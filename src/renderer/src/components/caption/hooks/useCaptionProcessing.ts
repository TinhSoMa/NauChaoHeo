import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Step,
  ProcessStatus,
  SubtitleEntry,
  TranslationProgress,
  TTSProgress,
  ProcessingMode,
  StepDependencyIssue,
} from '../CaptionTypes';
import {
  CaptionArtifactFile,
  CaptionSessionStopCheckpoint,
  CaptionSessionV1,
  CaptionStepNumber,
  CaptionProjectSettingsValues,
  CAPTION_PROCESS_STOP_SIGNAL,
  CoverQuad,
  RenderAudioPreviewProgress,
  TranslationBatchReport as SharedTranslationBatchReport,
} from '@shared/types/caption';
import { getCaptionSessionPathFromOutputDir, nowIso } from '@shared/utils/captionSession';
import {
  buildEntriesFingerprint,
  buildObjectFingerprint,
  canRunStep,
  compactEntries,
  getInputPaths,
  getSessionPathForInputPath,
  makeStepError,
  makeStepRunning,
  makeStepStopped,
  makeStepSuccess,
  markFollowingStepsStale,
  recordStepSkipped,
  readCaptionSession,
  resolveStepInputsFromSession,
  setStepArtifacts,
  shouldSkipStep,
  syncSessionWithProjectSettings,
  toStepKey,
  updateCaptionSession,
  validateStepOutputForSkip,
} from './captionSessionStore';
import {
  DEFAULT_FIT_AUDIO_WORKERS,
  MIN_FIT_AUDIO_WORKERS,
  MAX_FIT_AUDIO_WORKERS,
} from '../../../config/captionConfig';

type ProcessingAudioFile = {
  index: number;
  path: string;
  startMs: number;
  durationMs: number;
  success: boolean;
  error?: string;
};

type PartialProcessingAudioFile = Partial<ProcessingAudioFile> & {
  path?: string;
  startMs?: number;
};

type AudioPreviewStatus = 'idle' | 'mixing' | 'ready' | 'error';

type AudioPreviewMeta = {
  startSec: number;
  endSec: number;
  markerSec: number;
  outputPath: string;
  folderName: string;
  folderPath: string;
};

function normalizeAudioFiles(files: PartialProcessingAudioFile[] = []): ProcessingAudioFile[] {
  const normalized: ProcessingAudioFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || typeof file.path !== 'string' || !file.path.trim()) continue;
    if (typeof file.startMs !== 'number' || Number.isNaN(file.startMs)) continue;

    normalized.push({
      index: typeof file.index === 'number' ? file.index : i + 1,
      path: file.path,
      startMs: file.startMs,
      durationMs: typeof file.durationMs === 'number' ? file.durationMs : 0,
      success: file.success !== false,
      error: typeof file.error === 'string' ? file.error : undefined,
    });
  }

  return normalized;
}

function msToSrtTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

function normalizeSpeedLabel(speed: number): string {
  const fixed = speed.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}

function isProcessStopSignal(error: unknown): boolean {
  return error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

function normalizePathKey(value: string): string {
  return value.trim().replace(/[\\/]+$/, '').toLowerCase();
}

function normalizeFitAudioWorkers(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FIT_AUDIO_WORKERS;
  }
  const rounded = Math.round(value as number);
  if (rounded < MIN_FIT_AUDIO_WORKERS) {
    return DEFAULT_FIT_AUDIO_WORKERS;
  }
  return Math.min(MAX_FIT_AUDIO_WORKERS, Math.max(MIN_FIT_AUDIO_WORKERS, rounded));
}

function getPathBaseName(pathValue: string): string {
  const clean = (pathValue || '').trim();
  if (!clean) {
    return '';
  }
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || clean;
}

function resolveFolderPathForInput(currentPath: string, inputType: string): string {
  return inputType === 'draft' || inputType === 'srt'
    ? currentPath
    : currentPath.replace(/[^/\\]+$/, '');
}

function toSafeThumbSlug(thumbnailText?: string): string {
  const raw = (thumbnailText || '').trim();
  if (!raw) {
    return 'no_thumb';
  }
  const ascii = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
  const slug = ascii
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return slug || 'no_thumb';
}

