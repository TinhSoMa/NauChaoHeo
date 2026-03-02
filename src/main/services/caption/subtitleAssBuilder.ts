import os from 'os';
import path from 'path';
import { app } from 'electron';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { parseSrtFile } from './srtParser';
import { RenderVideoOptions } from '../../../shared/types/caption';
import { calculateHardsubTiming } from '../../../shared/utils/hardsubTiming';
import { resolveLandscapeOutputSize, ensureEven as ensureEvenResolution } from '../../../shared/utils/renderResolution';
import {
  clampNormalizedSubtitlePosition,
  isFiniteSubtitlePosition,
  isNormalizedSubtitlePosition,
} from '../../../shared/utils/subtitlePosition';
import { hexToAssColor } from './assConverter';
import { getVideoMetadata } from './hardsub/mediaProbe';
import { readRenderTimingContext } from './hardsub/timingContext';
import { registerTempFile } from './garbageCollector';

export interface SubtitlePrepResult {
  tempAssPath: string;
  duration: number;
  newAudioDuration: number;
  renderWidth: number;
  renderHeight: number;
  finalWidth: number;
  finalHeight: number;
  needsScale: boolean;
  hasVideoAudio: boolean;
  originalVideoDuration: number;
  videoSpeedMultiplier: number;
  scaleFactor: number;
  audioSpeed: number;
  step4ScaleUsed: number;
  step7SpeedUsed: number;
  audioEffectiveSpeed: number;
  subRenderDuration: number;
  videoSubBaseDuration: number;
  videoMarkerSec: number;
  speedCalcSource: 'runtime' | 'timing_context' | 'fallback_default';
  configuredSrtTimeScale: number;
  appliedSrtTimeScale: number;
  srtAlreadyScaled: boolean;
}

interface PortraitAssCanvas {
  width: number;
  height: number;
}

const MIN_SUBTITLE_FONT_SIZE = 1;
const MAX_SUBTITLE_FONT_SIZE = 1000;
const MIN_SUBTITLE_SHADOW = 0;
const MAX_SUBTITLE_SHADOW = 20;
const DEFAULT_SUBTITLE_FONT_SIZE = 48;
const DEFAULT_SUBTITLE_SHADOW = 2;
const SUBTITLE_SHADOW_STRONG_OPACITY = 0.9;
const SUBTITLE_SHADOW_SOFT_OPACITY = 0.15;

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function normalizeSubtitleFontSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SUBTITLE_FONT_SIZE;
  }
  return clampNumber(Math.round(value as number), MIN_SUBTITLE_FONT_SIZE, MAX_SUBTITLE_FONT_SIZE);
}

function normalizeSubtitleShadow(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SUBTITLE_SHADOW;
  }
  return clampNumber(value as number, MIN_SUBTITLE_SHADOW, MAX_SUBTITLE_SHADOW);
}

function opacityToAssAlphaHex(opacity: number): string {
  const normalizedOpacity = clampNumber(opacity, 0, 1);
  const alpha = Math.round((1 - normalizedOpacity) * 255);
  return alpha.toString(16).toUpperCase().padStart(2, '0');
}

