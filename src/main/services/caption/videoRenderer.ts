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
import { prepareSubtitleAndDuration, getSubtitleFilter } from './subtitleAssBuilder';
import { unregisterTempFile } from './garbageCollector';

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

function buildAtempoFilter(speed: number): string {
  let s = speed;
  const filters: string[] = [];
  while (s < 0.5) { filters.push('atempo=0.5'); s /= 0.5; }
  while (s > 100.0) { filters.push('atempo=100.0'); s /= 100.0; }
  if (Math.abs(s - 1.0) > 0.0001) filters.push(`atempo=${s.toFixed(4)}`);
  return filters.join(',');
}

function getAudioCodecArgs(audioPath: string): string[] {
  if (audioPath.toLowerCase().endsWith('.wav')) {
    return ['-c:a', 'pcm_s16le'];
  }
  return ['-c:a', 'libmp3lame', '-b:a', '192k'];
}

async function buildSpeedAdjustedAudioFile(
  audioPath: string | undefined,
  audioSpeed: number
): Promise<{ success: boolean; audioPath?: string; generated: boolean; error?: string }> {
  if (!audioPath || !existsSync(audioPath)) {
    return { success: true, audioPath, generated: false };
  }

  if (!audioSpeed || Math.abs(audioSpeed - 1.0) < 0.0001) {
    return { success: true, audioPath, generated: false };
  }

  const atempo = buildAtempoFilter(audioSpeed);
  if (!atempo) {
    return { success: true, audioPath, generated: false };
  }

  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, generated: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }

  const ext = path.extname(audioPath) || '.wav';
  const speedLabel = audioSpeed.toFixed(2).replace('.', '_');
  const adjustedAudioPath = path.join(path.dirname(audioPath), `audio_${speedLabel}${ext}`);

  return new Promise((resolve) => {
    const args = [
      '-y',
      '-i', audioPath,
      '-af', atempo,
      ...getAudioCodecArgs(adjustedAudioPath),
      adjustedAudioPath,
    ];

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      shell: false,
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[VideoRenderer] Đã tạo audio speed-adjusted: ${adjustedAudioPath} (speed=${audioSpeed})`);
        resolve({ success: true, audioPath: adjustedAudioPath, generated: true });
      } else {
        resolve({
          success: false,
          generated: false,
          error: stderr || `FFmpeg exit code: ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      resolve({ success: false, generated: false, error: `Lỗi ffmpeg speed-adjust: ${error.message}` });
    });
  });
}

async function readMediaDurationSec(mediaPath?: string): Promise<number | null> {
  if (!mediaPath || !existsSync(mediaPath)) {
    return null;
  }
  const meta = await getVideoMetadata(mediaPath);
  if (!meta.success || !meta.metadata) {
    return null;
  }
  return meta.metadata.duration > 0 ? meta.metadata.duration : null;
}

async function readSrtDurationSec(srtPath?: string): Promise<number | null> {
  if (!srtPath || !existsSync(srtPath)) {
    return null;
  }
  try {
    const parsed = await parseSrtFile(srtPath);
    if (!parsed.success || !parsed.entries.length) {
      return null;
    }
    const lastEndMs = Math.max(...parsed.entries.map((entry) => entry.endMs || 0));
    return lastEndMs > 0 ? lastEndMs / 1000 : null;
  } catch {
    return null;
  }
}

function roundValue(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return Math.round(value * 1000) / 1000;
}