function buildRenderedVideoName(
  renderMode: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16',
  renderContainer: 'mp4' | 'mov',
  thumbnailText?: string
): string {
  const now = new Date();
  const timestampPrefix =
    `${pad4(now.getFullYear())}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const aspect = renderMode === 'hardsub_portrait_9_16' ? '9_16' : '16_9';
  const thumbSlug = toSafeThumbSlug(thumbnailText);
  return `${timestampPrefix}_nauchaoheo_video_${aspect}_${thumbSlug}.${renderContainer}`;
}

function buildScaledSubtitleEntries(entries: SubtitleEntry[], scale: number): SubtitleEntry[] {
  const safeScale = scale > 0 ? scale : 1.0;
  return entries.map((entry, idx) => {
    const scaledStartMs = Math.max(0, Math.round(entry.startMs * safeScale));
    const scaledEndMs = Math.max(scaledStartMs + 1, Math.round(entry.endMs * safeScale));
    return {
      ...entry,
      index: idx + 1,
      startMs: scaledStartMs,
      endMs: scaledEndMs,
      durationMs: scaledEndMs - scaledStartMs,
      startTime: msToSrtTime(scaledStartMs),
      endTime: msToSrtTime(scaledEndMs),
    };
  });
}

// Helper function to validate steps
function validateSteps(steps: Step[]): { valid: boolean; error?: string } {
  if (steps.length === 0) {
    return { valid: false, error: 'Hãy chọn ít nhất 1 bước!' };
  }
  
  return { valid: true };
}

interface UseCaptionProcessingProps {
  projectId?: string | null;
  entries: SubtitleEntry[];
  setEntries: (entries: SubtitleEntry[]) => void;
  filePath: string;
  inputPathsOverride?: string[];
  inputType: string;
  srtFilesByFolder?: Record<string, string>;
  captionFolder: string | null;
  settings: {
    fontSizeScaleVersion?: number;
    subtitleFontSizeRel?: number;
    geminiModel: string;
    splitByLines: boolean;
    linesPerFile: number;
    numberOfParts: number;
    voice: string;
    rate: string;
    volume: string;
    edgeOutputFormat?: 'wav' | 'mp3';
    edgeTtsBatchSize?: number;
    srtSpeed: number;
    audioDir: string;
    setAudioDir: (dir: string) => void;
    trimAudioEnabled?: boolean;
    hardwareAcceleration: 'none' | 'qsv' | 'nvenc';
    style?: any;
    renderMode: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
    renderResolution: 'original' | '1080p' | '720p' | '540p' | '360p';
    renderContainer?: 'mp4' | 'mov';
    subtitlePosition?: { x: number; y: number } | null;
    blackoutTop?: number | null;
    coverMode?: 'blackout_bottom' | 'copy_from_above';
    coverQuad?: CoverQuad;
    coverFeatherPx?: number;
    coverFeatherHorizontalPx?: number;
    coverFeatherVerticalPx?: number;
    coverFeatherHorizontalPercent?: number;
    coverFeatherVerticalPercent?: number;
    autoFitAudio: boolean;
    fitAudioWorkers?: number;
    audioSpeed?: number;
    renderAudioSpeed?: number;
    videoVolume?: number;
    audioVolume?: number;
    logoPath?: string;
    logoPosition?: { x: number; y: number } | null;
    logoScale?: number;
    portraitForegroundCropPercent?: number;
    processingMode?: ProcessingMode;
    translateMethod?: 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui';
    thumbnailFrameTimeSec?: number | null;
    thumbnailDurationSec?: number;
    thumbnailText?: string;
    thumbnailTextSecondary?: string;
    thumbnailFontName?: string;
    thumbnailFontSize?: number;
    thumbnailFontSizeRel?: number;
    thumbnailTextPrimaryFontName?: string;
    thumbnailTextPrimaryFontSize?: number;
    thumbnailTextPrimaryFontSizeRel?: number;
    thumbnailTextPrimaryColor?: string;
    thumbnailTextSecondaryFontName?: string;
    thumbnailTextSecondaryFontSize?: number;
    thumbnailTextSecondaryFontSizeRel?: number;
    thumbnailTextSecondaryColor?: string;
    thumbnailLineHeightRatio?: number;
    thumbnailTextConstrainTo34?: boolean;
    thumbnailTextPrimaryPosition?: { x: number; y: number };
    thumbnailTextSecondaryPosition?: { x: number; y: number };
    hardsubTextPrimary?: string;
    hardsubTextSecondary?: string;
    hardsubTextPrimaryFontName?: string;
    hardsubTextPrimaryFontSize?: number;
    hardsubTextPrimaryFontSizeRel?: number;
    hardsubTextPrimaryColor?: string;
    hardsubTextSecondaryFontName?: string;
    hardsubTextSecondaryFontSize?: number;
    hardsubTextSecondaryFontSizeRel?: number;
    hardsubTextSecondaryColor?: string;
    hardsubTextPrimaryPosition?: { x: number; y: number };
    hardsubTextSecondaryPosition?: { x: number; y: number };
    hardsubPortraitTextPrimary?: string;
    hardsubPortraitTextSecondary?: string;
    hardsubPortraitTextPrimaryFontName?: string;
    hardsubPortraitTextPrimaryFontSize?: number;
    hardsubPortraitTextPrimaryFontSizeRel?: number;
    hardsubPortraitTextPrimaryColor?: string;
    hardsubPortraitTextSecondaryFontName?: string;
    hardsubPortraitTextSecondaryFontSize?: number;
    hardsubPortraitTextSecondaryFontSizeRel?: number;
    hardsubPortraitTextSecondaryColor?: string;
    hardsubPortraitTextPrimaryPosition?: { x: number; y: number };
    hardsubPortraitTextSecondaryPosition?: { x: number; y: number };
    portraitTextPrimaryFontName?: string;
    portraitTextPrimaryFontSize?: number;
    portraitTextPrimaryFontSizeRel?: number;
    portraitTextPrimaryColor?: string;
    portraitTextSecondaryFontName?: string;
    portraitTextSecondaryFontSize?: number;
    portraitTextSecondaryFontSizeRel?: number;
    portraitTextSecondaryColor?: string;
    portraitTextPrimaryPosition?: { x: number; y: number };
    portraitTextSecondaryPosition?: { x: number; y: number };
    thumbnailTextsByOrder?: string[];
    thumbnailTextsSecondaryByOrder?: string[];
    hardsubTextsByOrder?: string[];
    hardsubTextsSecondaryByOrder?: string[];
    layoutProfiles?: CaptionProjectSettingsValues['layoutProfiles'];
    settingsRevision?: number;
    settingsUpdatedAt?: string;
    isHydrated?: boolean;
    hydrationSeq?: number;
    autoShutdownEnabled?: boolean;
    autoShutdownDelayMinutes?: number;
  };
  enabledSteps: Set<Step>;
  setEnabledSteps: React.Dispatch<React.SetStateAction<Set<Step>>>;
}

type ProcessingSettings = UseCaptionProcessingProps['settings'];
type LooseRecord = Record<string, unknown>;

function cloneQuad(quad: CoverQuad | null | undefined): CoverQuad | null | undefined {
  if (!quad) {
    return quad;
  }
  return {
    tl: { ...quad.tl },
    tr: { ...quad.tr },
    br: { ...quad.br },
    bl: { ...quad.bl },
  };
}

function toRecord(value: unknown): LooseRecord {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as LooseRecord;
}

function readNumber(record: LooseRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(record: LooseRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readPoint(record: LooseRecord, key: string): { x: number; y: number } | undefined {
  const value = record[key];
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const typed = value as { x?: unknown; y?: unknown };
  if (typeof typed.x !== 'number' || !Number.isFinite(typed.x)) {
    return undefined;
  }
  if (typeof typed.y !== 'number' || !Number.isFinite(typed.y)) {
    return undefined;
  }
  return { x: typed.x, y: typed.y };
}

function readPointOrNull(record: LooseRecord, key: string): { x: number; y: number } | null | undefined {
  if (record[key] === null) {
    return null;
  }
  return readPoint(record, key);
}

function readCoverQuad(record: LooseRecord, key: string): CoverQuad | undefined {
  const value = record[key];
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const quad = value as CoverQuad;
  if (!quad.tl || !quad.tr || !quad.br || !quad.bl) {
    return undefined;
  }
  return cloneQuad(quad) as CoverQuad;
}

function readCoverMode(
  record: LooseRecord,
  key: string
): 'blackout_bottom' | 'copy_from_above' | undefined {
  const value = record[key];
  if (value === 'blackout_bottom' || value === 'copy_from_above') {
    return value;
  }
  return undefined;
}

function readRenderResolution(
  record: LooseRecord,
  key: string
): ProcessingSettings['renderResolution'] | undefined {
  const value = record[key];
  if (
    value === 'original'
    || value === '1080p'
    || value === '720p'
    || value === '540p'
    || value === '360p'
  ) {
    return value;
  }
  return undefined;
}

function readRenderContainer(record: LooseRecord, key: string): 'mp4' | 'mov' | undefined {
  const value = record[key];
  if (value === 'mp4' || value === 'mov') {
    return value;
  }
  return undefined;
}

function cloneLayoutProfile(profile: LooseRecord | undefined): LooseRecord | undefined {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }
  return {
    ...profile,
    style: profile.style && typeof profile.style === 'object'
      ? { ...(profile.style as LooseRecord) }
      : profile.style,
    subtitlePosition: profile.subtitlePosition === null
      ? null
      : readPoint(profile, 'subtitlePosition'),
    coverQuad: readCoverQuad(profile, 'coverQuad'),
    logoPosition: readPoint(profile, 'logoPosition'),
    thumbnailTextPrimaryPosition: readPoint(profile, 'thumbnailTextPrimaryPosition'),
    thumbnailTextSecondaryPosition: readPoint(profile, 'thumbnailTextSecondaryPosition'),
    hardsubTextPrimaryPosition: readPoint(profile, 'hardsubTextPrimaryPosition'),
    hardsubTextSecondaryPosition: readPoint(profile, 'hardsubTextSecondaryPosition'),
    hardsubPortraitTextPrimaryPosition: readPoint(profile, 'hardsubPortraitTextPrimaryPosition'),
    hardsubPortraitTextSecondaryPosition: readPoint(profile, 'hardsubPortraitTextSecondaryPosition'),
    portraitTextPrimaryPosition: readPoint(profile, 'portraitTextPrimaryPosition'),
    portraitTextSecondaryPosition: readPoint(profile, 'portraitTextSecondaryPosition'),
  };
}

function cloneLayoutProfiles(
  layoutProfiles: ProcessingSettings['layoutProfiles']
): ProcessingSettings['layoutProfiles'] {
  if (!layoutProfiles || typeof layoutProfiles !== 'object') {
    return layoutProfiles;
  }
  const landscape = layoutProfiles.landscape;
  const portrait = layoutProfiles.portrait;
  return {
    landscape: cloneLayoutProfile(landscape && typeof landscape === 'object' ? (landscape as LooseRecord) : undefined),
    portrait: cloneLayoutProfile(portrait && typeof portrait === 'object' ? (portrait as LooseRecord) : undefined),
  };
}

function withFallback<T>(value: T | undefined, fallback: T | undefined): T | undefined {
  return value !== undefined ? value : fallback;
}

function resolveRenderLayoutOverrides(settings: ProcessingSettings): Partial<ProcessingSettings> {
  const layoutKey = settings.renderMode === 'hardsub_portrait_9_16' ? 'portrait' : 'landscape';
  const profile = toRecord(settings.layoutProfiles?.[layoutKey]);
  if (!profile || typeof profile !== 'object') {
    return {};
  }

  const styleRecord = toRecord(profile.style);
  const style =
    Object.keys(styleRecord).length > 0
      ? styleRecord
      : settings.style;
  const subtitlePosition = readPointOrNull(profile, 'subtitlePosition');
  const thumbnailTextPrimaryPosition = readPoint(profile, 'thumbnailTextPrimaryPosition');
  const thumbnailTextSecondaryPosition = readPoint(profile, 'thumbnailTextSecondaryPosition');
  const thumbnailTextConstrainTo34 = typeof profile.thumbnailTextConstrainTo34 === 'boolean'
    ? profile.thumbnailTextConstrainTo34
    : undefined;
  const hardsubTextPrimaryPosition = readPoint(profile, 'hardsubTextPrimaryPosition');
  const hardsubTextSecondaryPosition = readPoint(profile, 'hardsubTextSecondaryPosition');
  const hardsubPortraitTextPrimaryPosition = readPoint(profile, 'hardsubPortraitTextPrimaryPosition');
  const hardsubPortraitTextSecondaryPosition = readPoint(profile, 'hardsubPortraitTextSecondaryPosition');
  const portraitTextPrimaryPosition = readPoint(profile, 'portraitTextPrimaryPosition');
  const portraitTextSecondaryPosition = readPoint(profile, 'portraitTextSecondaryPosition');
  const logoPosition = readPoint(profile, 'logoPosition');
  const coverQuad = readCoverQuad(profile, 'coverQuad');
  const coverMode = readCoverMode(profile, 'coverMode');
  const renderResolution = readRenderResolution(profile, 'renderResolution');
  const renderContainer = readRenderContainer(profile, 'renderContainer');

  return {
    fontSizeScaleVersion: withFallback(readNumber(profile, 'fontSizeScaleVersion'), settings.fontSizeScaleVersion),
    subtitleFontSizeRel: withFallback(readNumber(profile, 'subtitleFontSizeRel'), settings.subtitleFontSizeRel),
    style,
    renderResolution: withFallback(
      renderResolution,
      settings.renderResolution
    ),
    renderContainer: withFallback(
      renderContainer,
      settings.renderContainer
    ),
    blackoutTop: withFallback(
      profile.blackoutTop === null ? null : readNumber(profile, 'blackoutTop'),
      settings.blackoutTop
    ),
    coverMode: withFallback(
      coverMode,
      settings.coverMode
    ),
    coverQuad: withFallback(
      coverQuad,
      settings.coverQuad
    ),
    coverFeatherPx: withFallback(readNumber(profile, 'coverFeatherPx'), settings.coverFeatherPx),
    coverFeatherHorizontalPx: withFallback(
      readNumber(profile, 'coverFeatherHorizontalPx'),
      settings.coverFeatherHorizontalPx
    ),
    coverFeatherVerticalPx: withFallback(
      readNumber(profile, 'coverFeatherVerticalPx'),
      settings.coverFeatherVerticalPx
    ),
    coverFeatherHorizontalPercent: withFallback(
      readNumber(profile, 'coverFeatherHorizontalPercent'),
      settings.coverFeatherHorizontalPercent
    ),
    coverFeatherVerticalPercent: withFallback(
      readNumber(profile, 'coverFeatherVerticalPercent'),
      settings.coverFeatherVerticalPercent
    ),
    subtitlePosition: subtitlePosition === null
      ? null
      : withFallback(subtitlePosition, settings.subtitlePosition),
    thumbnailFrameTimeSec: withFallback(
      profile.thumbnailFrameTimeSec === null ? null : readNumber(profile, 'thumbnailFrameTimeSec'),
      settings.thumbnailFrameTimeSec
    ),
    thumbnailDurationSec: withFallback(readNumber(profile, 'thumbnailDurationSec'), settings.thumbnailDurationSec),
    thumbnailTextConstrainTo34: withFallback(
      thumbnailTextConstrainTo34,
      settings.thumbnailTextConstrainTo34
    ),
    logoPath: withFallback(readString(profile, 'logoPath'), settings.logoPath),
    logoPosition: withFallback(
      logoPosition,
      settings.logoPosition
    ),
    logoScale: withFallback(readNumber(profile, 'logoScale'), settings.logoScale),
    thumbnailFontName: withFallback(readString(profile, 'thumbnailFontName'), settings.thumbnailFontName),
    thumbnailFontSize: withFallback(readNumber(profile, 'thumbnailFontSize'), settings.thumbnailFontSize),
    thumbnailFontSizeRel: withFallback(readNumber(profile, 'thumbnailFontSizeRel'), settings.thumbnailFontSizeRel),
    thumbnailTextPrimaryFontName: withFallback(
      readString(profile, 'thumbnailTextPrimaryFontName'),
      settings.thumbnailTextPrimaryFontName
    ),
    thumbnailTextPrimaryFontSize: withFallback(
      readNumber(profile, 'thumbnailTextPrimaryFontSize'),
      settings.thumbnailTextPrimaryFontSize
    ),
    thumbnailTextPrimaryFontSizeRel: withFallback(
      readNumber(profile, 'thumbnailTextPrimaryFontSizeRel'),
      settings.thumbnailTextPrimaryFontSizeRel
    ),
    thumbnailTextPrimaryColor: withFallback(
      readString(profile, 'thumbnailTextPrimaryColor'),
      settings.thumbnailTextPrimaryColor
    ),
    thumbnailTextSecondaryFontName: withFallback(
      readString(profile, 'thumbnailTextSecondaryFontName'),
      settings.thumbnailTextSecondaryFontName
    ),
    thumbnailTextSecondaryFontSize: withFallback(
      readNumber(profile, 'thumbnailTextSecondaryFontSize'),
      settings.thumbnailTextSecondaryFontSize
    ),
    thumbnailTextSecondaryFontSizeRel: withFallback(
      readNumber(profile, 'thumbnailTextSecondaryFontSizeRel'),
      settings.thumbnailTextSecondaryFontSizeRel
    ),
    thumbnailTextSecondaryColor: withFallback(
      readString(profile, 'thumbnailTextSecondaryColor'),
      settings.thumbnailTextSecondaryColor
    ),
    thumbnailLineHeightRatio: withFallback(
      readNumber(profile, 'thumbnailLineHeightRatio'),
      settings.thumbnailLineHeightRatio
    ),
    thumbnailTextSecondary: withFallback(
      readString(profile, 'thumbnailTextSecondary'),
      settings.thumbnailTextSecondary
    ),
    hardsubTextPrimary: withFallback(
      readString(profile, 'hardsubTextPrimary'),
      settings.hardsubTextPrimary
    ),
    hardsubTextSecondary: withFallback(
      readString(profile, 'hardsubTextSecondary'),
      settings.hardsubTextSecondary
    ),
    hardsubPortraitTextPrimary: withFallback(
      readString(profile, 'hardsubPortraitTextPrimary'),
      settings.hardsubPortraitTextPrimary
    ),
    hardsubPortraitTextSecondary: withFallback(
      readString(profile, 'hardsubPortraitTextSecondary'),
      settings.hardsubPortraitTextSecondary
    ),
    thumbnailTextPrimaryPosition: withFallback(
      thumbnailTextPrimaryPosition,
      settings.thumbnailTextPrimaryPosition
    ),
    thumbnailTextSecondaryPosition: withFallback(
      thumbnailTextSecondaryPosition,
      settings.thumbnailTextSecondaryPosition
    ),
    hardsubTextPrimaryPosition: withFallback(
      hardsubTextPrimaryPosition,
      settings.hardsubTextPrimaryPosition
    ),
    hardsubTextSecondaryPosition: withFallback(
      hardsubTextSecondaryPosition,
      settings.hardsubTextSecondaryPosition
    ),
    hardsubPortraitTextPrimaryPosition: withFallback(
      hardsubPortraitTextPrimaryPosition,
      settings.hardsubPortraitTextPrimaryPosition
    ),
    hardsubPortraitTextSecondaryPosition: withFallback(
      hardsubPortraitTextSecondaryPosition,
      settings.hardsubPortraitTextSecondaryPosition
    ),
    hardsubTextPrimaryFontName: withFallback(
      readString(profile, 'hardsubTextPrimaryFontName'),
      settings.hardsubTextPrimaryFontName
    ),
    hardsubTextPrimaryFontSize: withFallback(
      readNumber(profile, 'hardsubTextPrimaryFontSize'),
      settings.hardsubTextPrimaryFontSize
    ),
    hardsubTextPrimaryFontSizeRel: withFallback(
      readNumber(profile, 'hardsubTextPrimaryFontSizeRel'),
      settings.hardsubTextPrimaryFontSizeRel
    ),
    hardsubTextPrimaryColor: withFallback(
      readString(profile, 'hardsubTextPrimaryColor'),
      settings.hardsubTextPrimaryColor
    ),
    hardsubTextSecondaryFontName: withFallback(
      readString(profile, 'hardsubTextSecondaryFontName'),
      settings.hardsubTextSecondaryFontName
    ),
    hardsubTextSecondaryFontSize: withFallback(
      readNumber(profile, 'hardsubTextSecondaryFontSize'),
      settings.hardsubTextSecondaryFontSize
    ),
    hardsubTextSecondaryFontSizeRel: withFallback(
      readNumber(profile, 'hardsubTextSecondaryFontSizeRel'),
      settings.hardsubTextSecondaryFontSizeRel
    ),
    hardsubTextSecondaryColor: withFallback(
      readString(profile, 'hardsubTextSecondaryColor'),
      settings.hardsubTextSecondaryColor
    ),
    hardsubPortraitTextPrimaryFontName: withFallback(
      readString(profile, 'hardsubPortraitTextPrimaryFontName'),
      settings.hardsubPortraitTextPrimaryFontName
    ),
    hardsubPortraitTextPrimaryFontSize: withFallback(
      readNumber(profile, 'hardsubPortraitTextPrimaryFontSize'),
      settings.hardsubPortraitTextPrimaryFontSize
    ),
    hardsubPortraitTextPrimaryFontSizeRel: withFallback(
      readNumber(profile, 'hardsubPortraitTextPrimaryFontSizeRel'),
      settings.hardsubPortraitTextPrimaryFontSizeRel
    ),
    hardsubPortraitTextPrimaryColor: withFallback(
      readString(profile, 'hardsubPortraitTextPrimaryColor'),
      settings.hardsubPortraitTextPrimaryColor
    ),
    hardsubPortraitTextSecondaryFontName: withFallback(
      readString(profile, 'hardsubPortraitTextSecondaryFontName'),
      settings.hardsubPortraitTextSecondaryFontName
    ),
    hardsubPortraitTextSecondaryFontSize: withFallback(
      readNumber(profile, 'hardsubPortraitTextSecondaryFontSize'),
      settings.hardsubPortraitTextSecondaryFontSize
    ),
    hardsubPortraitTextSecondaryFontSizeRel: withFallback(
      readNumber(profile, 'hardsubPortraitTextSecondaryFontSizeRel'),
      settings.hardsubPortraitTextSecondaryFontSizeRel
    ),
    hardsubPortraitTextSecondaryColor: withFallback(
      readString(profile, 'hardsubPortraitTextSecondaryColor'),
      settings.hardsubPortraitTextSecondaryColor
    ),
    portraitTextPrimaryFontName: withFallback(
      readString(profile, 'portraitTextPrimaryFontName'),
      settings.portraitTextPrimaryFontName
    ),
    portraitTextPrimaryFontSize: withFallback(
      readNumber(profile, 'portraitTextPrimaryFontSize'),
      settings.portraitTextPrimaryFontSize
    ),
    portraitTextPrimaryFontSizeRel: withFallback(
      readNumber(profile, 'portraitTextPrimaryFontSizeRel'),
      settings.portraitTextPrimaryFontSizeRel
    ),
    portraitTextPrimaryColor: withFallback(
      readString(profile, 'portraitTextPrimaryColor'),
      settings.portraitTextPrimaryColor
    ),
    portraitTextSecondaryFontName: withFallback(
      readString(profile, 'portraitTextSecondaryFontName'),
      settings.portraitTextSecondaryFontName
    ),
    portraitTextSecondaryFontSize: withFallback(
      readNumber(profile, 'portraitTextSecondaryFontSize'),
      settings.portraitTextSecondaryFontSize
    ),
    portraitTextSecondaryFontSizeRel: withFallback(
      readNumber(profile, 'portraitTextSecondaryFontSizeRel'),
      settings.portraitTextSecondaryFontSizeRel
    ),
    portraitTextSecondaryColor: withFallback(
      readString(profile, 'portraitTextSecondaryColor'),
      settings.portraitTextSecondaryColor
    ),
    portraitTextPrimaryPosition: withFallback(
      portraitTextPrimaryPosition,
      settings.portraitTextPrimaryPosition
    ),
    portraitTextSecondaryPosition: withFallback(
      portraitTextSecondaryPosition,
      settings.portraitTextSecondaryPosition
    ),
    portraitForegroundCropPercent: settings.renderMode === 'hardsub_portrait_9_16'
      ? withFallback(
          readNumber(profile, 'foregroundCropPercent'),
          settings.portraitForegroundCropPercent
        )
      : settings.portraitForegroundCropPercent,
  };
}

function entriesToSrtText(entries: SubtitleEntry[]): string {
  if (!entries.length) {
    return '';
  }
  const blocks = entries.map((entry, idx) => {
    const startTime = entry.startTime || msToSrtTime(entry.startMs);
    const endTime = entry.endTime || msToSrtTime(entry.endMs);
    const text = (entry.translatedText ?? entry.text ?? '').replace(/\r\n/g, '\n').trimEnd();
    return `${idx + 1}\n${startTime} --> ${endTime}\n${text}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

function entriesToPlainText(entries: SubtitleEntry[]): string {
  if (!entries.length) {
    return '';
  }
  const lines = entries
    .map((entry) => {
      const raw = (entry.translatedText ?? entry.text ?? '').replace(/\r\n/g, '\n').trim();
      return raw.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    })
    .filter((line) => line.length > 0);
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function resolveProcessOutputDir(inputType: string, currentPath: string): string {
  return inputType === 'draft' || inputType === 'srt'
    ? `${currentPath}/caption_output`
    : currentPath.replace(/[^/\\]+$/, 'caption_output');
}

function resolveParentDir(pathValue: string): string {
  const trimmed = (pathValue || '').trim().replace(/[\\/]+$/, '');
  if (!trimmed) {
    return '';
  }
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slashIndex >= 0 ? trimmed.slice(0, slashIndex) : trimmed;
}

function joinFilePath(baseDir: string, fileName: string): string {
  const normalizedBase = (baseDir || '').trim().replace(/[\\/]+$/, '');
  if (!normalizedBase) {
    return fileName;
  }
  const separator = normalizedBase.includes('\\') ? '\\' : '/';
  return `${normalizedBase}${separator}${fileName}`;
}

type StepBatchPlanItem = {
  batchIndex: number;
  startIndex: number;
  endIndex: number;
  lineCount: number;
  partPath?: string;
};

type Step3BatchState = NonNullable<CaptionSessionV1['data']['step3BatchState']>;

function buildChunkBatchPlan(
  entriesCount: number,
  linesPerBatch: number,
  partPaths: string[] = []
): StepBatchPlanItem[] {
  if (!Number.isFinite(entriesCount) || entriesCount <= 0) {
    return [];
  }
  const safeLinesPerBatch = Math.max(1, Math.floor(linesPerBatch));
  const plans: StepBatchPlanItem[] = [];
  let cursor = 0;
  let batchIndex = 1;
  while (cursor < entriesCount) {
    const startIndex = cursor;
    const endExclusive = Math.min(entriesCount, startIndex + safeLinesPerBatch);
    plans.push({
      batchIndex,
      startIndex,
      endIndex: endExclusive - 1,
      lineCount: endExclusive - startIndex,
      partPath: partPaths[batchIndex - 1],
    });
    cursor = endExclusive;
    batchIndex++;
  }
  return plans;
}

function buildPartCountBatchPlan(
  entriesCount: number,
  partsCount: number,
  partPaths: string[] = []
): StepBatchPlanItem[] {
  if (!Number.isFinite(entriesCount) || entriesCount <= 0) {
    return [];
  }
  const safePartsCount = Math.max(1, Math.min(Math.floor(partsCount), entriesCount));
  const entriesPerPart = Math.ceil(entriesCount / safePartsCount);
  return buildChunkBatchPlan(entriesCount, entriesPerPart, partPaths);
}

function buildStep3BatchState(
  totalBatches: number,
  reports: SharedTranslationBatchReport[]
): Step3BatchState {
  const sortedReports = [...reports].sort((a, b) => a.batchIndex - b.batchIndex);
  const successReports = sortedReports.filter((report) => report.status === 'success');
  const failedReports = sortedReports.filter((report) => report.status === 'failed');
  const missingBatchIndexes = failedReports.map((report) => report.batchIndex);
  const missingGlobalLineIndexes = Array.from(
    new Set(failedReports.flatMap((report) => report.missingGlobalLineIndexes))
  ).sort((a, b) => a - b);

  return {
    totalBatches,
    completedBatches: successReports.length,
    failedBatches: failedReports.length,
    missingBatchIndexes,
    missingGlobalLineIndexes,
    batches: sortedReports,
    updatedAt: nowIso(),
  };
}

function mergeTranslatedChunkIntoEntries(
  entries: SubtitleEntry[],
  chunk: { startIndex: number; texts: string[] }
): SubtitleEntry[] {
  const nextEntries = entries.map((entry) => ({ ...entry }));
  const startIndex = Math.max(0, Math.floor(chunk.startIndex));
  const texts = Array.isArray(chunk.texts) ? chunk.texts : [];

  for (let i = 0; i < texts.length; i++) {
    const targetIndex = startIndex + i;
    if (targetIndex < 0 || targetIndex >= nextEntries.length) {
      continue;
    }
    const rawText = typeof texts[i] === 'string' ? texts[i] : '';
    const hasTranslated = rawText.trim().length > 0;
    const current = nextEntries[targetIndex];
    // Nếu dịch thất bại: giữ bản dịch cũ nếu có, không fallback về text gốc
    const fallbackTranslated = (current.translatedText && current.translatedText.trim().length > 0)
      ? current.translatedText
      : undefined;
    nextEntries[targetIndex] = {
      ...current,
      translatedText: hasTranslated ? rawText : fallbackTranslated,
    };
  }

  return nextEntries;
}

function normalizeEntriesForSession(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => ({
    ...entry,
    // Giữ undefined nếu chưa dịch, không gán text gốc để tránh mask lỗi dịch
    translatedText: entry.translatedText && entry.translatedText.trim().length > 0
      ? entry.translatedText
      : undefined,
  }));
}

function collectBatchMissingInfo(
  entries: SubtitleEntry[],
  batchPlan: StepBatchPlanItem
): {
  expectedLines: number;
  translatedLines: number;
  missingLinesInBatch: number[];
  missingGlobalLineIndexes: number[];
} {
  const expectedLines = Math.max(0, batchPlan.lineCount || (batchPlan.endIndex - batchPlan.startIndex + 1));
  const missingLinesInBatch: number[] = [];
  const missingGlobalLineIndexes: number[] = [];
  let translatedLines = 0;

  for (let offset = 0; offset < expectedLines; offset++) {
    const globalIndex = batchPlan.startIndex + offset;
    const entry = entries[globalIndex];
    const translatedText = typeof entry?.translatedText === 'string' ? entry.translatedText : '';
    if (translatedText.trim().length > 0) {
      translatedLines++;
    } else {
      missingLinesInBatch.push(offset + 1);
      missingGlobalLineIndexes.push(globalIndex + 1);
    }
  }

  return {
    expectedLines,
    translatedLines,
    missingLinesInBatch,
    missingGlobalLineIndexes,
  };
}

type ManualParseResult =
  | { ok: true; translatedTexts: string[] }
  | { ok: false; errorCode: string; errorMessage: string };

function parseCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function failManualParse(
  _translatedTexts: string[],
  errorCode: string,
  errorMessage: string
): ManualParseResult {
  return {
    ok: false,
    errorCode,
    errorMessage,
  };
}

function parseJsonTranslationResponseForManual(
  response: string,
  expectedCount: number
): ManualParseResult {
  const safeExpectedCount = Math.max(0, Math.floor(expectedCount));
  const translatedTexts = new Array<string>(safeExpectedCount).fill('');
  const raw = typeof response === 'string' ? response.trim() : '';

  if (!raw) {
    return failManualParse(translatedTexts, 'JSON_PARSE_FAILED', 'Response rỗng');
  }
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    return failManualParse(
      translatedTexts,
      'JSON_PARSE_FAILED',
      'Response không phải JSON thuần túy (có text thừa ngoài JSON)'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failManualParse(
      translatedTexts,
      'JSON_PARSE_FAILED',
      `JSON.parse thất bại: ${String(error)}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: root phải là object');
  }

  const root = parsed as Record<string, unknown>;
  const status = typeof root.status === 'string' ? root.status.trim() : '';

  if (status === 'error') {
    const errorNode =
      root.error && typeof root.error === 'object' && !Array.isArray(root.error)
        ? (root.error as Record<string, unknown>)
        : {};
    const upstreamCode = typeof errorNode.code === 'string' ? errorNode.code.trim() : '';
    const upstreamMessage = typeof errorNode.message === 'string' ? errorNode.message.trim() : '';
    return failManualParse(
      translatedTexts,
      upstreamCode || 'ERROR_PROCESSING_FAILED',
      upstreamMessage || 'Model trả về status=error'
    );
  }

  if (status !== 'success') {
    return failManualParse(
      translatedTexts,
      'ERROR_INVALID_INPUT',
      'Schema không hợp lệ: status phải là "success" hoặc "error"'
    );
  }

  const dataNode =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  if (!dataNode) {
    return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data object');
  }

  const translations = Array.isArray(dataNode.translations) ? dataNode.translations : null;
  if (!translations) {
    return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data.translations[]');
  }

  const seenIndexes = new Set<number>();

  for (const item of translations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: item translations phải là object');
    }
    const typed = item as Record<string, unknown>;
    const parsedIndex = parseCount(typed.index);
    if (parsedIndex === null || parsedIndex <= 0) {
      return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: index phải là số nguyên >= 1');
    }
    if (parsedIndex > safeExpectedCount) {
      return failManualParse(
        translatedTexts,
        'ERROR_COUNT_MISMATCH',
        `Index ngoài phạm vi: ${parsedIndex} > ${safeExpectedCount}`
      );
    }
    if (seenIndexes.has(parsedIndex)) {
      return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', `Trùng index trong translations: ${parsedIndex}`);
    }
    const translatedValue =
      typeof typed.translated === 'string'
        ? typed.translated
        : (typeof typed.translation === 'string'
            ? typed.translation
            : (typeof typed.text === 'string' ? typed.text : null));
    if (translatedValue === null) {
      return failManualParse(
        translatedTexts,
        'ERROR_INVALID_INPUT',
        `Schema không hợp lệ tại index ${parsedIndex}: thiếu translated string`
      );
    }

    seenIndexes.add(parsedIndex);
    translatedTexts[parsedIndex - 1] = translatedValue.trim();
  }

  if (seenIndexes.size !== safeExpectedCount) {
    return failManualParse(
      translatedTexts,
      'ERROR_COUNT_MISMATCH',
      `Số dòng dịch không khớp: nhận ${seenIndexes.size}/${safeExpectedCount}`
    );
  }

  const summaryNode =
    dataNode.summary && typeof dataNode.summary === 'object' && !Array.isArray(dataNode.summary)
      ? (dataNode.summary as Record<string, unknown>)
      : null;
  if (!summaryNode) {
    return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: thiếu data.summary object');
  }

  const totalSentences = parseCount(summaryNode.total_sentences);
  const inputCount = parseCount(summaryNode.input_count);
  const outputCount = parseCount(summaryNode.output_count);
  const match = summaryNode.match;
  const languageStyle = summaryNode.language_style;

  if (
    totalSentences !== safeExpectedCount ||
    inputCount !== safeExpectedCount ||
    outputCount !== safeExpectedCount ||
    match !== true
  ) {
    return failManualParse(
      translatedTexts,
      'ERROR_COUNT_MISMATCH',
      `Summary mismatch: total=${String(totalSentences)}, input=${String(inputCount)}, output=${String(outputCount)}, match=${String(match)}`
    );
  }

  if (typeof languageStyle !== 'string' || !languageStyle.trim()) {
    return failManualParse(translatedTexts, 'ERROR_INVALID_INPUT', 'Schema không hợp lệ: summary.language_style phải là string');
  }

  return {
    ok: true,
    translatedTexts,
  };
}

type ManualBatchInput = {
  batchIndex: number;
  responseJson: string;
};

type ManualBulkParseResult =
  | { ok: true; items: ManualBatchInput[] }
  | { ok: false; errorMessage: string };

function repairTranslatedQuotes(raw: string): string {
  const target = '"translated"';
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const idx = raw.indexOf(target, i);
    if (idx === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, idx);
    out += target;
    let j = idx + target.length;
    while (j < raw.length && /\s/.test(raw[j])) { out += raw[j]; j += 1; }
    if (raw[j] === ':') { out += raw[j]; j += 1; }
    while (j < raw.length && /\s/.test(raw[j])) { out += raw[j]; j += 1; }
    if (raw[j] !== '"') {
      i = j;
      continue;
    }
    out += '"';
    j += 1;
    while (j < raw.length) {
      const ch = raw[j];
      if (ch === '\\') {
        if (j + 1 < raw.length) {
          out += ch + raw[j + 1];
          j += 2;
          continue;
        }
        out += ch;
        j += 1;
        continue;
      }
      if (ch === '"') {
        let k = j + 1;
        while (k < raw.length && /\s/.test(raw[k])) k += 1;
        if (k >= raw.length || raw[k] === ',' || raw[k] === '}') {
          out += '"';
          j += 1;
          break;
        }
        out += '\\"';
        j += 1;
        continue;
      }
      out += ch;
      j += 1;
    }
    i = j;
  }
  return out;
}

function parseManualBulkInput(raw: string): ManualBulkParseResult {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { ok: false, errorMessage: 'Input rỗng.' };
  }

  const normalizeItem = (item: Record<string, unknown>): ManualBatchInput | null => {
    const batchIndexRaw = item.batchIndex;
    const batchIndex = typeof batchIndexRaw === 'number' ? Math.floor(batchIndexRaw) : null;
    if (!batchIndex || batchIndex <= 0) {
      return null;
    }
    const response = item.response;
    if (typeof response === 'string') {
      return { batchIndex, responseJson: response.trim() };
    }
    if (response && typeof response === 'object') {
      return { batchIndex, responseJson: JSON.stringify(response) };
    }
    return null;
  };

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const items: ManualBatchInput[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return { ok: false, errorMessage: 'JSON array phải chứa object {batchIndex, response}.' };
        }
        const normalized = normalizeItem(item as Record<string, unknown>);
        if (!normalized) {
          return { ok: false, errorMessage: 'Thiếu batchIndex hoặc response trong JSON array.' };
        }
        items.push(normalized);
      }
      return { ok: true, items };
    }
  } catch {
    // try repair for JSON array
    try {
      const repaired = repairTranslatedQuotes(trimmed);
      const parsed = JSON.parse(repaired);
      if (Array.isArray(parsed)) {
        const items: ManualBatchInput[] = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return { ok: false, errorMessage: 'JSON array phải chứa object {batchIndex, response}.' };
          }
          const normalized = normalizeItem(item as Record<string, unknown>);
          if (!normalized) {
            return { ok: false, errorMessage: 'Thiếu batchIndex hoặc response trong JSON array.' };
          }
          items.push(normalized);
        }
        return { ok: true, items };
      }
    } catch {
      // fallback to NDJSON
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const items: ManualBatchInput[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch (error) {
      try {
        const repaired = repairTranslatedQuotes(line);
        parsedLine = JSON.parse(repaired);
      } catch {
        return { ok: false, errorMessage: `Line ${i + 1}: JSON không hợp lệ.` };
      }
    }
    if (!parsedLine || typeof parsedLine !== 'object' || Array.isArray(parsedLine)) {
      return { ok: false, errorMessage: `Line ${i + 1}: cần object {batchIndex, response}.` };
    }
    const normalized = normalizeItem(parsedLine as Record<string, unknown>);
    if (!normalized) {
      return { ok: false, errorMessage: `Line ${i + 1}: thiếu batchIndex hoặc response.` };
    }
    items.push(normalized);
  }

  return items.length > 0
    ? { ok: true, items }
    : { ok: false, errorMessage: 'Không có dòng hợp lệ.' };
}

function buildFailedBatchReportFromEntries(
  batchPlan: StepBatchPlanItem,
  entries: SubtitleEntry[],
  errorText: string,
  attempts = 1
): SharedTranslationBatchReport {
  const missingInfo = collectBatchMissingInfo(entries, batchPlan);
  return {
    batchIndex: batchPlan.batchIndex,
    startIndex: batchPlan.startIndex,
    endIndex: batchPlan.endIndex,
    expectedLines: missingInfo.expectedLines,
    translatedLines: missingInfo.translatedLines,
    missingLinesInBatch: missingInfo.missingLinesInBatch,
    missingGlobalLineIndexes: missingInfo.missingGlobalLineIndexes,
    attempts,
    status: 'failed',
    error: errorText,
  };
}

function formatIndexRanges(indexes: number[]): string {
  const normalized = Array.from(
    new Set(
      indexes
        .map((value) => Math.floor(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => a - b);

  if (normalized.length === 0) {
    return 'không rõ';
  }

  const ranges: string[] = [];
  let start = normalized[0];
  let prev = normalized[0];

  for (let i = 1; i < normalized.length; i++) {
    const current = normalized[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }

  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(',');
}

function formatMissingBatchMessage(
  folderName: string,
  reports: SharedTranslationBatchReport[]
): string {
  const failedReports = reports
    .filter((report) => report.status === 'failed')
    .sort((a, b) => a.batchIndex - b.batchIndex);

  if (failedReports.length === 0) {
    return `[${folderName}] Step 3 thiếu batch nhưng chưa có đủ batch report để xác định dòng thiếu.`;
  }

  const details = failedReports
    .map((report) => {
      const missingCount = report.missingGlobalLineIndexes.length;
      const missingRanges = formatIndexRanges(report.missingGlobalLineIndexes);
      return `#${report.batchIndex} (thiếu ${missingCount}/${report.expectedLines} dòng global: ${missingRanges})`;
    })
    .join(', ');

  const mergedGlobalRanges = formatIndexRanges(
    failedReports.flatMap((report) => report.missingGlobalLineIndexes)
  );
  const mergedGlobalCount = Array.from(new Set(failedReports.flatMap((report) => report.missingGlobalLineIndexes))).length;
  return `[${folderName}] Step 3 thiếu batch: ${details} | tổng thiếu ${mergedGlobalCount} dòng global: ${mergedGlobalRanges}`;
}

const STEP3_GEMINI_EXHAUSTED_CODE = 'ALL_GEMINI_WEB_ACCOUNTS_FAILED';

function normalizeStep3BackendErrorMessage(rawError: string): string {
  const trimmed = (rawError || '').trim();
  if (!trimmed) {
    return 'TRANSLATE_CALL_FAILED';
  }
  if (trimmed.includes(STEP3_GEMINI_EXHAUSTED_CODE)) {
    return 'Hết account Gemini Web khả dụng, Step 3 đã dừng.';
  }
  return trimmed;
}

function extractStep3BackendErrorCode(rawError: string): string {
  const trimmed = (rawError || '').trim();
  if (!trimmed) {
    return '';
  }
  const matched = trimmed.match(/^([A-Z0-9_]+)\s*:/);
  if (matched && matched[1]) {
    return matched[1];
  }
  return '';
}

function deriveBatchReportFromProgress(
  progress: TranslationProgress
): SharedTranslationBatchReport | null {
  if (!progress.translatedChunk || !Array.isArray(progress.translatedChunk.texts)) {
    return null;
  }

  const startIndex = Math.max(0, Math.floor(progress.translatedChunk.startIndex || 0));
  const texts = progress.translatedChunk.texts;
  const expectedLines = texts.length;
  const missingLinesInBatch: number[] = [];
  const missingGlobalLineIndexes: number[] = [];
  let translatedLines = 0;

  for (let i = 0; i < expectedLines; i++) {
    if (typeof texts[i] === 'string' && texts[i].trim().length > 0) {
      translatedLines++;
    } else {
      missingLinesInBatch.push(i + 1);
      missingGlobalLineIndexes.push(startIndex + i + 1);
    }
  }

  const fallbackBatchIndex = typeof progress.batchIndex === 'number'
    ? progress.batchIndex + 1
    : 1;

  return {
    batchIndex: fallbackBatchIndex,
    startIndex,
    endIndex: Math.max(startIndex, startIndex + expectedLines - 1),
    expectedLines,
    translatedLines,
    missingLinesInBatch,
    missingGlobalLineIndexes,
    attempts: 1,
    status: progress.eventType === 'batch_failed' ? 'failed' : 'success',
    error: progress.eventType === 'batch_failed' ? 'BATCH_INCOMPLETE' : undefined,
  };
}

function resolveRenderOutputDir(inputType: string, currentPath: string, sourceVideoPath?: string): string {
  if (sourceVideoPath && sourceVideoPath.trim()) {
    return resolveParentDir(sourceVideoPath);
  }
  return inputType === 'draft' || inputType === 'srt'
    ? currentPath.trim().replace(/[\\/]+$/, '')
    : resolveParentDir(currentPath);
}

function buildStopCheckpoint(params: {
  at: string;
  step: number;
  folderPath: string;
  folderIndex: number;
  totalFolders: number;
  processingMode: ProcessingMode;
  reason: 'user_stop' | 'recovered_interrupted_run';
  resumable?: boolean;
}): CaptionSessionStopCheckpoint {
  return {
    at: params.at,
    step: params.step,
    folderPath: params.folderPath,
    folderIndex: params.folderIndex,
    totalFolders: params.totalFolders,
    processingMode: params.processingMode,
    reason: params.reason,
    resumable: params.resumable !== false,
  };
}

function pushArtifact(
  artifacts: CaptionArtifactFile[],
  role: string,
  pathValue: unknown,
  kind: 'file' | 'dir' = 'file',
  note?: string
) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return;
  }
  artifacts.push({
    role,
    kind,
    path: pathValue.trim(),
    note,
  });
}