function parseScaleFromSrtFileName(srtPath: string): number | null {
  const baseName = path.basename(srtPath).toLowerCase();
  const match = baseName.match(/(?:subtitle|translated)_([0-9]+(?:[._][0-9]+)?)x\.srt$/i);
  if (!match?.[1]) {
    return null;
  }
  const normalized = match[1].replace(/_/g, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveCaptionFontsDir(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'fonts'),
    path.join(app.getAppPath(), 'resources', 'fonts'),
    path.join(process.cwd(), 'resources', 'fonts'),
    path.resolve(__dirname, '../../../../../resources/fonts'),
    path.resolve('resources', 'fonts'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Tính duration và export file ASS tạm để sử dụng trong bộ lọc FFmpeg
 */
async function prepareSubtitleAndDurationCore(
  options: RenderVideoOptions,
  portraitAssCanvas?: PortraitAssCanvas
): Promise<SubtitlePrepResult> {
  const { srtPath, width, height: userHeight, videoPath, outputPath } = options;
  const activeRenderMode = options.renderMode || 'black_bg';
  const audioSpeed = options.audioSpeed && options.audioSpeed > 0 ? options.audioSpeed : 1.0;
  const configuredSrtTimeScale = options.srtTimeScale && options.srtTimeScale > 0 ? options.srtTimeScale : 1.0;
  const isHardsub = (options.renderMode === 'hardsub' || options.renderMode === 'hardsub_portrait_9_16') && !!videoPath;
  const defaultTimingContextPath = outputPath
    ? path.join(path.dirname(outputPath), 'caption_session.json')
    : undefined;
  const timingContextPath = options.timingContextPath || defaultTimingContextPath;
  const timingContext = await readRenderTimingContext(timingContextPath);

  const runtimeStep4Scale = options.step4SrtScale && options.step4SrtScale > 0 ? options.step4SrtScale : null;
  const runtimeStep7Speed = options.step7AudioSpeedInput && options.step7AudioSpeedInput > 0
    ? options.step7AudioSpeedInput
    : (options.audioSpeed && options.audioSpeed > 0 ? options.audioSpeed : null);
  const contextStep4Scale = timingContext?.step4SrtScale && timingContext.step4SrtScale > 0 ? timingContext.step4SrtScale : null;
  const contextStep7Speed = timingContext?.step7AudioSpeed && timingContext.step7AudioSpeed > 0 ? timingContext.step7AudioSpeed : null;

  const step4Scale = runtimeStep4Scale ?? contextStep4Scale ?? 1.0;
  const step7Speed = runtimeStep7Speed ?? contextStep7Speed ?? 1.0;
  const speedCalcSource: 'runtime' | 'timing_context' | 'fallback_default' =
    runtimeStep4Scale != null || runtimeStep7Speed != null
      ? 'runtime'
      : (contextStep4Scale != null || contextStep7Speed != null ? 'timing_context' : 'fallback_default');

  const audioSpeedModel = options.audioSpeedModel || timingContext?.audioSpeedModel || 'step4_minus_step7_delta';
  const fileNameScaleHint = parseScaleFromSrtFileName(srtPath);
  const srtAlreadyScaled = !!(
    fileNameScaleHint &&
    fileNameScaleHint > 1 &&
    Math.abs(fileNameScaleHint - step4Scale) < 0.02
  );
  const appliedSrtTimeScale = calculateHardsubTiming({
    step4Scale,
    step7Speed,
    subRenderDuration: 1,
    audioScaledDuration: 1,
    configuredSrtTimeScale,
    srtAlreadyScaled,
  }).appliedSrtTimeScale;

  let rawDuration = (!isHardsub && options.targetDuration) ? options.targetDuration : 60;
  let srtEndTimeSec = 0;
  let totalAudioDurationSec = 0;

  try {
    const srtCheck = await parseSrtFile(srtPath);
    if (srtCheck.success && srtCheck.entries.length > 0) {
      const lastEndMs = Math.max(...srtCheck.entries.map(e => e.endMs || 0));
      srtEndTimeSec = lastEndMs > 0 ? (lastEndMs / 1000) * appliedSrtTimeScale : 0;
    }
  } catch (e) {
    console.warn("[VideoRenderer] Lỗi đọc srtEndTimeSec", e);
  }

  let isDurationFromAudio = false;
  if (options.audioPath && existsSync(options.audioPath)) {
    const audioMeta = await getVideoMetadata(options.audioPath);
    if (audioMeta.success && audioMeta.metadata) {
      totalAudioDurationSec = audioMeta.metadata.duration;
      rawDuration = totalAudioDurationSec;
      isDurationFromAudio = true;
    }
  }

  if (!isDurationFromAudio && (isHardsub || !options.targetDuration)) {
    if (srtEndTimeSec > 0) {
      rawDuration = srtEndTimeSec;
    }
  }

  // Mốc sub theo SRT render hiện tại (thường là subtitle_1.3x.srt).
  const subRenderDuration = srtEndTimeSec > 0 ? srtEndTimeSec : 0;

  // Audio render thực tế (đã scale ở step7 qua file audio_*.wav/mp3).
  const audioBaseDuration = totalAudioDurationSec > 0 ? totalAudioDurationSec : subRenderDuration;
  const duration = subRenderDuration > 0 ? subRenderDuration : rawDuration;
  const newAudioDuration = audioBaseDuration / audioSpeed;
  const timing = calculateHardsubTiming({
    step4Scale,
    step7Speed,
    subRenderDuration,
    audioScaledDuration: newAudioDuration,
    configuredSrtTimeScale,
    srtAlreadyScaled,
  });
  const audioEffectiveSpeed = timing.audioEffectiveSpeed;
  const videoSubBaseDuration = timing.videoSubBaseDuration;
  const videoSpeedNeeded = timing.videoSpeedMultiplier;
  const videoMarkerSec = timing.videoMarkerSec;

  let finalWidth = portraitAssCanvas?.width ?? width;
  let finalHeight = portraitAssCanvas?.height ?? (userHeight || 150);
  finalWidth = Math.max(64, Math.min(7680, ensureEvenResolution(finalWidth, 64)));
  finalHeight = Math.max(64, Math.min(4320, ensureEvenResolution(finalHeight, 64)));

  const tempAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);

  let renderWidth = finalWidth;
  let renderHeight = finalHeight;
  let sourceVideoWidth = Math.max(2, ensureEvenResolution(width, 2));
  let sourceVideoHeight = Math.max(2, ensureEvenResolution(userHeight || 150, 2));
  let needsScale = false;
  let hasVideoAudio = false;
  let originalVideoDuration = 0;
  const videoSpeedMultiplier = videoSpeedNeeded > 0 ? videoSpeedNeeded : 1.0;
  const hasSourceVideo = !!(videoPath && existsSync(videoPath));

  if (hasSourceVideo) {
    try {
      const probeResult = await getVideoMetadata(videoPath);
      if (probeResult.success && probeResult.metadata) {
        sourceVideoWidth = Math.max(2, ensureEvenResolution(probeResult.metadata.width, 2));
        sourceVideoHeight = Math.max(2, ensureEvenResolution(probeResult.metadata.actualHeight || probeResult.metadata.height, 2));
        if (!portraitAssCanvas) {
          renderWidth = sourceVideoWidth;
          renderHeight = sourceVideoHeight;
        }
        hasVideoAudio = !!probeResult.metadata.hasAudio;
        originalVideoDuration = probeResult.metadata.duration;
      }
    } catch (e) {}
  }

  console.log(
    `[VideoRenderer] Duration sync | source=${speedCalcSource}, step4Scale=${step4Scale.toFixed(4)}, step7Speed=${step7Speed.toFixed(4)}, ` +
    `audioEffectiveSpeed=${audioEffectiveSpeed.toFixed(4)}, subRenderDuration=${subRenderDuration.toFixed(3)}s, ` +
    `videoSubBaseDuration=${videoSubBaseDuration.toFixed(3)}s, audioScaledDuration=${newAudioDuration.toFixed(3)}s, ` +
    `videoSpeedNeeded=${videoSpeedNeeded.toFixed(4)}, videoMarkerSec=${videoMarkerSec.toFixed(3)}s, ` +
    `srtScaleConfigured=${configuredSrtTimeScale}, srtScaleApplied=${appliedSrtTimeScale}, srtAlreadyScaled=${srtAlreadyScaled}, ` +
    `ttsRate=${options.ttsRate || 'n/a'}, audioModel=${audioSpeedModel}, ` +
    `videoTotal=${originalVideoDuration.toFixed(3)}s, durationUsed=${duration.toFixed(3)}s, ` +
    `subtitleSource=${options.step7SubtitleSource || 'unknown'}, audioSource=${options.step7AudioSource || 'unknown'}`
  );

  let scaleFactor = 1;
  if (!portraitAssCanvas) {
    const skipBlackBgScale = activeRenderMode === 'black_bg' && !hasSourceVideo;
    const outputSize = skipBlackBgScale
      ? {
          width: sourceVideoWidth,
          height: sourceVideoHeight,
          scaleFactor: 1,
          isUpscale: false,
          isDownscale: false,
        }
      : resolveLandscapeOutputSize(sourceVideoWidth, sourceVideoHeight, options.renderResolution);

    renderWidth = outputSize.width;
    renderHeight = outputSize.height;
    scaleFactor = outputSize.scaleFactor;
    needsScale = renderWidth !== sourceVideoWidth || renderHeight !== sourceVideoHeight;

    if (activeRenderMode === 'black_bg' && hasSourceVideo) {
      finalWidth = Math.max(64, Math.min(7680, ensureEvenResolution(finalWidth * scaleFactor, 64)));
      finalHeight = Math.max(64, Math.min(4320, ensureEvenResolution(finalHeight * scaleFactor, 64)));
    }

    console.log('[VideoRenderer][Resolution][Landscape]', {
      sourceSize: `${sourceVideoWidth}x${sourceVideoHeight}`,
      targetResolution: options.renderResolution || '1080p',
      outputSize: `${renderWidth}x${renderHeight}`,
      scaleFactor: Number(scaleFactor.toFixed(6)),
      isUpscale: outputSize.isUpscale,
      isDownscale: outputSize.isDownscale,
    });
  }

  const s = options.style || { fontName: 'Arial', fontSize: 48, fontColor: '#FFFF00', shadow: 2, marginV: 0, alignment: 5 };
  console.log(`[VideoRenderer][Font] ASS font selected: "${s.fontName}"`);
  const normalizedUserFontSize = normalizeSubtitleFontSize(s.fontSize);
  const shadowBase = normalizeSubtitleShadow(s.shadow);
  const effectiveFontSize = Math.max(1, Math.round(normalizedUserFontSize * scaleFactor));
  const effectiveShadow = shadowBase === 0
    ? 0
    : Math.max(1, Math.round(effectiveFontSize * 0.04 * (shadowBase / 4)));
  const strongShadowOffset = Math.max(1, effectiveShadow);
  const softShadowOffset = Math.max(strongShadowOffset + 1, Math.round(effectiveShadow * 1.8));
  const strongShadowAlpha = opacityToAssAlphaHex(SUBTITLE_SHADOW_STRONG_OPACITY);
  const softShadowAlpha = opacityToAssAlphaHex(SUBTITLE_SHADOW_SOFT_OPACITY);

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
Style: Default,${s.fontName},${effectiveFontSize},${assColor},&H000000FF,&H00000000,&H1A000000,0,0,0,0,100,100,0,0,1,0,0,${assAlignment},0,0,${assMarginV},1

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
    const scaledStartMs = entry.startMs * appliedSrtTimeScale;
    const scaledEndMs = entry.endMs * appliedSrtTimeScale;
    // Timeline output = TTS audio timeline sau khi speed adjust (step7).
    // Clip TTS ở thời điểm gốc T → sau step4 scale nằm tại T*appliedSrtTimeScale trong merged audio
    // → sau step7 speed adjust nằm tại T*appliedSrtTimeScale/step7Speed trong output.
    // Subtitle phải hiện đúng lúc đó → chia step7Speed.
    const startAss = msToAssTime(scaledStartMs / step7Speed);
    const endAss = msToAssTime(scaledEndMs / step7Speed);
    const text = (entry.translatedText || entry.text).replace(/\n/g, '\\N');
    let posX = Math.round(renderWidth / 2);
    let posY = Math.round(renderHeight / 2);
    if (isFiniteSubtitlePosition(options.position)) {
      if (isNormalizedSubtitlePosition(options.position)) {
        const normalized = clampNormalizedSubtitlePosition(options.position);
        posX = Math.round(normalized.x * renderWidth);
        posY = Math.round(normalized.y * renderHeight);
      } else {
        posX = Math.round(options.position.x * scaleFactor);
        posY = Math.round(options.position.y * scaleFactor);
      }
    }
    const clampedX = Math.max(0, Math.min(renderWidth, posX));
    const clampedY = Math.max(0, Math.min(renderHeight, posY));

    if (effectiveShadow > 0) {
      const softShadowText =
        `{\\an5\\pos(${clampedX + softShadowOffset},${clampedY + softShadowOffset})` +
        `\\1c&H000000&\\1a&H${softShadowAlpha}&\\bord0\\shad0\\blur3}${text}`;
      const strongShadowText =
        `{\\an5\\pos(${clampedX + strongShadowOffset},${clampedY + strongShadowOffset})` +
        `\\1c&H000000&\\1a&H${strongShadowAlpha}&\\bord0\\shad0\\blur1}${text}`;
      assContent += `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${softShadowText}\n`;
      assContent += `Dialogue: 1,${startAss},${endAss},Default,,0,0,0,,${strongShadowText}\n`;
    }

    const mainText = `{\\an5\\pos(${clampedX},${clampedY})\\bord0\\shad0}${text}`;
    assContent += `Dialogue: 2,${startAss},${endAss},Default,,0,0,0,,${mainText}\n`;
  }

  await fs.writeFile(tempAssPath, assContent, 'utf-8');
  registerTempFile(tempAssPath);

  return {
    tempAssPath, duration, newAudioDuration, renderWidth, renderHeight, finalWidth, finalHeight,
    needsScale, hasVideoAudio, originalVideoDuration, videoSpeedMultiplier, scaleFactor, audioSpeed,
    step4ScaleUsed: step4Scale,
    step7SpeedUsed: step7Speed,
    audioEffectiveSpeed,
    subRenderDuration,
    videoSubBaseDuration,
    videoMarkerSec,
    speedCalcSource,
    configuredSrtTimeScale,
    appliedSrtTimeScale,
    srtAlreadyScaled,
  };
}

export async function prepareSubtitleAndDuration(options: RenderVideoOptions): Promise<SubtitlePrepResult> {
  return prepareSubtitleAndDurationCore(options);
}

export async function prepareSubtitleAndDurationPortrait(
  options: RenderVideoOptions,
  canvas: PortraitAssCanvas
): Promise<SubtitlePrepResult> {
  return prepareSubtitleAndDurationCore(options, canvas);
}

/**
 * Láy chuỗi bộ lọc FFmpeg dùng để vẽ ASS Subtitle lên video
 */
export function getSubtitleFilter(tempAssPath: string) {
  const assPathEscaped = tempAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  let fontsDirParam = '';
  try {
    const fontsDir = resolveCaptionFontsDir();
    if (fontsDir && existsSync(fontsDir)) {
      const fontsDirEscaped = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:');
      fontsDirParam = `:fontsdir='${fontsDirEscaped}'`;
      console.log(`[VideoRenderer][Font] ASS fontsdir: ${fontsDir}`);
    } else {
      console.warn('[VideoRenderer][Font] Không tìm thấy resources/fonts. FFmpeg có thể fallback font mặc định.');
    }
  } catch (e) {
    console.warn('[VideoRenderer][Font] Lỗi resolve fontsdir:', e);
  }

  return `ass='${assPathEscaped}'${fontsDirParam}`;
}
