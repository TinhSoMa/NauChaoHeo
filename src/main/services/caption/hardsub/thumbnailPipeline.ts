import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { RenderResult, RenderVideoOptions } from '../../../../shared/types/caption';
import { getFFmpegPath } from '../../../utils/ffmpegPath';
import { getVideoMetadata } from './mediaProbe';
import { summarizeThumbnailTextForLog } from './timingDebugWriter';

interface ThumbnailClipOptions {
  videoPath: string;
  timeSec: number;
  durationSec: number;
  thumbnailText?: string;
  thumbnailFontName?: string;
  width: number;
  height: number;
  fps?: number;
  includeAudio?: boolean;
}

async function createThumbnailClip(opts: ThumbnailClipOptions): Promise<{ success: boolean; clipPath?: string; error?: string }> {
  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg không tìm thấy' };
  }

  const tempDir = os.tmpdir();
  const ts = Date.now();
  const framePng = path.join(tempDir, `thumb_frame_${ts}.png`);
  const clipPath = path.join(tempDir, `thumb_clip_${ts}.mp4`);
  const textFilePath = path.join(tempDir, `thumb_text_${ts}.txt`);

  const safeW = opts.width % 2 === 0 ? opts.width : opts.width - 1;
  const safeH = opts.height % 2 === 0 ? opts.height : opts.height - 1;
  const safeFps = Number.isFinite(opts.fps) && (opts.fps || 0) > 0 ? Math.round(opts.fps || 24) : 24;
  const includeAudio = opts.includeAudio !== false;

  const escapeFilterPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const resolveFontsDir = (): string | null => {
    const candidates = [
      path.join(process.resourcesPath || '', 'fonts'),
      path.join(app.getAppPath(), 'resources', 'fonts'),
      path.join(process.cwd(), 'resources', 'fonts'),
      path.resolve('resources', 'fonts'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  const resolveThumbnailFontPath = async (fontName?: string): Promise<string | null> => {
    const fontsDir = resolveFontsDir();
    if (!fontsDir) {
      return null;
    }

    const requestedName = (fontName?.trim() || 'BrightwallPersonal').trim();
    const requestedNormalized = normalizeName(requestedName);

    try {
      const files = await fs.readdir(fontsDir);
      const fontFiles = files.filter((file) => file.toLowerCase().endsWith('.ttf') || file.toLowerCase().endsWith('.otf'));

      const exact = fontFiles.find((file) => normalizeName(path.parse(file).name) === requestedNormalized);
      if (exact) {
        return path.join(fontsDir, exact);
      }

      const close = fontFiles.find((file) => {
        const base = normalizeName(path.parse(file).name);
        return base.includes(requestedNormalized) || requestedNormalized.includes(base);
      });
      if (close) {
        return path.join(fontsDir, close);
      }

      const fallback = fontFiles.find((file) => normalizeName(path.parse(file).name) === 'brightwallpersonal')
        || fontFiles[0];
      return fallback ? path.join(fontsDir, fallback) : null;
    } catch {
      return null;
    }
  };

  const extractArgs = ['-y', '-ss', String(opts.timeSec), '-i', opts.videoPath, '-vframes', '1', '-q:v', '2', framePng];
  let extractStderr = '';
  const extractOk = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, extractArgs);
    proc.stderr?.on('data', (d) => { extractStderr += d.toString(); });
    proc.on('close', (code) => {
      const ok = code === 0 && existsSync(framePng);
      if (!ok) {
        console.error('[Thumbnail] extract frame failed (code', code, '):\n', extractStderr.slice(-800));
      }
      resolve(ok);
    });
    proc.on('error', (err) => {
      console.error('[Thumbnail] spawn extract error:', err);
      resolve(false);
    });
  });
  if (!extractOk) {
    return { success: false, error: `Không extract được frame thumbnail\n${extractStderr.slice(-400)}` };
  }

  const thumbnailFontSize = 145;
  const borderWidth = 4;
  const thumbnailFontPath = await resolveThumbnailFontPath(opts.thumbnailFontName);
  let textFilter = '';
  const baseVideoFilter = `scale=${safeW}:${safeH}`;
  if (opts.thumbnailText?.trim()) {
    const thumbnailText = opts.thumbnailText.trim();
    await fs.writeFile(textFilePath, thumbnailText, 'utf-8');
    if (!thumbnailFontPath) {
      console.warn('[Thumbnail] Không tìm thấy file font thumbnail, fallback dùng font mặc định của hệ thống.');
    }
    const fontParam = thumbnailFontPath ? `fontfile='${escapeFilterPath(thumbnailFontPath)}':` : '';
    textFilter =
      `,drawtext=textfile='${escapeFilterPath(textFilePath)}':reload=0:` +
      `${fontParam}fontcolor=yellow:fontsize=${thumbnailFontSize}:borderw=${borderWidth}:bordercolor=black:` +
      'text_shaping=1:fix_bounds=1:x=(w-text_w)/2:y=(h-text_h)/2';
  }
  const finalVideoFilter = `${baseVideoFilter}${textFilter}`;
  const thumbTextLog = summarizeThumbnailTextForLog(opts.thumbnailText);
  console.log(
    `[Thumbnail] create clip params | timeSec=${opts.timeSec}, durationSec=${opts.durationSec}, ` +
    `size=${safeW}x${safeH}, fps=${safeFps}, includeAudio=${includeAudio}, textLength=${thumbTextLog.length}, textPreview="${thumbTextLog.preview}", ` +
    `fontName=${opts.thumbnailFontName || 'BrightwallPersonal'}, fontFile=${thumbnailFontPath || 'system-default'}, fontSize=${thumbnailFontSize}, fontColor=yellow, border=${borderWidth}`
  );

  const clipArgs = includeAudio
    ? [
        '-y', '-loop', '1', '-r', String(safeFps), '-t', String(opts.durationSec), '-i', framePng,
        '-f', 'lavfi', '-t', String(opts.durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-vf', finalVideoFilter,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', String(safeFps), '-c:a', 'aac', '-b:a', '128k', '-shortest',
        '-map', '0:v', '-map', '1:a',
        clipPath,
      ]
    : [
        '-y', '-loop', '1', '-r', String(safeFps), '-t', String(opts.durationSec), '-i', framePng,
        '-vf', finalVideoFilter,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', String(safeFps), '-an',
        clipPath,
      ];

  let clipStderr = '';
  const clipOk = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, clipArgs);
    proc.stderr?.on('data', (d) => { clipStderr += d.toString(); });
    proc.on('close', (code) => {
      const ok = code === 0 && existsSync(clipPath);
      if (!ok) {
        console.error('[Thumbnail] create clip failed (code', code, '):\n', clipStderr.slice(-1200));
      }
      resolve(ok);
    });
    proc.on('error', (err) => {
      console.error('[Thumbnail] spawn clip error:', err);
      resolve(false);
    });
  });

  try { await fs.unlink(framePng); } catch {}
  try { await fs.unlink(textFilePath); } catch {}

  if (!clipOk) {
    return { success: false, error: `Không tạo được thumbnail clip\n${clipStderr.slice(-400)}` };
  }

  console.log(`[Thumbnail] clip tạo thành công: ${clipPath}`);
  return { success: true, clipPath };
}

