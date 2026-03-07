/**
 * Video Renderer - Render video từ file ASS bằng FFmpeg
 * Port từ caption_funtion.py
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import os from 'os';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import {
  RenderAudioPreviewOptions,
  RenderAudioPreviewProgress,
  RenderAudioPreviewResult,
  RenderThumbnailPreviewFrameOptions,
  RenderThumbnailPreviewFrameResult,
  RenderVideoPreviewFrameOptions,
  RenderVideoPreviewFrameResult,
  RenderVideoOptions,
  RenderProgress,
  RenderResult,
  SubtitleEntry,
  VideoMetadata,
} from '../../../shared/types/caption';
import { getFFmpegPath, getFFprobePath, isFFmpegAvailable } from '../../utils/ffmpegPath';
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
import { registerTempFile, unregisterTempFile } from './garbageCollector';
import { exportToSrt, msToSrtTime } from './srtParser';
import type { CoverFeatherStrategy } from './hardsub/types';

export const getVideoMetadata = probeGetVideoMetadata;
export const extractVideoFrame = probeExtractVideoFrame;

const AUDIO_PREVIEW_STOPPED_MESSAGE = 'Đã dừng test audio theo yêu cầu.';
const VIDEO_PREVIEW_STOPPED_MESSAGE = 'Đã dừng preview frame theo yêu cầu.';
let activeAudioPreviewProcess: ChildProcessWithoutNullStreams | null = null;
let audioPreviewStopRequested = false;
let activePreviewFrameProcess: ChildProcessWithoutNullStreams | null = null;
let activePreviewFrameToken: string | null = null;
let cancelAllPreviewRequests = false;
const canceledPreviewTokens = new Set<string>();

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

interface EncoderDecisionContext {
  renderMode?: RenderVideoOptions['renderMode'];
  coverMode?: RenderVideoOptions['coverMode'];
  hasLogo?: boolean;
  thumbnailEnabled?: boolean;
}

interface SpeedMaxProfile {
  qsvPreset: string;
  qsvGlobalQuality: number;
  nvencPreset: string;
  nvencCq: number;
  x264Preset: string;
  x264Crf: number;
  portraitBgDownscaleDivisor: number;
  portraitBgBlurLumaRadius: number;
  portraitBgBlurLumaPower: number;
  filterThreadsCap: number;
}

const SPEED_MAX_PROFILE: SpeedMaxProfile = {
  qsvPreset: 'veryfast',
  qsvGlobalQuality: 27,
  nvencPreset: 'p1',
  nvencCq: 25,
  x264Preset: 'veryfast',
  x264Crf: 24,
  portraitBgDownscaleDivisor: 10,
  portraitBgBlurLumaRadius: 6,
  portraitBgBlurLumaPower: 1,
  filterThreadsCap: 8,
};

function isHeavyFilterPipelineForQsvDecode(context?: EncoderDecisionContext): boolean {
  if (!context) {
    return false;
  }
  return (
    context.renderMode === 'hardsub_portrait_9_16'
    || context.coverMode === 'copy_from_above'
    || Boolean(context.hasLogo)
    || Boolean(context.thumbnailEnabled)
  );
}

function resolveFfmpegThreadArgs(): string[] {
  const coreCount = Math.max(2, os.cpus()?.length || 4);
  const filterThreads = Math.max(2, Math.min(SPEED_MAX_PROFILE.filterThreadsCap, Math.floor(coreCount * 0.75)));
  const filterComplexThreads = Math.max(2, Math.min(SPEED_MAX_PROFILE.filterThreadsCap, Math.ceil(filterThreads / 2)));
  return [
    '-threads', String(coreCount),
    '-filter_threads', String(filterThreads),
    '-filter_complex_threads', String(filterComplexThreads),
  ];
}

function resolveEncoderProfile(
  hardware: RenderVideoOptions['hardwareAcceleration'],
  renderMode: RenderVideoOptions['renderMode'],
  context?: EncoderDecisionContext
): EncoderProfile {
  if (hardware === 'qsv') {
    // Speed profile: dùng hybrid CPU filter + QSV encode.
    // Nếu pipeline nặng filter, ưu tiên software decode để tránh overhead upload/download.
    const forceQsvDecode =
      process.env.CAPTION_QSV_DECODE === '1' ||
      (renderMode === 'hardsub_portrait_9_16' && process.env.CAPTION_PORTRAIT_QSV_DECODE === '1');
    const forceSoftwareDecode = process.env.CAPTION_QSV_DECODE === '0';
    const heavyPipeline = isHeavyFilterPipelineForQsvDecode({
      renderMode,
      ...context,
    });
    const enableQsvDecode = forceSoftwareDecode ? false : (forceQsvDecode || !heavyPipeline);
    return {
      hwaccelArgs: enableQsvDecode ? ['-hwaccel', 'auto'] : [],
      videoCodec: 'h264_qsv',
      codecParams: [
        '-preset', SPEED_MAX_PROFILE.qsvPreset,
        '-global_quality', String(SPEED_MAX_PROFILE.qsvGlobalQuality),
      ],
      pixelFormat: 'nv12',
      decodePath: enableQsvDecode
        ? (heavyPipeline ? 'qsv_decode(forced) + qsv_encode' : 'qsv_decode + qsv_encode')
        : 'software_decode + qsv_encode',
    };
  }

  if (hardware === 'nvenc') {
    return {
      hwaccelArgs: [],
      videoCodec: 'h264_nvenc',
      // Ưu tiên tốc độ khi user chọn NVENC.
      codecParams: [
        '-preset', SPEED_MAX_PROFILE.nvencPreset,
        '-rc', 'vbr',
        '-cq', String(SPEED_MAX_PROFILE.nvencCq),
        '-b:v', '0',
      ],
      pixelFormat: 'nv12',
      decodePath: 'software_decode + nvenc_encode',
    };
  }

  return {
    hwaccelArgs: [],
    videoCodec: 'libx264',
    codecParams: ['-preset', SPEED_MAX_PROFILE.x264Preset, '-crf', String(SPEED_MAX_PROFILE.x264Crf)],
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

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y);
}

function resolveLogoOverlayPositionExpr(
  logoPosition: { x: number; y: number } | undefined,
  scaleFactor: number,
  outputWidth: number,
  outputHeight: number
): { x: string; y: string } | null {
  if (!isFinitePoint(logoPosition)) {
    return null;
  }
  const isNormalized = (
    logoPosition.x >= 0
    && logoPosition.x <= 1
    && logoPosition.y >= 0
    && logoPosition.y <= 1
  );
  if (isNormalized) {
    const px = Math.round(logoPosition.x * Math.max(1, outputWidth));
    const py = Math.round(logoPosition.y * Math.max(1, outputHeight));
    return {
      x: `${px}-overlay_w/2`,
      y: `${py}-overlay_h/2`,
    };
  }
  return {
    x: `${Math.round(logoPosition.x * scaleFactor)}-overlay_w/2`,
    y: `${Math.round(logoPosition.y * scaleFactor)}-overlay_h/2`,
  };
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

function parseFfmpegTimestampToSec(raw: string): number | null {
  const match = raw.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return (hours * 3600) + (minutes * 60) + seconds;
}

function summarizeFfmpegStderr(stderr: string): string {
  const text = (stderr || '').trim();
  if (!text) {
    return 'FFmpeg xử lý thất bại.';
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return 'FFmpeg xử lý thất bại.';
  }
  const important = lines.filter((line) =>
    /(error|failed|invalid|cannot|unable|no such|not found|could not)/i.test(line)
  );
  const source = important.length > 0 ? important : lines;
  const picked = [source[0], ...source.slice(-3)].filter((line, index, arr) => !!line && arr.indexOf(line) === index);
  return picked.join(' | ');
}

const COVER_FEATHER_RETRYABLE_PATTERN =
  /(could not open encoder before eof|output file is empty|nothing was written|error while filtering|error initializing (complex )?filters?|invalid argument)/i;

function shouldRetryWithGblurFeather(
  coverMode: string | undefined,
  coverFeatherPx: number | undefined,
  coverFeatherHorizontalPx: number | undefined,
  coverFeatherVerticalPx: number | undefined,
  coverFeatherHorizontalPercent: number | undefined,
  coverFeatherVerticalPercent: number | undefined,
  strategy: CoverFeatherStrategy,
  errorText: string
): boolean {
  if (coverMode !== 'copy_from_above') {
    return false;
  }
  const hasLegacyFeather = Number.isFinite(coverFeatherPx) && (coverFeatherPx as number) > 0;
  const hasHorizontalFeather = Number.isFinite(coverFeatherHorizontalPx) && (coverFeatherHorizontalPx as number) > 0;
  const hasVerticalFeather = Number.isFinite(coverFeatherVerticalPx) && (coverFeatherVerticalPx as number) > 0;
  const hasHorizontalPercent = Number.isFinite(coverFeatherHorizontalPercent) && (coverFeatherHorizontalPercent as number) > 0;
  const hasVerticalPercent = Number.isFinite(coverFeatherVerticalPercent) && (coverFeatherVerticalPercent as number) > 0;
  if (!hasLegacyFeather && !hasHorizontalFeather && !hasVerticalFeather && !hasHorizontalPercent && !hasVerticalPercent) {
    return false;
  }
  if (strategy !== 'geq_distance') {
    return false;
  }
  return COVER_FEATHER_RETRYABLE_PATTERN.test(errorText || '');
}

function resolvePreviewHwaccelArgs(
  hardware: RenderVideoPreviewFrameOptions['hardwareAcceleration'],
  renderMode?: RenderVideoPreviewFrameOptions['renderMode']
): string[] {
  // Portrait preview dễ gặp artifact xanh với một số driver khi decode bằng hwaccel.
  if (renderMode === 'hardsub_portrait_9_16') {
    return [];
  }
  if (hardware === 'qsv' || hardware === 'nvenc') {
    return ['-hwaccel', 'auto'];
  }
  return [];
}

function normalizePreviewEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const normalized = entries
    .map((entry, idx) => {
      const startMs = Number.isFinite(entry?.startMs) ? Math.max(0, Math.floor(entry.startMs)) : 0;
      const endMsRaw = Number.isFinite(entry?.endMs) ? Math.floor(entry.endMs) : startMs;
      const endMs = Math.max(startMs + 10, endMsRaw);
      const originalText = typeof entry?.text === 'string' ? entry.text : '';
      const translatedText = typeof entry?.translatedText === 'string' ? entry.translatedText : undefined;
      const startTime = typeof entry?.startTime === 'string' && entry.startTime.trim().length > 0
        ? entry.startTime
        : msToSrtTime(startMs);
      const endTime = typeof entry?.endTime === 'string' && entry.endTime.trim().length > 0
        ? entry.endTime
        : msToSrtTime(endMs);

      return {
        index: idx + 1,
        startTime,
        endTime,
        startMs,
        endMs,
        durationMs: Math.max(0, endMs - startMs),
        text: originalText,
        translatedText,
      } as SubtitleEntry;
    })
    .filter((entry) => {
      const visibleText = (entry.translatedText || entry.text || '').trim();
      return visibleText.length > 0 && entry.endMs > entry.startMs;
    })
    .sort((a, b) => a.startMs - b.startMs);

  return normalized;
}

function withReindexedEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries
    .sort((a, b) => a.startMs - b.startMs)
    .map((entry, idx) => ({
      ...entry,
      index: idx + 1,
      startTime: msToSrtTime(entry.startMs),
      endTime: msToSrtTime(entry.endMs),
      durationMs: Math.max(0, entry.endMs - entry.startMs),
    }));
}

function selectPreviewEntriesAtTime(entries: SubtitleEntry[], previewTimeSec: number): SubtitleEntry[] {
  if (!entries.length) {
    return [];
  }
  const previewMs = Math.max(0, Math.round(previewTimeSec * 1000));
  const active = entries.filter((entry) => entry.startMs <= previewMs && previewMs < entry.endMs);
  if (active.length > 0) {
    const rebasedActive = active.map((entry) => {
      const relativeStart = Math.max(0, entry.startMs - previewMs);
      const relativeEndRaw = entry.endMs - previewMs;
      const relativeEnd = Math.max(relativeStart + 400, relativeEndRaw);
      return {
        ...entry,
        startMs: relativeStart,
        endMs: relativeEnd,
      };
    });
    return withReindexedEntries(rebasedActive);
  }

  let nearest: SubtitleEntry | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const distance = previewMs < entry.startMs
      ? (entry.startMs - previewMs)
      : (previewMs > entry.endMs ? (previewMs - entry.endMs) : 0);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = entry;
    }
  }

  if (!nearest) {
    return [];
  }

  const nearestText = (nearest.translatedText || nearest.text || '').trim();
  if (!nearestText) {
    return [];
  }

  const syntheticStart = 0;
  const syntheticEnd = 1800;
  return withReindexedEntries([{
    ...nearest,
    index: 1,
    startMs: syntheticStart,
    endMs: syntheticEnd,
    startTime: msToSrtTime(syntheticStart),
    endTime: msToSrtTime(syntheticEnd),
    durationMs: syntheticEnd - syntheticStart,
    text: nearest.text,
    translatedText: nearest.translatedText,
  }]);
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
  progressCallback?: (progress: RenderProgress) => void,
  featherStrategy: CoverFeatherStrategy = 'geq_distance'
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
  const effectiveFeatherStrategy: CoverFeatherStrategy = featherStrategy;
  const videoFilter = buildVideoFilter({
    inputLabel: '[0:v]',
    needsScale: prep.needsScale,
    renderWidth: prep.renderWidth,
    renderHeight: prep.renderHeight,
    blackoutTop: options.blackoutTop,
    coverMode,
    coverQuad: options.coverQuad,
    coverFeatherPx: options.coverFeatherPx,
    coverFeatherHorizontalPx: options.coverFeatherHorizontalPx,
    coverFeatherVerticalPx: options.coverFeatherVerticalPx,
    coverFeatherHorizontalPercent: options.coverFeatherHorizontalPercent,
    coverFeatherVerticalPercent: options.coverFeatherVerticalPercent,
    featherStrategy: effectiveFeatherStrategy,
    videoSpeedMultiplier: prep.videoSpeedMultiplier,
    subtitleFilter,
  });

  const encoderProfile = resolveEncoderProfile(options.hardwareAcceleration, options.renderMode, {
    coverMode,
    hasLogo: Boolean(options.logoPath),
    thumbnailEnabled: Boolean(options.thumbnailEnabled),
  });

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
      const logoPositionExpr = resolveLogoOverlayPositionExpr(
        renderOptions.logoPosition,
        prep.scaleFactor,
        prep.renderWidth,
        prep.renderHeight
      );
      if (logoPositionExpr) {
        logoXAxis = logoPositionExpr.x;
        logoYAxis = logoPositionExpr.y;
      }
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

  const ffmpegThreadArgs = resolveFfmpegThreadArgs();
  const args = [
    ...inputArgs,
    ...ffmpegThreadArgs,
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
  const includeFullStderrOnError =
    coverMode === 'copy_from_above' &&
    (
      (Number.isFinite(options.coverFeatherPx) && (options.coverFeatherPx as number) > 0) ||
      (Number.isFinite(options.coverFeatherHorizontalPx) && (options.coverFeatherHorizontalPx as number) > 0) ||
      (Number.isFinite(options.coverFeatherVerticalPx) && (options.coverFeatherVerticalPx as number) > 0) ||
      (Number.isFinite(options.coverFeatherHorizontalPercent) && (options.coverFeatherHorizontalPercent as number) > 0) ||
      (Number.isFinite(options.coverFeatherVerticalPercent) && (options.coverFeatherVerticalPercent as number) > 0)
    );
  const renderStartedAtMs = Date.now();
  const renderResult = await runFFmpegProcess({
    args,
    totalFrames,
    fps,
    outputPath,
    tempAssPath: prep.tempAssPath,
    cleanupTempPaths: inlineThumbnail.cleanupFiles,
    duration: outputDuration,
    progressCallback,
    debugLabel: `hardsub:${effectiveFeatherStrategy}`,
    includeFullStderrOnError,
  });
  if (
    !renderResult.success &&
    shouldRetryWithGblurFeather(
      coverMode,
      options.coverFeatherPx,
      options.coverFeatherHorizontalPx,
      options.coverFeatherVerticalPx,
      options.coverFeatherHorizontalPercent,
      options.coverFeatherVerticalPercent,
      effectiveFeatherStrategy,
      renderResult.error || ''
    )
  ) {
    console.warn('[VideoRenderer][Hardsub] Retry with fallback feather strategy gblur_mask.', {
      initialStrategy: featherStrategy,
      error: renderResult.error,
    });
    return renderHardsubVideo(options, progressCallback, 'gblur_mask');
  }
  const renderWallMs = Date.now() - renderStartedAtMs;
  if (renderResult.success) {
    renderResult.timingPayload = {
      ...(hardsubTimingDebug as Record<string, unknown>),
      perf: {
        profile: 'speed_max',
        renderWallMs,
        ffmpegThreadArgs,
      },
    } as Record<string, unknown>;
  }
  return renderResult;
}

/**
 * Render hardsub chuyển khung 16:9 -> 9:16 với nền blur
 */
