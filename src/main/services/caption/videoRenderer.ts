/**
 * Video Renderer - Render video từ file ASS bằng FFmpeg
 * Port từ caption_funtion.py
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { 
  RenderVideoOptions, 
  RenderProgress, 
  RenderResult,
  VideoMetadata,
  ExtractFrameResult
} from '../../../shared/types/caption';
import { getFFmpegPath, getFFprobePath, isFFmpegAvailable } from '../../utils/ffmpegPath';
import { parseSrtFile } from './srtParser';
import { hexToAssColor, srtTimeToAss } from './assConverter';

/**
 * Lấy metadata của video bằng ffprobe
 */
export async function getVideoMetadata(videoPath: string): Promise<{
  success: boolean;
  metadata?: VideoMetadata;
  error?: string;
}> {
  if (!existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }
  
  const ffprobePath = getFFprobePath();
  
  if (!existsSync(ffprobePath)) {
    return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
  }
  
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath
    ];
    
    const process = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `ffprobe exit code: ${code}` });
        return;
      }
      
      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
        const audioStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');
        
        if (!videoStream && !audioStream) {
          resolve({ success: false, error: 'Không tìm thấy video hay audio stream' });
          return;
        }
        
        const fpsStr = videoStream?.r_frame_rate || '30/1';
        const fpsParts = fpsStr.split('/');
        const fps = fpsParts.length === 2 
          ? parseInt(fpsParts[0]) / parseInt(fpsParts[1]) 
          : 30;
        
        const metadata: VideoMetadata = {
          width: videoStream?.width || 1920,
          height: videoStream?.height || 1080,
          actualHeight: videoStream?.height || 1080,
          duration: parseFloat(info.format?.duration || '0'),
          frameCount: parseInt(videoStream?.nb_frames || '0') || Math.floor(parseFloat(info.format?.duration || '0') * fps),
          fps: Math.round(fps * 100) / 100,
          hasAudio: !!audioStream
        };
        
        resolve({ success: true, metadata });
        
      } catch (error) {
        resolve({ success: false, error: `Lỗi parse metadata: ${error}` });
      }
    });
    
    process.on('error', (error) => {
      resolve({ success: false, error: `Lỗi ffprobe: ${error.message}` });
    });
  });
}

/**
 * Extract một frame từ video để preview
 */
export async function extractVideoFrame(
  videoPath: string,
  frameNumber?: number
): Promise<ExtractFrameResult> {
  if (!existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }
  
  const ffmpegPath = getFFmpegPath();
  
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }
  
  const metadataResult = await getVideoMetadata(videoPath);
  if (!metadataResult.success || !metadataResult.metadata) {
    return { success: false, error: metadataResult.error || 'Không lấy được metadata' };
  }
  
  const { duration, width, height, fps } = metadataResult.metadata;
  
  let seekTime: number;
  if (frameNumber !== undefined) {
    seekTime = frameNumber / fps;
  } else {
    seekTime = duration * (0.1 + Math.random() * 0.8);
  }
  
  return new Promise((resolve) => {
    const args = [
      '-ss', seekTime.toFixed(2),
      '-i', videoPath,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ];
    
    const process = spawn(ffmpegPath, args);
    const chunks: Buffer[] = [];
    
    process.stdout.on('data', (data) => {
      chunks.push(data);
    });
    
    process.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve({ success: false, error: 'Không thể extract frame' });
        return;
      }
      
      const frameBuffer = Buffer.concat(chunks);
      const frameData = frameBuffer.toString('base64');
      
      resolve({
        success: true,
        frameData,
        width,
        height,
      });
    });
    
    process.on('error', (error) => {
      resolve({ success: false, error: `Lỗi ffmpeg: ${error.message}` });
    });
  });
}

/**
 * [HELPER] Tính duration và export file ASS tạm
 */