async function writeHardsubTimingJson(outputVideoPath: string, payload: unknown): Promise<string> {
  const ext = path.extname(outputVideoPath);
  const base = outputVideoPath.slice(0, outputVideoPath.length - ext.length);
  const jsonPath = `${base}_timing.json`;
  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
  return jsonPath;
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
      try { 
        unregisterTempFile(tempAssPath);
        await fs.unlink(tempAssPath); 
      } catch (e) {}
      if (code === 0) {
        if (progressCallback) progressCallback({ currentFrame: totalFrames, totalFrames, fps, percent: 100, status: 'completed', message: 'Hoàn thành!' });
        resolve({ success: true, outputPath, duration });
      } else {
        if (progressCallback) progressCallback({ currentFrame: 0, totalFrames, fps: 0, percent: 0, status: 'error', message: `Lỗi render: ${stderr.substring(0, 200)}` });
        resolve({ success: false, error: stderr || `FFmpeg exit code: ${code}` });
      }
    });
    
    process.on('error', async (error) => {
      try { 
        unregisterTempFile(tempAssPath);
        await fs.unlink(tempAssPath); 
      } catch (e) {}
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

  const audioSpeedInput = options.audioSpeed && options.audioSpeed > 0 ? options.audioSpeed : 1.0;
  const adjustedAudio = await buildSpeedAdjustedAudioFile(options.audioPath, audioSpeedInput);
  if (!adjustedAudio.success) {
    return { success: false, error: adjustedAudio.error || 'Không thể tạo audio speed-adjusted' };
  }

  const renderOptions: RenderVideoOptions = {
    ...options,
    audioPath: adjustedAudio.audioPath,
    // Audio đã được tăng tốc/giảm tốc thành file riêng -> không áp atempo lần nữa ở bước render.
    audioSpeed: 1.0,
    step7AudioSpeedInput: audioSpeedInput,
  };

  const prep = await prepareSubtitleAndDuration(renderOptions);
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

  let hwaccelArgs: string[] = [];
  let videoCodec = 'libx264';
  let codecParams = ['-preset', 'medium', '-crf', '23'];

  if (options.hardwareAcceleration === 'qsv') {
    hwaccelArgs = ['-hwaccel', 'auto'];
    videoCodec = 'h264_qsv';
    codecParams = ['-preset', 'fast', '-global_quality', '25'];
  }
  
  // Hardsub: tính thời lượng output đúng cho cả 2 trường hợp:
  //   - videoSpeedMultiplier < 1 (video chậm đi):  stretchedVideo > newAudio  → dùng stretchedVideo
  //   - videoSpeedMultiplier > 1 (video tăng tốc): stretchedVideo < newAudio  → dùng newAudio
  // Luôn lấy max để không cắt bất kỳ nguồn nào sớm hơn cần thiết.
  const stretchedVideoDuration = prep.originalVideoDuration > 0 && prep.videoSpeedMultiplier > 0
    ? prep.originalVideoDuration / prep.videoSpeedMultiplier
    : prep.originalVideoDuration;
  const outputDuration = Math.max(
    stretchedVideoDuration > 0 ? stretchedVideoDuration : 0,
    prep.newAudioDuration > 0 ? prep.newAudioDuration : 0
  ) || prep.newAudioDuration;
  const finalDurationStr = outputDuration.toFixed(3);
  console.log(
    `[VideoRenderer] Hardsub duration | videoTotal=${prep.originalVideoDuration.toFixed(3)}s, ` +
    `videoSpeedMultiplier=${prep.videoSpeedMultiplier.toFixed(4)}, stretchedVideo=${stretchedVideoDuration.toFixed(3)}s, ` +
    `audioForSync=${prep.newAudioDuration.toFixed(3)}s, outputDuration=${outputDuration.toFixed(3)}s`
  );
  
  const inputArgs = [...hwaccelArgs, '-i', renderOptions.videoPath!];
  let hasTtsAudio = false;
  if (renderOptions.audioPath && existsSync(renderOptions.audioPath)) {
    inputArgs.push('-i', renderOptions.audioPath);
    hasTtsAudio = true;
  }
  const subtitleDurationScaledSec = prep.subRenderDuration > 0 ? prep.subRenderDuration : prep.duration;
  const trimApplied = false;

  const step4SrtScale = prep.step4ScaleUsed && prep.step4ScaleUsed > 0
    ? prep.step4ScaleUsed
    : (options.step4SrtScale && options.step4SrtScale > 0 ? options.step4SrtScale : 1.0);
  const srtTimeScaleConfigured = prep.configuredSrtTimeScale > 0 ? prep.configuredSrtTimeScale : 1.0;
  const srtTimeScaleApplied = prep.appliedSrtTimeScale > 0 ? prep.appliedSrtTimeScale : 1.0;
  const step7AudioSpeed = prep.step7SpeedUsed && prep.step7SpeedUsed > 0 ? prep.step7SpeedUsed : audioSpeedInput;
  const audioEffectiveSpeed = prep.audioEffectiveSpeed;
  let subtitleDurationOriginalSec = prep.videoSubBaseDuration > 0 ? prep.videoSubBaseDuration : 0;
  const videoMarkerSec = prep.videoMarkerSec > 0 ? prep.videoMarkerSec : 0;
  const audioStartInOutputSec = hasTtsAudio ? 0 : null;
  const audioEndInOutputSec = hasTtsAudio ? Math.min(prep.newAudioDuration, outputDuration) : null;
  const resolvedVideoMarkerSec = videoMarkerSec > 0
    ? videoMarkerSec
    : ((audioEndInOutputSec ?? 0) * (prep.videoSpeedMultiplier > 0 ? prep.videoSpeedMultiplier : 1.0));
  const audioStartInVideoSec = hasTtsAudio ? 0 : null;
  const audioEndInVideoSec = hasTtsAudio ? resolvedVideoMarkerSec : null;

  const translatedSrtPath = path.join(path.dirname(options.srtPath), 'translated.srt');
  const translatedSrtDurationSec = subtitleDurationOriginalSec <= 0 ? await readSrtDurationSec(translatedSrtPath) : null;
  if (subtitleDurationOriginalSec <= 0 && translatedSrtDurationSec && translatedSrtDurationSec > 0) {
    subtitleDurationOriginalSec = translatedSrtDurationSec;
  }

  const audioOriginalDurationSec = await readMediaDurationSec(options.audioPath);
  const audioAfterSpeedDurationSec = await readMediaDurationSec(renderOptions.audioPath);
  const videoSubDurationAfterScaleSec = subtitleDurationOriginalSec * step4SrtScale;
  
  let hasLogo = false;
  let logoInputIndex = -1;
  if (renderOptions.logoPath && existsSync(renderOptions.logoPath)) {
    inputArgs.push('-i', renderOptions.logoPath);
    hasLogo = true;
    logoInputIndex = inputArgs.filter(arg => arg === '-i').length - 1;
  }

  const filterComplexParts: string[] = [];
  
  const volVid = (renderOptions.videoVolume !== undefined) ? renderOptions.videoVolume / 100 : 1.0;
  const volAud = (renderOptions.audioVolume !== undefined) ? renderOptions.audioVolume / 100 : 1.0;

  const vidAtempo = (prep.videoSpeedMultiplier !== 1.0) ? `,${buildAtempoFilter(prep.videoSpeedMultiplier)}` : '';
  const audAtempo = (prep.audioSpeed !== 1.0) ? `,${buildAtempoFilter(prep.audioSpeed)}` : '';

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
    const userLogoScale = renderOptions.logoScale ?? 1.0;
    const totalLogoScale = prep.scaleFactor * userLogoScale;
    const logoScaleFilter = totalLogoScale !== 1 ? `scale=iw*${totalLogoScale}:ih*${totalLogoScale}` : 'copy';
    
    let logoXAxis = `main_w-overlay_w-50*${prep.scaleFactor}`;
    let logoYAxis = `50*${prep.scaleFactor}`;
    
    if (renderOptions.logoPosition) {
      logoXAxis = `${Math.round(renderOptions.logoPosition.x * prep.scaleFactor)}-overlay_w/2`;
      logoYAxis = `${Math.round(renderOptions.logoPosition.y * prep.scaleFactor)}-overlay_w/2`;
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
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-r', fps.toString(),
    '-t', finalDurationStr,
    '-y',
    outputPath
  ];

  const hardsubTimingDebug = {
    generatedAt: new Date().toISOString(),
    paths: {
      inputVideo: renderOptions.videoPath ?? null,
      inputAudioOriginal: options.audioPath ?? null,
      inputAudioAfterStep7Scale: renderOptions.audioPath ?? null,
      inputSrtForRender: options.srtPath,
      translatedSrt_1_0x: existsSync(translatedSrtPath) ? translatedSrtPath : null,
      outputVideo: outputPath,
    },
    beforeSlowdownOriginal: {
      videoOriginalDurationSec: roundValue(prep.originalVideoDuration),
      videoWithSubtitleDurationSec_1_0x: roundValue(subtitleDurationOriginalSec),
      audioOriginalDurationSec: roundValue(audioOriginalDurationSec),
      audioAfterStep7ScaleDurationSec: roundValue(audioAfterSpeedDurationSec),
    },
    afterScale: {
      calcMode: 'audio_speed_adjusted_video_marker',
      audioSpeedModel: options.audioSpeedModel || 'step4_minus_step7_delta',
      step4SrtScale,
      srtTimeScaleConfigured,
      srtTimeScaleApplied,
      srtAlreadyScaled: prep.srtAlreadyScaled,
      step7AudioSpeedInput: step7AudioSpeed,
      audioEffectiveSpeed: roundValue(audioEffectiveSpeed),
      subtitleDurationScaledSec: roundValue(subtitleDurationScaledSec),
      videoWithSubtitleDurationAfterStep4ScaleSec: roundValue(videoSubDurationAfterScaleSec),
      videoMarkerSec: roundValue(videoMarkerSec),
      videoSpeedNeeded: roundValue(prep.videoSpeedMultiplier),
    },
    mergeWindowInVideo: hasTtsAudio
      ? {
          startSec: roundValue(audioStartInVideoSec),
          endSec: roundValue(audioEndInVideoSec),
          startLabel: `${(audioStartInVideoSec ?? 0).toFixed(3)}s`,
          endLabel: `${(audioEndInVideoSec ?? 0).toFixed(3)}s`,
        }
      : null,
    mergeWindowInOutputTimeline: hasTtsAudio
      ? {
          startSec: roundValue(audioStartInOutputSec),
          endSec: roundValue(audioEndInOutputSec),
          startLabel: `${(audioStartInOutputSec ?? 0).toFixed(3)}s`,
          endLabel: `${(audioEndInOutputSec ?? 0).toFixed(3)}s`,
        }
      : null,
    render: {
      outputRenderDurationSec: roundValue(outputDuration),
      stretchedVideoDurationSec: roundValue(stretchedVideoDuration),
      videoSpeedMultiplier: roundValue(prep.videoSpeedMultiplier),
      trimApplied,
      hasVideoAudio: prep.hasVideoAudio,
      hasTtsAudio,
      speedCalcSource: prep.speedCalcSource,
    },
  };

  let timingJsonPath: string | null = null;
  try {
    timingJsonPath = await writeHardsubTimingJson(outputPath, hardsubTimingDebug);
  } catch (error) {
    console.warn('[VideoRenderer][Hardsub] Không thể ghi timing JSON:', error);
  }

  console.log('[VideoRenderer][Hardsub] Render config', {
    inputVideo: renderOptions.videoPath,
    inputAudio: renderOptions.audioPath ?? null,
    outputVideo: outputPath,
    timingJsonPath,
    hasVideoAudio: prep.hasVideoAudio,
    hasTtsAudio,
    audioMergeWindowInVideo: hasTtsAudio
      ? {
          startSec: audioStartInVideoSec,
          endSec: audioEndInVideoSec,
          startLabel: `${(audioStartInVideoSec ?? 0).toFixed(3)}s`,
          endLabel: `${(audioEndInVideoSec ?? 0).toFixed(3)}s`,
        }
      : null,
    audioMergeWindowInOutputTimeline: hasTtsAudio
      ? {
          startSec: audioStartInOutputSec,
          endSec: audioEndInOutputSec,
          startLabel: `${(audioStartInOutputSec ?? 0).toFixed(3)}s`,
          endLabel: `${(audioEndInOutputSec ?? 0).toFixed(3)}s`,
        }
      : null,
    duration: {
      videoTotalSec: prep.originalVideoDuration,
      ttsEffectiveSec: prep.newAudioDuration,
      outputRenderSec: outputDuration,
    },
    speed: {
      calcMode: 'audio_speed_adjusted_video_marker',
      audioSpeedModel: options.audioSpeedModel || 'step4_minus_step7_delta',
      videoSpeedMultiplier: prep.videoSpeedMultiplier,
      audioSpeedInput: step7AudioSpeed,
      step4SrtScale,
      srtTimeScaleConfigured,
      srtTimeScaleApplied,
      srtAlreadyScaled: prep.srtAlreadyScaled,
      audioEffectiveSpeed,
      audioPreAdjustedFile: adjustedAudio.generated,
      speedCalcSource: prep.speedCalcSource,
    },
    sourceDuration: {
      videoOriginalSec: prep.originalVideoDuration,
      subtitle_1_0x_sec: subtitleDurationOriginalSec,
      subtitleScaledSec: subtitleDurationScaledSec,
      audioOriginalSec: audioOriginalDurationSec,
      audioAfterStep7ScaleSec: audioAfterSpeedDurationSec,
      videoMarkerSec,
    },
    subtitleWindow: {
      subtitleEndSec: prep.duration,
      trimApplied,
    },
    note: 'Không trim audio/video. mergeWindowInVideo là timeline video gốc; mergeWindowInOutputTimeline là timeline sau setpts.',
  });

  const totalFrames = Math.floor(outputDuration * fps);
  return runFFmpegProcess(args, totalFrames, fps, outputPath, prep.tempAssPath, outputDuration, progressCallback);
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

  const audioSpeedInput = options.audioSpeed && options.audioSpeed > 0 ? options.audioSpeed : 1.0;
  const adjustedAudio = await buildSpeedAdjustedAudioFile(options.audioPath, audioSpeedInput);
  if (!adjustedAudio.success) {
    return { success: false, error: adjustedAudio.error || 'Không thể tạo audio speed-adjusted' };
  }

  const renderOptions: RenderVideoOptions = {
    ...options,
    audioPath: adjustedAudio.audioPath,
    audioSpeed: 1.0,
    step7AudioSpeedInput: audioSpeedInput,
  };

  const prep = await prepareSubtitleAndDuration(renderOptions);
  const subtitleFilter = getSubtitleFilter(prep.tempAssPath);

  let videoCodec = 'libx264';
  let codecParams = ['-preset', 'medium', '-crf', '23'];

  if (options.hardwareAcceleration === 'qsv') {
    videoCodec = 'h264_qsv';
    codecParams = ['-preset', 'fast', '-global_quality', '25'];
  }
  
  const finalDurationStr = prep.newAudioDuration.toFixed(3);
  
  const fps = 24;
  const inputArgs = [
    '-f', 'lavfi',
    '-i', `color=black:s=${prep.finalWidth}x${prep.finalHeight}:r=${fps}`
  ];
  
  let hasTtsAudio = false;
  if (renderOptions.audioPath && existsSync(renderOptions.audioPath)) {
    inputArgs.push('-i', renderOptions.audioPath);
    hasTtsAudio = true;
  }

  const filterComplexParts: string[] = [];
  const volAud = (renderOptions.audioVolume !== undefined) ? renderOptions.audioVolume / 100 : 1.0;

  const audAtempo = (prep.audioSpeed !== 1.0) ? `,${buildAtempoFilter(prep.audioSpeed)}` : '';

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
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-t', finalDurationStr,
    '-y',
    outputPath
  ];

  const totalFrames = Math.floor(prep.newAudioDuration * fps);
  return runFFmpegProcess(args, totalFrames, fps, outputPath, prep.tempAssPath, prep.duration, progressCallback);
}


