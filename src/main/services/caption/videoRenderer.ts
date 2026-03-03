/**
 * Video Renderer - Render video từ file ASS bằng FFmpeg
 * Port từ caption_funtion.py
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  RenderThumbnailPreviewFrameOptions,
  RenderThumbnailPreviewFrameResult,
  RenderVideoOptions,
  RenderProgress,
  RenderResult,
  VideoMetadata,
} from '../../../shared/types/caption';
import { getFFprobePath, isFFmpegAvailable } from '../../utils/ffmpegPath';
import {
  prepareSubtitleAndDuration,
  prepareSubtitleAndDurationPortrait,
  getSubtitleFilter,
} from './subtitleAssBuilder';
import {
  extractVideoFrame as probeExtractVideoFrame,
  getVideoMetadata as probeGetVideoMetadata,
  readMediaDurationSec,
  readSrtDurationSec,
} from './hardsub/mediaProbe';
import { buildVideoFilter } from './hardsub/filterBuilder';
import { buildPortraitVideoFilter } from './hardsub/portraitFilterBuilder';
import { buildSpeedAdjustedAudioFile, buildAtempoFilter } from './hardsub/audioSpeedAdjuster';
import { buildHardsubAudioMix } from './hardsub/audioMixBuilder';
import {
  clearRenderStopRequest,
  isRenderInProgress,
  requestStopCurrentRender,
  runFFmpegProcess,
} from './hardsub/ffmpegRunner';
import {
  buildHardsubTimingPayload,
} from './hardsub/timingDebugWriter';
import {
  applyThumbnailPostProcess,
  buildInlineThumbnailVideoFilter,
  normalizeThumbnailDurationSec,
  renderThumbnailPreviewFrame as renderThumbnailPreviewFramePipeline,
} from './hardsub/thumbnailPipeline';

export const getVideoMetadata = probeGetVideoMetadata;
export const extractVideoFrame = probeExtractVideoFrame;

function resolvePortraitCanvasByPreset(
  renderResolution?: RenderVideoOptions['renderResolution']
): { width: number; height: number } {
  if (renderResolution === '720p') {
    return { width: 720, height: 1280 };
  }
  if (renderResolution === '540p') {
    return { width: 540, height: 960 };
  }
  if (renderResolution === '360p') {
    return { width: 360, height: 640 };
  }
  return { width: 1080, height: 1920 };
}

interface EncoderProfile {
  hwaccelArgs: string[];
  videoCodec: string;
  codecParams: string[];
  pixelFormat: 'yuv420p' | 'nv12';
  decodePath: string;
}

function resolveEncoderProfile(
  hardware: RenderVideoOptions['hardwareAcceleration'],
  renderMode: RenderVideoOptions['renderMode']
): EncoderProfile {
  if (hardware === 'qsv') {
    if (renderMode === 'hardsub_portrait_9_16') {
      // Portrait filter graph dày đặc filter CPU; decode software ổn định hơn.
      const enableQsvDecode = process.env.CAPTION_PORTRAIT_QSV_DECODE === '1';
      return {
        hwaccelArgs: enableQsvDecode ? ['-hwaccel', 'auto'] : [],
        videoCodec: 'h264_qsv',
        codecParams: ['-preset', 'fast', '-global_quality', '25'],
        pixelFormat: 'nv12',
        decodePath: enableQsvDecode ? 'qsv_decode + qsv_encode' : 'software_decode + qsv_encode',
      };
    }
    return {
      hwaccelArgs: ['-hwaccel', 'auto'],
      videoCodec: 'h264_qsv',
      codecParams: ['-preset', 'fast', '-global_quality', '25'],
      pixelFormat: 'nv12',
      decodePath: 'auto_decode + qsv_encode',
    };
  }

  if (hardware === 'nvenc') {
    return {
      hwaccelArgs: [],
      videoCodec: 'h264_nvenc',
      codecParams: ['-preset', 'p4', '-rc', 'vbr', '-cq', '24', '-b:v', '0'],
      pixelFormat: 'nv12',
      decodePath: 'software_decode + nvenc_encode',
    };
  }

  return {
    hwaccelArgs: [],
    videoCodec: 'libx264',
    codecParams: ['-preset', 'medium', '-crf', '23'],
    pixelFormat: 'yuv420p',
    decodePath: 'software',
  };
}

function clampVolumePercent(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value as number));
}

async function probeOutputAspectForLog(videoPath: string): Promise<{
  width: number;
  height: number;
  sampleAspectRatio: string | null;
  displayAspectRatio: string | null;
  frameRate: string | null;
} | null> {
  if (!videoPath || !existsSync(videoPath)) {
    return null;
  }

  const ffprobePath = getFFprobePath();
  if (!existsSync(ffprobePath)) {
    return null;
  }

  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,sample_aspect_ratio,display_aspect_ratio,r_frame_rate',
      '-of', 'json',
      videoPath,
    ];

    const proc = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        if (stderr.trim()) {
          console.warn('[VideoRenderer][HardsubPortrait] ffprobe output aspect thất bại:', stderr.trim());
        }
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
        if (!stream) {
          resolve(null);
          return;
        }
        resolve({
          width: Number(stream.width) || 0,
          height: Number(stream.height) || 0,
          sampleAspectRatio: typeof stream.sample_aspect_ratio === 'string' ? stream.sample_aspect_ratio : null,
          displayAspectRatio: typeof stream.display_aspect_ratio === 'string' ? stream.display_aspect_ratio : null,
          frameRate: typeof stream.r_frame_rate === 'string' ? stream.r_frame_rate : null,
        });
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => {
      resolve(null);
    });
  });
}

function ensureFilterLabelReference(value: string): string {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value;
  }
  return `[${value}]`;
}

function extractFilterLabelName(value: string): string {
  return value.replace(/^\[/, '').replace(/\]$/, '');
}

function ensureAudioLabelForConcat(
  mapAudioArg: string | null,
  filterComplexParts: string[],
  outputLabelName: string
): string | null {
  if (!mapAudioArg) {
    return null;
  }
  const sourceLabel = ensureFilterLabelReference(mapAudioArg);
  filterComplexParts.push(
    `${sourceLabel}aformat=channel_layouts=stereo,aresample=44100[${outputLabelName}]`
  );
  return `[${outputLabelName}]`;
}

async function injectInlineThumbnailAtEnd(input: {
  options: RenderVideoOptions;
  fps: number;
  filterComplexParts: string[];
  mainVideoLabel: string;
  mainAudioLabel: string | null;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  thumbnailVideoInputLabel?: string;
  thumbnailInputSeeked?: boolean;
}): Promise<{
  finalVideoLabel: string;
  finalAudioLabel: string | null;
  thumbnailDurationSec: number;
  cleanupFiles: string[];
}> {
  const thumbnailDurationSec = normalizeThumbnailDurationSec(input.options.thumbnailDurationSec);
  if (!input.options.thumbnailEnabled) {
    return {
      finalVideoLabel: input.mainVideoLabel,
      finalAudioLabel: input.mainAudioLabel,
      thumbnailDurationSec: 0,
      cleanupFiles: [],
    };
  }

  if (!input.options.videoPath || input.options.thumbnailTimeSec === undefined || input.options.thumbnailTimeSec === null) {
    throw new Error('Thiếu cấu hình thumbnail inline: cần videoPath và thumbnailTimeSec khi bật thumbnailEnabled.');
  }

  const thumbVideo = await buildInlineThumbnailVideoFilter({
    renderMode: input.options.renderMode,
    videoInputLabel: input.thumbnailVideoInputLabel || '[0:v]',
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    fps: input.fps,
    thumbnailTimeSec: input.thumbnailInputSeeked ? 0 : input.options.thumbnailTimeSec,
    thumbnailDurationSec,
    thumbnailText: input.options.thumbnailText,
    thumbnailTextSecondary: input.options.thumbnailTextSecondary,
    thumbnailFontName: input.options.thumbnailFontName,
    thumbnailFontSize: input.options.thumbnailFontSize,
    thumbnailTextPrimaryFontName: input.options.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: input.options.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor: input.options.thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName: input.options.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: input.options.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor: input.options.thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio: input.options.thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition: input.options.thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: input.options.thumbnailTextSecondaryPosition,
  });
  input.filterComplexParts.push(...thumbVideo.filterParts);

  const mainVideoLabel = ensureFilterLabelReference(input.mainVideoLabel);
  const thumbVideoLabel = ensureFilterLabelReference(thumbVideo.outputLabel);
  const finalVideoRawLabel = '[v_out_inline_raw]';
  const finalVideoLabel = '[v_out_inline]';

  if (input.mainAudioLabel) {
    const delayMs = Math.max(0, Math.round(thumbnailDurationSec * 1000));
    input.filterComplexParts.push(
      `${ensureFilterLabelReference(input.mainAudioLabel)}adelay=${delayMs}:all=1[a_out_inline]`
    );
    input.filterComplexParts.push(
      `${thumbVideoLabel}${mainVideoLabel}concat=n=2:v=1:a=0[${extractFilterLabelName(finalVideoRawLabel)}]`
    );
    input.filterComplexParts.push(
      `${finalVideoRawLabel}format=yuv420p,setsar=1[${extractFilterLabelName(finalVideoLabel)}]`
    );
    console.log('[VideoRenderer][ThumbnailInline]', {
      enabled: true,
      mode: input.options.renderMode || 'hardsub',
      thumbnailTimeSec: input.options.thumbnailTimeSec,
      thumbnailDurationSec,
      outputSize: `${input.outputWidth}x${input.outputHeight}`,
      sourceSize: `${input.sourceWidth}x${input.sourceHeight}`,
      hasMainAudio: true,
      audioPrefixMode: 'adelay',
      audioDelayMs: delayMs,
      thumbnailDebug: thumbVideo.debug,
    });
    return {
      finalVideoLabel,
      finalAudioLabel: '[a_out_inline]',
      thumbnailDurationSec,
      cleanupFiles: thumbVideo.cleanupFiles,
    };
  }

  input.filterComplexParts.push(
    `${thumbVideoLabel}${mainVideoLabel}concat=n=2:v=1:a=0[${extractFilterLabelName(finalVideoRawLabel)}]`
  );
  input.filterComplexParts.push(
    `${finalVideoRawLabel}format=yuv420p,setsar=1[${extractFilterLabelName(finalVideoLabel)}]`
  );
  console.log('[VideoRenderer][ThumbnailInline]', {
    enabled: true,
    mode: input.options.renderMode || 'hardsub',
    thumbnailTimeSec: input.options.thumbnailTimeSec,
    thumbnailDurationSec,
    outputSize: `${input.outputWidth}x${input.outputHeight}`,
    sourceSize: `${input.sourceWidth}x${input.sourceHeight}`,
    hasMainAudio: false,
    thumbnailDebug: thumbVideo.debug,
  });
  return {
    finalVideoLabel,
    finalAudioLabel: null,
    thumbnailDurationSec,
    cleanupFiles: thumbVideo.cleanupFiles,
  };
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
  const coverMode = options.coverMode || 'blackout_bottom';
  const videoFilter = buildVideoFilter({
    inputLabel: '[0:v]',
    needsScale: prep.needsScale,
    renderWidth: prep.renderWidth,
    renderHeight: prep.renderHeight,
    blackoutTop: options.blackoutTop,
    coverMode,
    coverQuad: options.coverQuad,
    videoSpeedMultiplier: prep.videoSpeedMultiplier,
    subtitleFilter,
  });

  const encoderProfile = resolveEncoderProfile(options.hardwareAcceleration, options.renderMode);

  // Hardsub: tính thời lượng output đúng cho cả 2 trường hợp:
  //   - videoSpeedMultiplier < 1 (video chậm đi):  stretchedVideo > newAudio  -> dùng stretchedVideo
  //   - videoSpeedMultiplier > 1 (video tăng tốc): stretchedVideo < newAudio  -> dùng newAudio
  // Luôn lấy max để không cắt bất kỳ nguồn nào sớm hơn cần thiết.
  const stretchedVideoDuration = prep.originalVideoDuration > 0 && prep.videoSpeedMultiplier > 0
    ? prep.originalVideoDuration / prep.videoSpeedMultiplier
    : prep.originalVideoDuration;
  const mainOutputDuration = Math.max(
    stretchedVideoDuration > 0 ? stretchedVideoDuration : 0,
    prep.newAudioDuration > 0 ? prep.newAudioDuration : 0
  ) || prep.newAudioDuration;
  console.log(
    `[VideoRenderer] Hardsub duration | videoTotal=${prep.originalVideoDuration.toFixed(3)}s, ` +
    `videoSpeedMultiplier=${prep.videoSpeedMultiplier.toFixed(4)}, stretchedVideo=${stretchedVideoDuration.toFixed(3)}s, ` +
    `audioForSync=${prep.newAudioDuration.toFixed(3)}s, outputDuration=${mainOutputDuration.toFixed(3)}s`
  );

  const inputArgs = [...encoderProfile.hwaccelArgs, '-i', renderOptions.videoPath!];
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
  const audioStartInOutputSecBase = hasTtsAudio ? 0 : null;
  const audioEndInOutputSecBase = hasTtsAudio ? Math.min(prep.newAudioDuration, mainOutputDuration) : null;
  const resolvedVideoMarkerSec = videoMarkerSec > 0
    ? videoMarkerSec
    : ((audioEndInOutputSecBase ?? 0) * (prep.videoSpeedMultiplier > 0 ? prep.videoSpeedMultiplier : 1.0));
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
  let thumbnailVideoInputLabel = '[0:v]';
  let thumbnailInputSeeked = false;
  if (renderOptions.thumbnailEnabled && renderOptions.thumbnailTimeSec !== undefined && renderOptions.thumbnailTimeSec !== null) {
    const thumbnailTimeSec = Math.max(0, Number(renderOptions.thumbnailTimeSec));
    inputArgs.push('-ss', String(thumbnailTimeSec), '-an', '-i', renderOptions.videoPath!);
    const thumbnailInputIndex = inputArgs.filter(arg => arg === '-i').length - 1;
    thumbnailVideoInputLabel = `[${thumbnailInputIndex}:v]`;
    thumbnailInputSeeked = true;
  }

  const filterComplexParts: string[] = [];
  const videoVolumeInput = renderOptions.videoVolume;
  const audioVolumeInput = renderOptions.audioVolume;
  const safeVideoVolume = clampVolumePercent(videoVolumeInput, 0, 200, 100);
  const safeAudioVolume = clampVolumePercent(audioVolumeInput, 0, 400, 100);
  console.log('[VideoRenderer][Hardsub][AudioGain]', {
    videoVolumeInput,
    videoVolumeApplied: safeVideoVolume,
    videoGainApplied: safeVideoVolume / 100,
    audioVolumeInput,
    audioVolumeApplied: safeAudioVolume,
    audioGainApplied: safeAudioVolume / 100,
  });
  const audioMix = buildHardsubAudioMix({
    hasVideoAudio: prep.hasVideoAudio,
    hasTtsAudio,
    videoVolume: safeVideoVolume,
    audioVolume: safeAudioVolume,
    videoSpeedMultiplier: prep.videoSpeedMultiplier,
    audioSpeed: prep.audioSpeed,
  });
  filterComplexParts.push(...audioMix.filterParts);
  filterComplexParts.push(...videoFilter.filterParts);

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
    filterComplexParts.push(`${videoFilter.outputLabel}[logo_scaled]overlay=x=${logoXAxis}:y=${logoYAxis}[v_out]`);
  } else {
    filterComplexParts.push(`${videoFilter.outputLabel}null[v_out]`);
  }

  const fps = 24;
  const inlineMainAudioLabel = options.thumbnailEnabled
    ? ensureAudioLabelForConcat(audioMix.mapAudioArg, filterComplexParts, 'a_main_concat_hardsub')
    : (audioMix.mapAudioArg && audioMix.mapAudioArg.startsWith('[') ? audioMix.mapAudioArg : null);
  const inlineThumbnail = await injectInlineThumbnailAtEnd({
    options: renderOptions,
    fps,
    filterComplexParts,
    mainVideoLabel: '[v_out]',
    mainAudioLabel: inlineMainAudioLabel,
    outputWidth: prep.renderWidth,
    outputHeight: prep.renderHeight,
    sourceWidth: prep.renderWidth,
    sourceHeight: prep.renderHeight,
    thumbnailVideoInputLabel,
    thumbnailInputSeeked,
  });
  const outputDuration = mainOutputDuration + inlineThumbnail.thumbnailDurationSec;
  const finalDurationStr = outputDuration.toFixed(3);
  const audioStartInOutputSec = hasTtsAudio ? ((audioStartInOutputSecBase ?? 0) + inlineThumbnail.thumbnailDurationSec) : null;
  const audioEndInOutputSec = hasTtsAudio ? ((audioEndInOutputSecBase ?? 0) + inlineThumbnail.thumbnailDurationSec) : null;

  const mapArgs: string[] = ['-map', inlineThumbnail.finalVideoLabel];
  if (options.thumbnailEnabled) {
    if (inlineThumbnail.finalAudioLabel) {
      mapArgs.push('-map', inlineThumbnail.finalAudioLabel);
    }
  } else if (audioMix.mapAudioArg) {
    mapArgs.push('-map', audioMix.mapAudioArg);
  }

  const args = [
    ...inputArgs,
    '-filter_complex', filterComplexParts.join(';'),
    ...mapArgs,
    '-c:v', encoderProfile.videoCodec,
    ...encoderProfile.codecParams,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', encoderProfile.pixelFormat,
    '-r', fps.toString(),
    '-t', finalDurationStr,
    '-y',
    outputPath,
  ];
  console.log('[VideoRenderer][Hardsub] Encoder profile', {
    hardware: options.hardwareAcceleration || 'none',
    codec: encoderProfile.videoCodec,
    pixelFormat: encoderProfile.pixelFormat,
    decodePath: encoderProfile.decodePath,
    hwaccelArgs: encoderProfile.hwaccelArgs,
  });

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
    thumbnail: {
      mode: 'landscape_hardsub',
      cropStrategy: 'none',
      fillStrategy: 'scale_to_output',
      outputAspect: `${prep.renderWidth}:${prep.renderHeight}`,
      durationSec: inlineThumbnail.thumbnailDurationSec > 0 ? inlineThumbnail.thumbnailDurationSec : (options.thumbnailDurationSec ?? 0.5),
      fontName: options.thumbnailTextPrimaryFontName || options.thumbnailFontName || 'BrightwallPersonal',
      fontSize: options.thumbnailTextPrimaryFontSize ?? options.thumbnailFontSize ?? 145,
      fontColor: options.thumbnailTextPrimaryColor || '#FFFF00',
      secondaryFontName: options.thumbnailTextSecondaryFontName || options.thumbnailFontName || 'BrightwallPersonal',
      secondaryFontSize: options.thumbnailTextSecondaryFontSize ?? options.thumbnailFontSize ?? 145,
      secondaryFontColor: options.thumbnailTextSecondaryColor || '#FFFF00',
      lineHeightRatio: options.thumbnailLineHeightRatio ?? 1.16,
      pipeline: options.thumbnailEnabled ? 'inline_single_stream' : 'post_concat_copy',
      audio: options.thumbnailEnabled ? 'silent_prefix' : 'none',
    },
  });

  console.log('[VideoRenderer][Hardsub] Render config', {
    inputVideo: renderOptions.videoPath,
    inputAudio: renderOptions.audioPath ?? null,
    outputVideo: outputPath,
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
    dataSource: {
      subtitleSource: options.step7SubtitleSource || 'unknown',
      audioSource: options.step7AudioSource || 'unknown',
    },
    cover: {
      mode: coverMode,
      hasQuad: !!options.coverQuad,
    },
    subtitleWindow: {
      subtitleEndSec: prep.duration,
      trimApplied,
    },
    note: 'Không trim audio/video. mergeWindowInVideo là timeline video gốc; mergeWindowInOutputTimeline là timeline sau setpts.',
  });
  console.log('[VideoRenderer][Hardsub][TimingPayload]', hardsubTimingDebug);

  const totalFrames = Math.floor(outputDuration * fps);
  const renderResult = await runFFmpegProcess({
    args,
    totalFrames,
    fps,
    outputPath,
    tempAssPath: prep.tempAssPath,
    cleanupTempPaths: inlineThumbnail.cleanupFiles,
    duration: outputDuration,
    progressCallback,
  });
  if (renderResult.success) {
    renderResult.timingPayload = hardsubTimingDebug as Record<string, unknown>;
  }
  return renderResult;
}

/**
 * Render hardsub chuyển khung 16:9 -> 9:16 với nền blur
 */