export function useCaptionProcessing({
  projectId,
  entries,
  setEntries,
  filePath,
  inputPathsOverride,
  inputType,
  srtFilesByFolder,
  captionFolder,
  settings,
  enabledSteps,
  setEnabledSteps,
}: UseCaptionProcessingProps) {
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [status, setStatus] = useState<ProcessStatus>('idle');
  const [progress, setProgress] = useState<TranslationProgress>({ current: 0, total: 0, message: 'Sẵn sàng.' });
  const [currentFolder, setCurrentFolder] = useState<{ index: number; total: number; name: string; path: string } | null>(null);
  const [stepDependencyIssues, setStepDependencyIssues] = useState<StepDependencyIssue[]>([]);
  
  // State for intermediate data
  const [audioFiles, setAudioFiles] = useState<ProcessingAudioFile[]>([]);
  const [audioPreviewStatus, setAudioPreviewStatus] = useState<AudioPreviewStatus>('idle');
  const [audioPreviewProgressText, setAudioPreviewProgressText] = useState<string>('');
  const [audioPreviewDataUri, setAudioPreviewDataUri] = useState<string>('');
  const [audioPreviewMeta, setAudioPreviewMeta] = useState<AudioPreviewMeta | null>(null);

  // Ref cho abort flag — cho phép handleStop() dừng vòng lặp đang chạy
  const abortRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  const translateBatchProgressHandlerRef = useRef<((progress: TranslationProgress) => void | Promise<void>) | null>(null);
  const audioPreviewStopRequestedRef = useRef(false);
  const baseInputPaths = useMemo(
    () => getInputPaths(inputType as 'srt' | 'draft', filePath),
    [filePath, inputType]
  );
  const resolvedInputPaths = useMemo(() => {
    if (!Array.isArray(inputPathsOverride)) {
      return baseInputPaths;
    }
    const basePathKeys = new Set(baseInputPaths.map(normalizePathKey));
    const nextPaths: string[] = [];
    const seenKeys = new Set<string>();
    for (const rawPath of inputPathsOverride) {
      if (typeof rawPath !== 'string') continue;
      const trimmedPath = rawPath.trim();
      if (!trimmedPath) continue;
      const normalizedKey = normalizePathKey(trimmedPath);
      if (seenKeys.has(normalizedKey)) continue;
      if (basePathKeys.size > 0 && !basePathKeys.has(normalizedKey)) continue;
      seenKeys.add(normalizedKey);
      nextPaths.push(trimmedPath);
    }
    return nextPaths;
  }, [baseInputPaths, inputPathsOverride, inputType]);
  const isDraftFilterApplied = (inputType === 'draft' || inputType === 'srt') && Array.isArray(inputPathsOverride);
  const isDraftFilterEmpty = isDraftFilterApplied && baseInputPaths.length > 0 && resolvedInputPaths.length === 0;
  const resolveFolderPath = useCallback(
    (currentPath: string) => resolveFolderPathForInput(currentPath, inputType),
    [inputType]
  );
  const resolveSourcePath = useCallback(
    (currentPath: string) => {
      if (inputType === 'srt') {
        const srtPath = srtFilesByFolder?.[currentPath];
        return typeof srtPath === 'string' ? srtPath : '';
      }
      return currentPath;
    },
    [inputType, srtFilesByFolder]
  );

  const toggleStep = useCallback((step: Step) => {
    setEnabledSteps(prev => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  }, [setEnabledSteps]);

  const stopStep7AudioPreview = useCallback(async (silent = false) => {
    audioPreviewStopRequestedRef.current = true;
    try {
      // @ts-ignore
      await window.electronAPI.captionVideo?.stopAudioPreview?.();
    } catch (error) {
      if (!silent) {
        console.warn('[CaptionProcessing] Không thể gửi stop audio preview:', error);
      }
    }
    if (!silent) {
      setAudioPreviewStatus('idle');
      setAudioPreviewProgressText('Đã dừng test audio.');
    }
  }, []);

  const handleStep7AudioPreview = useCallback(async (folderPath?: string) => {
    if (status === 'running') {
      setAudioPreviewStatus('error');
      setAudioPreviewProgressText('Không thể test audio khi pipeline đang chạy.');
      return;
    }
    if (audioPreviewStatus === 'mixing') {
      return;
    }

    const inputPaths = resolvedInputPaths;
    if (inputPaths.length === 0) {
      setAudioPreviewStatus('error');
      setAudioPreviewProgressText(
        isDraftFilterEmpty
          ? 'Không có folder nào được chọn để test audio.'
          : 'Chưa có input để test audio.'
      );
      return;
    }

    const normalizePath = (value: string) => value.trim().replace(/[\\/]+$/, '').toLowerCase();
    const requested = folderPath ? normalizePath(folderPath) : '';
    const targetPath = requested
      ? (inputPaths.find((candidatePath) => {
          const folderCandidate = inputType === 'draft' || inputType === 'srt'
            ? candidatePath
            : candidatePath.replace(/[^/\\]+$/, '');
          return normalizePath(candidatePath) === requested || normalizePath(folderCandidate) === requested;
        }) || currentFolder?.path || inputPaths[0])
      : (currentFolder?.path || inputPaths[0]);
    const folderName = (targetPath.split(/[/\\]/).pop() || targetPath || 'folder').trim();

    const processOutputDir = resolveProcessOutputDir(inputType, targetPath);
    const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', targetPath);
    const sessionFallback = {
      projectId,
      inputType: inputType as 'srt' | 'draft',
      sourcePath: resolveSourcePath(targetPath),
      folderPath: resolveFolderPath(targetPath),
    };

    try {
      audioPreviewStopRequestedRef.current = false;
      setAudioPreviewStatus('mixing');
      setAudioPreviewProgressText(`[${folderName}] Đang chuẩn bị test mix 20s...`);
      setAudioPreviewDataUri('');
      setAudioPreviewMeta(null);

      const session = await readCaptionSession(sessionPath, sessionFallback);
      const step7Inputs = resolveStepInputsFromSession(session, 7);
      const translatedEntries = compactEntries(step7Inputs.translatedEntries);
      const mergedAudioPath = step7Inputs.mergedAudioPath;
      if (translatedEntries.length === 0) {
        throw new Error('Hãy chạy Step 3 trước (thiếu translated entries trong session).');
      }
      if (!mergedAudioPath) {
        throw new Error('Hãy chạy Step 6 trước (thiếu merged audio path trong session).');
      }

      const srtScale = settings.srtSpeed > 0 ? settings.srtSpeed : 1.0;
      const scaleLabel = normalizeSpeedLabel(srtScale);
      const scaledSrtPath = `${processOutputDir}/srt/subtitle_${scaleLabel}x.srt`;
      const scaledEntries = buildScaledSubtitleEntries(translatedEntries, srtScale);
      // @ts-ignore
      const scaledSrtResult = await window.electronAPI.caption.exportSrt(scaledEntries, scaledSrtPath);
      if (!scaledSrtResult?.success) {
        throw new Error('Không thể tạo subtitle scaled cho audio preview.');
      }

      const folderPathsToSearch = (inputType === 'draft' || inputType === 'srt')
        ? [targetPath]
        : [targetPath.replace(/[^/\\]+$/, '')];
      // @ts-ignore
      const findBestRes = await window.electronAPI.captionVideo.findBestVideoInFolders(folderPathsToSearch);
      if (!findBestRes?.success || !findBestRes.data?.videoPath) {
        throw new Error(`Không tìm thấy video nguồn để test (${folderName}).`);
      }

      const previewOutputPath = `${processOutputDir}/step7_audio_preview_20s.wav`;
      const step7AudioSpeed = settings.renderAudioSpeed && settings.renderAudioSpeed > 0
        ? settings.renderAudioSpeed
        : 1.0;
      const timingContextPath = getCaptionSessionPathFromOutputDir(processOutputDir);

      // @ts-ignore
      window.electronAPI.captionVideo?.onAudioPreviewProgress?.((previewProgress: RenderAudioPreviewProgress) => {
        const progressMessage = previewProgress.message || 'Đang mix audio preview...';
        setAudioPreviewProgressText(`[${folderName}] ${progressMessage}`);
      });

      // @ts-ignore
      const previewRes = await window.electronAPI.captionVideo.mixAudioPreview({
        videoPath: findBestRes.data.videoPath,
        audioPath: mergedAudioPath,
        srtPath: scaledSrtPath,
        outputPath: previewOutputPath,
        previewDurationSec: 20,
        previewWindowMode: 'marker_centered',
        srtTimeScale: srtScale,
        step4SrtScale: srtScale,
        step7AudioSpeedInput: step7AudioSpeed,
        timingContextPath,
        audioSpeedModel: 'step4_minus_step7_delta',
        videoVolume: settings.videoVolume,
        audioVolume: settings.audioVolume,
        ttsRate: settings.rate,
        step7SubtitleSource: 'session_translated_entries',
        step7AudioSource: 'session_merged_audio',
      });

      if (!previewRes?.success || !previewRes.data) {
        const errorMessage = previewRes?.error || 'Không thể mix audio preview.';
        const stoppedByUser = audioPreviewStopRequestedRef.current
          || errorMessage.toLowerCase().includes('đã dừng');
        if (stoppedByUser) {
          setAudioPreviewStatus('idle');
          setAudioPreviewProgressText(`[${folderName}] Đã dừng test audio.`);
          return;
        }
        throw new Error(errorMessage);
      }

      const previewData = previewRes.data;
      if (!previewData.audioDataUri) {
        throw new Error('Mix audio preview thành công nhưng thiếu audioDataUri.');
      }

      setAudioPreviewDataUri(previewData.audioDataUri);
      setAudioPreviewMeta({
        startSec: typeof previewData.startSec === 'number' ? previewData.startSec : 0,
        endSec: typeof previewData.endSec === 'number' ? previewData.endSec : 0,
        markerSec: typeof previewData.markerSec === 'number' ? previewData.markerSec : 0,
        outputPath: previewData.outputPath || previewOutputPath,
        folderName,
        folderPath: targetPath,
      });
      setAudioPreviewStatus('ready');
      setAudioPreviewProgressText(`[${folderName}] Đã mix xong preview 20s.`);
    } catch (error) {
      if (audioPreviewStopRequestedRef.current) {
        setAudioPreviewStatus('idle');
        setAudioPreviewProgressText(`[${folderName}] Đã dừng test audio.`);
      } else {
        setAudioPreviewStatus('error');
        setAudioPreviewProgressText(`[${folderName}] ${String(error)}`);
      }
    } finally {
      audioPreviewStopRequestedRef.current = false;
    }
  }, [
    status,
    audioPreviewStatus,
    inputType,
    resolvedInputPaths,
    isDraftFilterEmpty,
    currentFolder?.path,
    projectId,
    settings.srtSpeed,
    settings.renderAudioSpeed,
    settings.videoVolume,
    settings.audioVolume,
    settings.rate,
  ]);

  useEffect(() => {
    return () => {
      void stopStep7AudioPreview(true);
    };
  }, [stopStep7AudioPreview]);

  const handleStop = useCallback(async () => {
    abortRef.current = true;
    const stopAt = nowIso();
    const paths = resolvedInputPaths;
    const totalFolders = paths.length;
    const activeFolderPath = currentFolder?.path || paths[0] || '';
    const activeFolderIndex = currentFolder?.index || (activeFolderPath ? Math.max(1, paths.findIndex((p) => p === activeFolderPath) + 1) : 1);
    const activeStep = currentStep || 0;
    const processingMode = settings.processingMode ?? 'folder-first';

    try {
      await Promise.all(paths.map(async (currentPath, idx) => {
        const folderPath = resolveFolderPath(currentPath);
        const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        await updateCaptionSession(
          sessionPath,
          (session) => {
            const checkpointStep = typeof session.runtime?.currentStep === 'number'
              ? session.runtime.currentStep
              : activeStep;
            const lastStopCheckpoint = buildStopCheckpoint({
              at: stopAt,
              step: checkpointStep > 0 ? checkpointStep : 1,
              folderPath: activeFolderPath || currentPath,
              folderIndex: activeFolderIndex > 0 ? activeFolderIndex : (idx + 1),
              totalFolders: totalFolders > 0 ? totalFolders : 1,
              processingMode,
              reason: 'user_stop',
              resumable: true,
            });
            return {
              ...session,
              runtime: {
                ...session.runtime,
                runState: 'stopping',
                stopRequestAt: stopAt,
                lastMessage: 'Đã nhận yêu cầu dừng từ người dùng.',
                lastStopCheckpoint,
              },
            };
          },
          {
            projectId,
            inputType: inputType as 'srt' | 'draft',
            sourcePath: resolveSourcePath(currentPath),
            folderPath,
          }
        );
      }));
    } catch (error) {
      console.warn('[CaptionProcessing] Không thể ghi trạng thái stopping vào session:', error);
    }

    try {
      // @ts-ignore
      await window.electronAPI.captionVideo?.stopRender?.();
    } catch (error) {
      console.warn('[CaptionProcessing] Không thể gửi stop render:', error);
    }
    try {
      // @ts-ignore
      await window.electronAPI.caption?.stopAll?.({ runId: runIdRef.current || undefined });
    } catch (error) {
      console.warn('[CaptionProcessing] Không thể gửi stopAll caption:', error);
    }
    try {
      // @ts-ignore
      await window.electronAPI.tts?.stop?.();
    } catch (error) {
      console.warn('[CaptionProcessing] Không thể gửi stop TTS:', error);
    }
    try {
      await window.electronAPI.shutdown?.cancel?.();
    } catch (error) {
      console.warn('[CaptionProcessing] Không thể hủy auto shutdown:', error);
    }
    await stopStep7AudioPreview(true);
    setStatus('idle');
    setCurrentFolder(null);
    setCurrentStep(null);
    setProgress(p => ({ ...p, message: 'Đã dừng.' }));
    runIdRef.current = null;
  }, [
    currentFolder?.index,
    currentFolder?.path,
    currentStep,
    resolvedInputPaths,
    inputType,
    projectId,
    resolveFolderPath,
    resolveSourcePath,
    settings.processingMode,
    stopStep7AudioPreview,
  ]);

  type ManualApplyResult = {
    success: boolean;
    error?: string;
    updatedBatchIndexes?: number[];
    completed?: boolean;
    missingBatches?: number;
  };

  type ManualValidateResult = {
    ok: boolean;
    error?: string;
  };

  const applyManualBatchUpdates = useCallback(async (
    inputPath: string,
    updates: Array<{ batchIndex: number; translatedTexts: string[] }>
  ): Promise<ManualApplyResult> => {
    const trimmedPath = inputPath?.trim();
    if (!trimmedPath) {
      return { success: false, error: 'Thiếu input path để cập nhật.' };
    }
    if (!updates.length) {
      return { success: false, error: 'Không có batch để cập nhật.' };
    }

    const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', trimmedPath);
    const folderPath = resolveFolderPath(trimmedPath);
    const fallback = { projectId, inputType: inputType as 'srt' | 'draft', sourcePath: resolveSourcePath(trimmedPath), folderPath };

    let result: ManualApplyResult = { success: true, updatedBatchIndexes: [] };

    try {
      await updateCaptionSession(sessionPath, (session) => {
        const step2BatchPlan = Array.isArray(session.data.step2BatchPlan)
          ? (session.data.step2BatchPlan as StepBatchPlanItem[])
          : [];
        if (step2BatchPlan.length === 0) {
          throw new Error('Chưa có dữ liệu Step 2 trong session. Hãy chạy Step 2 trước.');
        }
        const planMap = new Map<number, StepBatchPlanItem>();
        for (const plan of step2BatchPlan) {
          if (typeof plan.batchIndex === 'number') {
            planMap.set(Math.floor(plan.batchIndex), plan);
          }
        }

        const baseEntries = Array.isArray(session.data.translatedEntries) && session.data.translatedEntries.length > 0
          ? (session.data.translatedEntries as SubtitleEntry[])
          : (Array.isArray(session.data.extractedEntries) ? (session.data.extractedEntries as SubtitleEntry[]) : entries);
        const workingEntries = normalizeEntriesForSession(compactEntries(baseEntries));

        const existingReports = new Map<number, SharedTranslationBatchReport>();
        const step3BatchStateRaw = session.data.step3BatchState;
        if (step3BatchStateRaw && Array.isArray(step3BatchStateRaw.batches)) {
          for (const report of step3BatchStateRaw.batches as SharedTranslationBatchReport[]) {
            if (report && typeof report.batchIndex === 'number') {
              existingReports.set(Math.floor(report.batchIndex), { ...report, batchIndex: Math.floor(report.batchIndex) });
            }
          }
        }

        const nowMs = Date.now();
        const updatedIndexes: number[] = [];

        for (const update of updates) {
          const batchIndex = Math.max(1, Math.floor(update.batchIndex));
          const plan = planMap.get(batchIndex);
          if (!plan) {
            continue;
          }
          const expectedLines = Math.max(0, plan.lineCount || (plan.endIndex - plan.startIndex + 1));
          const translatedTexts = Array.from({ length: expectedLines }, (_, idx) => update.translatedTexts[idx] ?? '');
          for (let i = 0; i < expectedLines; i++) {
            const entryIndex = plan.startIndex + i;
            if (entryIndex < 0 || entryIndex >= workingEntries.length) {
              continue;
            }
            const rawText = typeof translatedTexts[i] === 'string' ? translatedTexts[i].trim() : '';
            workingEntries[entryIndex] = {
              ...workingEntries[entryIndex],
              translatedText: rawText.length > 0 ? rawText : undefined,
            };
          }

          const missingInfo = collectBatchMissingInfo(workingEntries, plan);
          const isSuccess = missingInfo.missingGlobalLineIndexes.length === 0;
          const existing = existingReports.get(batchIndex);
          const attempts = typeof existing?.attempts === 'number' ? existing.attempts + 1 : 1;
          const nextReport: SharedTranslationBatchReport = {
            batchIndex: plan.batchIndex,
            startIndex: plan.startIndex,
            endIndex: plan.endIndex,
            expectedLines: missingInfo.expectedLines,
            translatedLines: missingInfo.translatedLines,
            missingLinesInBatch: missingInfo.missingLinesInBatch,
            missingGlobalLineIndexes: missingInfo.missingGlobalLineIndexes,
            attempts,
            status: isSuccess ? 'success' : 'failed',
            error: isSuccess ? undefined : 'MANUAL_MISSING_LINES',
            startedAt: nowMs,
            endedAt: nowMs,
            durationMs: 0,
            transport: existing?.transport,
            resourceId: existing?.resourceId,
            resourceLabel: 'manual',
            queueRuntimeKey: existing?.queueRuntimeKey,
          };
          existingReports.set(batchIndex, nextReport);
          updatedIndexes.push(batchIndex);
        }

        const batchReports = Array.from(existingReports.values()).sort((a, b) => a.batchIndex - b.batchIndex);
        const totalBatches = step2BatchPlan.length;
        const planFingerprint = typeof session.data.step2BatchPlanFingerprint === 'string'
          ? session.data.step2BatchPlanFingerprint
          : buildObjectFingerprint(step2BatchPlan);
        const generatedStep3BatchState = {
          ...buildStep3BatchState(totalBatches, batchReports),
          planFingerprint,
        };
        const missingBatchIndexes = generatedStep3BatchState.missingBatchIndexes;
        const missingGlobalLineIndexes = generatedStep3BatchState.missingGlobalLineIndexes;
        const hasAllBatchReports = batchReports.length >= totalBatches;
        const translatedSrtContent = entriesToSrtText(workingEntries);
        const translatedLines = batchReports.reduce((sum, report) => sum + report.translatedLines, 0);

        const inputFingerprint = buildEntriesFingerprint((session.data.extractedEntries || []) as SubtitleEntry[]);
        const outputFingerprint = buildEntriesFingerprint(workingEntries);
        const prevOutputFingerprint = session.steps.step3?.outputFingerprint;
        const stepMetrics = {
          totalLines: workingEntries.length,
          translatedLines,
          failedLines: missingGlobalLineIndexes.length,
          failedBatches: generatedStep3BatchState.failedBatches,
          missingBatchIndexes,
          missingGlobalLineIndexes,
        };
        const isComplete = hasAllBatchReports && missingBatchIndexes.length === 0 && missingGlobalLineIndexes.length === 0;

        let nextStepState = session.steps.step3;
        if (isComplete) {
          nextStepState = {
            ...makeStepSuccess(session.steps.step3, stepMetrics),
            inputFingerprint,
            outputFingerprint,
            dependsOn: [1] as CaptionStepNumber[],
          };
        } else if (nextStepState?.status === 'stopped') {
          nextStepState = {
            ...makeStepStopped(session.steps.step3, nextStepState?.error || 'STOPPED_BY_USER', stepMetrics),
            inputFingerprint,
            outputFingerprint,
            dependsOn: [1] as CaptionStepNumber[],
          };
        } else {
          nextStepState = {
            ...makeStepError(session.steps.step3, 'STEP3_MANUAL_INCOMPLETE'),
            metrics: stepMetrics,
            inputFingerprint,
            outputFingerprint,
            dependsOn: [1] as CaptionStepNumber[],
          };
        }

        let nextSession: CaptionSessionV1 = {
          ...session,
          data: {
            ...session.data,
            translatedEntries: workingEntries,
            translatedSrtContent,
            step3BatchState: generatedStep3BatchState,
          },
          runtime: {
            ...session.runtime,
            lastMessage: isComplete
              ? 'Bước 3: Manual update hoàn tất.'
              : 'Bước 3: Manual update đã ghi nhận.',
          },
          steps: {
            ...session.steps,
            step3: nextStepState,
          },
        };

        if (isComplete && prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
          nextSession = markFollowingStepsStale(
            nextSession,
            3,
            'STEP3_OUTPUT_CHANGED',
            [1, 2, 3, 4, 5, 6, 7] as CaptionStepNumber[]
          );
        }

        result = {
          success: true,
          updatedBatchIndexes: updatedIndexes,
          completed: isComplete,
          missingBatches: missingBatchIndexes.length,
        };
        return nextSession;
      }, fallback);

      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [entries, inputType, projectId, resolveFolderPath, resolveSourcePath]);

  const applyManualBatchResponse = useCallback(async (payload: {
    inputPath: string;
    batchIndex: number;
    responseJson: string;
  }): Promise<ManualApplyResult> => {
    const trimmedPath = payload.inputPath?.trim();
    if (!trimmedPath) {
      return { success: false, error: 'Thiếu input path để cập nhật.' };
    }
    const batchIndex = Math.max(1, Math.floor(payload.batchIndex));
    const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', trimmedPath);
    const folderPath = resolveFolderPath(trimmedPath);
    const fallback = { projectId, inputType: inputType as 'srt' | 'draft', sourcePath: resolveSourcePath(trimmedPath), folderPath };

    try {
      const session = await readCaptionSession(sessionPath, fallback);
      const step2BatchPlan = Array.isArray(session.data.step2BatchPlan)
        ? (session.data.step2BatchPlan as StepBatchPlanItem[])
        : [];
      if (step2BatchPlan.length === 0) {
        return { success: false, error: 'Chưa có dữ liệu Step 2 trong session. Hãy chạy Step 2 trước.' };
      }
      const plan = step2BatchPlan.find((item) => Math.floor(item.batchIndex) === batchIndex);
      if (!plan) {
        return { success: false, error: `Không tìm thấy batch #${batchIndex} trong plan.` };
      }
      const expectedLines = Math.max(0, plan.lineCount || (plan.endIndex - plan.startIndex + 1));
      const parsed = parseJsonTranslationResponseForManual(payload.responseJson, expectedLines);
      if (!parsed.ok) {
        return { success: false, error: `${parsed.errorCode}: ${parsed.errorMessage}` };
      }

      return await applyManualBatchUpdates(trimmedPath, [{
        batchIndex,
        translatedTexts: parsed.translatedTexts,
      }]);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [applyManualBatchUpdates, inputType, projectId, resolveFolderPath, resolveSourcePath]);

  const applyManualBatchTranslatedTexts = useCallback(async (payload: {
    inputPath: string;
    batchIndex: number;
    translatedTexts: string[];
  }): Promise<ManualApplyResult> => {
    const trimmedPath = payload.inputPath?.trim();
    if (!trimmedPath) {
      return { success: false, error: 'Thiếu input path để cập nhật.' };
    }
    const batchIndex = Math.max(1, Math.floor(payload.batchIndex));
    const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', trimmedPath);
    const folderPath = resolveFolderPath(trimmedPath);
    const fallback = { projectId, inputType: inputType as 'srt' | 'draft', sourcePath: resolveSourcePath(trimmedPath), folderPath };

    try {
      const session = await readCaptionSession(sessionPath, fallback);
      const step2BatchPlan = Array.isArray(session.data.step2BatchPlan)
        ? (session.data.step2BatchPlan as StepBatchPlanItem[])
        : [];
      if (step2BatchPlan.length === 0) {
        return { success: false, error: 'Chưa có dữ liệu Step 2 trong session. Hãy chạy Step 2 trước.' };
      }
      const plan = step2BatchPlan.find((item) => Math.floor(item.batchIndex) === batchIndex);
      if (!plan) {
        return { success: false, error: `Không tìm thấy batch #${batchIndex} trong plan.` };
      }

      const expectedLines = Math.max(0, plan.lineCount || (plan.endIndex - plan.startIndex + 1));
      const normalized = Array.from({ length: expectedLines }, (_, idx) => {
        const value = payload.translatedTexts?.[idx];
        return typeof value === 'string' ? value.trim() : '';
      });

      return await applyManualBatchUpdates(trimmedPath, [{
        batchIndex,
        translatedTexts: normalized,
      }]);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [applyManualBatchUpdates, inputType, projectId, resolveFolderPath, resolveSourcePath]);

  const validateManualBatchResponse = useCallback(async (payload: {
    inputPath: string;
    batchIndex: number;
    responseJson: string;
  }): Promise<ManualValidateResult> => {
    const trimmedPath = payload.inputPath?.trim();
    if (!trimmedPath) {
      return { ok: false, error: 'Thiếu input path để kiểm tra.' };
    }
    const batchIndex = Math.max(1, Math.floor(payload.batchIndex || 0));
    if (!batchIndex) {
      return { ok: false, error: 'Thiếu batchIndex để kiểm tra.' };
    }
    try {
      const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', trimmedPath);
      const folderPath = resolveFolderPath(trimmedPath);
      const fallback = { projectId, inputType: inputType as 'srt' | 'draft', sourcePath: resolveSourcePath(trimmedPath), folderPath };
      const session = await readCaptionSession(sessionPath, fallback);
      const step2BatchPlan = Array.isArray(session.data.step2BatchPlan)
        ? (session.data.step2BatchPlan as StepBatchPlanItem[])
        : [];
      if (step2BatchPlan.length === 0) {
        return { ok: false, error: 'Chưa có dữ liệu Step 2 trong session. Hãy chạy Step 2 trước.' };
      }
      const plan = step2BatchPlan.find((item) => Math.floor(item.batchIndex) === batchIndex);
      if (!plan) {
        return { ok: false, error: `Không tìm thấy batch #${batchIndex} trong plan.` };
      }
      const expectedLines = Math.max(0, plan.lineCount || (plan.endIndex - plan.startIndex + 1));
      const parsed = parseJsonTranslationResponseForManual(payload.responseJson, expectedLines);
      if (!parsed.ok) {
        return { ok: false, error: `${parsed.errorCode}: ${parsed.errorMessage}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [inputType, projectId, resolveFolderPath, resolveSourcePath]);

  const applyManualBulkResponses = useCallback(async (payload: {
    inputPath: string;
    raw: string;
  }): Promise<ManualApplyResult> => {
    const trimmedPath = payload.inputPath?.trim();
    if (!trimmedPath) {
      return { success: false, error: 'Thiếu input path để cập nhật.' };
    }

    const bulkParsed = parseManualBulkInput(payload.raw);
    if (!bulkParsed.ok) {
      return { success: false, error: bulkParsed.errorMessage };
    }

    const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', trimmedPath);
    const folderPath = resolveFolderPath(trimmedPath);
    const fallback = { projectId, inputType: inputType as 'srt' | 'draft', sourcePath: resolveSourcePath(trimmedPath), folderPath };

    try {
      const session = await readCaptionSession(sessionPath, fallback);
      const step2BatchPlan = Array.isArray(session.data.step2BatchPlan)
        ? (session.data.step2BatchPlan as StepBatchPlanItem[])
        : [];
      if (step2BatchPlan.length === 0) {
        return { success: false, error: 'Chưa có dữ liệu Step 2 trong session. Hãy chạy Step 2 trước.' };
      }

      const planMap = new Map<number, StepBatchPlanItem>();
      for (const plan of step2BatchPlan) {
        if (typeof plan.batchIndex === 'number') {
          planMap.set(Math.floor(plan.batchIndex), plan);
        }
      }

      const updates: Array<{ batchIndex: number; translatedTexts: string[] }> = [];
      for (const item of bulkParsed.items) {
        const batchIndex = Math.max(1, Math.floor(item.batchIndex));
        const plan = planMap.get(batchIndex);
        if (!plan) {
          return { success: false, error: `Không tìm thấy batch #${batchIndex} trong plan.` };
        }
        const expectedLines = Math.max(0, plan.lineCount || (plan.endIndex - plan.startIndex + 1));
        const parsed = parseJsonTranslationResponseForManual(item.responseJson, expectedLines);
        if (!parsed.ok) {
          return { success: false, error: `Batch #${batchIndex} ${parsed.errorCode}: ${parsed.errorMessage}` };
        }
        updates.push({ batchIndex, translatedTexts: parsed.translatedTexts });
      }

      return await applyManualBatchUpdates(trimmedPath, updates);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [applyManualBatchUpdates, inputType, projectId, resolveFolderPath, resolveSourcePath]);

  const validateManualBulkResponses = useCallback(async (payload: {
    inputPath: string;
    raw: string;
  }): Promise<ManualValidateResult> => {
    const trimmedPath = payload.inputPath?.trim();
    if (!trimmedPath) {
      return { ok: false, error: 'Thiếu input path để kiểm tra.' };
    }

    const bulkParsed = parseManualBulkInput(payload.raw);
    if (!bulkParsed.ok) {
      return { ok: false, error: bulkParsed.errorMessage };
    }

    try {
      const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', trimmedPath);
      const folderPath = resolveFolderPath(trimmedPath);
      const fallback = { projectId, inputType: inputType as 'srt' | 'draft', sourcePath: resolveSourcePath(trimmedPath), folderPath };
      const session = await readCaptionSession(sessionPath, fallback);
      const step2BatchPlan = Array.isArray(session.data.step2BatchPlan)
        ? (session.data.step2BatchPlan as StepBatchPlanItem[])
        : [];
      if (step2BatchPlan.length === 0) {
        return { ok: false, error: 'Chưa có dữ liệu Step 2 trong session. Hãy chạy Step 2 trước.' };
      }
      const planMap = new Map<number, StepBatchPlanItem>();
      for (const plan of step2BatchPlan) {
        if (typeof plan.batchIndex === 'number') {
          planMap.set(Math.floor(plan.batchIndex), plan);
        }
      }
      for (const item of bulkParsed.items) {
        const batchIndex = Math.max(1, Math.floor(item.batchIndex));
        const plan = planMap.get(batchIndex);
        if (!plan) {
          return { ok: false, error: `Không tìm thấy batch #${batchIndex} trong plan.` };
        }
        const expectedLines = Math.max(0, plan.lineCount || (plan.endIndex - plan.startIndex + 1));
        const parsed = parseJsonTranslationResponseForManual(item.responseJson, expectedLines);
        if (!parsed.ok) {
          return { ok: false, error: `Batch #${batchIndex} ${parsed.errorCode}: ${parsed.errorMessage}` };
        }
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [inputType, projectId, resolveFolderPath, resolveSourcePath]);

  const handleStart = useCallback(async () => {
    const steps = Array.from(enabledSteps).filter((step) => step !== 5).sort() as Step[];
    setStepDependencyIssues([]);
    const nextRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    runIdRef.current = nextRunId;
    if (!settings.isHydrated) {
      setProgress({ current: 0, total: 0, message: 'Settings đang load, vui lòng đợi 1–2s.' });
      runIdRef.current = null;
      return;
    }
    const renderLayoutOverrides =
      settings.isHydrated ? resolveRenderLayoutOverrides(settings) : {};
    const styleForRun = renderLayoutOverrides.style ?? settings.style;
    const subtitlePositionForRun =
      renderLayoutOverrides.subtitlePosition !== undefined
        ? renderLayoutOverrides.subtitlePosition
        : settings.subtitlePosition;
    const coverQuadForRun =
      renderLayoutOverrides.coverQuad !== undefined
        ? renderLayoutOverrides.coverQuad
        : settings.coverQuad;
    const logoPositionForRun =
      renderLayoutOverrides.logoPosition !== undefined
        ? renderLayoutOverrides.logoPosition
        : settings.logoPosition;
    const thumbnailTextPrimaryPositionForRun =
      renderLayoutOverrides.thumbnailTextPrimaryPosition !== undefined
        ? renderLayoutOverrides.thumbnailTextPrimaryPosition
        : settings.thumbnailTextPrimaryPosition;
    const thumbnailTextSecondaryPositionForRun =
      renderLayoutOverrides.thumbnailTextSecondaryPosition !== undefined
        ? renderLayoutOverrides.thumbnailTextSecondaryPosition
        : settings.thumbnailTextSecondaryPosition;
    const hardsubTextPrimaryPositionForRun =
      renderLayoutOverrides.hardsubTextPrimaryPosition !== undefined
        ? renderLayoutOverrides.hardsubTextPrimaryPosition
        : settings.hardsubTextPrimaryPosition;
    const hardsubTextSecondaryPositionForRun =
      renderLayoutOverrides.hardsubTextSecondaryPosition !== undefined
        ? renderLayoutOverrides.hardsubTextSecondaryPosition
        : settings.hardsubTextSecondaryPosition;
    const hardsubPortraitTextPrimaryPositionForRun =
      renderLayoutOverrides.hardsubPortraitTextPrimaryPosition !== undefined
        ? renderLayoutOverrides.hardsubPortraitTextPrimaryPosition
        : settings.hardsubPortraitTextPrimaryPosition;
    const hardsubPortraitTextSecondaryPositionForRun =
      renderLayoutOverrides.hardsubPortraitTextSecondaryPosition !== undefined
        ? renderLayoutOverrides.hardsubPortraitTextSecondaryPosition
        : settings.hardsubPortraitTextSecondaryPosition;
    const portraitTextPrimaryPositionForRun =
      renderLayoutOverrides.portraitTextPrimaryPosition !== undefined
        ? renderLayoutOverrides.portraitTextPrimaryPosition
        : settings.portraitTextPrimaryPosition;
    const portraitTextSecondaryPositionForRun =
      renderLayoutOverrides.portraitTextSecondaryPosition !== undefined
        ? renderLayoutOverrides.portraitTextSecondaryPosition
        : settings.portraitTextSecondaryPosition;
    const runLockedSettings = {
      ...settings,
      ...renderLayoutOverrides,
      style: styleForRun ? { ...styleForRun } : styleForRun,
      subtitlePosition: subtitlePositionForRun ? { ...subtitlePositionForRun } : subtitlePositionForRun,
      coverQuad: coverQuadForRun
        ? {
            tl: { ...coverQuadForRun.tl },
            tr: { ...coverQuadForRun.tr },
            br: { ...coverQuadForRun.br },
            bl: { ...coverQuadForRun.bl },
          }
        : coverQuadForRun,
      logoPosition: logoPositionForRun ? { ...logoPositionForRun } : logoPositionForRun,
      thumbnailTextPrimaryPosition: thumbnailTextPrimaryPositionForRun
        ? { ...thumbnailTextPrimaryPositionForRun }
        : thumbnailTextPrimaryPositionForRun,
      thumbnailTextSecondaryPosition: thumbnailTextSecondaryPositionForRun
        ? { ...thumbnailTextSecondaryPositionForRun }
        : thumbnailTextSecondaryPositionForRun,
      hardsubTextPrimaryPosition: hardsubTextPrimaryPositionForRun
        ? { ...hardsubTextPrimaryPositionForRun }
        : hardsubTextPrimaryPositionForRun,
      hardsubTextSecondaryPosition: hardsubTextSecondaryPositionForRun
        ? { ...hardsubTextSecondaryPositionForRun }
        : hardsubTextSecondaryPositionForRun,
      hardsubPortraitTextPrimaryPosition: hardsubPortraitTextPrimaryPositionForRun
        ? { ...hardsubPortraitTextPrimaryPositionForRun }
        : hardsubPortraitTextPrimaryPositionForRun,
      hardsubPortraitTextSecondaryPosition: hardsubPortraitTextSecondaryPositionForRun
        ? { ...hardsubPortraitTextSecondaryPositionForRun }
        : hardsubPortraitTextSecondaryPositionForRun,
      portraitTextPrimaryPosition: portraitTextPrimaryPositionForRun
        ? { ...portraitTextPrimaryPositionForRun }
        : portraitTextPrimaryPositionForRun,
      portraitTextSecondaryPosition: portraitTextSecondaryPositionForRun
        ? { ...portraitTextSecondaryPositionForRun }
        : portraitTextSecondaryPositionForRun,
      thumbnailTextsByOrder: settings.thumbnailTextsByOrder ? [...settings.thumbnailTextsByOrder] : [],
      thumbnailTextsSecondaryByOrder: settings.thumbnailTextsSecondaryByOrder ? [...settings.thumbnailTextsSecondaryByOrder] : [],
      thumbnailText: settings.thumbnailText || '',
      thumbnailTextSecondary: settings.thumbnailTextSecondary || '',
      layoutProfiles: cloneLayoutProfiles(settings.layoutProfiles),
    };
    const cfg = runLockedSettings;
    const processingMode = cfg.processingMode ?? 'folder-first';

    // Validate steps
    const validation = validateSteps(steps);
    if (!validation.valid) {
      setProgress({ current: 0, total: 0, message: validation.error || 'Lỗi validation!' });
      runIdRef.current = null;
      return;
    }

    abortRef.current = false;
    await stopStep7AudioPreview(true);
    setStatus('running');
    try {
      await window.electronAPI.shutdown?.cancel?.();
    } catch (error) {
      console.warn('[CaptionProcessing] Không thể reset auto shutdown trước run mới:', error);
    }

    // Listen for progress — đăng ký 1 lần với replace (ghi đè listener cũ)
    // @ts-ignore
    window.electronAPI.caption.onTranslateProgress((p: TranslationProgress) => {
      if (abortRef.current) {
        return;
      }
      setProgress({
        ...p,
        current: p.current,
        total: p.total,
        message: p.message,
      });
      const batchHandler = translateBatchProgressHandlerRef.current;
      if (batchHandler) {
        Promise.resolve(batchHandler(p)).catch((error) => {
          console.warn('[CaptionProcessing] Lỗi cập nhật batch progress Step 3:', error);
        });
      }
    });
    // @ts-ignore
    window.electronAPI.tts.onProgress((p: TTSProgress) => {
      setProgress({ current: p.current, total: p.total, message: p.message });
    });
    // @ts-ignore
    window.electronAPI.captionVideo?.onRenderProgress?.((p: any) => {
      setProgress({ current: Math.floor(p.percent || 0), total: 100, message: p.message || 'Đang render video...' });
    });

    const inputPaths = resolvedInputPaths;
    const totalFolders = inputPaths.length;
    if (totalFolders === 0) {
      setStatus('error');
      setProgress({
        current: 0,
        total: 0,
        message: isDraftFilterEmpty
          ? 'Không có folder nào được chọn để chạy.'
          : 'Chưa có input để xử lý.',
      });
      return;
    }
    const isMulti = totalFolders > 1;
    const step7Enabled = steps.includes(7);
    const thumbnailEnabled = cfg.thumbnailFrameTimeSec !== null && cfg.thumbnailFrameTimeSec !== undefined;
    const shutdownEnabled = cfg.autoShutdownEnabled === true;
    const shutdownDelayMinutesRaw = Number(cfg.autoShutdownDelayMinutes);
    const shutdownDelayMinutes = Number.isFinite(shutdownDelayMinutesRaw)
      ? Math.min(30, Math.max(1, Math.round(shutdownDelayMinutesRaw)))
      : 5;
    let shutdownScheduleRequested = false;

    const scheduleAutoShutdownIfNeeded = async (
      source: 'pipeline_success' | 'pipeline_error',
      detail?: string
    ): Promise<void> => {
      if (!shutdownEnabled || shutdownScheduleRequested || abortRef.current) {
        return;
      }
      if (source === 'pipeline_success' && !step7Enabled) {
        return;
      }
      const reasonBase = source === 'pipeline_error'
        ? 'NauChaoHeo pipeline lỗi, tự tắt máy theo cấu hình.'
        : 'NauChaoHeo pipeline hoàn thành, tự tắt máy theo cấu hình.';
      const reason = detail ? `${reasonBase} ${detail}` : reasonBase;
      try {
        const result = await window.electronAPI.shutdown?.schedule?.({
          delayMinutes: shutdownDelayMinutes,
          source,
          reason,
        });
        if (result?.success) {
          shutdownScheduleRequested = true;
          console.log(
            `[CaptionProcessing] Đã lên lịch auto shutdown (${source}) sau ${shutdownDelayMinutes} phút.`
          );
        } else if (result && !result.success) {
          console.warn('[CaptionProcessing] Không thể lên lịch auto shutdown:', result.error || 'Unknown error');
        }
      } catch (error) {
        console.warn('[CaptionProcessing] Lỗi khi lên lịch auto shutdown:', error);
      }
    };

    const getSessionFallback = (currentPath: string) => ({
      projectId,
      inputType: inputType as 'srt' | 'draft',
      sourcePath: resolveSourcePath(currentPath),
      folderPath: resolveFolderPath(currentPath),
    });
    const setRunStateForAllSessions = async (
      runState: 'running' | 'stopping' | 'stopped' | 'completed' | 'error',
      message: string,
      checkpoint?: CaptionSessionStopCheckpoint
    ) => {
      const results = await Promise.allSettled(inputPaths.map(async (currentPath) => {
        const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        await updateCaptionSession(
          sessionPath,
          (session) => ({
            ...session,
            runtime: {
              ...session.runtime,
              runState,
              currentStep: runState === 'running' ? session.runtime.currentStep : null,
              lastMessage: message,
              lastGuardError: runState === 'error' ? message : undefined,
              lastStopCheckpoint: checkpoint || session.runtime.lastStopCheckpoint,
            },
          }),
          getSessionFallback(currentPath)
        );
      }));
      const failedCount = results.filter((result) => result.status === 'rejected').length;
      if (failedCount > 0) {
        console.warn(`[CaptionProcessing] Không thể cập nhật runState cho ${failedCount}/${inputPaths.length} session.`);
      }
    };
    const normalizeInterruptedSession = async (currentPath: string, folderIdx: number): Promise<CaptionSessionV1> => {
      const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
      const fallback = getSessionFallback(currentPath);
      const session = await readCaptionSession(sessionPath, fallback);
      const runningSteps = ([1, 2, 3, 4, 6, 7] as CaptionStepNumber[]).filter((stepNo) => {
        const key = toStepKey(stepNo);
        return session.steps[key]?.status === 'running';
      });
      if (runningSteps.length === 0) {
        return session;
      }

      const recoveredAt = nowIso();
      const recoveredStep = runningSteps[0];
      const recoveredCheckpoint = buildStopCheckpoint({
        at: recoveredAt,
        step: recoveredStep,
        folderPath: currentPath,
        folderIndex: folderIdx + 1,
        totalFolders,
        processingMode,
        reason: 'recovered_interrupted_run',
        resumable: true,
      });

      return updateCaptionSession(
        sessionPath,
        (current) => {
          const nextSteps = { ...current.steps };
          for (const stepNo of runningSteps) {
            const stepKey = toStepKey(stepNo);
            const prev = current.steps[stepKey];
            const outputCheck = validateStepOutputForSkip(current, stepNo);
            const oldMetrics = prev?.metrics && typeof prev.metrics === 'object'
              ? prev.metrics
              : {};
            nextSteps[stepKey] = outputCheck.ok
              ? makeStepSuccess(prev, {
                  ...oldMetrics,
                  recoveredFromInterruptedRun: true,
                  recoveredAt,
                  recoveredReason: 'output_valid',
                })
              : makeStepStopped(prev, 'STOPPED_RECOVERED_INTERRUPTED_RUN', {
                  ...oldMetrics,
                  stopReason: 'recovered_interrupted_run',
                  recoveredAt,
                  outputCheck: outputCheck.reason || 'invalid_output',
                });
          }

          return {
            ...current,
            steps: nextSteps,
            runtime: {
              ...current.runtime,
              runState: 'stopped',
              currentStep: null,
              lastMessage: `Đã tự phục hồi session bị gián đoạn (${runningSteps.length} step running cũ).`,
              lastGuardError: undefined,
              lastStopCheckpoint: recoveredCheckpoint,
            },
          };
        },
        fallback
      );
    };

    // Xóa audioFiles cũ khi chạy multi-folder để tránh dùng nhầm dữ liệu cũ
    if (isMulti) {
      setAudioFiles([]);
    }

    if (isMulti && step7Enabled && thumbnailEnabled) {
      const thumbnailTextsByOrder = cfg.thumbnailTextsByOrder || [];
      const missingFolders: string[] = [];

      for (let i = 0; i < inputPaths.length; i++) {
        const folderName = inputPaths[i].split(/[/\\]/).pop() || `Folder ${i + 1}`;
        const text = (thumbnailTextsByOrder[i] || '').trim();
        if (!text) {
          missingFolders.push(`[${i + 1}] ${folderName}`);
        }
      }

      if (thumbnailTextsByOrder.length !== totalFolders || missingFolders.length > 0) {
        const mismatchMsg = thumbnailTextsByOrder.length !== totalFolders
          ? `Số lượng text (${thumbnailTextsByOrder.length}) không khớp số folder (${totalFolders}).`
          : '';
        const missingMsg = missingFolders.length > 0
          ? `Thiếu text cho: ${missingFolders.join(', ')}.`
          : '';
        const finalMessage = `Lỗi cấu hình thumbnail multi-folder. ${mismatchMsg} ${missingMsg}`.trim();
        setStatus('error');
        setCurrentStep(null);
        setCurrentFolder(null);
        setProgress({ current: 0, total: totalFolders, message: finalMessage });
        return;
      }
    }

    const preflightIssues: StepDependencyIssue[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
      const currentPath = inputPaths[i];
      const folderName = currentPath.split(/[/\\]/).pop() || 'Unknown';
      const session = await normalizeInterruptedSession(currentPath, i);
      for (const step of steps) {
        const plannedEnabled = steps.filter((s) => s <= step) as CaptionStepNumber[];
        const guard = canRunStep(session, step as CaptionStepNumber, plannedEnabled);
        if (!guard.ok) {
          preflightIssues.push({
            step,
            folderPath: currentPath,
            folderName,
            code: guard.code || `STEP${step}_BLOCKED`,
            reason: guard.reason || 'Thiếu dữ liệu phụ thuộc trong caption_session.json.',
            missingDeps: guard.missingDeps as Step[],
          });
        }
      }
    }

    if (preflightIssues.length > 0) {
      const topIssue = preflightIssues[0];
      const details = preflightIssues
        .slice(0, 5)
        .map((issue) => `[${issue.folderName}] Step ${issue.step}: ${issue.reason}`)
        .join(' | ');
      await setRunStateForAllSessions('error', `Preflight fail: ${topIssue.reason}`);
      setStepDependencyIssues(preflightIssues);
      setStatus('error');
      setCurrentStep(null);
      setCurrentFolder(null);
      setProgress({
        current: 0,
        total: totalFolders,
        message: `Preflight fail: ${topIssue.reason} (${details})`,
      });
      return;
    }
    setStepDependencyIssues([]);
    await setRunStateForAllSessions('running', 'Đang xử lý caption...');

    // ========== PER-FOLDER STATE MAP (dùng cho step-first mode) ==========
    // Key = folder path, Value = { entries, audioFiles, srtFileForVideo }
    type FolderCtx = {
      entries: SubtitleEntry[];
      audioFiles: ProcessingAudioFile[];
      srtFileForVideo: string;
      outputDir: string;
      name: string;
    };
    const folderCtxMap = new Map<string, FolderCtx>();
    for (const p of inputPaths) {
      folderCtxMap.set(p, {
        entries: [],
        audioFiles: [],
        srtFileForVideo: '',
        outputDir: resolveProcessOutputDir(inputType, p),
        name: p.split(/[/\\]/).pop() || 'Unknown',
      });
    }

    // failedFolders: các folder đã có lỗi (step-first: bỏ qua bước tiếp theo của folder đó)
    const failedFolders = new Set<string>();
    const failedFolderDetails: Array<{ folderPath: string; folderName: string; error: string }> = [];
    const recordFolderFailure = (folderPath: string, folderName: string, error: unknown) => {
      const errorText = String(error);
      if (!failedFolders.has(folderPath)) {
        failedFolderDetails.push({ folderPath, folderName, error: errorText });
      }
      failedFolders.add(folderPath);
      return errorText;
    };

    const buildSettingsSnapshot = (folderIdx: number): Record<string, unknown> => {
      const thumbnailTextForSnapshot = isMulti
        ? (cfg.thumbnailTextsByOrder?.[folderIdx] || '').trim()
        : (cfg.thumbnailText || '').trim();
      const thumbnailTextSecondaryForSnapshot = isMulti
        ? (cfg.thumbnailTextsSecondaryByOrder?.[folderIdx] || '').trim()
        : (cfg.thumbnailTextSecondary || '').trim();
      const hardsubTextPrimaryForSnapshot = (
        isMulti
          ? (cfg.hardsubTextsByOrder?.[folderIdx] || '')
          : (cfg.hardsubTextPrimary || '')
      ).trim();
      const hardsubTextSecondaryForSnapshot = (
        isMulti
          ? (cfg.hardsubTextsSecondaryByOrder?.[folderIdx] || '')
          : (cfg.hardsubTextSecondary || '')
      ).trim();
      const hardsubPortraitTextPrimaryForSnapshot = (
        cfg.hardsubPortraitTextPrimary
        || hardsubTextPrimaryForSnapshot
        || ''
      ).trim();
      const hardsubPortraitTextSecondaryForSnapshot = (
        cfg.hardsubPortraitTextSecondary
        || hardsubTextSecondaryForSnapshot
        || ''
      ).trim();
      return ({
      step2Split: {
        splitByLines: cfg.splitByLines,
        linesPerFile: cfg.linesPerFile,
        numberOfParts: cfg.numberOfParts,
      },
      step3Translate: {
        geminiModel: cfg.geminiModel,
        translateMethod: cfg.translateMethod || 'api',
      },
      step4Tts: {
        voice: cfg.voice,
        rate: cfg.rate,
        volume: cfg.volume,
        edgeOutputFormat: cfg.edgeOutputFormat,
        edgeTtsBatchSize: cfg.edgeTtsBatchSize,
        srtSpeed: cfg.srtSpeed,
        autoFitAudio: cfg.autoFitAudio,
      },
      step6Merge: {
        trimAudioEnabled: cfg.trimAudioEnabled,
        autoFitAudio: cfg.autoFitAudio,
        fitAudioWorkers: cfg.fitAudioWorkers,
      },
      step7Render: {
        fontSizeScaleVersion: cfg.fontSizeScaleVersion,
        subtitleFontSizeRel: cfg.subtitleFontSizeRel,
        renderMode: cfg.renderMode,
        renderResolution: cfg.renderResolution,
        renderContainer: cfg.renderContainer || 'mp4',
        hardwareAcceleration: cfg.hardwareAcceleration,
        renderAudioSpeed: cfg.renderAudioSpeed,
        videoVolume: cfg.videoVolume,
        audioVolume: cfg.audioVolume,
        coverMode: cfg.coverMode || 'blackout_bottom',
        coverQuad: cfg.coverQuad,
        coverFeatherPx: cfg.coverFeatherPx,
        coverFeatherHorizontalPx: cfg.coverFeatherHorizontalPx,
        coverFeatherVerticalPx: cfg.coverFeatherVerticalPx,
        coverFeatherHorizontalPercent: cfg.coverFeatherHorizontalPercent,
        coverFeatherVerticalPercent: cfg.coverFeatherVerticalPercent,
        style: cfg.style,
        thumbnailFrameTimeSec: cfg.thumbnailFrameTimeSec,
        thumbnailDurationSec: cfg.thumbnailDurationSec,
        thumbnailText: thumbnailTextForSnapshot,
        thumbnailTextSecondary: thumbnailTextSecondaryForSnapshot,
        thumbnailFontName: cfg.thumbnailFontName,
        thumbnailFontSize: cfg.thumbnailFontSize,
        thumbnailFontSizeRel: cfg.thumbnailFontSizeRel,
        thumbnailTextPrimaryFontName: cfg.thumbnailTextPrimaryFontName,
        thumbnailTextPrimaryFontSize: cfg.thumbnailTextPrimaryFontSize,
        thumbnailTextPrimaryFontSizeRel: cfg.thumbnailTextPrimaryFontSizeRel,
        thumbnailTextPrimaryColor: cfg.thumbnailTextPrimaryColor,
        thumbnailTextSecondaryFontName: cfg.thumbnailTextSecondaryFontName,
        thumbnailTextSecondaryFontSize: cfg.thumbnailTextSecondaryFontSize,
        thumbnailTextSecondaryFontSizeRel: cfg.thumbnailTextSecondaryFontSizeRel,
        thumbnailTextSecondaryColor: cfg.thumbnailTextSecondaryColor,
        thumbnailLineHeightRatio: cfg.thumbnailLineHeightRatio,
        thumbnailTextPrimaryPosition: cfg.thumbnailTextPrimaryPosition,
        thumbnailTextSecondaryPosition: cfg.thumbnailTextSecondaryPosition,
        hardsubTextPrimary: hardsubTextPrimaryForSnapshot,
        hardsubTextSecondary: hardsubTextSecondaryForSnapshot,
        hardsubTextsByOrder: cfg.hardsubTextsByOrder,
        hardsubTextsSecondaryByOrder: cfg.hardsubTextsSecondaryByOrder,
        hardsubTextPrimaryFontName: cfg.hardsubTextPrimaryFontName,
        hardsubTextPrimaryFontSize: cfg.hardsubTextPrimaryFontSize,
        hardsubTextPrimaryFontSizeRel: cfg.hardsubTextPrimaryFontSizeRel,
        hardsubTextPrimaryColor: cfg.hardsubTextPrimaryColor,
        hardsubTextSecondaryFontName: cfg.hardsubTextSecondaryFontName,
        hardsubTextSecondaryFontSize: cfg.hardsubTextSecondaryFontSize,
        hardsubTextSecondaryFontSizeRel: cfg.hardsubTextSecondaryFontSizeRel,
        hardsubTextSecondaryColor: cfg.hardsubTextSecondaryColor,
        hardsubTextPrimaryPosition: cfg.hardsubTextPrimaryPosition,
        hardsubTextSecondaryPosition: cfg.hardsubTextSecondaryPosition,
        hardsubPortraitTextPrimary: hardsubPortraitTextPrimaryForSnapshot,
        hardsubPortraitTextSecondary: hardsubPortraitTextSecondaryForSnapshot,
        hardsubPortraitTextPrimaryFontName: cfg.hardsubPortraitTextPrimaryFontName,
        hardsubPortraitTextPrimaryFontSize: cfg.hardsubPortraitTextPrimaryFontSize,
        hardsubPortraitTextPrimaryFontSizeRel: cfg.hardsubPortraitTextPrimaryFontSizeRel,
        hardsubPortraitTextPrimaryColor: cfg.hardsubPortraitTextPrimaryColor,
        hardsubPortraitTextSecondaryFontName: cfg.hardsubPortraitTextSecondaryFontName,
        hardsubPortraitTextSecondaryFontSize: cfg.hardsubPortraitTextSecondaryFontSize,
        hardsubPortraitTextSecondaryFontSizeRel: cfg.hardsubPortraitTextSecondaryFontSizeRel,
        hardsubPortraitTextSecondaryColor: cfg.hardsubPortraitTextSecondaryColor,
        hardsubPortraitTextPrimaryPosition: cfg.hardsubPortraitTextPrimaryPosition,
        hardsubPortraitTextSecondaryPosition: cfg.hardsubPortraitTextSecondaryPosition,
        portraitTextPrimaryFontName: cfg.portraitTextPrimaryFontName,
        portraitTextPrimaryFontSize: cfg.portraitTextPrimaryFontSize,
        portraitTextPrimaryFontSizeRel: cfg.portraitTextPrimaryFontSizeRel,
        portraitTextPrimaryColor: cfg.portraitTextPrimaryColor,
        portraitTextSecondaryFontName: cfg.portraitTextSecondaryFontName,
        portraitTextSecondaryFontSize: cfg.portraitTextSecondaryFontSize,
        portraitTextSecondaryFontSizeRel: cfg.portraitTextSecondaryFontSizeRel,
        portraitTextSecondaryColor: cfg.portraitTextSecondaryColor,
        portraitTextPrimaryPosition: cfg.portraitTextPrimaryPosition,
        portraitTextSecondaryPosition: cfg.portraitTextSecondaryPosition,
        portraitForegroundCropPercent: cfg.portraitForegroundCropPercent,
        logoPath: cfg.logoPath,
        logoPosition: cfg.logoPosition,
        logoScale: cfg.logoScale,
      },
      settingsRevision: cfg.settingsRevision,
      settingsUpdatedAt: cfg.settingsUpdatedAt,
      enabledSteps: steps,
      processingMode,
    });
    };

    const sharedPrimaryTextForProjectSettings = (cfg.hardsubTextPrimary || '').trim();
    const sharedSecondaryTextForProjectSettings = (cfg.hardsubTextSecondary || '').trim();

    const projectSettingsForRun: CaptionProjectSettingsValues = {
      fontSizeScaleVersion: cfg.fontSizeScaleVersion,
      subtitleFontSizeRel: cfg.subtitleFontSizeRel,
      inputType: inputType as 'srt' | 'draft',
      geminiModel: cfg.geminiModel,
      translateMethod: cfg.translateMethod,
      voice: cfg.voice,
      rate: cfg.rate,
      volume: cfg.volume,
      edgeOutputFormat: cfg.edgeOutputFormat,
        edgeTtsBatchSize: cfg.edgeTtsBatchSize,
        srtSpeed: cfg.srtSpeed,
      splitByLines: cfg.splitByLines,
      linesPerFile: cfg.linesPerFile,
      numberOfParts: cfg.numberOfParts,
      enabledSteps: steps,
      audioDir: cfg.audioDir,
      autoFitAudio: cfg.autoFitAudio,
      fitAudioWorkers: cfg.fitAudioWorkers,
      trimAudioEnabled: cfg.trimAudioEnabled,
      hardwareAcceleration: cfg.hardwareAcceleration,
      style: cfg.style,
      renderMode: cfg.renderMode,
      renderResolution: cfg.renderResolution,
      renderContainer: cfg.renderContainer || 'mp4',
      blackoutTop: cfg.blackoutTop,
      coverMode: cfg.coverMode || 'blackout_bottom',
      coverQuad: cfg.coverQuad,
      ...(cfg.coverFeatherPx != null ? { coverFeatherPx: cfg.coverFeatherPx } : {}),
      ...(cfg.coverFeatherHorizontalPx != null ? { coverFeatherHorizontalPx: cfg.coverFeatherHorizontalPx } : {}),
      ...(cfg.coverFeatherVerticalPx != null ? { coverFeatherVerticalPx: cfg.coverFeatherVerticalPx } : {}),
      ...(cfg.coverFeatherHorizontalPercent != null ? { coverFeatherHorizontalPercent: cfg.coverFeatherHorizontalPercent } : {}),
      ...(cfg.coverFeatherVerticalPercent != null ? { coverFeatherVerticalPercent: cfg.coverFeatherVerticalPercent } : {}),
      audioSpeed: cfg.audioSpeed,
      renderAudioSpeed: cfg.renderAudioSpeed,
      videoVolume: cfg.videoVolume,
      audioVolume: cfg.audioVolume,
      thumbnailFontName: cfg.thumbnailFontName,
      thumbnailFontSize: cfg.thumbnailFontSize,
      thumbnailFontSizeRel: cfg.thumbnailFontSizeRel,
      thumbnailTextPrimaryFontName: cfg.thumbnailTextPrimaryFontName,
      thumbnailTextPrimaryFontSize: cfg.thumbnailTextPrimaryFontSize,
      thumbnailTextPrimaryFontSizeRel: cfg.thumbnailTextPrimaryFontSizeRel,
      thumbnailTextPrimaryColor: cfg.thumbnailTextPrimaryColor,
      thumbnailTextSecondaryFontName: cfg.thumbnailTextSecondaryFontName,
      thumbnailTextSecondaryFontSize: cfg.thumbnailTextSecondaryFontSize,
      thumbnailTextSecondaryFontSizeRel: cfg.thumbnailTextSecondaryFontSizeRel,
      thumbnailTextSecondaryColor: cfg.thumbnailTextSecondaryColor,
      thumbnailLineHeightRatio: cfg.thumbnailLineHeightRatio,
      thumbnailTextSecondary: cfg.thumbnailTextSecondary,
      thumbnailTextPrimaryPosition: cfg.thumbnailTextPrimaryPosition,
      thumbnailTextSecondaryPosition: cfg.thumbnailTextSecondaryPosition,
      hardsubTextPrimary: sharedPrimaryTextForProjectSettings,
      hardsubTextSecondary: sharedSecondaryTextForProjectSettings,
      hardsubTextsByOrder: cfg.hardsubTextsByOrder,
      hardsubTextsSecondaryByOrder: cfg.hardsubTextsSecondaryByOrder,
      hardsubTextPrimaryFontName: cfg.hardsubTextPrimaryFontName,
      hardsubTextPrimaryFontSize: cfg.hardsubTextPrimaryFontSize,
      hardsubTextPrimaryFontSizeRel: cfg.hardsubTextPrimaryFontSizeRel,
      hardsubTextPrimaryColor: cfg.hardsubTextPrimaryColor,
      hardsubTextSecondaryFontName: cfg.hardsubTextSecondaryFontName,
      hardsubTextSecondaryFontSize: cfg.hardsubTextSecondaryFontSize,
      hardsubTextSecondaryFontSizeRel: cfg.hardsubTextSecondaryFontSizeRel,
      hardsubTextSecondaryColor: cfg.hardsubTextSecondaryColor,
      hardsubTextPrimaryPosition: cfg.hardsubTextPrimaryPosition,
      hardsubTextSecondaryPosition: cfg.hardsubTextSecondaryPosition,
      hardsubPortraitTextPrimary: cfg.hardsubPortraitTextPrimary,
      hardsubPortraitTextSecondary: cfg.hardsubPortraitTextSecondary,
      hardsubPortraitTextPrimaryFontName: cfg.hardsubPortraitTextPrimaryFontName,
      hardsubPortraitTextPrimaryFontSize: cfg.hardsubPortraitTextPrimaryFontSize,
      hardsubPortraitTextPrimaryFontSizeRel: cfg.hardsubPortraitTextPrimaryFontSizeRel,
      hardsubPortraitTextPrimaryColor: cfg.hardsubPortraitTextPrimaryColor,
      hardsubPortraitTextSecondaryFontName: cfg.hardsubPortraitTextSecondaryFontName,
      hardsubPortraitTextSecondaryFontSize: cfg.hardsubPortraitTextSecondaryFontSize,
      hardsubPortraitTextSecondaryFontSizeRel: cfg.hardsubPortraitTextSecondaryFontSizeRel,
      hardsubPortraitTextSecondaryColor: cfg.hardsubPortraitTextSecondaryColor,
      hardsubPortraitTextPrimaryPosition: cfg.hardsubPortraitTextPrimaryPosition,
      hardsubPortraitTextSecondaryPosition: cfg.hardsubPortraitTextSecondaryPosition,
      portraitTextPrimaryFontName: cfg.portraitTextPrimaryFontName,
      portraitTextPrimaryFontSize: cfg.portraitTextPrimaryFontSize,
      portraitTextPrimaryFontSizeRel: cfg.portraitTextPrimaryFontSizeRel,
      portraitTextPrimaryColor: cfg.portraitTextPrimaryColor,
      portraitTextSecondaryFontName: cfg.portraitTextSecondaryFontName,
      portraitTextSecondaryFontSize: cfg.portraitTextSecondaryFontSize,
      portraitTextSecondaryFontSizeRel: cfg.portraitTextSecondaryFontSizeRel,
      portraitTextSecondaryColor: cfg.portraitTextSecondaryColor,
      portraitTextPrimaryPosition: cfg.portraitTextPrimaryPosition,
      portraitTextSecondaryPosition: cfg.portraitTextSecondaryPosition,
      thumbnailTextSecondaryByOrder: cfg.thumbnailTextsSecondaryByOrder,
      subtitlePosition: cfg.subtitlePosition,
      thumbnailFrameTimeSec: cfg.thumbnailFrameTimeSec,
      thumbnailDurationSec: cfg.thumbnailDurationSec,
      layoutProfiles: cfg.layoutProfiles,
      portraitForegroundCropPercent: cfg.portraitForegroundCropPercent,
      processingMode: cfg.processingMode,
    };

    const updateSessionForStep = async (
      currentPath: string,
      step: Step,
      folderIdx: number,
      updater: (session: CaptionSessionV1) => CaptionSessionV1
    ) => {
      const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
      const folderPath = resolveFolderPath(currentPath);
      const sourcePath = resolveSourcePath(currentPath);
      await updateCaptionSession(
        sessionPath,
        (session) => updater({
          ...session,
          updatedAt: nowIso(),
          projectContext: {
            ...session.projectContext,
            projectId: projectId || null,
            inputType: inputType as 'srt' | 'draft',
            sourcePath,
            folderPath,
          },
          runtime: {
            ...session.runtime,
            runState: 'running',
            enabledSteps: steps,
            processingMode,
            currentStep: step,
            progress,
          },
          settings: {
            ...session.settings,
            ...buildSettingsSnapshot(folderIdx),
          },
        }),
        getSessionFallback(currentPath)
      );
    };

    // =========================================================
    // Helper: xử lý 1 step cho 1 folder
    // =========================================================
    const processStep = async (step: Step, currentPath: string, folderIdx: number): Promise<void> => {
      const ctx = folderCtxMap.get(currentPath)!;
      const { name: folderName, outputDir: processOutputDir } = ctx;
      let { entries: currentEntries, audioFiles: currentAudioFiles, srtFileForVideo } = ctx;
      const stepKey = toStepKey(step);
      let previousStepStateBeforeRun: CaptionSessionV1['steps'][typeof stepKey] | undefined;

      const msgCtx = (base: string) => {
        if (!isMulti) return base;
        if (processingMode === 'step-first') {
          return `Bước ${step} [${folderIdx + 1}/${totalFolders}] ${folderName}: ${base}`;
        }
        return `[${folderIdx + 1}/${totalFolders}] ${folderName}: ${base}`;
      };

      if (abortRef.current) {
        throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
      }

      try {
        const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        const sessionFallback = getSessionFallback(currentPath);
        const sessionBeforeStep = await readCaptionSession(sessionPath, sessionFallback);
        previousStepStateBeforeRun = sessionBeforeStep.steps[stepKey];
        // Truyền context các steps đang chạy để guard nhất quán với preflight check
        const guard = canRunStep(sessionBeforeStep, step as CaptionStepNumber, steps as CaptionStepNumber[]);
        if (!guard.ok) {
          throw new Error(`[${folderName}] ${guard.reason || `Chưa chạy các bước phụ thuộc cho Step ${step}.`} (${guard.code || 'STEP_BLOCKED'})`);
        }
        const stepInputs = resolveStepInputsFromSession(sessionBeforeStep, step as CaptionStepNumber);
        const hydrateStepInputContext = () => {
          if (step === 2 || step === 3) {
            currentEntries = compactEntries(stepInputs.extractedEntries);
          } else if (step === 4 || step === 6 || step === 7) {
            currentEntries = compactEntries(stepInputs.translatedEntries);
          }
          if (step >= 4 && step <= 6) {
            currentAudioFiles = normalizeAudioFiles(stepInputs.ttsAudioFiles as PartialProcessingAudioFile[]);
          }
          if (step === 7) {
            srtFileForVideo = stepInputs.scaledSrtPath || stepInputs.translatedSrtPath || '';
          }
        };
        const hydrateStepOutputContext = () => {
          if (step === 1 || step === 2) {
            currentEntries = compactEntries(stepInputs.extractedEntries);
          } else if (step >= 3) {
            currentEntries = compactEntries(stepInputs.translatedEntries);
          }
          if (step >= 4 && step <= 6) {
            currentAudioFiles = normalizeAudioFiles(stepInputs.ttsAudioFiles as PartialProcessingAudioFile[]);
          }
          if (step === 7) {
            srtFileForVideo = stepInputs.scaledSrtPath || stepInputs.translatedSrtPath || '';
          }
        };
        hydrateStepInputContext();
        if (!isMulti && currentEntries.length > 0) {
          setEntries(currentEntries);
        }
        if (!isMulti && step >= 4 && step <= 6 && currentAudioFiles.length > 0) {
          setAudioFiles(currentAudioFiles);
        }

        let currentDataSource = 'session';
        if (step === 2 || step === 3) currentDataSource = 'session_extracted_entries';
        if (step === 4) currentDataSource = 'session_translated_entries';
        if (step === 6) currentDataSource = 'session_tts_audio_files';
        if (step === 7) currentDataSource = 'session_translated_entries+session_merged_audio';

        const currentSrtSpeed = cfg.srtSpeed > 0 ? cfg.srtSpeed : 1.0;
        const skipDecision = shouldSkipStep(sessionBeforeStep, step as CaptionStepNumber, {
          currentSrtSpeed,
          currentTrimAudioEnabled: !!cfg.trimAudioEnabled,
          currentAutoFitAudio: !!cfg.autoFitAudio,
          currentEdgeOutputFormat: cfg.edgeOutputFormat === 'mp3' ? 'mp3' : 'wav',
        });
        if (step === 6 && skipDecision.reason === 'srt_scale_changed') {
          await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
            ...session,
            steps: {
              ...session.steps,
              [stepKey]: {
                ...session.steps[stepKey],
                status: 'stale',
                error: undefined,
                metrics: undefined,
                blockedReason: 'srt_scale_changed',
              },
            },
          }));
        }
        if (step === 4 && skipDecision.reason === 'tts_output_format_changed') {
          await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
            ...session,
            steps: {
              ...session.steps,
              [stepKey]: {
                ...session.steps[stepKey],
                status: 'stale',
                error: undefined,
                metrics: undefined,
                blockedReason: 'tts_output_format_changed',
              },
            },
          }));
        }
        if (skipDecision.skip) {
          hydrateStepOutputContext();
          const skipReason = skipDecision.reason || 'session_output_ready';
          const skipMessage = msgCtx(`Bước ${step}: Skip (${skipReason})`);
          setProgress({ current: 1, total: 1, message: skipMessage });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
            ...session,
            data: step === 7
              ? {
                  ...session.data,
                  step7SubtitleSource: 'session_translated_entries',
                  step7AudioSource: 'session_merged_audio',
                }
              : session.data,
            runtime: {
              ...session.runtime,
              currentDataSource,
              lastMessage: skipMessage,
              lastGuardError: undefined,
            },
            steps: {
              ...session.steps,
              [stepKey]: recordStepSkipped(session.steps[stepKey], skipReason),
            },
          }));
          if (!isMulti && currentEntries.length > 0) {
            setEntries(currentEntries);
          }
          if (!isMulti && step >= 4 && step <= 6 && currentAudioFiles.length > 0) {
            setAudioFiles(currentAudioFiles);
          }
          ctx.entries = currentEntries;
          ctx.audioFiles = currentAudioFiles;
          ctx.srtFileForVideo = srtFileForVideo;
          return;
        }

        setProgress({ current: 0, total: 100, message: msgCtx(`Bước ${step}: Bắt đầu...`) });
        await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
          ...session,
          runtime: {
            ...session.runtime,
            currentDataSource,
            lastGuardError: undefined,
          },
          steps: {
            ...session.steps,
            [stepKey]: makeStepRunning(session.steps[stepKey], buildSettingsSnapshot(folderIdx)),
          },
        }));

      // ========== STEP 1: INPUT ==========
      if (step === 1) {
        if (currentEntries.length === 0 && currentPath) {
          const sourcePath = resolveSourcePath(currentPath);
          if (inputType === 'srt' && !sourcePath) {
            throw new Error(`[${folderName}] Thiếu file SRT cho folder.`);
          }
          const parseResult = inputType === 'srt'
            // @ts-ignore
            ? await window.electronAPI.caption.parseSrt(sourcePath)
            // @ts-ignore
            : await window.electronAPI.caption.parseDraft(`${currentPath}/draft_content.json`);

          if (parseResult.success && parseResult.data) {
            currentEntries = parseResult.data.entries;
            if (!isMulti) setEntries(currentEntries);
          } else {
            throw new Error(`[${folderName}] Lỗi đọc file draft/srt: ${parseResult.error || 'missing_srt'}`);
          }
        }
        setProgress({ current: 1, total: 1, message: msgCtx('Bước 1: Đã load file input') });
        await updateSessionForStep(currentPath, step, folderIdx, (session) => {
          const extractedEntries = compactEntries(currentEntries);
          const stepArtifacts: CaptionArtifactFile[] = [];
          if (inputType === 'draft') {
            pushArtifact(stepArtifacts, 'draft_folder', currentPath, 'dir');
            pushArtifact(stepArtifacts, 'draft_content_json', `${currentPath}/draft_content.json`, 'file');
          } else {
            const sourcePath = resolveSourcePath(currentPath);
            pushArtifact(stepArtifacts, 'source_srt', sourcePath, 'file');
          }
          const outputFingerprint = buildEntriesFingerprint(extractedEntries);
          const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
          let nextSession: CaptionSessionV1 = {
            ...session,
            data: {
              ...session.data,
              extractedEntries,
            },
            steps: {
              ...session.steps,
              [stepKey]: {
                ...makeStepSuccess(session.steps[stepKey], {
                  totalEntries: currentEntries.length,
                }),
                outputFingerprint,
                inputFingerprint: buildObjectFingerprint({
                  currentPath,
                  inputType,
                }),
                dependsOn: [],
              },
            },
          };
          nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
          if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
            nextSession = markFollowingStepsStale(
              nextSession,
              step,
              'STEP1_OUTPUT_CHANGED',
              steps as CaptionStepNumber[]
            );
          }
          return nextSession;
        });
      }

      // ========== STEP 2: SPLIT ==========
      if (step === 2) {
        if (currentEntries.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu Step 1 trong caption_session.json. Hãy chạy Step 1 trước.`);
        }
        setProgress({ current: 0, total: 1, message: msgCtx('Bước 2: Đang chia nhỏ text...') });
        const textOutputDir = `${processOutputDir}/text`;
        const splitValue = cfg.splitByLines ? cfg.linesPerFile : cfg.numberOfParts;
        // @ts-ignore
        const result = await window.electronAPI.caption.split({
          entries: currentEntries,
          splitByLines: cfg.splitByLines,
          value: splitValue,
          outputDir: textOutputDir,
        });
        if (result.success && result.data) {
          const splitData = result.data;
          const splitFiles = Array.isArray(splitData.files) ? splitData.files : [];
          const step2BatchPlan = cfg.splitByLines
            ? buildChunkBatchPlan(currentEntries.length, splitValue, splitFiles)
            : buildPartCountBatchPlan(currentEntries.length, splitValue, splitFiles);
          const step2BatchPlanFingerprint = buildObjectFingerprint(step2BatchPlan);
          setProgress({ current: 1, total: 1, message: msgCtx(`Bước 2: Đã tạo ${splitData.partsCount} phần`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const stepArtifacts: CaptionArtifactFile[] = [];
            pushArtifact(stepArtifacts, 'split_output_dir', textOutputDir, 'dir');
            for (const file of splitFiles) {
              pushArtifact(stepArtifacts, 'split_part', file, 'file');
            }
            const previousPlanFingerprint = typeof session.data.step2BatchPlanFingerprint === 'string'
              ? session.data.step2BatchPlanFingerprint
              : null;
            const planChanged = !!previousPlanFingerprint && previousPlanFingerprint !== step2BatchPlanFingerprint;
            const outputFingerprint = buildObjectFingerprint({
              partsCount: splitData.partsCount,
              files: splitFiles,
              step2BatchPlan,
            });
            const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
            const outputChanged = !!prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint;
            const shouldResetStep3State = planChanged || outputChanged;
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                step2BatchPlan,
                step2BatchPlanFingerprint,
                step3BatchState: shouldResetStep3State ? undefined : session.data.step3BatchState,
              },
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    partsCount: splitData.partsCount,
                    files: splitFiles,
                    batchPlanCount: step2BatchPlan.length,
                  }),
                  inputFingerprint: buildEntriesFingerprint((session.data.extractedEntries || []) as SubtitleEntry[]),
                  outputFingerprint,
                  dependsOn: [1],
                },
              },
            };
            nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
            if (planChanged) {
              nextSession = markFollowingStepsStale(
                nextSession,
                step,
                'STEP2_BATCH_PLAN_CHANGED',
                steps as CaptionStepNumber[]
              );
            } else if (outputChanged) {
              nextSession = markFollowingStepsStale(
                nextSession,
                step,
                'STEP2_OUTPUT_CHANGED',
                steps as CaptionStepNumber[]
              );
            }
            return nextSession;
          });
        } else {
          throw new Error(`[${folderName}] Lỗi chia file: ${result.error}`);
        }
      }

      // ========== STEP 3: DỊCH ==========
      if (step === 3) {
        if (currentEntries.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu Step 1 trong caption_session.json. Hãy chạy Step 1 trước.`);
        }
        const sessionStep2BatchPlan = Array.isArray(sessionBeforeStep.data.step2BatchPlan)
          ? (sessionBeforeStep.data.step2BatchPlan as StepBatchPlanItem[])
          : [];
        if (sessionStep2BatchPlan.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu Step 2 trong caption_session.json. Hãy chạy Step 2 trước.`);
        }
        const step3BatchPlan: StepBatchPlanItem[] = sessionStep2BatchPlan;
        const totalBatches = step3BatchPlan.length;
        const linesPerBatch = typeof step3BatchPlan[0]?.lineCount === 'number'
          ? Math.max(1, Math.floor(step3BatchPlan[0].lineCount))
          : Math.max(1, Math.ceil(currentEntries.length / totalBatches));
        const previousTranslatedEntries = Array.isArray(sessionBeforeStep.data.translatedEntries)
          ? compactEntries(sessionBeforeStep.data.translatedEntries as SubtitleEntry[])
          : [];
        let liveTranslatedEntries = (
          previousTranslatedEntries.length === currentEntries.length
            ? normalizeEntriesForSession(previousTranslatedEntries)
            : normalizeEntriesForSession(compactEntries(currentEntries))
        );
        const planFingerprint = typeof sessionBeforeStep.data.step2BatchPlanFingerprint === 'string'
          ? sessionBeforeStep.data.step2BatchPlanFingerprint
          : buildObjectFingerprint(step3BatchPlan);
        const previousStep3BatchStateRaw = toRecord(sessionBeforeStep.data.step3BatchState);
        const previousPlanFingerprint = typeof previousStep3BatchStateRaw?.planFingerprint === 'string'
          ? String(previousStep3BatchStateRaw.planFingerprint)
          : null;
        const shouldResetBatchState = !!previousPlanFingerprint && previousPlanFingerprint !== planFingerprint;
        const previousStep3BatchState = shouldResetBatchState ? {} : previousStep3BatchStateRaw;
        const previousMissingBatchIndexes = Array.isArray(previousStep3BatchState.missingBatchIndexes)
          ? previousStep3BatchState.missingBatchIndexes
              .map((value) => Math.floor(Number(value)))
              .filter((value) => Number.isFinite(value) && value >= 1 && value <= totalBatches)
          : [];
        const previousMissingBatchIndexSet = new Set<number>(previousMissingBatchIndexes);
        const previousReportsByIndex = new Map<number, SharedTranslationBatchReport>();
        if (Array.isArray(previousStep3BatchState.batches)) {
          for (const report of previousStep3BatchState.batches as SharedTranslationBatchReport[]) {
            if (!report || typeof report.batchIndex !== 'number') {
              continue;
            }
            const safeBatchIndex = Math.floor(report.batchIndex);
            if (safeBatchIndex < 1 || safeBatchIndex > totalBatches) {
              continue;
            }
            previousReportsByIndex.set(safeBatchIndex, { ...report, batchIndex: safeBatchIndex });
          }
        }

        const retryBatchIndexSet = new Set<number>();
        const placeholderBatchIndexes = new Set<number>();
        const batchReportsMap = new Map<number, SharedTranslationBatchReport>();

        for (const batchPlan of step3BatchPlan) {
          const batchIndex = batchPlan.batchIndex;
          const report = previousReportsByIndex.get(batchIndex);
          const missingInfo = collectBatchMissingInfo(liveTranslatedEntries, batchPlan);
          const hasMissingText = missingInfo.missingLinesInBatch.length > 0;
          const hasReport = !!report;
          const markedMissing = previousMissingBatchIndexSet.has(batchIndex);

          let needsRetry = markedMissing || !hasReport || report?.status === 'failed' || hasMissingText;
          if (report?.status === 'success' && !hasMissingText) {
            needsRetry = false;
          }

          if (needsRetry) {
            retryBatchIndexSet.add(batchIndex);
            let retryReason = 'RETRY_REQUIRED';
            if (!hasReport) retryReason = 'NO_BATCH_REPORT';
            else if (report?.status === 'failed') retryReason = report.error || 'BATCH_FAILED';
            else if (hasMissingText) retryReason = 'MISSING_TRANSLATED_LINES';
            else if (markedMissing) retryReason = 'MISSING_BATCH_STATE';

            batchReportsMap.set(
              batchIndex,
              buildFailedBatchReportFromEntries(batchPlan, liveTranslatedEntries, retryReason, report?.attempts || 1)
            );
            if (!hasReport) {
              placeholderBatchIndexes.add(batchIndex);
            }
          } else if (report) {
            batchReportsMap.set(batchIndex, report);
          }
        }

        const retryBatchIndexes = Array.from(retryBatchIndexSet).sort((a, b) => a - b);
        const isStep3RetryMode = retryBatchIndexes.length > 0;
        const scheduledBatchIndexes = isStep3RetryMode ? retryBatchIndexes : [];
        let step3PersistQueue: Promise<void> = Promise.resolve();

        setProgress({
          current: 0,
          total: currentEntries.length,
          message: isStep3RetryMode
            ? msgCtx(`Bước 3: Dịch lại batch lỗi ${retryBatchIndexes.map((idx) => `#${idx}`).join(', ')}...`)
            : msgCtx('Bước 3: Không có batch cần dịch lại, dùng lại bản dịch hiện tại.'),
        });
        await updateSessionForStep(currentPath, step, folderIdx, (session) => {
          const initialBatchReports = Array.from(batchReportsMap.values()).sort((a, b) => a.batchIndex - b.batchIndex);
          return {
            ...session,
            data: {
              ...session.data,
              step2BatchPlan: step3BatchPlan,
              translatedEntries: liveTranslatedEntries,
              translatedSrtContent: entriesToSrtText(liveTranslatedEntries),
              step3BatchState: {
                ...buildStep3BatchState(totalBatches, initialBatchReports),
                planFingerprint,
              },
            },
            runtime: {
              ...session.runtime,
              lastMessage: isStep3RetryMode
                ? msgCtx(`Bước 3: Khởi tạo resume cho batch lỗi ${retryBatchIndexes.map((idx) => `#${idx}`).join(', ')}`)
                : msgCtx('Bước 3: Khởi tạo trạng thái batch...'),
            },
          };
        });

        translateBatchProgressHandlerRef.current = async (progressEvent: TranslationProgress) => {
          if (abortRef.current) {
            return;
          }
          step3PersistQueue = step3PersistQueue
            .catch(() => undefined)
            .then(async () => {
              const eventType = progressEvent.eventType;
              const isBatchEvent = eventType === 'batch_started'
                || eventType === 'batch_retry'
                || eventType === 'batch_completed'
                || eventType === 'batch_failed';
              if (!isBatchEvent) {
                return;
              }
              if (progressEvent.translatedChunk) {
                liveTranslatedEntries = mergeTranslatedChunkIntoEntries(liveTranslatedEntries, progressEvent.translatedChunk);
              }
              const batchIndexFromProgress = typeof progressEvent.batchReport?.batchIndex === 'number'
                ? Math.floor(progressEvent.batchReport.batchIndex)
                : (typeof progressEvent.batchIndex === 'number' ? Math.floor(progressEvent.batchIndex) + 1 : null);
              const incomingBatchReport = progressEvent.batchReport
                ? ({ ...progressEvent.batchReport } as SharedTranslationBatchReport)
                : deriveBatchReportFromProgress(progressEvent);
              const effectiveBatchIndex = incomingBatchReport?.batchIndex ?? batchIndexFromProgress;
              if (effectiveBatchIndex != null && effectiveBatchIndex > 0) {
                const existing = batchReportsMap.get(effectiveBatchIndex);
                if (!incomingBatchReport && !existing && (eventType === 'batch_started' || eventType === 'batch_retry')) {
                  return;
                }
                placeholderBatchIndexes.delete(effectiveBatchIndex);
                const plan = step3BatchPlan.find(p => p.batchIndex === effectiveBatchIndex);
                const baseReport: Partial<SharedTranslationBatchReport> = plan
                  ? {
                      batchIndex: plan.batchIndex,
                      startIndex: plan.startIndex,
                      endIndex: plan.endIndex,
                      expectedLines: plan.lineCount,
                      translatedLines: 0,
                      missingLinesInBatch: [],
                      missingGlobalLineIndexes: [],
                      attempts: 0,
                      status: existing?.status ?? (incomingBatchReport?.status ?? 'failed'),
                    }
                  : {};
                const merged: SharedTranslationBatchReport = {
                  ...(baseReport as SharedTranslationBatchReport),
                  ...(existing || {}),
                  ...(incomingBatchReport || {}),
                  error: incomingBatchReport?.error ?? existing?.error,
                  status: incomingBatchReport?.status ?? existing?.status ?? 'failed',
                  attempts: typeof incomingBatchReport?.attempts === 'number'
                    ? incomingBatchReport.attempts
                    : (existing?.attempts ?? 0),
                  startedAt: incomingBatchReport?.startedAt ?? (typeof progressEvent.startedAt === 'number' ? progressEvent.startedAt : existing?.startedAt),
                  endedAt: incomingBatchReport?.endedAt ?? (typeof progressEvent.endedAt === 'number' ? progressEvent.endedAt : existing?.endedAt),
                  durationMs: incomingBatchReport?.durationMs ?? existing?.durationMs,
                  transport: incomingBatchReport?.transport ?? progressEvent.transport ?? existing?.transport,
                  resourceId: incomingBatchReport?.resourceId ?? progressEvent.resourceId ?? existing?.resourceId,
                  resourceLabel: incomingBatchReport?.resourceLabel ?? progressEvent.resourceLabel ?? existing?.resourceLabel,
                  queueRuntimeKey: incomingBatchReport?.queueRuntimeKey ?? progressEvent.queueRuntimeKey ?? existing?.queueRuntimeKey,
                  queuePacingMode: incomingBatchReport?.queuePacingMode ?? progressEvent.queuePacingMode ?? existing?.queuePacingMode,
                  queueGapMs: incomingBatchReport?.queueGapMs ?? progressEvent.queueGapMs ?? existing?.queueGapMs,
                  nextAllowedAt: incomingBatchReport?.nextAllowedAt ?? progressEvent.nextAllowedAt ?? existing?.nextAllowedAt,
                };
                if (typeof merged.durationMs !== 'number') {
                  const startedAt = typeof merged.startedAt === 'number' ? merged.startedAt : undefined;
                  const endedAt = typeof merged.endedAt === 'number' ? merged.endedAt : undefined;
                  if (startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt) {
                    merged.durationMs = endedAt - startedAt;
                  }
                }
                batchReportsMap.set(effectiveBatchIndex, merged);
              }
              const isGrokUi = (progressEvent.transport || cfg.translateMethod) === 'grok_ui';
              if (isGrokUi) {
                const chunkStart = progressEvent.translatedChunk?.startIndex ?? -1;
                const chunkLines = Array.isArray(progressEvent.translatedChunk?.texts)
                  ? progressEvent.translatedChunk?.texts.length
                  : 0;
                const reportStart = typeof incomingBatchReport?.startIndex === 'number'
                  ? incomingBatchReport.startIndex
                  : -1;
                const safeProgressBatchIndex = typeof progressEvent.batchIndex === 'number'
                  ? progressEvent.batchIndex
                  : null;
                console.log(
                  `[CaptionProcessing][GrokUI][Debug] progress batchIndex=${safeProgressBatchIndex ?? 'n/a'} reportBatch=${incomingBatchReport?.batchIndex ?? 'n/a'} reportStart=${reportStart} chunkStart=${chunkStart} lines=${chunkLines}`
                );
              }
              const batchReports = Array.from(batchReportsMap.values()).sort((a, b) => a.batchIndex - b.batchIndex);
              const step3BatchState = buildStep3BatchState(totalBatches, batchReports);
              const translatedSnapshot = normalizeEntriesForSession(compactEntries(liveTranslatedEntries));
              const translatedSrtContent = entriesToSrtText(translatedSnapshot);
              await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
                ...session,
                data: {
                  ...session.data,
                  translatedEntries: translatedSnapshot,
                  translatedSrtContent,
                  step3BatchState: {
                    ...step3BatchState,
                    planFingerprint,
                  },
                },
                runtime: {
                  ...session.runtime,
                  lastMessage: msgCtx(progressEvent.message || `Bước 3: Cập nhật batch #${incomingBatchReport?.batchIndex || '?'}`),
                },
              }));
              if (progressEvent.eventType === 'batch_completed' || progressEvent.eventType === 'batch_failed') {
                const shouldAck = isGrokUi;
                if (!shouldAck) {
                  return;
                }
                const safeProgressBatchIndex = typeof progressEvent.batchIndex === 'number'
                  ? progressEvent.batchIndex
                  : null;
                const ackBatchIndex = incomingBatchReport?.batchIndex ?? (safeProgressBatchIndex != null ? safeProgressBatchIndex + 1 : null);
                if (ackBatchIndex == null) {
                  console.warn('[CaptionProcessing][GrokUI] Bỏ qua ACK vì thiếu batchIndex.');
                  return;
                }
                const ackRunId = progressEvent.runId || runIdRef.current || undefined;
                try {
                  const ackResult = await window.electronAPI.caption.ackTranslateProgress({
                    runId: ackRunId,
                    batchIndex: ackBatchIndex,
                    eventType: progressEvent.eventType,
                  });
                  if (!ackResult?.success) {
                    console.warn('[CaptionProcessing][GrokUI] ACK thất bại:', ackResult?.error || 'UNKNOWN_ERROR');
                  } else {
                    console.log(
                      `[CaptionProcessing][GrokUI] Đã gửi ACK (batch=${ackBatchIndex}, event=${progressEvent.eventType})`
                    );
                  }
                } catch (error) {
                  console.warn('[CaptionProcessing] Không thể ACK translate progress:', error);
                }
              }
            });
          await step3PersistQueue;
        };

        let result: any;
        if (isStep3RetryMode) {
          try {
            // @ts-ignore
            result = await window.electronAPI.caption.translate({
              entries: liveTranslatedEntries,
              targetLanguage: 'Vietnamese',
              model: cfg.geminiModel,
              linesPerBatch,
              translateMethod: cfg.translateMethod,
              retryBatchIndexes,
              projectId: projectId || undefined,
              sourcePath: resolveSourcePath(currentPath),
              runId: runIdRef.current || undefined,
            });
          } catch (error) {
            const stopSignal = isProcessStopSignal(error)
              || (typeof error === 'string' && error.includes(CAPTION_PROCESS_STOP_SIGNAL))
              || (error instanceof Error && error.message.includes(CAPTION_PROCESS_STOP_SIGNAL));
            if (stopSignal) {
              abortRef.current = true;
              result = {
                success: false,
                error: CAPTION_PROCESS_STOP_SIGNAL,
                data: {
                  entries: liveTranslatedEntries,
                  batchReports: Array.from(batchReportsMap.values()),
                  missingBatchIndexes: [],
                  missingGlobalLineIndexes: [],
                },
              };
            } else {
              throw error;
            }
          } finally {
            translateBatchProgressHandlerRef.current = null;
          }
        } else {
          translateBatchProgressHandlerRef.current = null;
          result = {
            success: true,
            data: {
              entries: liveTranslatedEntries,
              batchReports: Array.from(batchReportsMap.values()),
              missingBatchIndexes: [],
              missingGlobalLineIndexes: [],
            },
          };
        }
        await step3PersistQueue;

        if (!result?.success && typeof result?.error === 'string' && result.error.includes('TRANSLATION_ALREADY_RUNNING')) {
          throw new Error('Đang có phiên dịch đang chạy, vui lòng đợi dừng hoàn tất.');
        }

        const stopSignalDetected = typeof result?.error === 'string'
          && result.error.includes(CAPTION_PROCESS_STOP_SIGNAL);
        if (stopSignalDetected) {
          abortRef.current = true;
        }

        const backendCallSucceeded = result?.success === true;
        const backendErrorRaw = typeof result?.error === 'string' && result.error.trim().length > 0
          ? result.error.trim()
          : 'TRANSLATE_CALL_FAILED';
        const backendErrorMessage = normalizeStep3BackendErrorMessage(backendErrorRaw);
        const backendErrorCode = extractStep3BackendErrorCode(backendErrorRaw);
        const translateData = (result?.data && typeof result.data === 'object')
          ? (result.data as Record<string, unknown>)
          : {};

        if (Array.isArray(translateData.entries) && translateData.entries.length === currentEntries.length) {
          liveTranslatedEntries = normalizeEntriesForSession(compactEntries(translateData.entries as SubtitleEntry[]));
        }

        const backendReports = Array.isArray(translateData.batchReports)
          ? (translateData.batchReports as SharedTranslationBatchReport[])
          : [];
        for (const report of backendReports) {
          if (!report || typeof report.batchIndex !== 'number') {
            continue;
          }
          batchReportsMap.set(report.batchIndex, report);
          placeholderBatchIndexes.delete(report.batchIndex);
        }

        const isStoppedByUser = abortRef.current
          || (typeof result?.error === 'string' && result.error.includes(CAPTION_PROCESS_STOP_SIGNAL));
        const fallbackFailureReason = backendCallSucceeded
          ? 'MISSING_BATCH_REPORT'
          : `TRANSLATE_CALL_FAILED: ${backendErrorRaw}`;
        const postTranslateEntries = normalizeEntriesForSession(compactEntries(liveTranslatedEntries));
        const finalBatchReports: SharedTranslationBatchReport[] = [];
        for (const batchPlan of step3BatchPlan) {
          const report = batchReportsMap.get(batchPlan.batchIndex);
          const isPlaceholder = placeholderBatchIndexes.has(batchPlan.batchIndex);
          if (isStoppedByUser && isPlaceholder) {
            continue;
          }
          const missingInfo = collectBatchMissingInfo(postTranslateEntries, batchPlan);
          const hasMissingText = missingInfo.missingLinesInBatch.length > 0;

          if (!report) {
            if (!isStoppedByUser) {
              finalBatchReports.push(
                buildFailedBatchReportFromEntries(batchPlan, postTranslateEntries, fallbackFailureReason)
              );
            }
            continue;
          }

          if (!isStoppedByUser && report.status === 'success' && hasMissingText) {
            finalBatchReports.push(
              buildFailedBatchReportFromEntries(batchPlan, postTranslateEntries, 'MISSING_TRANSLATED_LINES', report.attempts || 1)
            );
            continue;
          }

          if (report.status === 'failed') {
            const errorReason = (typeof report.error === 'string' && report.error.trim().length > 0)
              ? report.error
              : (fallbackFailureReason || 'BATCH_FAILED');
            finalBatchReports.push(
              buildFailedBatchReportFromEntries(batchPlan, postTranslateEntries, errorReason, report.attempts || 1)
            );
            continue;
          }

          if (report.status === 'success' && !hasMissingText) {
            finalBatchReports.push({
              ...report,
              error: undefined,
            });
          } else {
            finalBatchReports.push(report);
          }
        }
        finalBatchReports.sort((a, b) => a.batchIndex - b.batchIndex);
        const generatedStep3BatchState = buildStep3BatchState(totalBatches, finalBatchReports);
        const missingBatchIndexes: number[] = generatedStep3BatchState.missingBatchIndexes.length > 0
          ? generatedStep3BatchState.missingBatchIndexes
          : (!backendCallSucceeded && !isStoppedByUser ? scheduledBatchIndexes : []);
        const missingGlobalLineIndexes: number[] = generatedStep3BatchState.missingGlobalLineIndexes.length > 0
          ? generatedStep3BatchState.missingGlobalLineIndexes
          : [];
        const finalStep3BatchState: Step3BatchState = {
          ...generatedStep3BatchState,
          failedBatches: Math.max(generatedStep3BatchState.failedBatches, missingBatchIndexes.length),
          missingBatchIndexes,
          missingGlobalLineIndexes,
          updatedAt: nowIso(),
          planFingerprint,
        };
        const failedLines = missingGlobalLineIndexes.length;
        const translatedLines = finalBatchReports.length > 0
          ? finalBatchReports.reduce((sum, report) => sum + report.translatedLines, 0)
          : (typeof translateData.translatedLines === 'number' ? translateData.translatedLines : 0);

        currentEntries = postTranslateEntries;
        if (!isMulti) setEntries(currentEntries);
        srtFileForVideo = `${processOutputDir}/srt/translated.srt`;
        const translatedSrtContent = entriesToSrtText(currentEntries);
        // @ts-ignore
        await window.electronAPI.caption.exportSrt(currentEntries, srtFileForVideo);

        const plainTextContent = entriesToPlainText(currentEntries);
        if (plainTextContent) {
          try {
            const folderPathsToSearch = (inputType === 'draft' || inputType === 'srt')
              ? [currentPath]
              : [currentPath.replace(/[^/\\]+$/, '')];
            // @ts-ignore
            const findBestRes = await window.electronAPI.captionVideo.findBestVideoInFolders(folderPathsToSearch);
            const videoPath = findBestRes?.success ? findBestRes.data?.videoPath : undefined;
            const videoDir = videoPath ? resolveParentDir(videoPath) : '';
            if (videoDir) {
              const plainTextPath = joinFilePath(videoDir, 'subtitle.txt');
              // @ts-ignore
              const plainTextResult = await window.electronAPI.caption.exportPlainText(plainTextContent, plainTextPath);
              if (plainTextResult?.success) {
                console.log(`[CaptionProcessing][Step3] Đã lưu text thuần: ${plainTextPath}`);
              } else {
                console.warn('[CaptionProcessing][Step3] Export text thuần thất bại:', plainTextResult?.error || 'unknown');
              }
            } else {
              console.warn('[CaptionProcessing][Step3] Không tìm thấy video gốc để lưu text thuần.');
            }
          } catch (error) {
            console.warn('[CaptionProcessing][Step3] Lỗi export text thuần:', error);
          }
        }

        const isGrokUiMethod = (cfg.translateMethod || 'api') === 'grok_ui';
        const hasAllBatchReports = finalBatchReports.length >= totalBatches;
        const stoppedWithIncompleteBatches = isStoppedByUser && !hasAllBatchReports;
        const isStep3Complete = !stoppedWithIncompleteBatches && (isGrokUiMethod
          ? (missingBatchIndexes.length === 0 && failedLines === 0)
          : (backendCallSucceeded && missingBatchIndexes.length === 0 && failedLines === 0));
        if (isGrokUiMethod && isStep3Complete && !backendCallSucceeded) {
          console.warn('[CaptionProcessing][GrokUI] Backend failed but data saved → mark as success.');
        }
        setProgress({
          current: translatedLines,
          total: currentEntries.length,
          message: stoppedWithIncompleteBatches
            ? msgCtx('Bước 3: Đã dừng.')
            : isStep3Complete
              ? msgCtx(`Bước 3: Đã dịch ${translatedLines} dòng`)
              : msgCtx(
                backendCallSucceeded
                  ? `Bước 3: Thiếu ${failedLines} dòng (batch lỗi: ${missingBatchIndexes.map((v) => `#${v}`).join(', ')})`
                  : `Bước 3: Backend lỗi (${backendErrorMessage})`
              ),
        });

        await updateSessionForStep(currentPath, step, folderIdx, (session) => {
          const stepArtifacts: CaptionArtifactFile[] = [];
          pushArtifact(stepArtifacts, 'translated_srt', srtFileForVideo, 'file');
          const translatedEntries = compactEntries(currentEntries);
          const inputFingerprint = buildEntriesFingerprint((session.data.extractedEntries || []) as SubtitleEntry[]);
          const outputFingerprint = buildEntriesFingerprint(translatedEntries);
          const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
          const stepMetrics = {
            totalLines: currentEntries.length,
            translatedLines,
            failedLines,
            failedBatches: finalStep3BatchState.failedBatches,
            missingBatchIndexes,
            missingGlobalLineIndexes,
          };
          const step3ErrorReason = !backendCallSucceeded
            ? `STEP3_BACKEND_FAILED${backendErrorCode ? `:${backendErrorCode}` : ''}: ${backendErrorRaw}`
            : `STEP3_MISSING_BATCHES: ${missingBatchIndexes.map((idx) => `#${idx}`).join(', ') || 'unknown'}`;
          const nextStepState = isStep3Complete
            ? {
                ...makeStepSuccess(session.steps[stepKey], stepMetrics),
                inputFingerprint,
                outputFingerprint,
                dependsOn: [1] as CaptionStepNumber[],
              }
            : (stoppedWithIncompleteBatches || isGrokUiMethod
              ? {
                  ...makeStepStopped(
                    session.steps[stepKey],
                    stoppedWithIncompleteBatches ? 'STOPPED_BY_USER' : 'GROK_UI_INCOMPLETE',
                    stepMetrics
                  ),
                  inputFingerprint,
                  outputFingerprint,
                  dependsOn: [1] as CaptionStepNumber[],
                }
              : {
                  ...makeStepError(
                    session.steps[stepKey],
                    step3ErrorReason
                  ),
                  metrics: stepMetrics,
                  inputFingerprint,
                  outputFingerprint,
                  dependsOn: [1] as CaptionStepNumber[],
                });

          let nextSession: CaptionSessionV1 = {
            ...session,
            data: {
              ...session.data,
              translatedEntries,
              translatedSrtContent,
              step3BatchState: finalStep3BatchState,
            },
            artifacts: {
              ...session.artifacts,
              translatedSrtPath: srtFileForVideo,
            },
            runtime: {
              ...session.runtime,
              lastMessage: stoppedWithIncompleteBatches
                ? msgCtx('Bước 3: Đã dừng.')
                : isStep3Complete
                  ? msgCtx('Bước 3: Hoàn tất.')
                  : msgCtx(
                    backendCallSucceeded
                      ? `Bước 3: Thiếu batch ${missingBatchIndexes.map((idx) => `#${idx}`).join(', ')}`
                      : `Bước 3: Backend lỗi (${backendErrorMessage})`
                  ),
            },
            steps: {
              ...session.steps,
              [stepKey]: nextStepState,
            },
          };
          nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
          if (isStep3Complete && prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
            nextSession = markFollowingStepsStale(
              nextSession,
              step,
              'STEP3_OUTPUT_CHANGED',
              steps as CaptionStepNumber[]
            );
          }
          return nextSession;
        });

        if (!isStep3Complete) {
          if (stoppedWithIncompleteBatches) {
            return;
          }
          const fallbackMissingDetails = missingBatchIndexes
            .map((batchIndex) => `#${batchIndex}`)
            .join(', ');
          const fallbackMissingRanges = formatIndexRanges(missingGlobalLineIndexes);
          const missingMessage = finalBatchReports.length > 0
            ? formatMissingBatchMessage(folderName, finalBatchReports)
            : `[${folderName}] Step 3 thiếu batch: ${fallbackMissingDetails || 'không rõ'} | tổng thiếu ${failedLines} dòng global: ${fallbackMissingRanges}`;
          if (isGrokUiMethod) {
            console.warn(`[CaptionProcessing][GrokUI] Incomplete batches → stopped (no error). ${missingMessage}`);
            abortRef.current = true;
            throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
          }
          throw new Error(missingMessage);
        }
      }

      // ========== STEP 4: TTS ==========
      if (step === 4) {
        if (currentEntries.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu dịch trong caption_session.json. Hãy chạy Step 3 trước.`);
        }
        const audioDir = `${processOutputDir}/audio`;
        const isCapCutVoice = typeof cfg.voice === 'string' && cfg.voice.toLowerCase().startsWith('capcut:');
        if (!isMulti) cfg.setAudioDir(audioDir);
        setProgress({ current: 0, total: currentEntries.length, message: msgCtx('Bước 4: Đang tạo audio...') });
        const ttsGenerateOptions: Record<string, unknown> = {
          voice: cfg.voice,
          outputDir: audioDir,
          outputFormat: cfg.edgeOutputFormat === 'mp3' ? 'mp3' : 'wav',
          runId: runIdRef.current || undefined,
        };
        if (!isCapCutVoice) {
          ttsGenerateOptions.rate = cfg.rate;
          ttsGenerateOptions.volume = cfg.volume;
          ttsGenerateOptions.edgeTtsBatchSize = cfg.edgeTtsBatchSize;
        }
        // @ts-ignore
        const result = await window.electronAPI.tts.generate(currentEntries, ttsGenerateOptions);
        if (result.success && result.data) {
          const ttsData = result.data;
          currentAudioFiles = normalizeAudioFiles(ttsData.audioFiles as PartialProcessingAudioFile[]);
          if (!isMulti) setAudioFiles(currentAudioFiles);
          setProgress({ current: ttsData.totalGenerated, total: currentEntries.length, message: msgCtx(`Bước 4: Đã tạo ${ttsData.totalGenerated} audio`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const stepArtifacts: CaptionArtifactFile[] = [];
            pushArtifact(stepArtifacts, 'audio_output_dir', audioDir, 'dir');
            for (const file of currentAudioFiles) {
              pushArtifact(stepArtifacts, 'tts_audio_clip', file.path, 'file');
            }
            const outputFingerprint = buildObjectFingerprint(
              currentAudioFiles.map((file) => ({
                index: file.index,
                path: file.path,
                startMs: file.startMs,
                durationMs: file.durationMs,
              }))
            );
            const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                ttsAudioFiles: currentAudioFiles,
              },
              artifacts: {
                ...session.artifacts,
                audioDir,
              },
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    totalGenerated: ttsData.totalGenerated,
                    totalFailed: ttsData.totalFailed,
                    outputFormat: cfg.edgeOutputFormat === 'mp3' ? 'mp3' : 'wav',
                  }),
                  inputFingerprint: buildEntriesFingerprint((session.data.translatedEntries || []) as SubtitleEntry[]),
                  outputFingerprint,
                  dependsOn: [3],
                },
              },
            };
            nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
            if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
              nextSession = markFollowingStepsStale(
                nextSession,
                step,
                'STEP4_OUTPUT_CHANGED',
                steps as CaptionStepNumber[]
              );
            }
            return nextSession;
          });
        } else {
          if (typeof result.error === 'string' && result.error.includes(CAPTION_PROCESS_STOP_SIGNAL)) {
            throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
          }
          throw new Error(`[${folderName}] Lỗi tạo audio: ${result.error}`);
        }
      }

      // ========== STEP 6: MERGE AUDIO ==========
      if (step === 6) {
        let filesToMerge = normalizeAudioFiles(currentAudioFiles);

        if (filesToMerge.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu audio từ Step 4 trong caption_session.json. Hãy chạy Step 4 trước.`);
        }

        let trimResults: Record<string, unknown> | null = null;
        let trimOutputDir = '';
        let trimTargets: Array<{ inputPath: string; outputPath: string }> = [];
        let trimmedCount = 0;
        let trimFailedCount = 0;
        let trimErrors: string[] = [];
        let fitOutputDir = '';
        let fitScaledCount = 0;
        let fitOutputPaths: string[] = [];
        let fitPathMapping: Array<{ originalPath: string; outputPath: string }> = [];
        let fitSourceFiles: string[] = [];
        let fitSpeed = 1.0;
        let fitSpeedLabel = '';
        let fitSpeedDirLabel = '';
        let fitAudioWorkersUsed = 0;
        if (cfg.trimAudioEnabled) {
          const previousTrimResults = toRecord(sessionBeforeStep.data?.trimResults);
          const previousTrimFiles = Array.isArray(previousTrimResults.trimFiles)
            ? previousTrimResults.trimFiles.filter((filePath) => typeof filePath === 'string' && filePath.trim().length > 0)
            : [];
          const previousTrimOutputDir = readString(previousTrimResults, 'trimOutputDir') || '';
          const trimmedByName = new Map<string, string>();
          for (const filePath of previousTrimFiles) {
            const fileName = String(filePath).split(/[/\\]/).pop() || '';
            if (fileName) {
              trimmedByName.set(fileName, String(filePath));
            }
          }
          const canReuseTrim = previousTrimFiles.length > 0
            && filesToMerge.every((file) => {
              const fileName = file.path.split(/[/\\]/).pop() || '';
              return fileName && trimmedByName.has(fileName);
            });

          if (canReuseTrim) {
            trimTargets = filesToMerge.map((file) => {
              const fileName = file.path.split(/[/\\]/).pop() || '';
              const outputPath = trimmedByName.get(fileName) || file.path;
              return { inputPath: file.path, outputPath };
            });
            filesToMerge = filesToMerge.map((file) => {
              const fileName = file.path.split(/[/\\]/).pop() || '';
              const outputPath = trimmedByName.get(fileName);
              return outputPath ? { ...file, path: outputPath, success: true } : file;
            });
            trimOutputDir = previousTrimOutputDir || (trimTargets[0]?.outputPath ? resolveParentDir(trimTargets[0].outputPath) : '');
            trimmedCount = trimTargets.length;
            trimFailedCount = 0;
            trimErrors = [];
            trimResults = previousTrimResults;
            setProgress({ current: trimmedCount, total: trimTargets.length, message: msgCtx('Bước 6: Dùng lại audio đã trim') });
          } else {
            trimOutputDir = `${processOutputDir}/audio_trimmed`;
            trimTargets = filesToMerge.map((file) => {
              const fileName = file.path.split(/[/\\]/).pop() || `audio_${file.index}.wav`;
              return {
                inputPath: file.path,
                outputPath: joinFilePath(trimOutputDir, fileName),
              };
            });
            setProgress({ current: 0, total: trimTargets.length, message: msgCtx('Bước 6: Đang trim audio...') });
            const trimEndTargets = trimTargets.map((item) => ({
              inputPath: item.outputPath,
              outputPath: item.outputPath,
            }));
            // @ts-ignore
            const trimResult = await window.electronAPI.tts.trimSilenceToPaths(trimTargets);
            // @ts-ignore
            const trimEndResult = await window.electronAPI.tts.trimSilenceEndToPaths(trimEndTargets);
            if (trimResult.success && trimResult.data && trimEndResult.success && trimEndResult.data) {
              const trimmedMiddleData = trimResult.data;
              const trimmedEndData = trimEndResult.data;
              trimmedCount = trimmedEndData.trimmedCount;
              trimFailedCount = trimmedEndData.failedCount;
              trimErrors = Array.isArray(trimmedEndData.errors) ? trimmedEndData.errors : [];
              setProgress({ current: trimmedCount, total: trimTargets.length, message: msgCtx(`Bước 6: Đã trim ${trimmedCount} files`) });
              trimResults = {
                trimmedMiddle: trimmedMiddleData,
                trimmedEnd: trimmedEndData,
                trimOutputDir,
                trimFiles: trimTargets.map((item) => item.outputPath),
              };
              const outputMap = new Map(trimTargets.map((item) => [item.inputPath, item.outputPath]));
              filesToMerge = filesToMerge.map((file) => {
                const outputPath = outputMap.get(file.path);
                return outputPath ? { ...file, path: outputPath, success: true } : file;
              });
            } else {
              throw new Error(`[${folderName}] Lỗi trim silence: ${trimResult.error || trimEndResult.error}`);
            }
          }
        }

        if (cfg.autoFitAudio) {
          if (currentEntries.length === 0) {
            throw new Error(`[${folderName}] Thiếu dữ liệu subtitle dịch trong session để fit audio. Hãy chạy Step 3 trước.`);
          }
          const safeFitAudioWorkers = normalizeFitAudioWorkers(cfg.fitAudioWorkers);
          fitAudioWorkersUsed = safeFitAudioWorkers;
          fitSpeed = cfg.srtSpeed > 0 ? cfg.srtSpeed : 1.0;
          fitSpeedLabel = normalizeSpeedLabel(fitSpeed);
          fitSpeedDirLabel = `${fitSpeedLabel.replace('.', '_')}x`;
          fitSourceFiles = filesToMerge.map((file) => file.path);

          const previousFitResults = toRecord(sessionBeforeStep.data?.fitResults);
          const previousFitSpeed = readNumber(previousFitResults, 'srtSpeed');
          const previousSpeedLabel = readString(previousFitResults, 'speedLabel');
          const previousFitOutputDir = readString(previousFitResults, 'fitOutputDir') || '';
          const previousFitScaledCount = readNumber(previousFitResults, 'fitScaledCount') || 0;
          const previousFitFiles = Array.isArray(previousFitResults.fitFiles)
            ? previousFitResults.fitFiles.filter((item) => typeof item === 'string' && item.trim().length > 0) as string[]
            : [];
          const previousMappingRaw = Array.isArray(previousFitResults.pathMapping)
            ? previousFitResults.pathMapping
            : [];
          const previousPathMapping = previousMappingRaw
            .map((item) => toRecord(item))
            .filter((item) => typeof item.originalPath === 'string' && typeof item.outputPath === 'string')
            .map((item) => ({
              originalPath: String(item.originalPath),
              outputPath: String(item.outputPath),
            }));

          const mappingByOriginal = new Map<string, string>();
          const mappingByAnyPath = new Map<string, string>();
          const normalizedOutputPathByAnyPath = new Map<string, string>();
          for (const mapping of previousPathMapping) {
            mappingByOriginal.set(mapping.originalPath, mapping.outputPath);
            mappingByAnyPath.set(mapping.originalPath, mapping.outputPath);
            mappingByAnyPath.set(mapping.outputPath, mapping.outputPath);

            const normalizedOriginalPath = normalizePathKey(mapping.originalPath);
            const normalizedOutputPath = normalizePathKey(mapping.outputPath);
            normalizedOutputPathByAnyPath.set(normalizedOriginalPath, mapping.outputPath);
            normalizedOutputPathByAnyPath.set(normalizedOutputPath, mapping.outputPath);
          }

          const speedMatches = Number.isFinite(previousFitSpeed) && Math.abs((previousFitSpeed || 0) - fitSpeed) < 0.0001;
          const labelMatches = !previousSpeedLabel || previousSpeedLabel === fitSpeedDirLabel;
          const missingMapping = filesToMerge.filter((file) => {
            const normalizedKey = normalizePathKey(file.path);
            return !normalizedOutputPathByAnyPath.has(normalizedKey);
          });

          let reusedFit = false;
          if (speedMatches && labelMatches && missingMapping.length === 0 && mappingByAnyPath.size > 0) {
            const outputPaths = filesToMerge.map((file) => {
              const normalizedKey = normalizePathKey(file.path);
              return normalizedOutputPathByAnyPath.get(normalizedKey)
                || mappingByAnyPath.get(file.path)
                || file.path;
            });
            const uniqueOutputs = Array.from(new Set(outputPaths));
            // @ts-ignore
            const checkResult = await window.electronAPI.tts.checkAudioFiles(uniqueOutputs);
            const missingOutputs = checkResult?.success && checkResult.data
              ? (checkResult.data.missingPaths || [])
              : uniqueOutputs;
            if (missingOutputs.length === 0) {
              filesToMerge = filesToMerge.map((file) => {
                const normalizedKey = normalizePathKey(file.path);
                const mapped = normalizedOutputPathByAnyPath.get(normalizedKey)
                  || mappingByAnyPath.get(file.path);
                return mapped ? { ...file, path: mapped, success: true } : file;
              });
              fitOutputDir = previousFitOutputDir;
              const derivedFitOutputs = previousFitFiles.length > 0
                ? previousFitFiles
                : previousPathMapping
                  .filter((mapping) => mapping.outputPath !== mapping.originalPath)
                  .map((mapping) => mapping.outputPath);
              fitScaledCount = previousFitScaledCount || derivedFitOutputs.length;
              fitOutputPaths = derivedFitOutputs;
              if (!fitOutputDir && derivedFitOutputs.length > 0) {
                const normalized = derivedFitOutputs[0].replace(/[/\\]+$/, '');
                const match = normalized.match(/^(.*)[\\/][^\\/]+$/);
                fitOutputDir = match ? match[1] : '';
              }
              fitPathMapping = previousPathMapping;
              setProgress({
                current: fitScaledCount,
                total: filesToMerge.length,
                message: msgCtx('Bước 6: Dùng lại audio đã fit'),
              });
              reusedFit = true;
            } else {
              console.warn(`[${folderName}] fit cache invalid: thiếu ${missingOutputs.length} file fit`);
            }
          } else if (missingMapping.length > 0) {
            console.warn(`[${folderName}] fit cache invalid: thiếu mapping ${missingMapping.length} file`);
          }

          if (!reusedFit) {
            setProgress({
              current: 0,
              total: filesToMerge.length,
              message: msgCtx(`Bước 6: Đang fit audio (${safeFitAudioWorkers} workers)...`),
            });
            const fitItems = filesToMerge
              .map(f => {
                const entryByIndex = currentEntries.find(e => e.index === f.index);
                const entryByStart = currentEntries.find(e => e.startMs === f.startMs);
                const baseDurationMs = f.durationMs > 0
                  ? f.durationMs
                  : (entryByIndex?.durationMs || entryByStart?.durationMs || 0);
                const allowedDurationMs = baseDurationMs > 0
                  ? Math.round(baseDurationMs * fitSpeed)
                  : 0;
                return { path: f.path, durationMs: allowedDurationMs, speedLabel: fitSpeedDirLabel };
              })
              .filter(item => item.durationMs > 0);

            if (fitItems.length > 0) {
              const fitWorkerCount = Math.max(1, Math.min(safeFitAudioWorkers, fitItems.length));
              fitAudioWorkersUsed = fitWorkerCount;
              let processedCount = 0;
              let scaledCount = 0;
              const pathMapping: Array<{ originalPath: string; outputPath: string }> = [];
              let nextFitItemIndex = 0;
              let fitWorkerError: Error | null = null;

              const runFitWorker = async (workerNo: number) => {
                while (true) {
                  if (fitWorkerError) {
                    return;
                  }
                  if (abortRef.current) {
                    fitWorkerError = new Error(CAPTION_PROCESS_STOP_SIGNAL);
                    return;
                  }
                  const currentFitItemIndex = nextFitItemIndex;
                  nextFitItemIndex += 1;
                  if (currentFitItemIndex >= fitItems.length) {
                    return;
                  }

                  const fitItem = fitItems[currentFitItemIndex];
                  const audioName = getPathBaseName(fitItem.path) || 'unknown';
                  setProgress({
                    current: processedCount,
                    total: fitItems.length,
                    message: msgCtx(`Bước 6: Đang fit ${processedCount}/${fitItems.length} - w${workerNo} - ${audioName}`),
                  });

                  // @ts-ignore
                  const fitResult = await window.electronAPI.tts.fitAudio([fitItem]);
                  if (fitResult.success && fitResult.data) {
                    const fitData = fitResult.data as {
                      scaledCount?: number;
                      pathMapping?: Array<{ originalPath: string; outputPath: string }>;
                    };
                    const itemScaledCount = Number.isFinite(fitData.scaledCount) ? (fitData.scaledCount as number) : 0;
                    const itemMapping = Array.isArray(fitData.pathMapping) ? fitData.pathMapping : [];
                    scaledCount += itemScaledCount;
                    pathMapping.push(...itemMapping);
                  } else {
                    if ((fitResult?.error || '') === CAPTION_PROCESS_STOP_SIGNAL || abortRef.current) {
                      fitWorkerError = new Error(CAPTION_PROCESS_STOP_SIGNAL);
                      return;
                    }
                    console.warn(`[${folderName}] Cảnh báo fit audio (${audioName}): ${fitResult.error}`);
                  }

                  processedCount++;
                  setProgress({
                    current: processedCount,
                    total: fitItems.length,
                    message: msgCtx(`Bước 6: Đang fit ${processedCount}/${fitItems.length} - w${workerNo} - ${audioName}`),
                  });
                }
              };

              await Promise.all(
                Array.from({ length: fitWorkerCount }, (_, workerIndex) => runFitWorker(workerIndex + 1))
              );

              if (fitWorkerError) {
                throw fitWorkerError;
              }

              setProgress({
                current: fitItems.length,
                total: fitItems.length,
                message: msgCtx(`Bước 6: Đã fit xong ${scaledCount}/${fitItems.length} audio cần tăng tốc (${fitWorkerCount} workers)`),
              });

              fitScaledCount = scaledCount;
              fitPathMapping = pathMapping;
              for (const mapping of pathMapping) {
                const idx = filesToMerge.findIndex(f => f.path === mapping.originalPath);
                if (idx !== -1) {
                  filesToMerge[idx] = { ...filesToMerge[idx], path: mapping.outputPath, success: true };
                  if (mapping.outputPath !== mapping.originalPath) {
                    fitOutputPaths.push(mapping.outputPath);
                  }
                }
              }
              if (fitOutputPaths.length > 0) {
                const normalized = fitOutputPaths[0].replace(/[/\\]+$/, '');
                const match = normalized.match(/^(.*)[\\/][^\\/]+$/);
                fitOutputDir = match ? match[1] : '';
              }
            }
          }
        }

        const safeSrtSpeed = cfg.srtSpeed > 0 ? cfg.srtSpeed : 1.0;
        const speedLabel = normalizeSpeedLabel(safeSrtSpeed);
        const mergedPath = `${processOutputDir}/merged_audio_${speedLabel}x.wav`;
        if (abortRef.current) {
          throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
        }
        setProgress({ current: 0, total: 1, message: msgCtx('Bước 6: Đang ghép audio...') });
        // @ts-ignore
        const result = await window.electronAPI.tts.mergeAudio(filesToMerge, mergedPath, safeSrtSpeed);
        if (!result.success && ((result?.error || '') === CAPTION_PROCESS_STOP_SIGNAL || abortRef.current)) {
          throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
        }
        if (result.success) {
          setProgress({ current: 1, total: 1, message: msgCtx('Bước 6: Đã ghép audio thành công') });
          const actualMergedOutputPath = (
            result.data?.outputPath && typeof result.data.outputPath === 'string'
              ? result.data.outputPath.trim()
              : mergedPath
          ) || mergedPath;
          const mergeResultPayload: Record<string, unknown> = result.data
            ? {
                success: !!result.data.success,
                outputPath: actualMergedOutputPath,
                error: result.data.error,
                requestedOutputPath: mergedPath,
                srtSpeed: safeSrtSpeed,
                speedLabel,
              }
            : {
                success: true,
                outputPath: actualMergedOutputPath,
                requestedOutputPath: mergedPath,
                srtSpeed: safeSrtSpeed,
                speedLabel,
              };
          const fitResultsPayload = cfg.autoFitAudio ? {
            srtSpeed: fitSpeed,
            speedLabel: fitSpeedDirLabel || fitSpeedLabel,
            fitOutputDir: fitOutputDir || undefined,
            fitFiles: fitOutputPaths,
            sourceFiles: fitSourceFiles,
            pathMapping: fitPathMapping,
            fitScaledCount,
            fitAudioWorkers: fitAudioWorkersUsed,
          } : undefined;
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const stepArtifacts: CaptionArtifactFile[] = [];
            pushArtifact(stepArtifacts, 'merged_audio', actualMergedOutputPath, 'file');
            for (const file of filesToMerge) {
              pushArtifact(stepArtifacts, 'merge_input_audio', file.path, 'file');
            }
            if (cfg.trimAudioEnabled && trimTargets.length > 0) {
              pushArtifact(stepArtifacts, 'trimmed_audio_dir', trimOutputDir, 'dir');
              for (const target of trimTargets) {
                pushArtifact(stepArtifacts, 'trimmed_audio_clip', target.outputPath, 'file');
              }
            }
            if (fitOutputDir && fitOutputPaths.length > 0) {
              pushArtifact(stepArtifacts, 'fit_audio_dir', fitOutputDir, 'dir');
              for (const outputPath of fitOutputPaths) {
                pushArtifact(stepArtifacts, 'fit_audio_clip', outputPath, 'file');
              }
            }
              const outputFingerprint = buildObjectFingerprint({
                mergedPath: actualMergedOutputPath,
                filesCount: filesToMerge.length,
                srtSpeed: safeSrtSpeed,
                speedLabel,
                trimAudioEnabled: !!cfg.trimAudioEnabled,
                trimOutputDir: cfg.trimAudioEnabled ? trimOutputDir : undefined,
                trimFiles: cfg.trimAudioEnabled ? trimTargets.map((item) => item.outputPath) : undefined,
                autoFitAudio: !!cfg.autoFitAudio,
                fitOutputDir: fitOutputDir || undefined,
                fitScaledCount,
                fitSpeed: fitSpeed,
                fitSpeedLabel: fitSpeedDirLabel || fitSpeedLabel,
                fitMappingCount: fitPathMapping.length,
              });
            const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                mergeResult: mergeResultPayload,
                trimResults: trimResults || undefined,
                fitResults: fitResultsPayload || undefined,
              },
              artifacts: {
                ...session.artifacts,
                mergedAudioPath: actualMergedOutputPath,
              },
              timing: {
                ...session.timing,
                step4SrtScale: safeSrtSpeed,
              },
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    mergedPath: actualMergedOutputPath,
                    requestedMergedPath: mergedPath,
                    filesCount: filesToMerge.length,
                    srtSpeed: safeSrtSpeed,
                    speedLabel,
                    trimAudioEnabled: !!cfg.trimAudioEnabled,
                    trimOutputDir: cfg.trimAudioEnabled ? trimOutputDir : undefined,
                    trimmedCount: trimmedCount,
                    trimFailedCount: trimFailedCount,
                    trimErrors: trimErrors.length > 0 ? trimErrors : undefined,
                    autoFitAudio: !!cfg.autoFitAudio,
                    fitOutputDir: fitOutputDir || undefined,
                    fitCount: fitScaledCount || undefined,
                    fitAudioWorkers: cfg.autoFitAudio ? fitAudioWorkersUsed : undefined,
                  }),
                  inputFingerprint: buildObjectFingerprint(filesToMerge.map((file) => ({
                    path: file.path,
                    startMs: file.startMs,
                    durationMs: file.durationMs,
                  }))),
                  outputFingerprint,
                  dependsOn: [4],
                },
              },
            };
            nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
            if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
              nextSession = markFollowingStepsStale(
                nextSession,
                step,
                'STEP6_OUTPUT_CHANGED',
                steps as CaptionStepNumber[]
              );
            }
            return nextSession;
          });
        } else {
          throw new Error(`[${folderName}] Lỗi ghép audio: ${result.error}`);
        }
      }

      // ========== STEP 7: RENDER VIDEO ==========
      if (step === 7) {
        if (abortRef.current) {
          throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
        }
        const sessionPathForStep7 = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        const sessionFallback = {
          projectId,
          inputType: inputType as 'srt' | 'draft',
          sourcePath: resolveSourcePath(currentPath),
          folderPath: resolveFolderPath(currentPath),
        };
        const sessionBeforeRender = await readCaptionSession(sessionPathForStep7, sessionFallback);
        const targetRevision = cfg.settingsRevision && cfg.settingsRevision > 0 ? cfg.settingsRevision : 0;
        const currentRevision = sessionBeforeRender.effectiveSettingsRevision || 0;
        if (targetRevision > 0 && currentRevision < targetRevision) {
          await syncSessionWithProjectSettings(
            sessionPathForStep7,
            {
              projectSettings: projectSettingsForRun,
              revision: targetRevision,
              updatedAt: cfg.settingsUpdatedAt || nowIso(),
              source: 'project_default',
            },
            sessionFallback
          );
        }

        const sessionForRender = await readCaptionSession(sessionPathForStep7, sessionFallback);
        const step7Inputs = resolveStepInputsFromSession(sessionForRender, 7);
        const translatedEntriesForRender = compactEntries(step7Inputs.translatedEntries);
        const mergedAudioPathForRender = step7Inputs.mergedAudioPath;
        if (translatedEntriesForRender.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu dịch trong caption_session.json. Hãy chạy Step 3 trước.`);
        }
        if (!mergedAudioPathForRender) {
          throw new Error(`[${folderName}] Chưa có merged audio trong caption_session.json. Hãy chạy Step 6 trước.`);
        }
        currentEntries = translatedEntriesForRender;
        if (!isMulti) {
          setEntries(translatedEntriesForRender);
        }

        setProgress({ current: 0, total: 100, message: msgCtx('Bước 7: Đang tìm video gốc tốt nhất...') });
        let finalVideoInputPath: string | undefined = undefined;
        const folderPathsToSearch = (inputType === 'draft' || inputType === 'srt')
          ? [currentPath]
          : [currentPath.replace(/[^/\\]+$/, '')];
        // @ts-ignore
        const findBestRes = await window.electronAPI.captionVideo.findBestVideoInFolders(folderPathsToSearch);
        let stripWidth = 1080;
        let stripHeight = 1920;
        let targetDuration: number | undefined = undefined;

        if (findBestRes.success && findBestRes.data?.videoPath) {
          const foundVideo = findBestRes.data.videoPath;
          if (cfg.renderMode === 'hardsub' || cfg.renderMode === 'hardsub_portrait_9_16') {
            finalVideoInputPath = foundVideo;
            setProgress({ current: 5, total: 100, message: msgCtx(`Bước 7: Đã tìm thấy video ${foundVideo.split(/[/\\]/).pop()}`) });
          } else {
            setProgress({ current: 5, total: 100, message: msgCtx('Bước 7: Render nền đen (Chế độ màn hình)') });
          }
          try {
            // @ts-ignore
            const meta = await window.electronAPI.captionVideo.getVideoMetadata(foundVideo);
            if (meta && meta.success && meta.data) {
              stripWidth = meta.data.width;
              targetDuration = meta.data.duration;
              if (cfg.renderMode === 'black_bg') {
                const realHeight = meta.data.actualHeight || 1080;
                stripHeight = Math.floor(realHeight / 10);
              } else {
                stripHeight = meta.data.actualHeight || meta.data.height;
              }
            }
          } catch (e) {
            console.warn('Không lấy được metadata video, dùng mặc định', e);
          }
        } else {
          if (cfg.renderMode === 'black_bg') {
            setProgress({ current: 5, total: 100, message: msgCtx('Bước 7: Render nền đen (Chế độ màn hình)') });
          }
        }

        const srtScale = cfg.srtSpeed > 0 ? cfg.srtSpeed : 1.0;
        const scaleLabel = normalizeSpeedLabel(srtScale);
        const scaledSrtPath = `${processOutputDir}/srt/subtitle_${scaleLabel}x.srt`;

        const scaledEntries = buildScaledSubtitleEntries(translatedEntriesForRender, srtScale);
        // @ts-ignore
        const scaledSrtResult = await window.electronAPI.caption.exportSrt(scaledEntries, scaledSrtPath);
        if (scaledSrtResult?.success) {
          srtFileForVideo = scaledSrtPath;
          console.log(`[CaptionProcessing] Dùng SRT scaled cho render: ${scaledSrtPath} (scale=${srtScale}, source=session_translated_entries)`);
        } else {
          throw new Error(`[${folderName}] Không thể tạo SRT scaled từ dữ liệu dịch trong session.`);
        }

        const thumbnailTextForRender = isMulti
          ? (cfg.thumbnailTextsByOrder?.[folderIdx] || '').trim()
          : (cfg.thumbnailText || '').trim();
        const thumbnailTextSecondaryForRender = isMulti
          ? (cfg.thumbnailTextsSecondaryByOrder?.[folderIdx] || '').trim()
          : (cfg.thumbnailTextSecondary || '').trim();
        const hardsubTextPrimaryForRender = (
          isMulti
            ? (cfg.hardsubTextsByOrder?.[folderIdx] || '')
            : (cfg.hardsubTextPrimary || '')
        ).trim();
        const hardsubTextSecondaryForRender = (
          isMulti
            ? (cfg.hardsubTextsSecondaryByOrder?.[folderIdx] || '')
            : (cfg.hardsubTextSecondary || '')
        ).trim();
        const hardsubPortraitTextPrimaryForRender = (
          cfg.hardsubPortraitTextPrimary
          || hardsubTextPrimaryForRender
          || ''
        ).trim();
        const hardsubPortraitTextSecondaryForRender = (
          cfg.hardsubPortraitTextSecondary
          || hardsubTextSecondaryForRender
          || ''
        ).trim();
        const finalVideoFileName = buildRenderedVideoName(
          cfg.renderMode,
          cfg.renderContainer || 'mp4',
          thumbnailTextForRender
        );
        let renderOutputDir = resolveRenderOutputDir(inputType, currentPath, finalVideoInputPath);
        try {
          const appSettingsRes = await window.electronAPI.appSettings.getAll();
          const appSettings = appSettingsRes?.data as { renderVideoOutputDir?: unknown; useRenderVideoOutputDir?: unknown } | undefined;
          const useCustom = Boolean(appSettings && appSettings.useRenderVideoOutputDir === true);
          const customDir = appSettings && typeof appSettings.renderVideoOutputDir === 'string'
            ? appSettings.renderVideoOutputDir.trim()
            : '';
          if (useCustom && customDir) {
            renderOutputDir = customDir;
          }
        } catch (err) {
          console.warn('[CaptionProcessing][Step7] Không tải được appSettings cho output dir:', err);
        }
        const finalVideoPath = joinFilePath(renderOutputDir, finalVideoFileName);
        console.log(
          `[CaptionProcessing][Step7] Output filename: ${finalVideoFileName}, outputDir: ${renderOutputDir || '(empty)'}`
        );
        const timingContextPath = getCaptionSessionPathFromOutputDir(processOutputDir);
        const step7AudioSpeed = cfg.renderAudioSpeed && cfg.renderAudioSpeed > 0
          ? cfg.renderAudioSpeed : 1.0;
        await updateSessionForStep(currentPath, step, folderIdx, (session) => {
          const stepArtifacts: CaptionArtifactFile[] = [];
          pushArtifact(stepArtifacts, 'scaled_srt_for_render', srtFileForVideo, 'file');
          pushArtifact(stepArtifacts, 'merged_audio_for_render', mergedAudioPathForRender, 'file');
          pushArtifact(stepArtifacts, 'source_video', finalVideoInputPath, 'file');
          let nextSession: CaptionSessionV1 = {
            ...session,
            artifacts: {
              ...session.artifacts,
              translatedSrtPath: session.artifacts.translatedSrtPath,
              scaledSrtPath: srtFileForVideo,
              mergedAudioPath: mergedAudioPathForRender,
            },
            timing: {
              ...session.timing,
              step4SrtScale: srtScale,
              step7AudioSpeed,
              audioSpeedModel: 'step4_minus_step7_delta',
            },
          };
          nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
          return nextSession;
        });

        setProgress({ current: 20, total: 100, message: msgCtx('Bước 7: Bắt đầu render video (có thể mất vài phút)...') });

        const step7TextPrimaryFontName = cfg.renderMode === 'hardsub_portrait_9_16'
          ? (
              cfg.hardsubPortraitTextPrimaryFontName
              || cfg.portraitTextPrimaryFontName
              || cfg.thumbnailTextPrimaryFontName
              || cfg.thumbnailFontName
              || 'BrightwallPersonal'
            )
          : (
              cfg.hardsubTextPrimaryFontName
              || cfg.thumbnailTextPrimaryFontName
              || cfg.thumbnailFontName
              || 'BrightwallPersonal'
            );
        const step7TextPrimaryFontSize = cfg.renderMode === 'hardsub_portrait_9_16'
          ? (
              cfg.hardsubPortraitTextPrimaryFontSize
              ?? cfg.portraitTextPrimaryFontSize
              ?? cfg.thumbnailTextPrimaryFontSize
              ?? cfg.thumbnailFontSize
              ?? 145
            )
          : (
              cfg.hardsubTextPrimaryFontSize
              ?? cfg.thumbnailTextPrimaryFontSize
              ?? cfg.thumbnailFontSize
              ?? 145
            );
        const step7TextPrimaryColor = cfg.renderMode === 'hardsub_portrait_9_16'
          ? (
              cfg.hardsubPortraitTextPrimaryColor
              || cfg.portraitTextPrimaryColor
              || cfg.thumbnailTextPrimaryColor
              || '#FFFF00'
            )
          : (
              cfg.hardsubTextPrimaryColor
              || cfg.thumbnailTextPrimaryColor
              || '#FFFF00'
            );
        const step7TextSecondaryFontName = cfg.renderMode === 'hardsub_portrait_9_16'
          ? (
              cfg.hardsubPortraitTextSecondaryFontName
              || cfg.portraitTextSecondaryFontName
              || cfg.thumbnailTextSecondaryFontName
              || cfg.thumbnailFontName
              || 'BrightwallPersonal'
            )
          : (
              cfg.hardsubTextSecondaryFontName
              || cfg.thumbnailTextSecondaryFontName
              || cfg.thumbnailFontName
              || 'BrightwallPersonal'
            );
        const step7TextSecondaryFontSize = cfg.renderMode === 'hardsub_portrait_9_16'
          ? (
              cfg.hardsubPortraitTextSecondaryFontSize
              ?? cfg.portraitTextSecondaryFontSize
              ?? cfg.thumbnailTextSecondaryFontSize
              ?? cfg.thumbnailFontSize
              ?? 145
            )
          : (
              cfg.hardsubTextSecondaryFontSize
              ?? cfg.thumbnailTextSecondaryFontSize
              ?? cfg.thumbnailFontSize
              ?? 145
            );
        const step7TextSecondaryColor = cfg.renderMode === 'hardsub_portrait_9_16'
          ? (
              cfg.hardsubPortraitTextSecondaryColor
              || cfg.portraitTextSecondaryColor
              || cfg.thumbnailTextSecondaryColor
              || '#FFFF00'
            )
          : (
              cfg.hardsubTextSecondaryColor
              || cfg.thumbnailTextSecondaryColor
              || '#FFFF00'
            );
        console.log(
          `[CaptionProcessing][Step7][TextOverlay] folderIdx=${folderIdx + 1}/${totalFolders}, folder=${folderName}, durationSec=${cfg.thumbnailDurationSec ?? 0.5}, ` +
          `font1=${step7TextPrimaryFontName} size1=${step7TextPrimaryFontSize}, ` +
          `color1=${step7TextPrimaryColor.toUpperCase()}, ` +
          `font2=${step7TextSecondaryFontName} size2=${step7TextSecondaryFontSize}, ` +
          `color2=${step7TextSecondaryColor.toUpperCase()}, ` +
          `lineHeight=${Number(cfg.thumbnailLineHeightRatio ?? 1.16).toFixed(2)}x, ` +
          `videoText1="${hardsubTextPrimaryForRender}", videoText2="${hardsubTextSecondaryForRender}"`
        );

        const thumbnailEnabledForRender = true;
        const thumbnailTimeSecForRender = cfg.thumbnailFrameTimeSec ?? 0;
        const thumbnailDurationSecForRender = cfg.thumbnailDurationSec ?? 0.5;

        // @ts-ignore
        const renderRes = await window.electronAPI.captionVideo.renderVideo({
          srtPath: srtFileForVideo,
          outputPath: finalVideoPath,
          width: stripWidth,
          height: stripHeight,
          videoPath: finalVideoInputPath,
          targetDuration: (cfg.renderMode === 'hardsub' || cfg.renderMode === 'hardsub_portrait_9_16')
            ? targetDuration
            : undefined,
          hardwareAcceleration: cfg.hardwareAcceleration,
          style: cfg.style,
          renderMode: cfg.renderMode,
          renderResolution: cfg.renderResolution,
          position: cfg.subtitlePosition || undefined,
          blackoutTop: (cfg.blackoutTop != null && cfg.blackoutTop < 1)
            ? cfg.blackoutTop : undefined,
          coverMode: cfg.coverMode || 'blackout_bottom',
          coverQuad: cfg.coverQuad,
          coverFeatherPx: cfg.coverFeatherPx,
          coverFeatherHorizontalPx: cfg.coverFeatherHorizontalPx,
          coverFeatherVerticalPx: cfg.coverFeatherVerticalPx,
          coverFeatherHorizontalPercent: cfg.coverFeatherHorizontalPercent,
          coverFeatherVerticalPercent: cfg.coverFeatherVerticalPercent,
          audioPath: mergedAudioPathForRender,
          audioSpeed: cfg.renderAudioSpeed,
          step7AudioSpeedInput: step7AudioSpeed,
          srtTimeScale: srtScale,
          step4SrtScale: srtScale,
          timingContextPath,
          audioSpeedModel: 'step4_minus_step7_delta',
          ttsRate: cfg.rate,
          videoVolume: cfg.videoVolume,
          audioVolume: cfg.audioVolume,
          logoPath: cfg.logoPath,
          logoPosition: cfg.logoPosition,
          logoScale: cfg.logoScale,
          portraitForegroundCropPercent: cfg.portraitForegroundCropPercent,
          thumbnailEnabled: thumbnailEnabledForRender,
          thumbnailDurationSec: thumbnailDurationSecForRender,
          thumbnailTimeSec: thumbnailTimeSecForRender,
          thumbnailText: thumbnailTextForRender,
          thumbnailTextSecondary: thumbnailTextSecondaryForRender,
          hardsubTextPrimary: hardsubTextPrimaryForRender,
          hardsubTextSecondary: hardsubTextSecondaryForRender,
          hardsubPortraitTextPrimary: hardsubPortraitTextPrimaryForRender,
          hardsubPortraitTextSecondary: hardsubPortraitTextSecondaryForRender,
          thumbnailFontName: cfg.thumbnailFontName,
          thumbnailFontSize: cfg.thumbnailFontSize,
          thumbnailTextPrimaryFontName: cfg.thumbnailTextPrimaryFontName,
          thumbnailTextPrimaryFontSize: cfg.thumbnailTextPrimaryFontSize,
          thumbnailTextPrimaryColor: cfg.thumbnailTextPrimaryColor,
          thumbnailTextSecondaryFontName: cfg.thumbnailTextSecondaryFontName,
          thumbnailTextSecondaryFontSize: cfg.thumbnailTextSecondaryFontSize,
          thumbnailTextSecondaryColor: cfg.thumbnailTextSecondaryColor,
          thumbnailLineHeightRatio: cfg.thumbnailLineHeightRatio,
          thumbnailTextPrimaryPosition: cfg.thumbnailTextPrimaryPosition,
          thumbnailTextSecondaryPosition: cfg.thumbnailTextSecondaryPosition,
          thumbnailTextConstrainTo34: cfg.thumbnailTextConstrainTo34,
          hardsubTextPrimaryFontName: cfg.hardsubTextPrimaryFontName,
          hardsubTextPrimaryFontSize: cfg.hardsubTextPrimaryFontSize,
          hardsubTextPrimaryColor: cfg.hardsubTextPrimaryColor,
          hardsubTextSecondaryFontName: cfg.hardsubTextSecondaryFontName,
          hardsubTextSecondaryFontSize: cfg.hardsubTextSecondaryFontSize,
          hardsubTextSecondaryColor: cfg.hardsubTextSecondaryColor,
          hardsubTextPrimaryPosition: cfg.hardsubTextPrimaryPosition,
          hardsubTextSecondaryPosition: cfg.hardsubTextSecondaryPosition,
          hardsubPortraitTextPrimaryFontName: cfg.hardsubPortraitTextPrimaryFontName,
          hardsubPortraitTextPrimaryFontSize: cfg.hardsubPortraitTextPrimaryFontSize,
          hardsubPortraitTextPrimaryColor: cfg.hardsubPortraitTextPrimaryColor,
          hardsubPortraitTextSecondaryFontName: cfg.hardsubPortraitTextSecondaryFontName,
          hardsubPortraitTextSecondaryFontSize: cfg.hardsubPortraitTextSecondaryFontSize,
          hardsubPortraitTextSecondaryColor: cfg.hardsubPortraitTextSecondaryColor,
          hardsubPortraitTextPrimaryPosition: cfg.hardsubPortraitTextPrimaryPosition,
          hardsubPortraitTextSecondaryPosition: cfg.hardsubPortraitTextSecondaryPosition,
          portraitTextPrimaryFontName: cfg.portraitTextPrimaryFontName,
          portraitTextPrimaryFontSize: cfg.portraitTextPrimaryFontSize,
          portraitTextPrimaryColor: cfg.portraitTextPrimaryColor,
          portraitTextSecondaryFontName: cfg.portraitTextSecondaryFontName,
          portraitTextSecondaryFontSize: cfg.portraitTextSecondaryFontSize,
          portraitTextSecondaryColor: cfg.portraitTextSecondaryColor,
          portraitTextPrimaryPosition: cfg.portraitTextPrimaryPosition,
          portraitTextSecondaryPosition: cfg.portraitTextSecondaryPosition,
          step7SubtitleSource: 'session_translated_entries',
          step7AudioSource: 'session_merged_audio',
        });

        if (renderRes.success) {
          const renderedPath = renderRes.data?.outputPath || finalVideoPath;
          const timingPayload = renderRes.data?.timingPayload && typeof renderRes.data.timingPayload === 'object'
            ? renderRes.data.timingPayload as Record<string, unknown>
            : undefined;
          let timingFromRender: Record<string, unknown> = {};
          if (timingPayload) {
            const parsed = timingPayload as Record<string, any>;
            const afterScale = (parsed.afterScale && typeof parsed.afterScale === 'object')
              ? parsed.afterScale as Record<string, unknown>
              : {};
            timingFromRender = {
              step4SrtScale: typeof afterScale.step4SrtScale === 'number' ? afterScale.step4SrtScale : undefined,
              step7AudioSpeed: typeof afterScale.step7AudioSpeedInput === 'number' ? afterScale.step7AudioSpeedInput : undefined,
              audioEffectiveSpeed: typeof afterScale.audioEffectiveSpeed === 'number' ? afterScale.audioEffectiveSpeed : undefined,
              videoSubBaseDuration: typeof afterScale.videoWithSubtitleDurationAfterStep4ScaleSec === 'number'
                ? afterScale.videoWithSubtitleDurationAfterStep4ScaleSec
                : undefined,
              videoSpeedMultiplier: typeof afterScale.videoSpeedNeeded === 'number' ? afterScale.videoSpeedNeeded : undefined,
              videoMarkerSec: typeof afterScale.videoMarkerSec === 'number' ? afterScale.videoMarkerSec : undefined,
            };
            console.log(`[CaptionProcessing][Step7] Đã nhận timing payload từ backend cho ${folderName}.`);
          } else {
            console.warn(`[CaptionProcessing][Step7] Backend không trả timing payload cho ${folderName}.`);
          }
          setProgress({ current: 100, total: 100, message: msgCtx(`Bước 7: Đã render video thành công! (${renderRes.data?.duration?.toFixed(1)}s)`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const stepArtifacts: CaptionArtifactFile[] = [];
            pushArtifact(stepArtifacts, 'final_video', renderedPath, 'file');
            pushArtifact(stepArtifacts, 'scaled_srt_for_render', srtFileForVideo, 'file');
            pushArtifact(stepArtifacts, 'merged_audio_for_render', mergedAudioPathForRender, 'file');
            pushArtifact(stepArtifacts, 'source_video', finalVideoInputPath, 'file');
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                renderResult: {
                  success: true,
                  outputPath: renderedPath,
                  duration: renderRes.data?.duration || 0,
                  renderAt: nowIso(),
                },
                renderTimingPayload: timingPayload,
                step7SubtitleSource: 'session_translated_entries',
                step7AudioSource: 'session_merged_audio',
              },
              artifacts: {
                ...session.artifacts,
                finalVideoPath: renderedPath,
              },
              timing: {
                ...session.timing,
                ...timingFromRender,
              },
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    lastRenderAt: nowIso(),
                    duration: renderRes.data?.duration || 0,
                    outputPath: renderedPath,
                  }),
                  inputFingerprint: buildObjectFingerprint({
                    translatedEntries: translatedEntriesForRender.map((entry) => ({
                      index: entry.index,
                      startMs: entry.startMs,
                      endMs: entry.endMs,
                      translatedText: entry.translatedText,
                      text: entry.text,
                    })),
                    mergedAudioPath: mergedAudioPathForRender,
                    srtScale,
                  }),
                  outputFingerprint: buildObjectFingerprint({
                    outputPath: renderedPath,
                    duration: renderRes.data?.duration || 0,
                  }),
                  dependsOn: [3, 6],
                },
              },
            };
            nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
            return nextSession;
          });
          console.log(`[CaptionProcessing][Step7] Đã lưu timing payload vào caption_session.json cho ${folderName}.`);
        } else {
          const stopByUser = abortRef.current
            || (typeof renderRes.error === 'string' && renderRes.error.toLowerCase().includes('đã dừng render'));
          if (stopByUser) {
            throw new Error(CAPTION_PROCESS_STOP_SIGNAL);
          }
          throw new Error(`[${folderName}] Lỗi render video: ${renderRes.error}`);
        }
      }

        // Ghi lại state đã thay đổi vào ctx map
        ctx.entries = currentEntries;
        ctx.audioFiles = currentAudioFiles;
        ctx.srtFileForVideo = srtFileForVideo;
      } catch (error) {
        if (isProcessStopSignal(error)) {
          const stoppedAt = nowIso();
          const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
          const stepStopCheckpoint = buildStopCheckpoint({
            at: stoppedAt,
            step,
            folderPath: currentPath,
            folderIndex: folderIdx + 1,
            totalFolders,
            processingMode,
            reason: 'user_stop',
            resumable: true,
          });
          await updateCaptionSession(
            sessionPath,
            (session) => {
              const outputCheck = validateStepOutputForSkip(session, step as CaptionStepNumber);
              const canRestorePreviousSuccess = previousStepStateBeforeRun?.status === 'success' && outputCheck.ok;
              const oldMetrics = (previousStepStateBeforeRun?.metrics && typeof previousStepStateBeforeRun.metrics === 'object')
                ? previousStepStateBeforeRun.metrics
                : {};
              const nextStepState = canRestorePreviousSuccess
                ? makeStepSuccess(previousStepStateBeforeRun, {
                    ...oldMetrics,
                    recoveredFromStop: true,
                    recoveredAt: stoppedAt,
                    recoveredReason: 'output_valid',
                  })
                : makeStepStopped(session.steps[stepKey], 'STOPPED_BY_USER', {
                    ...(session.steps[stepKey]?.metrics || {}),
                    stopReason: 'user_stop',
                    stoppedAt,
                  });

              return {
                ...session,
                steps: {
                  ...session.steps,
                  [stepKey]: nextStepState,
                },
                runtime: {
                  ...session.runtime,
                  runState: 'stopped',
                  currentStep: null,
                  lastMessage: msgCtx(`Bước ${step}: Đã dừng.`),
                  lastGuardError: undefined,
                  lastStopCheckpoint: stepStopCheckpoint,
                },
              };
            },
            getSessionFallback(currentPath)
          );
          throw error;
        }
        await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
          ...session,
          steps: {
            ...session.steps,
            [stepKey]: makeStepError(session.steps[stepKey], String(error)),
          },
          runtime: {
            ...session.runtime,
            runState: 'error',
            lastMessage: String(error),
            lastGuardError: String(error),
          },
        }));
        throw error;
      }
    };
    // =========================================================
    // END helper processStep
    // =========================================================

    let lastAttemptedStep: Step | null = null;
    let lastAttemptedFolderPath = inputPaths[0] || '';
    let lastAttemptedFolderIndex = inputPaths.length > 0 ? 1 : 0;

    try {
      if (processingMode === 'step-first' && isMulti) {
        // ===== STEP-FIRST MODE: vòng ngoài là step, vòng trong là folder =====
        for (const step of steps) {
          if (abortRef.current) break;
          setCurrentStep(step);
          setProgress({ current: 0, total: totalFolders, message: `Bước ${step}: Bắt đầu cho ${totalFolders} folder...` });

          for (let i = 0; i < inputPaths.length; i++) {
            if (abortRef.current) break;
            const currentPath = inputPaths[i];
            const ctx = folderCtxMap.get(currentPath)!;

            // Bỏ qua folder đã lỗi ở bước trước
            if (failedFolders.has(currentPath)) {
              setProgress({ current: i + 1, total: totalFolders, message: `Bước ${step} [${i + 1}/${totalFolders}] ⚠ Bỏ qua ${ctx.name} (đã lỗi trước đó)` });
              continue;
            }

            setCurrentFolder({ index: i + 1, total: totalFolders, name: ctx.name, path: currentPath });
            lastAttemptedStep = step;
            lastAttemptedFolderPath = currentPath;
            lastAttemptedFolderIndex = i + 1;

            try {
              await processStep(step, currentPath, i);
              setProgress({ current: i + 1, total: totalFolders, message: `Bước ${step} [${i + 1}/${totalFolders}] ✓ ${ctx.name}` });
            } catch (err) {
              if (isProcessStopSignal(err)) {
                abortRef.current = true;
                break;
              }
              const errMessage = recordFolderFailure(currentPath, ctx.name, err);
              console.error(`[Step-first] Bước ${step} lỗi tại ${ctx.name}:`, err);
              setProgress({ current: i + 1, total: totalFolders, message: `Bước ${step} [${i + 1}/${totalFolders}] ✗ ${ctx.name}: ${errMessage}` });
            }
          }
        }

        // Tổng kết step-first
        const successCount = totalFolders - failedFolders.size;
        const failMsg = failedFolders.size > 0
          ? ` (${failedFolders.size} lỗi: ${Array.from(failedFolders).map(p => p.split(/[/\\]/).pop()).join(', ')})`
          : '';
        if (abortRef.current) {
          const stoppedAt = nowIso();
          const stopCheckpoint = buildStopCheckpoint({
            at: stoppedAt,
            step: lastAttemptedStep || 1,
            folderPath: lastAttemptedFolderPath || inputPaths[0] || '',
            folderIndex: lastAttemptedFolderIndex > 0 ? lastAttemptedFolderIndex : 1,
            totalFolders,
            processingMode,
            reason: 'user_stop',
            resumable: true,
          });
          await setRunStateForAllSessions(
            'stopped',
            `Đã dừng. ${successCount}/${totalFolders} folder hoàn thành.`,
            stopCheckpoint
          );
        } else if (failedFolders.size === totalFolders) {
          await setRunStateForAllSessions('error', `Tất cả folder đều lỗi${failMsg}`);
          await scheduleAutoShutdownIfNeeded('pipeline_error', `Summary: all ${totalFolders} folders failed.`);
        } else {
          await setRunStateForAllSessions(
            'completed',
            `Hoàn thành ${successCount}/${totalFolders} folder (Bước: ${steps.join(', ')})${failMsg}`
          );
          await scheduleAutoShutdownIfNeeded(
            'pipeline_success',
            `Summary: ${successCount}/${totalFolders} folders completed.`
          );
        }
        setStatus(
          abortRef.current
            ? 'idle'
            : (failedFolders.size === totalFolders ? 'error' : 'success')
        );
        setStepDependencyIssues([]);
        setProgress({
          current: successCount,
          total: totalFolders,
          message: abortRef.current
            ? `Đã dừng. ${successCount}/${totalFolders} folder hoàn thành.`
            : `✓ Hoàn thành ${successCount}/${totalFolders} folder (Bước: ${steps.join(', ')})${failMsg}`,
        });

      } else {
        // ===== FOLDER-FIRST MODE (mặc định): vòng ngoài là folder, vòng trong là step =====
        for (let i = 0; i < inputPaths.length; i++) {
          if (abortRef.current) break;
          const currentPath = inputPaths[i];
          const ctx = folderCtxMap.get(currentPath)!;
          let folderFailed = false;

          setCurrentFolder({ index: i + 1, total: totalFolders, name: ctx.name, path: currentPath });

          for (const step of steps) {
            if (abortRef.current) break;
            setCurrentStep(step);
            lastAttemptedStep = step;
            lastAttemptedFolderPath = currentPath;
            lastAttemptedFolderIndex = i + 1;
            try {
              await processStep(step, currentPath, i);
            } catch (err) {
              if (isProcessStopSignal(err)) {
                abortRef.current = true;
                break;
              }
              const errMessage = recordFolderFailure(currentPath, ctx.name, err);
              console.error(`[Folder-first] Bước ${step} lỗi tại ${ctx.name}:`, err);
              setProgress({
                current: i + 1,
                total: totalFolders,
                message: `[${i + 1}/${totalFolders}] ✗ ${ctx.name}: ${errMessage}`,
              });
              folderFailed = true;
              break;
            }
          }

          if (abortRef.current) break;
          if (folderFailed) {
            continue;
          }
          if (isMulti) {
            setProgress({ current: i + 1, total: totalFolders, message: `[${i + 1}/${totalFolders}] ✓ Hoàn thành: ${ctx.name}` });
          }
        }

        const successCount = totalFolders - failedFolders.size;
        const warningDetails = failedFolderDetails
          .slice(0, 5)
          .map((detail) => `${detail.folderName}: ${detail.error}`)
          .join(' | ');
        const warningTail = failedFolderDetails.length > 5
          ? ` | +${failedFolderDetails.length - 5} lỗi khác`
          : '';

        if (abortRef.current) {
          const stoppedAt = nowIso();
          const stopCheckpoint = buildStopCheckpoint({
            at: stoppedAt,
            step: lastAttemptedStep || 1,
            folderPath: lastAttemptedFolderPath || inputPaths[0] || '',
            folderIndex: lastAttemptedFolderIndex > 0 ? lastAttemptedFolderIndex : 1,
            totalFolders,
            processingMode,
            reason: 'user_stop',
            resumable: true,
          });
          await setRunStateForAllSessions(
            'stopped',
            `Đã dừng. ${successCount}/${totalFolders} folder hoàn thành.`,
            stopCheckpoint
          );
        } else if (failedFolders.size === totalFolders) {
          await setRunStateForAllSessions(
            'error',
            `Tất cả folder đều lỗi.${warningDetails ? ` ${warningDetails}${warningTail}` : ''}`
          );
          await scheduleAutoShutdownIfNeeded('pipeline_error', `Summary: all ${totalFolders} folders failed.`);
        } else if (failedFolders.size > 0) {
          await setRunStateForAllSessions(
            'completed',
            `Hoàn thành ${successCount}/${totalFolders} folder, có cảnh báo.${warningDetails ? ` ${warningDetails}${warningTail}` : ''}`
          );
          await scheduleAutoShutdownIfNeeded(
            'pipeline_success',
            `Summary: ${successCount}/${totalFolders} folders completed with warnings.`
          );
        } else {
          await setRunStateForAllSessions(
            'completed',
            isMulti
              ? `Hoàn thành tất cả ${totalFolders} project! (Các bước: ${steps.join(', ')})`
              : `Hoàn thành các bước: ${steps.join(', ')}`
          );
          await scheduleAutoShutdownIfNeeded(
            'pipeline_success',
            isMulti
              ? `Summary: all ${totalFolders} projects completed.`
              : `Summary: completed steps ${steps.join(', ')}.`
          );
        }
        setStatus(
          abortRef.current
            ? 'idle'
            : (failedFolders.size === totalFolders ? 'error' : 'success')
        );
        setStepDependencyIssues([]);
        setProgress({
          current: successCount,
          total: totalFolders,
          message: abortRef.current
            ? `Đã dừng. ${successCount}/${totalFolders} folder hoàn thành.`
            : failedFolders.size === totalFolders
              ? `✗ Tất cả ${totalFolders} folder đều lỗi.${warningDetails ? ` ${warningDetails}${warningTail}` : ''}`
              : failedFolders.size > 0
                ? `✓ Hoàn thành ${successCount}/${totalFolders} folder (có cảnh báo).${warningDetails ? ` ${warningDetails}${warningTail}` : ''}`
            : isMulti
              ? `✓ Hoàn thành tất cả ${totalFolders} project! (Các bước: ${steps.join(', ')})`
              : `✓ Hoàn thành các bước: ${steps.join(', ')}`,
        });
      }
    } catch (err) {
      if (isProcessStopSignal(err) || abortRef.current) {
        const stoppedAt = nowIso();
        const stopCheckpoint = buildStopCheckpoint({
          at: stoppedAt,
          step: lastAttemptedStep || 1,
          folderPath: lastAttemptedFolderPath || inputPaths[0] || '',
          folderIndex: lastAttemptedFolderIndex > 0 ? lastAttemptedFolderIndex : 1,
          totalFolders: totalFolders > 0 ? totalFolders : 1,
          processingMode,
          reason: 'user_stop',
          resumable: true,
        });
        await setRunStateForAllSessions('stopped', 'Đã dừng.', stopCheckpoint);
        setStatus('idle');
        setProgress(p => ({ ...p, message: 'Đã dừng.' }));
      } else {
        await setRunStateForAllSessions('error', `Lỗi: ${String(err)}`);
        setStatus('error');
        setProgress(p => ({ ...p, message: `Lỗi: ${err}` }));
        await scheduleAutoShutdownIfNeeded('pipeline_error', `Unhandled error: ${String(err)}`);
        console.error(err);
      }
    }

    translateBatchProgressHandlerRef.current = null;
    setCurrentStep(null);
    setCurrentFolder(null);
    runIdRef.current = null;
  }, [
    projectId, enabledSteps, entries, inputType, captionFolder,
    settings, audioFiles, stopStep7AudioPreview, resolvedInputPaths, isDraftFilterEmpty,
  ]);

  return {
    enabledSteps,
    toggleStep,
    handleStart,
    handleStop,
    applyManualBatchResponse,
    applyManualBatchTranslatedTexts,
    applyManualBulkResponses,
    validateManualBatchResponse,
    validateManualBulkResponses,
    handleStep7AudioPreview,
    stopStep7AudioPreview,
    status,
    progress,
    currentStep,
    audioFiles,
    audioPreviewStatus,
    audioPreviewProgressText,
    audioPreviewDataUri,
    audioPreviewMeta,
    currentFolder,
    stepDependencyIssues,
  };
}