/**
 * [THUMBNAIL] Tạo clip freeze-frame 0.2s từ một frame trong video
 * Dùng 2 bước: extract PNG → tạo clip từ ảnh tĩnh
 */
async function createThumbnailClip(opts: {
  videoPath: string;
  timeSec: number;
  durationSec: number;
  thumbnailText?: string;
  width: number;
  height: number;
  fps?: number;
  includeAudio?: boolean;
}): Promise<{ success: boolean; clipPath?: string; error?: string }> {
  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) return { success: false, error: 'FFmpeg không tìm thấy' };

  const tempDir = os.tmpdir();
  const ts = Date.now();
  const framePng = path.join(tempDir, `thumb_frame_${ts}.png`);
  const clipPath = path.join(tempDir, `thumb_clip_${ts}.mp4`);
  const textFilePath = path.join(tempDir, `thumb_text_${ts}.txt`);

  // Đảm bảo width/height là số chẵn (libx264 yêu cầu)
  const safeW = opts.width % 2 === 0 ? opts.width : opts.width - 1;
  const safeH = opts.height % 2 === 0 ? opts.height : opts.height - 1;
  const safeFps = Number.isFinite(opts.fps) && (opts.fps || 0) > 0 ? Math.round(opts.fps || 24) : 24;
  const includeAudio = opts.includeAudio !== false;

  const escapeFilterPath = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const resolveThumbnailFontPath = (): string | null => {
    const candidates = [
      path.join(process.resourcesPath, 'fonts', 'BrightwallPersonal.ttf'),
      path.join(app.getAppPath(), 'resources', 'fonts', 'BrightwallPersonal.ttf'),
      path.join(process.cwd(), 'resources', 'fonts', 'BrightwallPersonal.ttf'),
      path.resolve('resources', 'fonts', 'BrightwallPersonal.ttf'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  // Step 1: extract 1 frame từ videoPath tại timeSec
  const extractArgs = [
    '-y',
    '-ss', String(opts.timeSec),
    '-i', opts.videoPath,
    '-vframes', '1',
    '-q:v', '2',
    framePng,
  ];
  let extractStderr = '';
  const extractOk = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, extractArgs);
    proc.stderr?.on('data', (d) => { extractStderr += d.toString(); });
    proc.on('close', (code) => {
      const ok = code === 0 && existsSync(framePng);
      if (!ok) console.error('[Thumbnail] extract frame failed (code', code, '):\n', extractStderr.slice(-800));
      resolve(ok);
    });
    proc.on('error', (err) => { console.error('[Thumbnail] spawn extract error:', err); resolve(false); });
  });
  if (!extractOk) return { success: false, error: `Không extract được frame thumbnail\n${extractStderr.slice(-400)}` };

  // Step 2: tạo clip từ ảnh tĩnh (-t ĐẶT TRƯỚC -i để giới hạn input loop duration)
  const thumbnailFontSizeMax = 145;
  const thumbnailFontSize = thumbnailFontSizeMax;
  const borderWidth = 4;
  const thumbnailFontPath = resolveThumbnailFontPath();
  let textFilter = '';
  const baseVideoFilter = `scale=${safeW}:${safeH}`;
  if (opts.thumbnailText?.trim()) {
    const thumbnailText = opts.thumbnailText.trim();
    await fs.writeFile(textFilePath, thumbnailText, 'utf-8');
    if (!thumbnailFontPath) {
      console.warn('[Thumbnail] Không tìm thấy BrightwallPersonal.ttf, fallback dùng font mặc định của hệ thống.');
    }
    const fontParam = thumbnailFontPath
      ? `fontfile='${escapeFilterPath(thumbnailFontPath)}':`
      : '';
    textFilter =
      `,drawtext=textfile='${escapeFilterPath(textFilePath)}':reload=0:` +
      `${fontParam}fontcolor=yellow:fontsize=${thumbnailFontSize}:borderw=${borderWidth}:bordercolor=black:` +
      `text_shaping=1:fix_bounds=1:x=(w-text_w)/2:y=(h-text_h)/2`;
  }
  const finalVideoFilter = `${baseVideoFilter}${textFilter}`;
  console.log(
    `[Thumbnail] create clip params | timeSec=${opts.timeSec}, durationSec=${opts.durationSec}, ` +
    `size=${safeW}x${safeH}, fps=${safeFps}, includeAudio=${includeAudio}, text="${opts.thumbnailText || ''}", ` +
    `font=${thumbnailFontPath || 'system-default'}, fontSize=${thumbnailFontSize}, fontColor=yellow, border=${borderWidth}`
  );

  const clipArgs = includeAudio
    ? [
        '-y',
        '-loop', '1',
        '-r', String(safeFps),
        '-t', String(opts.durationSec), // giới hạn ngay input image (trước -i)
        '-i', framePng,
        '-f', 'lavfi',
        '-t', String(opts.durationSec), // giới hạn anullsrc
        '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
        '-vf', finalVideoFilter,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-r', String(safeFps),
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-map', '0:v',
        '-map', '1:a',
        clipPath,
      ]
    : [
        '-y',
        '-loop', '1',
        '-r', String(safeFps),
        '-t', String(opts.durationSec),
        '-i', framePng,
        '-vf', finalVideoFilter,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-r', String(safeFps),
        '-an',
        clipPath,
      ];
  let clipStderr = '';
  const clipOk = await new Promise<boolean>((resolve) => {
    const proc = spawn(ffmpegPath, clipArgs);
    proc.stderr?.on('data', (d) => { clipStderr += d.toString(); });
    proc.on('close', (code) => {
      const ok = code === 0 && existsSync(clipPath);
      if (!ok) console.error('[Thumbnail] create clip failed (code', code, '):\n', clipStderr.slice(-1200));
      resolve(ok);
    });
    proc.on('error', (err) => { console.error('[Thumbnail] spawn clip error:', err); resolve(false); });
  });

  // Xóa file tạm
  try { await fs.unlink(framePng); } catch {}
  try { await fs.unlink(textFilePath); } catch {}

  if (!clipOk) return { success: false, error: `Không tạo được thumbnail clip\n${clipStderr.slice(-400)}` };
  console.log(`[Thumbnail] clip tạo thành công: ${clipPath}`);
  return { success: true, clipPath };
}

