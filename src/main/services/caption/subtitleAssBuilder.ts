import os from 'os';
import path from 'path';
import { app } from 'electron';
import fs, { existsSync } from 'fs';
import { parseSrtFile } from './srtParser';
import { RenderVideoOptions } from '../../../shared/types/caption';
import { hexToAssColor } from './assConverter';
import { getVideoMetadata } from './videoRenderer'; // Temporary import, in the future this should be inside a videoUtils or ffmpegUtils
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
}

/**
 * Tính duration và export file ASS tạm để sử dụng trong bộ lọc FFmpeg
 */
export async function prepareSubtitleAndDuration(options: RenderVideoOptions): Promise<SubtitlePrepResult> {
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
      text = `{\\pos(${posX},${posY})}${text}`;
    }
    assContent += `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${text}\n`;
  }

  await fs.promises.writeFile(tempAssPath, assContent, 'utf-8');
  registerTempFile(tempAssPath);

  return {
    tempAssPath, duration, newAudioDuration, renderWidth, renderHeight, finalWidth, finalHeight,
    needsScale, hasVideoAudio, originalVideoDuration, videoSpeedMultiplier, scaleFactor, audioSpeed
  };
}

/**
 * Láy chuỗi bộ lọc FFmpeg dùng để vẽ ASS Subtitle lên video
 */
export function getSubtitleFilter(tempAssPath: string) {
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