async function prepareSubtitleAndDuration(options: RenderVideoOptions) {
  const { srtPath, width, height: userHeight, videoPath } = options;
  const audioSpeed = options.audioSpeed && options.audioSpeed > 0 ? options.audioSpeed : 1.0;
  let rawDuration = options.targetDuration || 60;
  let srtEndTimeSec = 0;

  try {
    const srtCheck = await parseSrtFile(srtPath);
    if (srtCheck.success && srtCheck.entries.length > 0) {
      srtEndTimeSec = Math.ceil(srtCheck.entries[srtCheck.entries.length - 1].endMs / 1000) + 2;
    }
  } catch (e) {
    console.warn("[VideoRenderer] Lỗi đọc srtEndTimeSec", e);
  }

  let isDurationFromAudio = false;
  if (options.audioPath && existsSync(options.audioPath)) {
    const audioMeta = await getVideoMetadata(options.audioPath);
    if (audioMeta.success && audioMeta.metadata) {
      const audioDuration = audioMeta.metadata.duration;
      if (srtEndTimeSec > 0 && audioDuration > srtEndTimeSec * 2) {
        rawDuration = srtEndTimeSec;
      } else {
        rawDuration = audioDuration;
        isDurationFromAudio = true;
      }
    }
  }

  if (!isDurationFromAudio && !options.targetDuration) {
    if (srtEndTimeSec > 0) {
      rawDuration = srtEndTimeSec;
    }
  }

  const duration = rawDuration;
  const newAudioDuration = duration / audioSpeed;

  let finalWidth = width;
  let finalHeight = userHeight || 150;
  if (finalWidth % 2 !== 0) finalWidth += 1;
  if (finalHeight % 2 !== 0) finalHeight += 1;
  finalWidth = Math.max(64, Math.min(7680, finalWidth));
  finalHeight = Math.max(64, Math.min(4320, finalHeight));

  const tempAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);

  let renderWidth = finalWidth;
  let renderHeight = finalHeight;
  let needsScale = false;
  let hasVideoAudio = false;
  let originalVideoDuration = 0;
  let videoSpeedMultiplier = 1.0;

  if (videoPath && existsSync(videoPath)) {
    try {
      const probeResult = await getVideoMetadata(videoPath);
      if (probeResult.success && probeResult.metadata) {
        renderWidth = probeResult.metadata.width;
        renderHeight = probeResult.metadata.actualHeight || probeResult.metadata.height;
        hasVideoAudio = !!probeResult.metadata.hasAudio;
        originalVideoDuration = probeResult.metadata.duration;
        if (originalVideoDuration > 0 && newAudioDuration > 0) {
          videoSpeedMultiplier = originalVideoDuration / newAudioDuration;
        }
      }
    } catch (e) {}
  }

  let MAX_OUTPUT_HEIGHT = 1080;
  if (options.renderResolution === '720p') MAX_OUTPUT_HEIGHT = 720;
  if (options.renderResolution === '540p') MAX_OUTPUT_HEIGHT = 540;
  if (options.renderResolution === '360p') MAX_OUTPUT_HEIGHT = 360;
  if (options.renderResolution === 'original') MAX_OUTPUT_HEIGHT = 99999;
  
  let scaleFactor = 1;
  if (renderHeight > MAX_OUTPUT_HEIGHT && videoPath && existsSync(videoPath)) {
    scaleFactor = MAX_OUTPUT_HEIGHT / renderHeight;
    renderWidth = Math.round(renderWidth * scaleFactor);
    if (renderWidth % 2 !== 0) renderWidth += 1;
    renderHeight = MAX_OUTPUT_HEIGHT;
    needsScale = true;
  }

  const s = options.style || { fontName: 'Arial', fontSize: 48, fontColor: '#FFFF00', shadow: 2, marginV: 0, alignment: 5 };
  let effectiveFontSize = Math.round(s.fontSize * scaleFactor);
  let effectiveShadow = Math.max(0, Math.round(s.shadow * scaleFactor));
  let effectiveOutline = Math.max(1, Math.round(2 * scaleFactor));

  if (renderHeight < 400 && (!videoPath || !existsSync(videoPath))) {
    effectiveFontSize = Math.max(16, Math.floor(renderHeight * 0.9));
  } else if (effectiveFontSize > renderHeight * 0.15) {
    effectiveFontSize = Math.floor(renderHeight * 0.08);
  }

  const assColor = hexToAssColor(s.fontColor);
  const assAlignment = 5;
  const assMarginV = 0;

  const srtData = await parseSrtFile(srtPath);
  if (!srtData.success || srtData.entries.length === 0) {
    throw new Error(srtData.error || 'Không có subtitle entries');
  }

  for (let i = 0; i < srtData.entries.length - 1; i++) {
    const curr = srtData.entries[i];
    const next = srtData.entries[i + 1];
    if (curr.endMs >= next.startMs) {
      curr.endMs = next.startMs - 10;
      const d = new Date(curr.endMs);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
      curr.endTime = `${hh}:${mm}:${ss},${ms}`;
    }
  }

  let assContent = `[Script Info]
Title: NauChaoHeo Render
ScriptType: v4.00+
PlayResX: ${renderWidth}
PlayResY: ${renderHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.fontName},${effectiveFontSize},${assColor},&H000000FF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,${effectiveOutline},${effectiveShadow},${assAlignment},0,0,${assMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const msToAssTime = (ms: number): string => {
    const t = Math.max(0, Math.floor(ms));
    const h = Math.floor(t / 3600000);
    const m = Math.floor((t % 3600000) / 60000);
    const s = Math.floor((t % 60000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  };

  for (const entry of srtData.entries) {
    const startAss = msToAssTime(entry.startMs / videoSpeedMultiplier);
    const endAss = msToAssTime(entry.endMs / videoSpeedMultiplier);
    let text = (entry.translatedText || entry.text).replace(/\n/g, '\\N');
    if (options.position) {
      const posX = Math.round(options.position.x * scaleFactor);
      const posY = Math.round(options.position.y * scaleFactor);
      text = `{\\\\pos(${posX},${posY})}${text}`;
    }
    assContent += `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${text}\n`;
  }

  await fs.writeFile(tempAssPath, assContent, 'utf-8');

  return {
    tempAssPath, duration, newAudioDuration, renderWidth, renderHeight, finalWidth, finalHeight,
    needsScale, hasVideoAudio, originalVideoDuration, videoSpeedMultiplier, scaleFactor, audioSpeed
  };
}

/**
 * [HELPER] Lấy chuỗi filter ASS
 */
function getSubtitleFilter(tempAssPath: string) {
  const assPathEscaped = tempAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  let fontsDirParam = '';
  try {
    const fontsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'fonts')
      : path.join(app.getAppPath(), 'resources', 'fonts');
    if (existsSync(fontsDir)) {
      const fontsDirEscaped = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');
      fontsDirParam = `:fontsdir='${fontsDirEscaped}'`;
    }
  } catch (e) {}

  return `ass='${assPathEscaped}'${fontsDirParam}`;
}

/**
 * [HELPER] Run FFmpeg process
 */
function runFFmpegProcess(args: string[], totalFrames: number, fps: number, outputPath: string, tempAssPath: string, duration: number, progressCallback?: (progress: RenderProgress) => void): Promise<RenderResult> {
  const ffmpegPath = getFFmpegPath();
  return new Promise((resolve) => {
    const process = spawn(ffmpegPath, args);
    let stderr = '';
    
    process.stderr.on('data', (data) => {
      const line = data.toString();
      stderr += line;
      
      const frameMatch = line.match(/frame=\s*(\d+)/);
      if (frameMatch && progressCallback) {
        const currentFrame = parseInt(frameMatch[1], 10);
        const percent = Math.min(100, Math.round((currentFrame / totalFrames) * 100));
        progressCallback({
          currentFrame, totalFrames, fps, percent, status: 'rendering', message: `Đang render: ${percent}%`
        });
      }
    });
    
    process.on('close', async (code) => {
      try { await fs.unlink(tempAssPath); } catch (e) {}
      if (code === 0) {
        if (progressCallback) progressCallback({ currentFrame: totalFrames, totalFrames, fps, percent: 100, status: 'completed', message: 'Hoàn thành!' });
        resolve({ success: true, outputPath, duration });
      } else {
        if (progressCallback) progressCallback({ currentFrame: 0, totalFrames, fps: 0, percent: 0, status: 'error', message: `Lỗi render: ${stderr.substring(0, 200)}` });
        resolve({ success: false, error: stderr || `FFmpeg exit code: ${code}` });
      }
    });
    
    process.on('error', async (error) => {
      try { await fs.unlink(tempAssPath); } catch (e) {}
      resolve({ success: false, error: `Lỗi FFmpeg: ${error.message}` });
    });
  });
}

/**
 * Render video đè (Hardsub)
 */
export async function renderHardsubVideo(
  options: RenderVideoOptions,
  progressCallback?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  if (!options.videoPath || !existsSync(options.videoPath)) {
    return { success: false, error: 'Chế độ hardsub yêu cầu videoPath' };
  }

  const { outputPath } = options;
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const prep = await prepareSubtitleAndDuration(options);
  const subtitleFilter = getSubtitleFilter(prep.tempAssPath);

  const filterParts: string[] = [];
  if (prep.needsScale) filterParts.push(`scale=${prep.renderWidth}:${prep.renderHeight}`);
  if (options.blackoutTop != null && options.blackoutTop < 1) {
    const blackoutY = Math.round(options.blackoutTop * prep.renderHeight);
    const blackoutH = prep.renderHeight - blackoutY;
    filterParts.push(`drawbox=x=0:y=${blackoutY}:w=iw:h=${blackoutH}:color=black:t=fill`);
  }
  if (prep.videoSpeedMultiplier !== 1.0) {
    const ptsMultiplier = (1 / prep.videoSpeedMultiplier).toFixed(4);
    filterParts.push(`setpts=${ptsMultiplier}*PTS`);
  }
  filterParts.push(subtitleFilter);
  const videoFilter = filterParts.join(',');

  const videoCodec = options.useGpu ? 'h264_nvenc' : 'libx264';
  const codecParams = options.useGpu 
    ? ['-cq', '28', '-preset', 'p6', '-profile:v', 'high']
    : ['-preset', 'medium', '-crf', '23'];
  
  const finalDurationStr = prep.newAudioDuration.toFixed(3);
  
  const inputArgs = ['-stream_loop', '-1', '-i', options.videoPath];
  let hasTtsAudio = false;
  if (options.audioPath && existsSync(options.audioPath)) {
    inputArgs.push('-i', options.audioPath);
    hasTtsAudio = true;
  }
  
  let hasLogo = false;
  let logoInputIndex = -1;
  if (options.logoPath && existsSync(options.logoPath)) {
    inputArgs.push('-i', options.logoPath);
    hasLogo = true;
    logoInputIndex = inputArgs.filter(arg => arg === '-i').length - 1;
  }

  const filterComplexParts: string[] = [];
  
  const volVid = (options.videoVolume !== undefined) ? options.videoVolume / 100 : 1.0;
  const volAud = (options.audioVolume !== undefined) ? options.audioVolume / 100 : 1.0;

  const getAtempoFilter = (speed: number): string => {
    let s = speed;
    const filters = [];
    while (s < 0.5) { filters.push('atempo=0.5'); s /= 0.5; }
    while (s > 100.0) { filters.push('atempo=100.0'); s /= 100.0; }
    if (s !== 1.0) filters.push(`atempo=${s}`);
    return filters.join(',');
  };

  const vidAtempo = (prep.videoSpeedMultiplier !== 1.0) ? `,${getAtempoFilter(prep.videoSpeedMultiplier)}` : '';
  const audAtempo = (prep.audioSpeed !== 1.0) ? `,${getAtempoFilter(prep.audioSpeed)}` : '';

  if (prep.hasVideoAudio && hasTtsAudio) {
    // Ép kiểu về stereo và dùng apad để trôi tới hết thời lượng, amerge nối thành 4 kênh, pan gom về 2 kênh
    filterComplexParts.push(`[0:a]aformat=channel_layouts=stereo,volume=${volVid}${vidAtempo},apad[a_vid]`);
    filterComplexParts.push(`[1:a]aformat=channel_layouts=stereo,volume=${volAud}${audAtempo},apad[a_tts]`);
    filterComplexParts.push(`[a_vid][a_tts]amerge=inputs=2[a_merged]`);
    filterComplexParts.push(`[a_merged]pan=stereo|c0<c0+c2|c1<c1+c3[a_out]`);
  } else if (prep.hasVideoAudio && !hasTtsAudio && (volVid !== 1.0 || vidAtempo)) {
    filterComplexParts.push(`[0:a]volume=${volVid}${vidAtempo}[a_out]`);
  } else if (!prep.hasVideoAudio && hasTtsAudio && (volAud !== 1.0 || audAtempo)) {
    filterComplexParts.push(`[1:a]volume=${volAud}${audAtempo}[a_out]`);
  }
  
  filterComplexParts.push(`[0:v]${videoFilter}[v_base]`);

  if (hasLogo && logoInputIndex > 0) {
    const userLogoScale = options.logoScale ?? 1.0;
    const totalLogoScale = prep.scaleFactor * userLogoScale;
    const logoScaleFilter = totalLogoScale !== 1 ? `scale=iw*${totalLogoScale}:ih*${totalLogoScale}` : 'copy';
    
    let logoXAxis = `main_w-overlay_w-50*${prep.scaleFactor}`;
    let logoYAxis = `50*${prep.scaleFactor}`;
    
    if (options.logoPosition) {
      logoXAxis = `${Math.round(options.logoPosition.x * prep.scaleFactor)}-overlay_w/2`;
      logoYAxis = `${Math.round(options.logoPosition.y * prep.scaleFactor)}-overlay_w/2`;
    }
    
    filterComplexParts.push(`[${logoInputIndex}:v]${logoScaleFilter}[logo_scaled]`);
    filterComplexParts.push(`[v_base][logo_scaled]overlay=x=${logoXAxis}:y=${logoYAxis}[v_out]`);
  } else {
    filterComplexParts.push(`[v_base]copy[v_out]`);
  }

  const mapArgs: string[] = ['-map', '[v_out]'];
  if (prep.hasVideoAudio && hasTtsAudio) {
    mapArgs.push('-map', '[a_out]');
  } else if (prep.hasVideoAudio && !hasTtsAudio) {
    mapArgs.push('-map', (volVid !== 1.0 || vidAtempo) ? '[a_out]' : '0:a');
  } else if (!prep.hasVideoAudio && hasTtsAudio) {
    mapArgs.push('-map', (volAud !== 1.0 || audAtempo) ? '[a_out]' : '1:a');
  }

  const fps = 24;
  const args = [
    ...inputArgs,
    '-filter_complex', filterComplexParts.join(';'),
    ...mapArgs,
    '-c:v', videoCodec,
    ...codecParams,
    '-pix_fmt', 'yuv420p',
    '-r', fps.toString(),
    '-t', finalDurationStr,
    '-y',
    outputPath
  ];

  const totalFrames = Math.floor(prep.newAudioDuration * fps);
  return runFFmpegProcess(args, totalFrames, fps, outputPath, prep.tempAssPath, prep.duration, progressCallback);
}

/**
 * Render video chỉ có chữ nền đen (Black background)
 */
export async function renderBlackBackgroundVideo(
  options: RenderVideoOptions,
  progressCallback?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  const { outputPath } = options;
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const prep = await prepareSubtitleAndDuration(options);
  const subtitleFilter = getSubtitleFilter(prep.tempAssPath);

  const videoCodec = options.useGpu ? 'h264_nvenc' : 'libx264';
  const codecParams = options.useGpu 
    ? ['-cq', '28', '-preset', 'p6', '-profile:v', 'high']
    : ['-preset', 'medium', '-crf', '23'];
  
  const finalDurationStr = prep.newAudioDuration.toFixed(3);
  
  const fps = 24;
  const inputArgs = [
    '-f', 'lavfi',
    '-i', `color=black:s=${prep.finalWidth}x${prep.finalHeight}:r=${fps}`
  ];
  
  let hasTtsAudio = false;
  if (options.audioPath && existsSync(options.audioPath)) {
    inputArgs.push('-i', options.audioPath);
    hasTtsAudio = true;
  }

  const filterComplexParts: string[] = [];
  const volAud = (options.audioVolume !== undefined) ? options.audioVolume / 100 : 1.0;

  const getAtempoFilter = (speed: number): string => {
    let s = speed;
    const filters = [];
    while (s < 0.5) { filters.push('atempo=0.5'); s /= 0.5; }
    while (s > 100.0) { filters.push('atempo=100.0'); s /= 100.0; }
    if (s !== 1.0) filters.push(`atempo=${s}`);
    return filters.join(',');
  };

  const audAtempo = (prep.audioSpeed !== 1.0) ? `,${getAtempoFilter(prep.audioSpeed)}` : '';

  if (hasTtsAudio && (volAud !== 1.0 || audAtempo)) {
    filterComplexParts.push(`[1:a]volume=${volAud}${audAtempo}[a_out]`);
  }
  
  filterComplexParts.push(`[0:v]${subtitleFilter}[v_out]`);

  const mapArgs: string[] = ['-map', '[v_out]'];
  if (hasTtsAudio) {
    mapArgs.push('-map', (volAud !== 1.0 || audAtempo) ? '[a_out]' : '1:a');
  }

  const args = [
    ...inputArgs,
    '-filter_complex', filterComplexParts.join(';'),
    ...mapArgs,
    '-c:v', videoCodec,
    ...codecParams,
    '-pix_fmt', 'yuv420p',
    '-t', finalDurationStr,
    '-y',
    outputPath
  ];

  const totalFrames = Math.floor(prep.newAudioDuration * fps);
  return runFFmpegProcess(args, totalFrames, fps, outputPath, prep.tempAssPath, prep.duration, progressCallback);
}


/**
 * Route tự động theo options.renderMode
 */
export async function renderVideo(
  options: RenderVideoOptions,
  progressCallback?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  console.log(`[VideoRenderer] Route to ${options.renderMode || 'black_bg'} mode`);
  if (!isFFmpegAvailable()) {
    return { success: false, error: 'FFmpeg không được cài đặt' };
  }
  if (!existsSync(options.srtPath)) {
    return { success: false, error: `File SRT không tồn tại: ${options.srtPath}` };
  }
  if (options.renderMode === 'hardsub' && options.videoPath) {
    return renderHardsubVideo(options, progressCallback);
  } else {
    return renderBlackBackgroundVideo(options, progressCallback);
  }
}

/**
 * Tìm video gốc tốt nhất
 */
export async function findBestVideoInFolders(folderPaths: string[]): Promise<{
  success: boolean;
  videoPath?: string;
  metadata?: VideoMetadata;
  error?: string;
}> {
  const videoExtensions = ['.mp4', '.mov'];
  const potentialVideos: string[] = [];
  
  for (const dir of folderPaths) {
    if (!existsSync(dir)) continue;
    
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (videoExtensions.includes(ext)) {
          potentialVideos.push(path.join(dir, file));
        }
      }
    } catch (error) {
       console.error(`[VideoRenderer] Lỗi đọc thư mục ${dir}:`, error);
    }
  }

  if (potentialVideos.length === 0) {
    return { success: false, error: 'Không tìm thấy file video (.mp4, .mov) nào trong thư mục' };
  }

  type VideoStat = { path: string; metadata: VideoMetadata; area: number };
  const validVideos: VideoStat[] = [];
  
  for (const videoPath of potentialVideos) {
    const res = await getVideoMetadata(videoPath);
    if (res.success && res.metadata) {
      const realHeight = res.metadata.actualHeight || 1080;
      const maxDim = Math.max(res.metadata.width, realHeight);

      if (maxDim >= 720 && realHeight > 500) { 
        validVideos.push({
           path: videoPath,
           metadata: res.metadata,
           area: res.metadata.width * realHeight
        });
      }
    }
  }

  if (validVideos.length === 0) {
     return { success: false, error: 'Không có video nào đạt độ phân giải > 750p' };
  }

  validVideos.sort((a, b) => b.area - a.area);
  const bestVideo = validVideos[0];
  
  return { success: true, videoPath: bestVideo.path, metadata: bestVideo.metadata };
}
