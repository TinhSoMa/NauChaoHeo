/**
 * Video Renderer - Render video từ file ASS bằng FFmpeg
 * Port từ caption_funtion.py
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  RenderVideoOptions,
  RenderProgress,
  RenderResult,
  VideoMetadata,
} from '../../../shared/types/caption';
import { isFFmpegAvailable } from '../../utils/ffmpegPath';
import { prepareSubtitleAndDuration, getSubtitleFilter } from './subtitleAssBuilder';
import {
  extractVideoFrame as probeExtractVideoFrame,
  getVideoMetadata as probeGetVideoMetadata,
  readMediaDurationSec,
  readSrtDurationSec,
} from './hardsub/mediaProbe';
import { buildVideoFilter } from './hardsub/filterBuilder';
import { buildSpeedAdjustedAudioFile, buildAtempoFilter } from './hardsub/audioSpeedAdjuster';
import { buildHardsubAudioMix } from './hardsub/audioMixBuilder';
import { runFFmpegProcess } from './hardsub/ffmpegRunner';
import {
  buildHardsubTimingPayload,
  writeHardsubTimingJson,
} from './hardsub/timingDebugWriter';
import { applyThumbnailPostProcess } from './hardsub/thumbnailPipeline';

export const getVideoMetadata = probeGetVideoMetadata;
export const extractVideoFrame = probeExtractVideoFrame;

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
  const videoFilter = buildVideoFilter({
    needsScale: prep.needsScale,
    renderWidth: prep.renderWidth,
    renderHeight: prep.renderHeight,
    blackoutTop: options.blackoutTop,
    videoSpeedMultiplier: prep.videoSpeedMultiplier,
    subtitleFilter,
  });

  let hwaccelArgs: string[] = [];
  let videoCodec = 'libx264';
  let codecParams = ['-preset', 'medium', '-crf', '23'];

  if (options.hardwareAcceleration === 'qsv') {
    hwaccelArgs = ['-hwaccel', 'auto'];
    videoCodec = 'h264_qsv';
    codecParams = ['-preset', 'fast', '-global_quality', '25'];
  }

  // Hardsub: tính thời lượng output đúng cho cả 2 trường hợp:
  //   - videoSpeedMultiplier < 1 (video chậm đi):  stretchedVideo > newAudio  -> dùng stretchedVideo
  //   - videoSpeedMultiplier > 1 (video tăng tốc): stretchedVideo < newAudio  -> dùng newAudio
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
  const audioMix = buildHardsubAudioMix({
    hasVideoAudio: prep.hasVideoAudio,
    hasTtsAudio,
    videoVolume: renderOptions.videoVolume !== undefined ? renderOptions.videoVolume : 100,
    audioVolume: renderOptions.audioVolume !== undefined ? renderOptions.audioVolume : 100,
    videoSpeedMultiplier: prep.videoSpeedMultiplier,
    audioSpeed: prep.audioSpeed,
  });
  filterComplexParts.push(...audioMix.filterParts);
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
    filterComplexParts.push('[v_base]copy[v_out]');
  }

  const mapArgs: string[] = ['-map', '[v_out]'];
  if (audioMix.mapAudioArg) {
    mapArgs.push('-map', audioMix.mapAudioArg);
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
    outputPath,
  ];

  const hardsubTimingDebug = buildHardsubTimingPayload({
    options,
    renderOptions,
    prep,
    outputPath,
    subtitleDurationOriginalSec,
    subtitleDurationScaledSec,
    audioOriginalDurationSec,
    audioAfterSpeedDurationSec,
    videoSubDurationAfterScaleSec,
    outputDuration,
    stretchedVideoDuration,
    hasTtsAudio,
    audioStartInVideoSec,
    audioEndInVideoSec,
    audioStartInOutputSec,
    audioEndInOutputSec,
    trimApplied,
    adjustedAudioGenerated: adjustedAudio.generated,
    step4SrtScale,
    srtTimeScaleConfigured,
    srtTimeScaleApplied,
    step7AudioSpeed,
    audioEffectiveSpeed,
    videoMarkerSec,
  });

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
  return runFFmpegProcess({
    args,
    totalFrames,
    fps,
    outputPath,
    tempAssPath: prep.tempAssPath,
    duration: outputDuration,
    progressCallback,
  });
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
    '-i', `color=black:s=${prep.finalWidth}x${prep.finalHeight}:r=${fps}`,
  ];

  let hasTtsAudio = false;
  if (renderOptions.audioPath && existsSync(renderOptions.audioPath)) {
    inputArgs.push('-i', renderOptions.audioPath);
    hasTtsAudio = true;
  }

  const filterComplexParts: string[] = [];
  const volAud = (renderOptions.audioVolume !== undefined) ? renderOptions.audioVolume / 100 : 1.0;
  const audAtempo = (prep.audioSpeed !== 1.0) ? `,${buildAtempoFilter(prep.audioSpeed)}` : '';
  if (hasTtsAudio && (volAud !== 1.0 || !!audAtempo)) {
    filterComplexParts.push(`[1:a]volume=${volAud}${audAtempo}[a_out]`);
  }

  filterComplexParts.push(`[0:v]${subtitleFilter}[v_out]`);

  const mapArgs: string[] = ['-map', '[v_out]'];
  if (hasTtsAudio) {
    mapArgs.push('-map', (volAud !== 1.0 || !!audAtempo) ? '[a_out]' : '1:a');
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
    outputPath,
  ];

  const totalFrames = Math.floor(prep.newAudioDuration * fps);
  return runFFmpegProcess({
    args,
    totalFrames,
    fps,
    outputPath,
    tempAssPath: prep.tempAssPath,
    duration: prep.duration,
    progressCallback,
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

  result = await applyThumbnailPostProcess(options, result);
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
    if (!existsSync(dir)) {
      continue;
    }

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
    const res = await probeGetVideoMetadata(videoPath);
    if (res.success && res.metadata) {
      const realHeight = res.metadata.actualHeight || 1080;
      const maxDim = Math.max(res.metadata.width, realHeight);
      if (maxDim >= 720 && realHeight > 500) {
        validVideos.push({
          path: videoPath,
          metadata: res.metadata,
          area: res.metadata.width * realHeight,
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