async function prependThumbnailClip(
  thumbnailClipPath: string,
  mainOutputPath: string,
  hasAudio: boolean
): Promise<{ success: boolean; error?: string }> {
  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg không tìm thấy' };
  }
  if (!existsSync(mainOutputPath)) {
    return { success: false, error: `Không tìm thấy file render chính: ${mainOutputPath}` };
  }

  const dir = path.dirname(mainOutputPath);
  const ext = path.extname(mainOutputPath);
  const ts = Date.now();
  const tempConcatPath = path.join(dir, `_concat_thumb_temp_${ts}${ext}`);
  const backupMainPath = path.join(dir, `_main_backup_${ts}${ext}`);
  const concatListPath = path.join(dir, `_concat_list_${ts}.txt`);

  const toConcatPath = (p: string) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
  const concatListContent = `file '${toConcatPath(thumbnailClipPath)}'\nfile '${toConcatPath(mainOutputPath)}'\n`;
  try {
    await fs.writeFile(concatListPath, concatListContent, 'utf-8');
  } catch (writeErr) {
    return { success: false, error: `Không thể tạo file concat list: ${writeErr}` };
  }

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-movflags', '+faststart', tempConcatPath];
  let concatStderr = '';
  const pushStderr = (chunk: string): void => {
    concatStderr += chunk;
    if (concatStderr.length > 12000) {
      concatStderr = concatStderr.slice(-12000);
    }
  };

  return new Promise((resolve) => {
    console.log(`[Thumbnail] Bắt đầu concat demuxer (tách luồng, không render lại toàn bộ video), hasAudio=${hasAudio}...`);
    const proc = spawn(ffmpegPath, args);
    proc.stderr?.on('data', (d) => { pushStderr(d.toString()); });
    proc.on('close', async (code) => {
      try { await fs.unlink(thumbnailClipPath); } catch {}
      try { await fs.unlink(concatListPath); } catch {}

      if (code === 0 && existsSync(tempConcatPath)) {
        try {
          await fs.rename(mainOutputPath, backupMainPath);
          try {
            await fs.rename(tempConcatPath, mainOutputPath);
            try { await fs.unlink(backupMainPath); } catch {}
            resolve({ success: true });
            return;
          } catch (swapErr) {
            console.error('[Thumbnail] Swap file sau concat thất bại:', swapErr);
            try {
              if (existsSync(mainOutputPath)) {
                await fs.unlink(mainOutputPath);
              }
            } catch {}
            try { await fs.rename(backupMainPath, mainOutputPath); } catch {}
            try { await fs.unlink(tempConcatPath); } catch {}
            resolve({ success: false, error: `Không thể thay thế file output sau concat: ${swapErr}` });
            return;
          }
        } catch (backupErr) {
          console.error('[Thumbnail] Tạo backup file output thất bại:', backupErr);
          try { await fs.unlink(tempConcatPath); } catch {}
          resolve({ success: false, error: `Không thể backup file output trước khi thay thế: ${backupErr}` });
          return;
        }
      }

      try { await fs.unlink(tempConcatPath); } catch {}
      console.error('[Thumbnail] concat failed (code', code, '):\n', concatStderr.slice(-1200));
      resolve({ success: false, error: `Ghép thumbnail thất bại (exit ${code})\n${concatStderr.slice(-400)}` });
    });

    proc.on('error', async (err) => {
      try { await fs.unlink(thumbnailClipPath); } catch {}
      try { await fs.unlink(concatListPath); } catch {}
      try { await fs.unlink(tempConcatPath); } catch {}
      resolve({ success: false, error: err.message });
    });
  });
}