export async function renderHardsubPortraitVideo(
  options: RenderVideoOptions,
  progressCallback?: (progress: RenderProgress) => void,
  featherStrategy: CoverFeatherStrategy = 'geq_distance'
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
  const coverMode = options.coverMode || 'blackout_bottom';
  const effectiveFeatherStrategy: CoverFeatherStrategy = featherStrategy;
  const encoderProfile = resolveEncoderProfile(options.hardwareAcceleration, options.renderMode, {
    coverMode,
    hasLogo: Boolean(options.logoPath),
    thumbnailEnabled: Boolean(options.thumbnailEnabled),
  });

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
  const bgDownscaleWidth = even(portraitCanvas.width / SPEED_MAX_PROFILE.portraitBgDownscaleDivisor);
  const bgDownscaleHeight = even(portraitCanvas.height / SPEED_MAX_PROFILE.portraitBgDownscaleDivisor);
  const bgBlurLumaRadius = SPEED_MAX_PROFILE.portraitBgBlurLumaRadius;
  const bgBlurLumaPower = SPEED_MAX_PROFILE.portraitBgBlurLumaPower;
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
    coverMode,
    coverQuad: options.coverQuad,
    coverFeatherPx: options.coverFeatherPx,
    coverFeatherHorizontalPx: options.coverFeatherHorizontalPx,
    coverFeatherVerticalPx: options.coverFeatherVerticalPx,
    coverFeatherHorizontalPercent: options.coverFeatherHorizontalPercent,
    coverFeatherVerticalPercent: options.coverFeatherVerticalPercent,
    featherStrategy: effectiveFeatherStrategy,
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
      const logoPositionExpr = resolveLogoOverlayPositionExpr(
        renderOptions.logoPosition,
        prep.scaleFactor,
        prep.renderWidth,
        prep.renderHeight
      );
      if (logoPositionExpr) {
        logoXAxis = logoPositionExpr.x;
        logoYAxis = logoPositionExpr.y;
      }
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

  const ffmpegThreadArgs = resolveFfmpegThreadArgs();
  const args = [
    ...inputArgs,
    ...ffmpegThreadArgs,
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
      mode: coverMode,
      hasQuad: !!options.coverQuad,
    },
  });
  console.log('[VideoRenderer][HardsubPortrait][TimingPayload]', hardsubTimingDebug);

  const totalFrames = Math.floor(outputDuration * fps);
  const includeFullStderrOnError =
    coverMode === 'copy_from_above' &&
    (
      (Number.isFinite(options.coverFeatherPx) && (options.coverFeatherPx as number) > 0) ||
      (Number.isFinite(options.coverFeatherHorizontalPx) && (options.coverFeatherHorizontalPx as number) > 0) ||
      (Number.isFinite(options.coverFeatherVerticalPx) && (options.coverFeatherVerticalPx as number) > 0) ||
      (Number.isFinite(options.coverFeatherHorizontalPercent) && (options.coverFeatherHorizontalPercent as number) > 0) ||
      (Number.isFinite(options.coverFeatherVerticalPercent) && (options.coverFeatherVerticalPercent as number) > 0)
    );
  const renderStartedAtMs = Date.now();
  const renderResult = await runFFmpegProcess({
    args,
    totalFrames,
    fps,
    outputPath,
    tempAssPath: prep.tempAssPath,
    cleanupTempPaths: inlineThumbnail.cleanupFiles,
    duration: outputDuration,
    progressCallback,
    debugLabel: `hardsub_portrait:${effectiveFeatherStrategy}`,
    includeFullStderrOnError,
  });
  if (
    !renderResult.success &&
    shouldRetryWithGblurFeather(
      coverMode,
      options.coverFeatherPx,
      options.coverFeatherHorizontalPx,
      options.coverFeatherVerticalPx,
      options.coverFeatherHorizontalPercent,
      options.coverFeatherVerticalPercent,
      effectiveFeatherStrategy,
      renderResult.error || ''
    )
  ) {
    console.warn('[VideoRenderer][HardsubPortrait] Retry with fallback feather strategy gblur_mask.', {
      initialStrategy: featherStrategy,
      error: renderResult.error,
    });
    return renderHardsubPortraitVideo(options, progressCallback, 'gblur_mask');
  }
  const renderWallMs = Date.now() - renderStartedAtMs;
  if (renderResult.success) {
    renderResult.timingPayload = {
      ...(hardsubTimingDebug as Record<string, unknown>),
      perf: {
        profile: 'speed_max',
        renderWallMs,
        ffmpegThreadArgs,
      },
    } as Record<string, unknown>;
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

  const encoderProfile = resolveEncoderProfile(options.hardwareAcceleration, options.renderMode, {
    thumbnailEnabled: Boolean(options.thumbnailEnabled),
  });

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

  const ffmpegThreadArgs = resolveFfmpegThreadArgs();
  const args = [
    ...inputArgs,
    ...ffmpegThreadArgs,
    '-filter_complex', filterComplexParts.join(';'),
    ...mapArgs,
    '-c:v', encoderProfile.videoCodec,
    ...encoderProfile.codecParams,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', encoderProfile.pixelFormat,
    '-t', finalDurationStr,
    '-y',
    outputPath,
  ];

  const totalFrames = Math.floor(prep.newAudioDuration * fps);
  const renderStartedAtMs = Date.now();
  const renderResult = await runFFmpegProcess({
    args,
    totalFrames,
    fps,
    outputPath,
    tempAssPath: prep.tempAssPath,
    duration: prep.duration,
    progressCallback,
  });
  if (renderResult.success) {
    renderResult.timingPayload = {
      profile: 'speed_max',
      renderWallMs: Date.now() - renderStartedAtMs,
      ffmpegThreadArgs,
    };
  }
  return renderResult;
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

export async function renderVideoPreviewFrame(
  options: RenderVideoPreviewFrameOptions,
  retryCount = 0,
  featherStrategy: CoverFeatherStrategy = 'geq_distance',
  featherRetryCount = 0
): Promise<RenderVideoPreviewFrameResult> {
  if (!isFFmpegAvailable()) {
    return { success: false, error: 'FFmpeg không được cài đặt' };
  }
  if (!options.videoPath || !existsSync(options.videoPath)) {
    return { success: false, error: `Video không tồn tại: ${options.videoPath}` };
  }
  const requestToken =
    typeof options.requestToken === 'string' && options.requestToken.trim().length > 0
      ? options.requestToken.trim()
      : null;
  if (requestToken && canceledPreviewTokens.has(requestToken)) {
    canceledPreviewTokens.delete(requestToken);
    return { success: false, error: VIDEO_PREVIEW_STOPPED_MESSAGE };
  }
  if (cancelAllPreviewRequests) {
    cancelAllPreviewRequests = false;
  }
  if (activePreviewFrameProcess && !activePreviewFrameProcess.killed) {
    const sameRequestToken = requestToken && activePreviewFrameToken === requestToken;
    if (!sameRequestToken) {
      if (activePreviewFrameToken) {
        canceledPreviewTokens.add(activePreviewFrameToken);
      }
      try {
        activePreviewFrameProcess.kill('SIGKILL');
      } catch {}
    }
  }

  const normalizedEntries = normalizePreviewEntries(options.entries || []);
  if (normalizedEntries.length === 0) {
    return { success: false, error: 'Không có subtitle để render preview.' };
  }

  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }

  const probeResult = await probeGetVideoMetadata(options.videoPath);
  const sourceMeta = probeResult.success && probeResult.metadata ? probeResult.metadata : null;
  const sourceWidth = sourceMeta?.width || 1920;
  const sourceHeight = sourceMeta?.actualHeight || sourceMeta?.height || 1080;
  const sourceDuration = sourceMeta?.duration || 0;
  const sourceFps = sourceMeta?.fps && sourceMeta.fps > 0 ? sourceMeta.fps : 25;
  const requestedTime = Number.isFinite(options.previewTimeSec) ? Number(options.previewTimeSec) : 0;
  const effectiveRequestedTime = Number.isFinite(options.timeBucketSec) && (options.timeBucketSec as number) > 0
    ? Number(options.timeBucketSec)
    : requestedTime;
  const frameStepSec = 1 / sourceFps;
  const seekBackoffSec = Math.min(0.25, Math.max(0.02, frameStepSec));
  const seekUpperBound = sourceDuration > 0
    ? Math.max(0, sourceDuration - seekBackoffSec)
    : effectiveRequestedTime;
  const safePreviewTimeSec = Math.max(0, Math.min(seekUpperBound, effectiveRequestedTime));
  const previewEntries = selectPreviewEntriesAtTime(normalizedEntries, safePreviewTimeSec);
  if (previewEntries.length === 0) {
    return { success: false, error: 'Không tìm được subtitle hợp lệ để render preview.' };
  }
  const previewHwaccelArgs = resolvePreviewHwaccelArgs(options.hardwareAcceleration, options.renderMode);

  let tempDirPath = '';
  let tempSrtPath = '';
  let tempFramePath = '';
  let prepTempAssPath: string | null = null;

  const cleanupPreviewTemps = async () => {
    if (prepTempAssPath) {
      unregisterTempFile(prepTempAssPath);
      try {
        await fs.unlink(prepTempAssPath);
      } catch {}
      prepTempAssPath = null;
    }
    if (tempSrtPath) {
      unregisterTempFile(tempSrtPath);
    }
    if (tempFramePath) {
      unregisterTempFile(tempFramePath);
    }
    if (tempDirPath) {
      try {
        await fs.rm(tempDirPath, { recursive: true, force: true });
      } catch {}
    }
  };

  try {
    tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'caption_video_preview_'));
    tempSrtPath = path.join(tempDirPath, 'preview_input.srt');
    tempFramePath = path.join(tempDirPath, 'preview_frame.png');
    registerTempFile(tempSrtPath);
    registerTempFile(tempFramePath);

    const srtExport = await exportToSrt(previewEntries, tempSrtPath, true);
    if (!srtExport.success) {
      await cleanupPreviewTemps();
      return { success: false, error: srtExport.error || 'Không thể tạo SRT tạm cho preview.' };
    }

    const renderMode = options.renderMode || 'hardsub';
    const renderOptionsBase: RenderVideoOptions = {
      srtPath: tempSrtPath,
      outputPath: path.join(tempDirPath, 'preview_dummy.mp4'),
      width: sourceWidth,
      height: sourceHeight,
      videoPath: renderMode === 'black_bg' ? undefined : options.videoPath,
      style: options.style,
      renderMode,
      renderResolution: options.renderResolution,
      position: options.position,
      blackoutTop: options.blackoutTop,
      coverMode: options.coverMode,
      coverQuad: options.coverQuad,
      coverFeatherPx: options.coverFeatherPx,
      coverFeatherHorizontalPx: options.coverFeatherHorizontalPx,
      coverFeatherVerticalPx: options.coverFeatherVerticalPx,
      coverFeatherHorizontalPercent: options.coverFeatherHorizontalPercent,
      coverFeatherVerticalPercent: options.coverFeatherVerticalPercent,
      logoPath: options.logoPath,
      logoPosition: options.logoPosition,
      logoScale: options.logoScale,
      portraitForegroundCropPercent: options.portraitForegroundCropPercent,
      audioSpeed: 1.0,
      step7AudioSpeedInput: 1.0,
      srtTimeScale: 1.0,
      step4SrtScale: 1.0,
    };

    let outputWidth = sourceWidth;
    let outputHeight = sourceHeight;
    const filterComplexParts: string[] = [];
    const finalVideoLabel = '[v_preview_out]';
    let inputArgs: string[] = [];

    if (renderMode === 'black_bg') {
      const prep = await prepareSubtitleAndDuration({
        ...renderOptionsBase,
        renderMode: 'black_bg',
        videoPath: undefined,
      });
      prepTempAssPath = prep.tempAssPath;
      outputWidth = prep.finalWidth;
      outputHeight = prep.finalHeight;
      const subtitleFilter = getSubtitleFilter(prep.tempAssPath);
      inputArgs = [
        '-f', 'lavfi',
        '-i', `color=black:s=${prep.finalWidth}x${prep.finalHeight}:r=24`,
      ];
      filterComplexParts.push(`[0:v]${subtitleFilter}${finalVideoLabel}`);
    } else if (renderMode === 'hardsub_portrait_9_16') {
      const portraitCanvas = resolvePortraitCanvasByPreset(options.renderResolution);
      const prep = await prepareSubtitleAndDurationPortrait({
        ...renderOptionsBase,
        renderMode: 'hardsub_portrait_9_16',
        videoPath: options.videoPath,
      }, portraitCanvas);
      prepTempAssPath = prep.tempAssPath;
      outputWidth = prep.renderWidth;
      outputHeight = prep.renderHeight;
      const subtitleFilter = getSubtitleFilter(prep.tempAssPath);
      const even = (value: number) => {
        const rounded = Math.max(2, Math.round(value));
        return rounded % 2 === 0 ? rounded : rounded + 1;
      };
      const coverMode = options.coverMode || 'blackout_bottom';
      const effectiveFeatherStrategy: CoverFeatherStrategy = featherStrategy;
      const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
      const outputAspect = portraitCanvas.width / portraitCanvas.height;
      const aspectDiffRatio = Math.abs(sourceAspect - outputAspect) / outputAspect;
      const nearPortraitAspectThreshold = 0.05;
      const layoutStrategy: 'blur_composite' | 'direct_fit_no_blur' =
        aspectDiffRatio <= nearPortraitAspectThreshold ? 'direct_fit_no_blur' : 'blur_composite';
      const foregroundCropPercent = Math.min(
        20,
        Math.max(
          0,
          Number.isFinite(options.portraitForegroundCropPercent ?? 0)
            ? (options.portraitForegroundCropPercent as number)
            : 0
        )
      );
      const portraitVideo = buildPortraitVideoFilter({
        inputLabel: '[0:v]',
        outputWidth: portraitCanvas.width,
        outputHeight: portraitCanvas.height,
        subtitleFilter,
        sourceAspect,
        layoutStrategy,
        foregroundCropPercent,
        videoSpeedMultiplier: 1.0,
        blackoutTop: options.blackoutTop,
        coverMode,
        coverQuad: options.coverQuad,
        coverFeatherPx: options.coverFeatherPx,
        coverFeatherHorizontalPx: options.coverFeatherHorizontalPx,
        coverFeatherVerticalPx: options.coverFeatherVerticalPx,
        coverFeatherHorizontalPercent: options.coverFeatherHorizontalPercent,
        coverFeatherVerticalPercent: options.coverFeatherVerticalPercent,
        featherStrategy: effectiveFeatherStrategy,
        bgDownscaleWidth: even(portraitCanvas.width / SPEED_MAX_PROFILE.portraitBgDownscaleDivisor),
        bgDownscaleHeight: even(portraitCanvas.height / SPEED_MAX_PROFILE.portraitBgDownscaleDivisor),
        bgBlurLumaRadius: SPEED_MAX_PROFILE.portraitBgBlurLumaRadius,
        bgBlurLumaPower: SPEED_MAX_PROFILE.portraitBgBlurLumaPower,
      });
      inputArgs = [...previewHwaccelArgs, '-ss', safePreviewTimeSec.toFixed(3), '-i', options.videoPath];
      filterComplexParts.push(...portraitVideo.filterParts);
      const portraitOutputLabel = `[${portraitVideo.outputLabel}]`;
      if (options.logoPath && existsSync(options.logoPath)) {
        inputArgs.push('-i', options.logoPath);
        const userLogoScale = options.logoScale ?? 1.0;
        const totalLogoScale = prep.scaleFactor * userLogoScale;
        const logoScaleFilter = totalLogoScale !== 1
          ? `scale=iw*${totalLogoScale}:ih*${totalLogoScale}`
          : 'copy';
        let logoXAxis = `main_w-overlay_w-50*${prep.scaleFactor}`;
        let logoYAxis = `50*${prep.scaleFactor}`;
        if (options.logoPosition) {
          const logoPositionExpr = resolveLogoOverlayPositionExpr(
            options.logoPosition,
            prep.scaleFactor,
            outputWidth,
            outputHeight
          );
          if (logoPositionExpr) {
            logoXAxis = logoPositionExpr.x;
            logoYAxis = logoPositionExpr.y;
          }
        }
        filterComplexParts.push('[1:v]' + logoScaleFilter + '[logo_scaled_preview]');
        filterComplexParts.push(`${portraitOutputLabel}[logo_scaled_preview]overlay=x=${logoXAxis}:y=${logoYAxis}${finalVideoLabel}`);
      } else {
        filterComplexParts.push(`${portraitOutputLabel}null${finalVideoLabel}`);
      }
    } else {
      const prep = await prepareSubtitleAndDuration({
        ...renderOptionsBase,
        renderMode: 'hardsub',
        videoPath: options.videoPath,
      });
      prepTempAssPath = prep.tempAssPath;
      outputWidth = prep.renderWidth;
      outputHeight = prep.renderHeight;
      const subtitleFilter = getSubtitleFilter(prep.tempAssPath);
      const videoFilter = buildVideoFilter({
        inputLabel: '[0:v]',
        needsScale: prep.needsScale,
        renderWidth: prep.renderWidth,
        renderHeight: prep.renderHeight,
        blackoutTop: options.blackoutTop,
        coverMode: options.coverMode || 'blackout_bottom',
        coverQuad: options.coverQuad,
        coverFeatherPx: options.coverFeatherPx,
        coverFeatherHorizontalPx: options.coverFeatherHorizontalPx,
        coverFeatherVerticalPx: options.coverFeatherVerticalPx,
        coverFeatherHorizontalPercent: options.coverFeatherHorizontalPercent,
        coverFeatherVerticalPercent: options.coverFeatherVerticalPercent,
        featherStrategy,
        videoSpeedMultiplier: 1.0,
        subtitleFilter,
      });
      inputArgs = [...previewHwaccelArgs, '-ss', safePreviewTimeSec.toFixed(3), '-i', options.videoPath];
      filterComplexParts.push(...videoFilter.filterParts);
      if (options.logoPath && existsSync(options.logoPath)) {
        inputArgs.push('-i', options.logoPath);
        const userLogoScale = options.logoScale ?? 1.0;
        const totalLogoScale = prep.scaleFactor * userLogoScale;
        const logoScaleFilter = totalLogoScale !== 1
          ? `scale=iw*${totalLogoScale}:ih*${totalLogoScale}`
          : 'copy';
        let logoXAxis = `main_w-overlay_w-50*${prep.scaleFactor}`;
        let logoYAxis = `50*${prep.scaleFactor}`;
        if (options.logoPosition) {
          const logoPositionExpr = resolveLogoOverlayPositionExpr(
            options.logoPosition,
            prep.scaleFactor,
            outputWidth,
            outputHeight
          );
          if (logoPositionExpr) {
            logoXAxis = logoPositionExpr.x;
            logoYAxis = logoPositionExpr.y;
          }
        }
        filterComplexParts.push('[1:v]' + logoScaleFilter + '[logo_scaled_preview]');
        filterComplexParts.push(`${videoFilter.outputLabel}[logo_scaled_preview]overlay=x=${logoXAxis}:y=${logoYAxis}${finalVideoLabel}`);
      } else {
        filterComplexParts.push(`${videoFilter.outputLabel}null${finalVideoLabel}`);
      }
    }

    const args = [
      ...inputArgs,
      '-filter_complex', filterComplexParts.join(';'),
      '-map', finalVideoLabel,
      '-frames:v', '1',
      '-c:v', 'png',
      '-an',
      '-sn',
      '-y',
      tempFramePath,
    ];
    const isCanceledRequest = (): boolean => {
      if (cancelAllPreviewRequests) {
        return true;
      }
      if (requestToken && canceledPreviewTokens.has(requestToken)) {
        return true;
      }
      return false;
    };
    const clearCanceledFlag = (): void => {
      if (requestToken) {
        canceledPreviewTokens.delete(requestToken);
      }
    };

    return await new Promise<RenderVideoPreviewFrameResult>((resolve) => {
      const process = spawn(ffmpegPath, args);
      activePreviewFrameProcess = process;
      activePreviewFrameToken = requestToken;
      let stderr = '';

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', async (code) => {
        const canceled = isCanceledRequest();
        if (activePreviewFrameProcess === process) {
          activePreviewFrameProcess = null;
          activePreviewFrameToken = null;
        }
        if (canceled) {
          clearCanceledFlag();
          await cleanupPreviewTemps();
          resolve({ success: false, error: VIDEO_PREVIEW_STOPPED_MESSAGE });
          return;
        }
        if (code === 0) {
          try {
            const frameBuffer = await fs.readFile(tempFramePath);
            await cleanupPreviewTemps();
            clearCanceledFlag();
            resolve({
              success: true,
              frameData: frameBuffer.toString('base64'),
              width: outputWidth,
              height: outputHeight,
              previewTimeSec: safePreviewTimeSec,
            });
          } catch (error) {
            await cleanupPreviewTemps();
            resolve({ success: false, error: `Không thể đọc frame preview: ${String(error)}` });
          }
          return;
        }

        const summarizedError = summarizeFfmpegStderr(stderr) || `FFmpeg exit code: ${code}`;
        const combinedErrorText = `${stderr}\n${summarizedError}`;
        const coverMode = options.coverMode || 'blackout_bottom';
        console.error('[VideoRenderer][PreviewFrame] FFmpeg command failed', {
          coverMode,
          featherStrategy,
          retryCount,
          featherRetryCount,
          args,
          filterComplex: filterComplexParts.join(';'),
          stderr,
        });
        await cleanupPreviewTemps();
        clearCanceledFlag();
        const eofEncoderError = /could not open encoder before eof|output file is empty|nothing was written into output file/i.test(
          combinedErrorText
        );
        if (eofEncoderError && retryCount < 1 && safePreviewTimeSec > 0.05) {
          const retryPreviewTimeSec = Math.max(0, safePreviewTimeSec - Math.max(0.25, frameStepSec * 2));
          if (retryPreviewTimeSec < safePreviewTimeSec - 0.001) {
            console.warn('[VideoRenderer][PreviewFrame] Retry preview frame due to EOF/empty-output error.', {
              requestedTime,
              safePreviewTimeSec,
              retryPreviewTimeSec,
              sourceDuration,
              sourceFps,
              retryCount,
              error: summarizedError,
            });
            const retryResult = await renderVideoPreviewFrame(
              {
                ...options,
                previewTimeSec: retryPreviewTimeSec,
              },
              retryCount + 1,
              featherStrategy,
              featherRetryCount
            );
            resolve(retryResult);
            return;
          }
        }
        if (
          featherRetryCount < 1 &&
          shouldRetryWithGblurFeather(
            coverMode,
            options.coverFeatherPx,
            options.coverFeatherHorizontalPx,
            options.coverFeatherVerticalPx,
            options.coverFeatherHorizontalPercent,
            options.coverFeatherVerticalPercent,
            featherStrategy,
            combinedErrorText
          )
        ) {
          console.warn('[VideoRenderer][PreviewFrame] Retry with fallback feather strategy gblur_mask.', {
            currentStrategy: featherStrategy,
            error: summarizedError,
          });
          const retryResult = await renderVideoPreviewFrame(
            options,
            retryCount,
            'gblur_mask',
            featherRetryCount + 1
          );
          resolve(retryResult);
          return;
        }
        resolve({
          success: false,
          error: summarizedError,
        });
      });

      process.on('error', async (error) => {
        const canceled = isCanceledRequest();
        if (activePreviewFrameProcess === process) {
          activePreviewFrameProcess = null;
          activePreviewFrameToken = null;
        }
        clearCanceledFlag();
        await cleanupPreviewTemps();
        if (canceled) {
          resolve({ success: false, error: VIDEO_PREVIEW_STOPPED_MESSAGE });
          return;
        }
        const summarizedError = `Lỗi FFmpeg: ${error.message}`;
        resolve({ success: false, error: summarizedError });
      });
    });
  } catch (error) {
    if (requestToken) {
      canceledPreviewTokens.delete(requestToken);
    }
    await cleanupPreviewTemps();
    return { success: false, error: String(error) };
  }
}