export async function renderHardsubPortraitVideo(
  options: RenderVideoOptions,
  progressCallback?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  if (!options.videoPath || !existsSync(options.videoPath)) {
    return { success: false, error: 'Chế độ hardsub 9:16 yêu cầu videoPath' };
  }

  const { outputPath } = options;
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const audioSpeedInput = options.audioSpeed && options.audioSpeed > 0 ? options.audioSpeed : 1.0;
  const adjustedAudio = await buildSpeedAdjustedAudioFile(options.audioPath, audioSpeedInput);
  if (!adjustedAudio.success) {
    return { success: false, error: adjustedAudio.error || 'Không thể tạo audio speed-adjusted' };
  }

  const portraitCanvas = resolvePortraitCanvasByPreset(options.renderResolution);
  const renderOptions: RenderVideoOptions = {
    ...options,
    width: portraitCanvas.width,
    height: portraitCanvas.height,
    audioPath: adjustedAudio.audioPath,
    audioSpeed: 1.0,
    step7AudioSpeedInput: audioSpeedInput,
  };

  const prep = await prepareSubtitleAndDurationPortrait(renderOptions, portraitCanvas);
  const subtitleFilter = getSubtitleFilter(prep.tempAssPath);

  const encoderProfile = resolveEncoderProfile(options.hardwareAcceleration, options.renderMode);

  const stretchedVideoDuration = prep.originalVideoDuration > 0 && prep.videoSpeedMultiplier > 0
    ? prep.originalVideoDuration / prep.videoSpeedMultiplier
    : prep.originalVideoDuration;
  const mainOutputDuration = Math.max(
    stretchedVideoDuration > 0 ? stretchedVideoDuration : 0,
    prep.newAudioDuration > 0 ? prep.newAudioDuration : 0
  ) || prep.newAudioDuration;
  console.log(
    `[VideoRenderer] HardsubPortrait duration | videoTotal=${prep.originalVideoDuration.toFixed(3)}s, ` +
    `videoSpeedMultiplier=${prep.videoSpeedMultiplier.toFixed(4)}, stretchedVideo=${stretchedVideoDuration.toFixed(3)}s, ` +
    `audioForSync=${prep.newAudioDuration.toFixed(3)}s, outputDuration=${mainOutputDuration.toFixed(3)}s`
  );

  const inputArgs = [...encoderProfile.hwaccelArgs, '-i', renderOptions.videoPath!];
  let hasTtsAudio = false;
  if (renderOptions.audioPath && existsSync(renderOptions.audioPath)) {
    inputArgs.push('-i', renderOptions.audioPath);
    hasTtsAudio = true;
  }

  const step4SrtScale = prep.step4ScaleUsed && prep.step4ScaleUsed > 0
    ? prep.step4ScaleUsed
    : (options.step4SrtScale && options.step4SrtScale > 0 ? options.step4SrtScale : 1.0);
  const srtTimeScaleConfigured = prep.configuredSrtTimeScale > 0 ? prep.configuredSrtTimeScale : 1.0;
  const srtTimeScaleApplied = prep.appliedSrtTimeScale > 0 ? prep.appliedSrtTimeScale : 1.0;
  const step7AudioSpeed = prep.step7SpeedUsed && prep.step7SpeedUsed > 0 ? prep.step7SpeedUsed : audioSpeedInput;
  const audioEffectiveSpeed = prep.audioEffectiveSpeed;
  let subtitleDurationOriginalSec = prep.videoSubBaseDuration > 0 ? prep.videoSubBaseDuration : 0;
  const subtitleDurationScaledSec = prep.subRenderDuration > 0 ? prep.subRenderDuration : prep.duration;
  const videoMarkerSec = prep.videoMarkerSec > 0 ? prep.videoMarkerSec : 0;
  const trimApplied = false;

  const audioStartInOutputSecBase = hasTtsAudio ? 0 : null;
  const audioEndInOutputSecBase = hasTtsAudio ? Math.min(prep.newAudioDuration, mainOutputDuration) : null;
  const resolvedVideoMarkerSec = videoMarkerSec > 0
    ? videoMarkerSec
    : ((audioEndInOutputSecBase ?? 0) * (prep.videoSpeedMultiplier > 0 ? prep.videoSpeedMultiplier : 1.0));
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
  let thumbnailVideoInputLabel = '[0:v]';
  let thumbnailInputSeeked = false;
  if (renderOptions.thumbnailEnabled && renderOptions.thumbnailTimeSec !== undefined && renderOptions.thumbnailTimeSec !== null) {
    const thumbnailTimeSec = Math.max(0, Number(renderOptions.thumbnailTimeSec));
    inputArgs.push('-ss', String(thumbnailTimeSec), '-an', '-i', renderOptions.videoPath!);
    const thumbnailInputIndex = inputArgs.filter(arg => arg === '-i').length - 1;
    thumbnailVideoInputLabel = `[${thumbnailInputIndex}:v]`;
    thumbnailInputSeeked = true;
  }

  const even = (value: number) => {
    const rounded = Math.max(2, Math.round(value));
    return rounded % 2 === 0 ? rounded : rounded + 1;
  };
  // Ưu tiên tốc độ cho mode 9:16: downscale nền mạnh hơn trước khi blur.
  const bgDownscaleWidth = even(portraitCanvas.width / 8);
  const bgDownscaleHeight = even(portraitCanvas.height / 8);
  const bgBlurLumaRadius = 8;
  const bgBlurLumaPower = 1;
  const nearPortraitAspectThreshold = 0.05;

  let sourceWidth = portraitCanvas.width;
  let sourceHeight = portraitCanvas.height;
  try {
    const sourceMeta = await getVideoMetadata(renderOptions.videoPath!);
    if (sourceMeta.success && sourceMeta.metadata) {
      sourceWidth = sourceMeta.metadata.width;
      sourceHeight = sourceMeta.metadata.actualHeight || sourceMeta.metadata.height;
    }
  } catch (error) {
    console.warn('[VideoRenderer][HardsubPortrait] Không đọc được source metadata, dùng fallback canvas.', error);
  }

  const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
  const outputAspect = portraitCanvas.width / portraitCanvas.height;
  const aspectDiffRatio = Math.abs(sourceAspect - outputAspect) / outputAspect;
  const layoutStrategy: 'blur_composite' | 'direct_fit_no_blur' =
    aspectDiffRatio <= nearPortraitAspectThreshold ? 'direct_fit_no_blur' : 'blur_composite';
  const foregroundCropPercent = Math.min(
    20,
    Math.max(0, Number.isFinite(options.portraitForegroundCropPercent ?? 0)
      ? (options.portraitForegroundCropPercent as number)
      : 0)
  );

  const portraitVideo = buildPortraitVideoFilter({
    inputLabel: '[0:v]',
    outputWidth: portraitCanvas.width,
    outputHeight: portraitCanvas.height,
    subtitleFilter,
    sourceAspect,
    layoutStrategy,
    foregroundCropPercent,
    videoSpeedMultiplier: prep.videoSpeedMultiplier,
    blackoutTop: options.blackoutTop,
    coverMode: options.coverMode || 'blackout_bottom',
    coverQuad: options.coverQuad,
    bgDownscaleWidth,
    bgDownscaleHeight,
    bgBlurLumaRadius,
    bgBlurLumaPower,
  });

  const filterComplexParts: string[] = [];
  const videoVolumeInput = renderOptions.videoVolume;
  const audioVolumeInput = renderOptions.audioVolume;
  const safeVideoVolume = clampVolumePercent(videoVolumeInput, 0, 200, 100);
  const safeAudioVolume = clampVolumePercent(audioVolumeInput, 0, 400, 100);
  console.log('[VideoRenderer][HardsubPortrait][AudioGain]', {
    videoVolumeInput,
    videoVolumeApplied: safeVideoVolume,
    videoGainApplied: safeVideoVolume / 100,
    audioVolumeInput,
    audioVolumeApplied: safeAudioVolume,
    audioGainApplied: safeAudioVolume / 100,
  });
  const audioMix = buildHardsubAudioMix({
    hasVideoAudio: prep.hasVideoAudio,
    hasTtsAudio,
    videoVolume: safeVideoVolume,
    audioVolume: safeAudioVolume,
    videoSpeedMultiplier: prep.videoSpeedMultiplier,
    audioSpeed: prep.audioSpeed,
  });
  filterComplexParts.push(...audioMix.filterParts);

  filterComplexParts.push(...portraitVideo.filterParts);

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
    filterComplexParts.push(`[${portraitVideo.outputLabel}][logo_scaled]overlay=x=${logoXAxis}:y=${logoYAxis}[v_out]`);
  } else {
    filterComplexParts.push(`[${portraitVideo.outputLabel}]null[v_out]`);
  }

  const fps = 24;
  const inlineMainAudioLabel = options.thumbnailEnabled
    ? ensureAudioLabelForConcat(audioMix.mapAudioArg, filterComplexParts, 'a_main_concat_portrait')
    : (audioMix.mapAudioArg && audioMix.mapAudioArg.startsWith('[') ? audioMix.mapAudioArg : null);
  const inlineThumbnail = await injectInlineThumbnailAtEnd({
    options: renderOptions,
    fps,
    filterComplexParts,
    mainVideoLabel: '[v_out]',
    mainAudioLabel: inlineMainAudioLabel,
    outputWidth: portraitCanvas.width,
    outputHeight: portraitCanvas.height,
    sourceWidth,
    sourceHeight,
    thumbnailVideoInputLabel,
    thumbnailInputSeeked,
  });
  const outputDuration = mainOutputDuration + inlineThumbnail.thumbnailDurationSec;
  const finalDurationStr = outputDuration.toFixed(3);
  const audioStartInOutputSec = hasTtsAudio ? ((audioStartInOutputSecBase ?? 0) + inlineThumbnail.thumbnailDurationSec) : null;
  const audioEndInOutputSec = hasTtsAudio ? ((audioEndInOutputSecBase ?? 0) + inlineThumbnail.thumbnailDurationSec) : null;

  const mapArgs: string[] = ['-map', inlineThumbnail.finalVideoLabel];
  if (options.thumbnailEnabled) {
    if (inlineThumbnail.finalAudioLabel) {
      mapArgs.push('-map', inlineThumbnail.finalAudioLabel);
    }
  } else if (audioMix.mapAudioArg) {
    mapArgs.push('-map', audioMix.mapAudioArg);
  }

  const args = [
    ...inputArgs,
    '-filter_complex', filterComplexParts.join(';'),
    ...mapArgs,
    '-c:v', encoderProfile.videoCodec,
    ...encoderProfile.codecParams,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', encoderProfile.pixelFormat,
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
    layoutMode: 'portrait_blur_9_16',
    canvas: portraitCanvas,
    bgBlur: {
      downscaleW: bgDownscaleWidth,
      downscaleH: bgDownscaleHeight,
      blur: `${bgBlurLumaRadius}:${bgBlurLumaPower}`,
    },
    fgFitMode: 'scale-by-aspect-keep-ratio-center',
    layoutStrategy,
    foregroundCropPercent,
    aspect: {
      source: sourceAspect,
      output: outputAspect,
      diffRatio: aspectDiffRatio,
    },
    ratioNormalizeApplied: true,
    targetSar: '1:1',
    targetDar: '9:16',
    thumbnail: {
      mode: 'portrait_9_16',
      cropStrategy: 'center_3_4',
      fillStrategy: 'cropped_bg_blur_top_bottom',
      outputAspect: `${portraitCanvas.width}:${portraitCanvas.height}`,
      durationSec: inlineThumbnail.thumbnailDurationSec > 0 ? inlineThumbnail.thumbnailDurationSec : (options.thumbnailDurationSec ?? 0.5),
      fontName: options.thumbnailTextPrimaryFontName || options.thumbnailFontName || 'BrightwallPersonal',
      fontSize: options.thumbnailTextPrimaryFontSize ?? options.thumbnailFontSize ?? 145,
      fontColor: options.thumbnailTextPrimaryColor || '#FFFF00',
      secondaryFontName: options.thumbnailTextSecondaryFontName || options.thumbnailFontName || 'BrightwallPersonal',
      secondaryFontSize: options.thumbnailTextSecondaryFontSize ?? options.thumbnailFontSize ?? 145,
      secondaryFontColor: options.thumbnailTextSecondaryColor || '#FFFF00',
      lineHeightRatio: options.thumbnailLineHeightRatio ?? 1.16,
      pipeline: options.thumbnailEnabled ? 'inline_single_stream' : 'post_concat_copy',
      audio: options.thumbnailEnabled ? 'silent_prefix' : 'none',
    },
  });

  console.log('[VideoRenderer][HardsubPortrait] Render config', {
    inputVideo: renderOptions.videoPath,
    inputAudio: renderOptions.audioPath ?? null,
    outputVideo: outputPath,
    canvas: portraitCanvas,
    aspect: {
      source: sourceAspect,
      output: outputAspect,
      diffRatio: aspectDiffRatio,
    },
    layoutStrategy,
    foregroundCropPercent,
    ratioNormalize: 'setsar=1,setdar=9/16',
    decodePath: encoderProfile.decodePath,
    encoder: encoderProfile.videoCodec,
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
    dataSource: {
      subtitleSource: options.step7SubtitleSource || 'unknown',
      audioSource: options.step7AudioSource || 'unknown',
    },
    cover: {
      mode: options.coverMode || 'blackout_bottom',
      hasQuad: !!options.coverQuad,
    },
  });
  console.log('[VideoRenderer][HardsubPortrait][TimingPayload]', hardsubTimingDebug);

  const totalFrames = Math.floor(outputDuration * fps);
  const renderResult = await runFFmpegProcess({
    args,
    totalFrames,
    fps,
    outputPath,
    tempAssPath: prep.tempAssPath,
    cleanupTempPaths: inlineThumbnail.cleanupFiles,
    duration: outputDuration,
    progressCallback,
  });
  if (renderResult.success) {
    renderResult.timingPayload = hardsubTimingDebug as Record<string, unknown>;
    const outputAspectMeta = await probeOutputAspectForLog(outputPath);
    if (outputAspectMeta) {
      console.log('[VideoRenderer][HardsubPortrait] Output aspect check', {
        width: outputAspectMeta.width,
        height: outputAspectMeta.height,
        sampleAspectRatio: outputAspectMeta.sampleAspectRatio,
        displayAspectRatio: outputAspectMeta.displayAspectRatio,
        frameRate: outputAspectMeta.frameRate,
      });
    }
  }
  return renderResult;
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
  const audioVolumeInput = renderOptions.audioVolume;
  const safeAudioVolume = clampVolumePercent(audioVolumeInput, 0, 400, 100);
  const volAud = safeAudioVolume / 100;
  console.log('[VideoRenderer][BlackBg][AudioGain]', {
    audioVolumeInput,
    audioVolumeApplied: safeAudioVolume,
    audioGainApplied: volAud,
  });
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
  clearRenderStopRequest();
  console.log(`[VideoRenderer] Route to ${options.renderMode || 'black_bg'} mode`);
  if (!isFFmpegAvailable()) {
    return { success: false, error: 'FFmpeg không được cài đặt' };
  }
  if (!existsSync(options.srtPath)) {
    return { success: false, error: `File SRT không tồn tại: ${options.srtPath}` };
  }

  let result: RenderResult;
  if (options.renderMode === 'hardsub_portrait_9_16' && options.videoPath) {
    result = await renderHardsubPortraitVideo(options, progressCallback);
  } else if (options.renderMode === 'hardsub' && options.videoPath) {
    result = await renderHardsubVideo(options, progressCallback);
  } else {
    result = await renderBlackBackgroundVideo(options, progressCallback);
  }

  console.log('[VideoRenderer] Thumbnail render config', {
    renderMode: options.renderMode || 'black_bg',
    renderResolution: options.renderResolution || 'original',
    thumbnailEnabled: !!options.thumbnailEnabled,
    thumbnailTimeSec: options.thumbnailTimeSec ?? null,
    thumbnailDurationSec: options.thumbnailDurationSec ?? 0.5,
    thumbnailTextSecondary: options.thumbnailTextSecondary ?? '',
    thumbnailFontName: options.thumbnailFontName || null,
    thumbnailFontSize: options.thumbnailFontSize ?? 145,
    thumbnailTextPrimaryFontName: options.thumbnailTextPrimaryFontName || null,
    thumbnailTextPrimaryFontSize: options.thumbnailTextPrimaryFontSize ?? options.thumbnailFontSize ?? 145,
    thumbnailTextPrimaryColor: options.thumbnailTextPrimaryColor || '#FFFF00',
    thumbnailTextSecondaryFontName: options.thumbnailTextSecondaryFontName || null,
    thumbnailTextSecondaryFontSize: options.thumbnailTextSecondaryFontSize ?? options.thumbnailFontSize ?? 145,
    thumbnailTextSecondaryColor: options.thumbnailTextSecondaryColor || '#FFFF00',
    thumbnailLineHeightRatio: options.thumbnailLineHeightRatio ?? 1.16,
    thumbnailTextPrimaryPosition: options.thumbnailTextPrimaryPosition ?? null,
    thumbnailTextSecondaryPosition: options.thumbnailTextSecondaryPosition ?? null,
  });

  if (options.renderMode === 'black_bg') {
    console.log('[VideoRenderer] Thumbnail post-process fallback (black_bg)');
    result = await applyThumbnailPostProcess(options, result);
  }
  return result;
}

export function stopActiveRender(): { success: boolean; stopped: boolean; message: string } {
  const inProgress = isRenderInProgress();
  const stopResult = requestStopCurrentRender();
  if (inProgress || stopResult.hadActiveProcess) {
    return { success: true, stopped: true, message: 'Đã gửi tín hiệu dừng render.' };
  }
  return { success: true, stopped: false, message: 'Không có tiến trình render đang chạy.' };
}

export async function renderThumbnailPreviewFrame(
  options: RenderThumbnailPreviewFrameOptions
): Promise<RenderThumbnailPreviewFrameResult> {
  return renderThumbnailPreviewFramePipeline(options);
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