export async function applyThumbnailPostProcess(
  options: RenderVideoOptions,
  result: RenderResult
): Promise<RenderResult> {
  console.log(`[VideoRenderer] Thumbnail check: enabled=${options.thumbnailEnabled}, videoPath=${!!options.videoPath}, timeSec=${options.thumbnailTimeSec}`);
  if (!result.success || !options.thumbnailEnabled) {
    return result;
  }

  if (!options.videoPath || options.thumbnailTimeSec === undefined) {
    return {
      success: false,
      error: 'Thiếu cấu hình thumbnail: cần videoPath và thumbnailTimeSec khi bật thumbnailEnabled.',
    };
  }

  const outputMeta = await getVideoMetadata(options.outputPath);
  if (!outputMeta.success || !outputMeta.metadata) {
    return {
      success: false,
      error: `Không đọc được metadata output để tạo thumbnail: ${outputMeta.error || 'unknown error'}`,
    };
  }

  console.log('[VideoRenderer] Thumbnail output metadata', {
    width: outputMeta.metadata.width,
    height: outputMeta.metadata.actualHeight || outputMeta.metadata.height,
    fps: outputMeta.metadata.fps,
    hasAudio: !!outputMeta.metadata.hasAudio,
    duration: outputMeta.metadata.duration,
  });

  const thumbTextLog = summarizeThumbnailTextForLog(options.thumbnailText);
  console.log(
    `[VideoRenderer] 🖼 Tạo thumbnail tại ${options.thumbnailTimeSec}s`,
    {
      textLength: thumbTextLog.length,
      textPreview: thumbTextLog.preview,
      thumbnailFontName: options.thumbnailFontName || 'BrightwallPersonal',
    }
  );

  const thumbResult = await createThumbnailClip({
    videoPath: options.videoPath,
    timeSec: options.thumbnailTimeSec,
    durationSec: 0.2,
    thumbnailText: options.thumbnailText,
    thumbnailFontName: options.thumbnailFontName,
    width: outputMeta.metadata.width,
    height: outputMeta.metadata.actualHeight || outputMeta.metadata.height,
    fps: outputMeta.metadata.fps,
    includeAudio: !!outputMeta.metadata.hasAudio,
  });

  if (!thumbResult.success || !thumbResult.clipPath) {
    return { success: false, error: `Tạo thumbnail thất bại: ${thumbResult.error || 'unknown error'}` };
  }

  console.log('[VideoRenderer] Ghép thumbnail vào đầu video...');
  const prependResult = await prependThumbnailClip(
    thumbResult.clipPath,
    options.outputPath,
    !!outputMeta.metadata.hasAudio
  );

  if (!prependResult.success) {
    return { success: false, error: `Ghép thumbnail thất bại: ${prependResult.error || 'unknown error'}` };
  }

  console.log('[VideoRenderer] ✅ Thumbnail đã ghép thành công');
  return result;
}