export async function renderStep7AudioPreview(
  options: RenderAudioPreviewOptions,
  progressCallback?: (progress: RenderAudioPreviewProgress) => void
): Promise<RenderAudioPreviewResult> {
  if (!isFFmpegAvailable()) {
    return { success: false, error: 'FFmpeg không được cài đặt' };
  }
  if (activeAudioPreviewProcess && !activeAudioPreviewProcess.killed) {
    return { success: false, error: 'Đang có tiến trình test audio khác đang chạy.' };
  }
  if (!existsSync(options.videoPath)) {
    return { success: false, error: `Video không tồn tại: ${options.videoPath}` };
  }
  if (!existsSync(options.audioPath)) {
    return { success: false, error: `Audio không tồn tại: ${options.audioPath}` };
  }
  if (!existsSync(options.srtPath)) {
    return { success: false, error: `SRT không tồn tại: ${options.srtPath}` };
  }

  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }

  const previewDurationSec = Number.isFinite(options.previewDurationSec)
    ? Math.max(1, options.previewDurationSec as number)
    : 20;
  const previewWindowMode = options.previewWindowMode || 'marker_centered';
  const outputPath = options.outputPath;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  audioPreviewStopRequested = false;
  const step7SpeedInput = options.step7AudioSpeedInput && options.step7AudioSpeedInput > 0
    ? options.step7AudioSpeedInput
    : 1.0;
  const adjustedAudio = await buildSpeedAdjustedAudioFile(options.audioPath, step7SpeedInput);
  if (!adjustedAudio.success || !adjustedAudio.audioPath || !existsSync(adjustedAudio.audioPath)) {
    return { success: false, error: adjustedAudio.error || 'Không thể tạo audio speed-adjusted cho preview.' };
  }

  const renderOptions: RenderVideoOptions = {
    srtPath: options.srtPath,
    outputPath,
    width: 1920,
    height: 1080,
    videoPath: options.videoPath,
    renderMode: 'hardsub',
    audioPath: adjustedAudio.audioPath,
    audioSpeed: 1.0,
    step7AudioSpeedInput: step7SpeedInput,
    srtTimeScale: options.srtTimeScale,
    step4SrtScale: options.step4SrtScale,
    timingContextPath: options.timingContextPath,
    audioSpeedModel: options.audioSpeedModel,
    ttsRate: options.ttsRate,
    step7SubtitleSource: options.step7SubtitleSource,
    step7AudioSource: options.step7AudioSource,
  };

  let prepTempAssPath: string | null = null;
  const cleanupPreviewTemps = async () => {
    if (prepTempAssPath) {
      unregisterTempFile(prepTempAssPath);
      try {
        await fs.unlink(prepTempAssPath);
      } catch {}
    }
    if (adjustedAudio.generated && adjustedAudio.audioPath) {
      try {
        await fs.unlink(adjustedAudio.audioPath);
      } catch {}
    }
  };

  try {
    const prep = await prepareSubtitleAndDuration(renderOptions);
    prepTempAssPath = prep.tempAssPath;
    const hasTtsAudio = existsSync(adjustedAudio.audioPath);
    if (!hasTtsAudio) {
      await cleanupPreviewTemps();
      return { success: false, error: 'Không tìm thấy file audio preview đã speed-adjust.' };
    }

    const safeVideoVolume = clampVolumePercent(options.videoVolume, 0, 200, 100);
    const safeAudioVolume = clampVolumePercent(options.audioVolume, 0, 400, 100);
    const audioMix = buildHardsubAudioMix({
      hasVideoAudio: prep.hasVideoAudio,
      hasTtsAudio: true,
      videoVolume: safeVideoVolume,
      audioVolume: safeAudioVolume,
      videoSpeedMultiplier: prep.videoSpeedMultiplier,
      audioSpeed: prep.audioSpeed,
    });

    const filterComplexParts = [...audioMix.filterParts];
    const previewSourceLabel = ensureAudioLabelForConcat(audioMix.mapAudioArg, filterComplexParts, 'a_preview_src');
    if (!previewSourceLabel) {
      await cleanupPreviewTemps();
      return { success: false, error: 'Không thể xác định audio stream để mix preview.' };
    }

    const stretchedVideoDuration = prep.originalVideoDuration > 0 && prep.videoSpeedMultiplier > 0
      ? prep.originalVideoDuration / prep.videoSpeedMultiplier
      : prep.originalVideoDuration;
    const totalDuration = Math.max(
      previewDurationSec,
      prep.newAudioDuration > 0 ? prep.newAudioDuration : 0,
      stretchedVideoDuration > 0 ? stretchedVideoDuration : 0
    );
    const markerSec = prep.videoMarkerSec > 0 ? prep.videoMarkerSec : previewDurationSec / 2;
    const maxStart = Math.max(0, totalDuration - previewDurationSec);
    const rawStartSec = previewWindowMode === 'marker_centered'
      ? markerSec - (previewDurationSec / 2)
      : 0;
    const startSec = Math.max(0, Math.min(maxStart, rawStartSec));
    let endSec = Math.min(totalDuration, startSec + previewDurationSec);
    if (endSec <= startSec) {
      endSec = startSec + previewDurationSec;
    }
    const effectiveDuration = Math.max(0.1, endSec - startSec);

    filterComplexParts.push(
      `${previewSourceLabel}atrim=start=${startSec.toFixed(3)}:end=${endSec.toFixed(3)},asetpts=PTS-STARTPTS[a_preview_out]`
    );

    const args = [
      '-i', options.videoPath,
      '-i', adjustedAudio.audioPath,
      '-filter_complex', filterComplexParts.join(';'),
      '-map', '[a_preview_out]',
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'pcm_s16le',
      '-t', effectiveDuration.toFixed(3),
      '-y',
      outputPath,
    ];

    progressCallback?.({
      percent: 0,
      status: 'mixing',
      message: 'Đang mix audio preview 20s...',
    });

    return await new Promise<RenderAudioPreviewResult>((resolve) => {
      const process = spawn(ffmpegPath, args);
      activeAudioPreviewProcess = process;
      let stderr = '';

      process.stderr.on('data', (data) => {
        const line = data.toString();
        stderr += line;
        const timeMatches = [...line.matchAll(/time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)];
        const lastMatch = timeMatches.length > 0 ? timeMatches[timeMatches.length - 1] : null;
        if (!lastMatch?.[1]) {
          return;
        }
        const currentTimeSec = parseFfmpegTimestampToSec(lastMatch[1]);
        if (currentTimeSec == null) {
          return;
        }
        const percent = Math.min(99, Math.max(0, Math.round((currentTimeSec / effectiveDuration) * 100)));
        progressCallback?.({
          percent,
          status: 'mixing',
          message: `Đang mix audio preview: ${percent}%`,
        });
      });

      process.on('close', async (code) => {
        const stoppedByUser = audioPreviewStopRequested;
        activeAudioPreviewProcess = null;
        audioPreviewStopRequested = false;
        await cleanupPreviewTemps();

        if (stoppedByUser) {
          progressCallback?.({
            percent: 0,
            status: 'stopped',
            message: AUDIO_PREVIEW_STOPPED_MESSAGE,
          });
          resolve({
            success: false,
            error: AUDIO_PREVIEW_STOPPED_MESSAGE,
            outputPath,
            previewDurationSec: effectiveDuration,
            startSec,
            endSec,
            markerSec,
          });
          return;
        }

        if (code === 0) {
          try {
            const audioBuffer = await fs.readFile(outputPath);
            const audioDataUri = `data:audio/wav;base64,${audioBuffer.toString('base64')}`;
            progressCallback?.({
              percent: 100,
              status: 'completed',
              message: 'Mix audio preview hoàn tất.',
            });
            resolve({
              success: true,
              outputPath,
              previewDurationSec: effectiveDuration,
              startSec,
              endSec,
              markerSec,
              audioDataUri,
            });
          } catch (error) {
            progressCallback?.({
              percent: 0,
              status: 'error',
              message: `Không thể đọc file preview: ${String(error)}`,
            });
            resolve({ success: false, error: `Không thể đọc file preview: ${String(error)}` });
          }
          return;
        }

        progressCallback?.({
          percent: 0,
          status: 'error',
          message: 'Mix audio preview thất bại.',
        });
        resolve({
          success: false,
          error: stderr || `FFmpeg exit code: ${code}`,
          outputPath,
          previewDurationSec: effectiveDuration,
          startSec,
          endSec,
          markerSec,
        });
      });

      process.on('error', async (error) => {
        const stoppedByUser = audioPreviewStopRequested;
        activeAudioPreviewProcess = null;
        audioPreviewStopRequested = false;
        await cleanupPreviewTemps();
        if (stoppedByUser) {
          resolve({ success: false, error: AUDIO_PREVIEW_STOPPED_MESSAGE });
          return;
        }
        progressCallback?.({
          percent: 0,
          status: 'error',
          message: `Lỗi FFmpeg khi mix preview: ${error.message}`,
        });
        resolve({ success: false, error: `Lỗi FFmpeg khi mix preview: ${error.message}` });
      });
    });
  } catch (error) {
    await cleanupPreviewTemps();
    return { success: false, error: String(error) };
  }
}