/**
 * [THUMBNAIL] Ghép thumbnail clip vào đầu video chính bằng FFmpeg concat
 */
async function prependThumbnailClip(
  thumbnailClipPath: string,
  mainOutputPath: string,
  hasAudio: boolean
): Promise<{ success: boolean; error?: string }> {
  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) return { success: false, error: 'FFmpeg không tìm thấy' };
  if (!existsSync(mainOutputPath)) return { success: false, error: `Không tìm thấy file render chính: ${mainOutputPath}` };

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

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    tempConcatPath,
  ];

  let concatStderr = '';
  const pushStderr = (chunk: string): void => {
    concatStderr += chunk;
    if (concatStderr.length > 12000) {
      concatStderr = concatStderr.slice(-12000);
    }
  };

  return new Promise((resolve) => {
    console.log(
      `[Thumbnail] Bắt đầu concat demuxer (tách luồng, không render lại toàn bộ video), hasAudio=${hasAudio}...`
    );
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
              if (existsSync(mainOutputPath)) await fs.unlink(mainOutputPath);
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
      } else {
        try { await fs.unlink(tempConcatPath); } catch {}
        console.error('[Thumbnail] concat failed (code', code, '):\n', concatStderr.slice(-1200));
        resolve({ success: false, error: `Ghép thumbnail thất bại (exit ${code})\n${concatStderr.slice(-400)}` });
      }
    });
    proc.on('error', async (err) => {
      try { await fs.unlink(thumbnailClipPath); } catch {}
      try { await fs.unlink(concatListPath); } catch {}
      try { await fs.unlink(tempConcatPath); } catch {}
      resolve({ success: false, error: err.message });
    });
  });
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

  let result: RenderResult;
  if (options.renderMode === 'hardsub' && options.videoPath) {
    result = await renderHardsubVideo(options, progressCallback);
  } else {
    result = await renderBlackBackgroundVideo(options, progressCallback);
  }

  // Post-processing: prepend thumbnail 0.2s nếu được bật
  console.log(`[VideoRenderer] Thumbnail check: enabled=${options.thumbnailEnabled}, videoPath=${!!options.videoPath}, timeSec=${options.thumbnailTimeSec}`);
  if (result.success && options.thumbnailEnabled) {
    if (!options.videoPath || options.thumbnailTimeSec === undefined) {
      return {
        success: false,
        error: 'Thiếu cấu hình thumbnail: cần videoPath và thumbnailTimeSec khi bật thumbnailEnabled.'
      };
    }

    const outputMeta = await getVideoMetadata(options.outputPath);
    if (!outputMeta.success || !outputMeta.metadata) {
      return {
        success: false,
        error: `Không đọc được metadata output để tạo thumbnail: ${outputMeta.error || 'unknown error'}`
      };
    }
    console.log('[VideoRenderer] Thumbnail output metadata', {
      width: outputMeta.metadata.width,
      height: outputMeta.metadata.actualHeight || outputMeta.metadata.height,
      fps: outputMeta.metadata.fps,
      hasAudio: !!outputMeta.metadata.hasAudio,
      duration: outputMeta.metadata.duration,
    });

    console.log(`[VideoRenderer] 🖼 Tạo thumbnail tại ${options.thumbnailTimeSec}s, text="${options.thumbnailText || ''}"...`);
    const thumbWidth = outputMeta.metadata.width;
    const thumbHeight = outputMeta.metadata.actualHeight || outputMeta.metadata.height;
    const thumbResult = await createThumbnailClip({
      videoPath: options.videoPath,
      timeSec: options.thumbnailTimeSec,
      durationSec: 0.2,
      thumbnailText: options.thumbnailText,
      width: thumbWidth,
      height: thumbHeight,
      fps: outputMeta.metadata.fps,
      includeAudio: !!outputMeta.metadata.hasAudio,
    });

    if (thumbResult.success && thumbResult.clipPath) {
      console.log('[VideoRenderer] Ghép thumbnail vào đầu video...');
      const prependResult = await prependThumbnailClip(
        thumbResult.clipPath,
        options.outputPath,
        !!outputMeta.metadata.hasAudio
      );
      if (!prependResult.success) {
        return {
          success: false,
          error: `Ghép thumbnail thất bại: ${prependResult.error || 'unknown error'}`
        };
      } else {
        console.log('[VideoRenderer] ✅ Thumbnail đã ghép thành công');
      }
    } else {
      return {
        success: false,
        error: `Tạo thumbnail thất bại: ${thumbResult.error || 'unknown error'}`
      };
    }
  }

  return result;
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