export function stopActiveVideoPreviewFrame(
  requestToken?: string
): { success: boolean; stopped: boolean; message: string } {
  const normalizedToken =
    typeof requestToken === 'string' && requestToken.trim().length > 0
      ? requestToken.trim()
      : null;
  const hasActiveProcess = !!activePreviewFrameProcess && !activePreviewFrameProcess.killed;
  if (!hasActiveProcess) {
    return { success: true, stopped: false, message: 'Không có tiến trình preview frame đang chạy.' };
  }

  if (
    normalizedToken &&
    activePreviewFrameToken &&
    normalizedToken !== activePreviewFrameToken
  ) {
    return { success: true, stopped: false, message: 'Request token không khớp preview frame đang chạy.' };
  }

  if (normalizedToken) {
    canceledPreviewTokens.add(normalizedToken);
  } else {
    cancelAllPreviewRequests = true;
  }

  try {
    activePreviewFrameProcess!.kill('SIGKILL');
  } catch {}

  return { success: true, stopped: true, message: VIDEO_PREVIEW_STOPPED_MESSAGE };
}

export function stopActiveAudioPreview(): { success: boolean; stopped: boolean; message: string } {
  audioPreviewStopRequested = true;
  const hadActiveProcess = !!activeAudioPreviewProcess && !activeAudioPreviewProcess.killed;
  if (hadActiveProcess) {
    try {
      activeAudioPreviewProcess!.kill('SIGKILL');
    } catch {}
    return { success: true, stopped: true, message: AUDIO_PREVIEW_STOPPED_MESSAGE };
  }
  return { success: true, stopped: false, message: 'Không có tiến trình test audio đang chạy.' };
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
  const generatedRenderNamePattern = /(?:^|_)nauchaoheo_video_(?:16_9|9_16)(?:_|\.|$)/i;
  const potentialVideos: Array<{ path: string; isGeneratedRender: boolean }> = [];

  for (const dir of folderPaths) {
    if (!existsSync(dir)) {
      continue;
    }

    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (videoExtensions.includes(ext)) {
          potentialVideos.push({
            path: path.join(dir, file),
            isGeneratedRender: generatedRenderNamePattern.test(file),
          });
        }
      }
    } catch (error) {
      console.error(`[VideoRenderer] Lỗi đọc thư mục ${dir}:`, error);
    }
  }

  if (potentialVideos.length === 0) {
    return { success: false, error: 'Không tìm thấy file video (.mp4, .mov) nào trong thư mục' };
  }

  // Ưu tiên video gốc; chỉ fallback sang video render nội bộ nếu không có lựa chọn nào khác.
  const preferredCandidates = potentialVideos.filter((video) => !video.isGeneratedRender);
  const candidatePool = preferredCandidates.length > 0 ? preferredCandidates : potentialVideos;

  type VideoStat = {
    path: string;
    metadata: VideoMetadata;
    area: number;
    isGeneratedRender: boolean;
    mtimeMs: number;
  };
  const validVideos: VideoStat[] = [];

  for (const candidate of candidatePool) {
    const videoPath = candidate.path;
    const res = await probeGetVideoMetadata(videoPath);
    if (res.success && res.metadata) {
      const realHeight = res.metadata.actualHeight || 1080;
      const maxDim = Math.max(res.metadata.width, realHeight);
      if (maxDim >= 720 && realHeight > 500) {
        let mtimeMs = 0;
        try {
          const stat = await fs.stat(videoPath);
          mtimeMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
        } catch {}
        validVideos.push({
          path: videoPath,
          metadata: res.metadata,
          area: res.metadata.width * realHeight,
          isGeneratedRender: candidate.isGeneratedRender,
          mtimeMs,
        });
      }
    }
  }

  if (validVideos.length === 0) {
    return { success: false, error: 'Không có video nào đạt độ phân giải > 750p' };
  }

  validVideos.sort((a, b) => {
    if (a.isGeneratedRender !== b.isGeneratedRender) {
      return a.isGeneratedRender ? 1 : -1;
    }
    if (a.area !== b.area) {
      return b.area - a.area;
    }
    return b.mtimeMs - a.mtimeMs;
  });
  const bestVideo = validVideos[0];
  if (bestVideo.isGeneratedRender) {
    console.warn('[VideoRenderer] findBestVideoInFolders: fallback sang video render nội bộ do không có video gốc phù hợp.');
  }
  return { success: true, videoPath: bestVideo.path, metadata: bestVideo.metadata };
}
