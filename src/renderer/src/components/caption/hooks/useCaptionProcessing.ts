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

const PROCESS_STOP_SIGNAL = '__CAPTION_PROCESS_STOPPED__';
function isProcessStopSignal(error: unknown): boolean {
  return error instanceof Error && error.message === PROCESS_STOP_SIGNAL;
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
    srtSpeed: number;
    audioDir: string;
    setAudioDir: (dir: string) => void;
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
    audioSpeed?: number;
    renderAudioSpeed?: number;
    videoVolume?: number;
    audioVolume?: number;
    logoPath?: string;
    logoPosition?: { x: number; y: number } | null;
    logoScale?: number;
    portraitForegroundCropPercent?: number;
    processingMode?: ProcessingMode;
    translateMethod?: 'api' | 'impit' | 'gemini_webapi_queue';
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
    thumbnailTextSecondaryOverrideFlags?: boolean[];
    layoutProfiles?: CaptionProjectSettingsValues['layoutProfiles'];
    settingsRevision?: number;
    settingsUpdatedAt?: string;
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

function resolveProcessOutputDir(inputType: string, currentPath: string): string {
  return inputType === 'draft'
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
    const fallbackText = (current.translatedText && current.translatedText.trim().length > 0)
      ? current.translatedText
      : current.text;
    nextEntries[targetIndex] = {
      ...current,
      translatedText: hasTranslated ? rawText : fallbackText,
    };
  }

  return nextEntries;
}

function normalizeEntriesForSession(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => ({
    ...entry,
    translatedText: entry.translatedText && entry.translatedText.trim().length > 0
      ? entry.translatedText
      : entry.text,
  }));
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
  return inputType === 'draft' ? currentPath.trim().replace(/[\\/]+$/, '') : resolveParentDir(currentPath);
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
  const translateBatchProgressHandlerRef = useRef<((progress: TranslationProgress) => void | Promise<void>) | null>(null);
  const audioPreviewStopRequestedRef = useRef(false);
  const baseInputPaths = useMemo(
    () => getInputPaths(inputType as 'srt' | 'draft', filePath),
    [filePath, inputType]
  );
  const resolvedInputPaths = useMemo(() => {
    if (inputType !== 'draft' || !Array.isArray(inputPathsOverride)) {
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
  const isDraftFilterApplied = inputType === 'draft' && Array.isArray(inputPathsOverride);
  const isDraftFilterEmpty = isDraftFilterApplied && baseInputPaths.length > 0 && resolvedInputPaths.length === 0;

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
          ? 'Không có folder nào thỏa điều kiện lọc để test audio.'
          : 'Chưa có input để test audio.'
      );
      return;
    }

    const normalizePath = (value: string) => value.trim().replace(/[\\/]+$/, '').toLowerCase();
    const requested = folderPath ? normalizePath(folderPath) : '';
    const targetPath = requested
      ? (inputPaths.find((candidatePath) => {
          const folderCandidate = inputType === 'draft'
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
      sourcePath: targetPath,
      folderPath: inputType === 'draft' ? targetPath : targetPath.replace(/[^/\\]+$/, ''),
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

      const folderPathsToSearch = inputType === 'draft'
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
        const folderPath = inputType === 'draft' ? currentPath : currentPath.replace(/[^/\\]+$/, '');
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
            sourcePath: currentPath,
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
    await stopStep7AudioPreview(true);
    setStatus('idle');
    setCurrentFolder(null);
    setCurrentStep(null);
    setProgress(p => ({ ...p, message: 'Đã dừng.' }));
  }, [currentFolder?.index, currentFolder?.path, currentStep, resolvedInputPaths, inputType, projectId, settings.processingMode, stopStep7AudioPreview]);

  const handleStart = useCallback(async () => {
    const steps = Array.from(enabledSteps).sort() as Step[];
    setStepDependencyIssues([]);
    const renderLayoutOverrides = resolveRenderLayoutOverrides(settings);
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
      thumbnailTextSecondaryOverrideFlags: settings.thumbnailTextSecondaryOverrideFlags
        ? [...settings.thumbnailTextSecondaryOverrideFlags]
        : [],
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
      return;
    }

    abortRef.current = false;
    await stopStep7AudioPreview(true);
    setStatus('running');

    // Listen for progress — đăng ký 1 lần với replace (ghi đè listener cũ)
    // @ts-ignore
    window.electronAPI.caption.onTranslateProgress((p: TranslationProgress) => {
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
          ? 'Không có folder nào thỏa điều kiện lọc.'
          : 'Chưa có input để xử lý.',
      });
      return;
    }
    const isMulti = totalFolders > 1;
    const step7Enabled = steps.includes(7);
    const thumbnailEnabled = cfg.thumbnailFrameTimeSec !== null && cfg.thumbnailFrameTimeSec !== undefined;

    const getFolderPath = (currentPath: string) => (
      inputType === 'draft' ? currentPath : currentPath.replace(/[^/\\]+$/, '')
    );
    const getSessionFallback = (currentPath: string) => ({
      projectId,
      inputType: inputType as 'srt' | 'draft',
      sourcePath: currentPath,
      folderPath: getFolderPath(currentPath),
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
      const runningSteps = ([1, 2, 3, 4, 5, 6, 7] as CaptionStepNumber[]).filter((stepNo) => {
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
      const sharedTextPrimary = (
        thumbnailTextForSnapshot
        || cfg.hardsubTextPrimary
        || cfg.hardsubPortraitTextPrimary
        || ''
      ).trim();
      const sharedTextSecondary = (
        thumbnailTextSecondaryForSnapshot
        || cfg.hardsubTextSecondary
        || cfg.hardsubPortraitTextSecondary
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
        srtSpeed: cfg.srtSpeed,
        autoFitAudio: cfg.autoFitAudio,
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
        hardsubTextPrimary: sharedTextPrimary,
        hardsubTextSecondary: sharedTextSecondary,
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
        hardsubPortraitTextPrimary: sharedTextPrimary,
        hardsubPortraitTextSecondary: sharedTextSecondary,
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

    const sharedPrimaryTextForProjectSettings = (
      cfg.thumbnailText
      || cfg.hardsubTextPrimary
      || cfg.hardsubPortraitTextPrimary
      || ''
    ).trim();
    const sharedSecondaryTextForProjectSettings = (
      cfg.thumbnailTextSecondary
      || cfg.hardsubTextSecondary
      || cfg.hardsubPortraitTextSecondary
      || ''
    ).trim();

    const projectSettingsForRun: CaptionProjectSettingsValues = {
      fontSizeScaleVersion: cfg.fontSizeScaleVersion,
      subtitleFontSizeRel: cfg.subtitleFontSizeRel,
      inputType: inputType as 'srt' | 'draft',
      geminiModel: cfg.geminiModel,
      translateMethod: cfg.translateMethod,
      voice: cfg.voice,
      rate: cfg.rate,
      volume: cfg.volume,
      srtSpeed: cfg.srtSpeed,
      splitByLines: cfg.splitByLines,
      linesPerFile: cfg.linesPerFile,
      numberOfParts: cfg.numberOfParts,
      enabledSteps: steps,
      audioDir: cfg.audioDir,
      autoFitAudio: cfg.autoFitAudio,
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
      hardsubPortraitTextPrimary: sharedPrimaryTextForProjectSettings,
      hardsubPortraitTextSecondary: sharedSecondaryTextForProjectSettings,
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
      thumbnailTextSecondaryOverrideFlags: cfg.thumbnailTextSecondaryOverrideFlags,
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
      const folderPath = getFolderPath(currentPath);
      await updateCaptionSession(
        sessionPath,
        (session) => updater({
          ...session,
          updatedAt: nowIso(),
          projectContext: {
            ...session.projectContext,
            projectId: projectId || null,
            inputType: inputType as 'srt' | 'draft',
            sourcePath: currentPath,
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
        throw new Error(PROCESS_STOP_SIGNAL);
      }

      try {
        const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        const sessionFallback = getSessionFallback(currentPath);
        const sessionBeforeStep = await readCaptionSession(sessionPath, sessionFallback);
        previousStepStateBeforeRun = sessionBeforeStep.steps[stepKey];
        const guard = canRunStep(sessionBeforeStep, step as CaptionStepNumber);
        if (!guard.ok) {
          throw new Error(`[${folderName}] ${guard.reason || `Chưa chạy các bước phụ thuộc cho Step ${step}.`} (${guard.code || 'STEP_BLOCKED'})`);
        }
        if (step === 6 && steps.includes(5) && sessionBeforeStep.steps.step5?.status !== 'success') {
          throw new Error(`[${folderName}] Step 6 yêu cầu Step 5 đã hoàn thành trong session khi bạn bật Step 5.`);
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
        if (step === 5 || step === 6) currentDataSource = 'session_tts_audio_files';
        if (step === 7) currentDataSource = 'session_translated_entries+session_merged_audio';

        const skipDecision = shouldSkipStep(sessionBeforeStep, step as CaptionStepNumber);
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
          const parseResult = inputType === 'srt'
            // @ts-ignore
            ? await window.electronAPI.caption.parseSrt(currentPath)
            // @ts-ignore
            : await window.electronAPI.caption.parseDraft(`${currentPath}/draft_content.json`);

          if (parseResult.success && parseResult.data) {
            currentEntries = parseResult.data.entries;
            if (!isMulti) setEntries(currentEntries);
          } else {
            throw new Error(`[${folderName}] Lỗi đọc file draft/srt: ${parseResult.error}`);
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
            pushArtifact(stepArtifacts, 'source_srt', currentPath, 'file');
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
          setProgress({ current: 1, total: 1, message: msgCtx(`Bước 2: Đã tạo ${splitData.partsCount} phần`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const stepArtifacts: CaptionArtifactFile[] = [];
            pushArtifact(stepArtifacts, 'split_output_dir', textOutputDir, 'dir');
            for (const file of splitFiles) {
              pushArtifact(stepArtifacts, 'split_part', file, 'file');
            }
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                step2BatchPlan,
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
                  outputFingerprint: buildObjectFingerprint({
                    partsCount: splitData.partsCount,
                    files: splitFiles,
                    step2BatchPlan,
                  }),
                  dependsOn: [1],
                },
              },
            };
            nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, stepArtifacts);
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
        const linesPerBatch = 50;
        const totalBatches = Math.max(1, Math.ceil(currentEntries.length / linesPerBatch));
        const sessionStep2BatchPlan = Array.isArray(sessionBeforeStep.data.step2BatchPlan)
          ? (sessionBeforeStep.data.step2BatchPlan as StepBatchPlanItem[])
          : [];
        const step3BatchPlan: StepBatchPlanItem[] = sessionStep2BatchPlan.length > 0
          ? sessionStep2BatchPlan
          : buildChunkBatchPlan(currentEntries.length, linesPerBatch);
        const step3BatchPlanByIndex = new Map<number, StepBatchPlanItem>(
          step3BatchPlan.map((item) => [item.batchIndex, item])
        );
        const previousTranslatedEntries = Array.isArray(sessionBeforeStep.data.translatedEntries)
          ? compactEntries(sessionBeforeStep.data.translatedEntries as SubtitleEntry[])
          : [];
        let liveTranslatedEntries = (
          previousTranslatedEntries.length === currentEntries.length
            ? normalizeEntriesForSession(previousTranslatedEntries)
            : normalizeEntriesForSession(compactEntries(currentEntries))
        );
        const previousStep3BatchState = toRecord(sessionBeforeStep.data.step3BatchState);
        const previousMissingBatchIndexes = Array.isArray(previousStep3BatchState.missingBatchIndexes)
          ? previousStep3BatchState.missingBatchIndexes
              .map((value) => Math.floor(Number(value)))
              .filter((value) => Number.isFinite(value) && value >= 1 && value <= totalBatches)
          : [];
        const retryBatchIndexes = Array.from(new Set(previousMissingBatchIndexes)).sort((a, b) => a - b);
        const retryBatchIndexSet = retryBatchIndexes.length > 0 ? new Set<number>(retryBatchIndexes) : null;
        const isStep3RetryMode = !!retryBatchIndexSet && retryBatchIndexSet.size > 0;
        const scheduledBatchIndexes = isStep3RetryMode
          ? retryBatchIndexes
          : step3BatchPlan.map((item) => item.batchIndex);
        const batchReportsMap = new Map<number, SharedTranslationBatchReport>();
        if (isStep3RetryMode && Array.isArray(previousStep3BatchState.batches)) {
          for (const report of previousStep3BatchState.batches as SharedTranslationBatchReport[]) {
            if (!report || typeof report.batchIndex !== 'number') {
              continue;
            }
            const safeBatchIndex = Math.floor(report.batchIndex);
            if (safeBatchIndex < 1 || safeBatchIndex > totalBatches) {
              continue;
            }
            if (retryBatchIndexSet?.has(safeBatchIndex)) {
              continue;
            }
            batchReportsMap.set(safeBatchIndex, { ...report, batchIndex: safeBatchIndex });
          }
        }
        let step3PersistQueue: Promise<void> = Promise.resolve();

        setProgress({
          current: 0,
          total: currentEntries.length,
          message: isStep3RetryMode
            ? msgCtx(`Bước 3: Dịch lại batch lỗi ${retryBatchIndexes.map((idx) => `#${idx}`).join(', ')}...`)
            : msgCtx('Bước 3: Đang dịch...'),
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
              step3BatchState: buildStep3BatchState(totalBatches, initialBatchReports),
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
          if (progressEvent.eventType !== 'batch_completed' && progressEvent.eventType !== 'batch_failed') {
            return;
          }
          step3PersistQueue = step3PersistQueue
            .catch(() => undefined)
            .then(async () => {
              if (progressEvent.translatedChunk) {
                liveTranslatedEntries = mergeTranslatedChunkIntoEntries(liveTranslatedEntries, progressEvent.translatedChunk);
              }
              const incomingBatchReport = progressEvent.batchReport
                ? ({ ...progressEvent.batchReport } as SharedTranslationBatchReport)
                : deriveBatchReportFromProgress(progressEvent);
              if (incomingBatchReport) {
                batchReportsMap.set(incomingBatchReport.batchIndex, incomingBatchReport);
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
                  step3BatchState,
                },
                runtime: {
                  ...session.runtime,
                  lastMessage: msgCtx(progressEvent.message || `Bước 3: Cập nhật batch #${incomingBatchReport?.batchIndex || '?'}`),
                },
              }));
            });
          await step3PersistQueue;
        };

        let result: any;
        try {
          // @ts-ignore
          result = await window.electronAPI.caption.translate({
            entries: liveTranslatedEntries,
            targetLanguage: 'Vietnamese',
            model: cfg.geminiModel,
            linesPerBatch,
            translateMethod: cfg.translateMethod,
            retryBatchIndexes: isStep3RetryMode ? retryBatchIndexes : undefined,
            projectId: projectId || undefined,
            sourcePath: currentPath,
          });
        } finally {
          translateBatchProgressHandlerRef.current = null;
        }
        await step3PersistQueue;

        const backendCallSucceeded = result?.success === true;
        const backendErrorMessage = typeof result?.error === 'string' && result.error.trim().length > 0
          ? result.error.trim()
          : 'TRANSLATE_CALL_FAILED';
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
        }

        const buildFallbackFailedReport = (
          batchIndex: number,
          errorText: string
        ): SharedTranslationBatchReport | null => {
          const batchPlan = step3BatchPlanByIndex.get(batchIndex);
          if (!batchPlan) {
            return null;
          }
          const expectedLines = Math.max(0, batchPlan.lineCount || (batchPlan.endIndex - batchPlan.startIndex + 1));
          const missingLinesInBatch = Array.from({ length: expectedLines }, (_, idx) => idx + 1);
          const missingGlobalLineIndexes = Array.from({ length: expectedLines }, (_, idx) => batchPlan.startIndex + idx + 1);
          const translatedLines = missingGlobalLineIndexes.reduce((sum, globalLineIndex) => {
            const existing = liveTranslatedEntries[globalLineIndex - 1];
            const text = typeof existing?.translatedText === 'string' ? existing.translatedText : '';
            return sum + (text.trim().length > 0 ? 1 : 0);
          }, 0);
          return {
            batchIndex,
            startIndex: batchPlan.startIndex,
            endIndex: batchPlan.endIndex,
            expectedLines,
            translatedLines,
            missingLinesInBatch,
            missingGlobalLineIndexes,
            attempts: 1,
            status: 'failed',
            error: errorText,
          };
        };

        const fallbackFailureReason = backendCallSucceeded
          ? 'MISSING_BATCH_REPORT'
          : `TRANSLATE_CALL_FAILED: ${backendErrorMessage}`;
        for (const batchIndex of scheduledBatchIndexes) {
          if (batchReportsMap.has(batchIndex)) {
            continue;
          }
          const fallbackReport = buildFallbackFailedReport(batchIndex, fallbackFailureReason);
          if (fallbackReport) {
            batchReportsMap.set(batchIndex, fallbackReport);
          }
        }

        const finalBatchReports = Array.from(batchReportsMap.values()).sort((a, b) => a.batchIndex - b.batchIndex);
        const generatedStep3BatchState = buildStep3BatchState(totalBatches, finalBatchReports);
        const backendMissingBatchIndexes = Array.isArray(translateData.missingBatchIndexes)
          ? (translateData.missingBatchIndexes as number[])
          : [];
        const backendMissingGlobalLineIndexes = Array.isArray(translateData.missingGlobalLineIndexes)
          ? (translateData.missingGlobalLineIndexes as number[])
          : [];
        const scheduledMissingGlobalLineIndexes = Array.from(new Set(
          scheduledBatchIndexes.flatMap((batchIndex) => {
            const batchPlan = step3BatchPlanByIndex.get(batchIndex);
            if (!batchPlan) {
              return [];
            }
            const expectedLines = Math.max(0, batchPlan.lineCount || (batchPlan.endIndex - batchPlan.startIndex + 1));
            return Array.from({ length: expectedLines }, (_, idx) => batchPlan.startIndex + idx + 1);
          })
        )).sort((a, b) => a - b);
        const missingBatchIndexes: number[] = generatedStep3BatchState.missingBatchIndexes.length > 0
          ? generatedStep3BatchState.missingBatchIndexes
          : Array.from(new Set(
            backendMissingBatchIndexes.length > 0
              ? backendMissingBatchIndexes
              : (!backendCallSucceeded ? scheduledBatchIndexes : [])
          )).sort((a, b) => a - b);
        const missingGlobalLineIndexes: number[] = generatedStep3BatchState.missingGlobalLineIndexes.length > 0
          ? generatedStep3BatchState.missingGlobalLineIndexes
          : Array.from(new Set(
            backendMissingGlobalLineIndexes.length > 0
              ? backendMissingGlobalLineIndexes
              : (!backendCallSucceeded ? scheduledMissingGlobalLineIndexes : [])
          )).sort((a, b) => a - b);
        const finalStep3BatchState: Step3BatchState = {
          ...generatedStep3BatchState,
          failedBatches: Math.max(generatedStep3BatchState.failedBatches, missingBatchIndexes.length),
          missingBatchIndexes,
          missingGlobalLineIndexes,
          updatedAt: nowIso(),
        };
        const failedLines = missingGlobalLineIndexes.length;
        const translatedLines = finalBatchReports.length > 0
          ? finalBatchReports.reduce((sum, report) => sum + report.translatedLines, 0)
          : (typeof translateData.translatedLines === 'number' ? translateData.translatedLines : 0);

        currentEntries = normalizeEntriesForSession(compactEntries(liveTranslatedEntries));
        if (!isMulti) setEntries(currentEntries);
        srtFileForVideo = `${processOutputDir}/srt/translated.srt`;
        const translatedSrtContent = entriesToSrtText(currentEntries);
        // @ts-ignore
        await window.electronAPI.caption.exportSrt(currentEntries, srtFileForVideo);

        const isStep3Complete = backendCallSucceeded && missingBatchIndexes.length === 0 && failedLines === 0;
        setProgress({
          current: translatedLines,
          total: currentEntries.length,
          message: isStep3Complete
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
            ? `STEP3_BACKEND_FAILED: ${backendErrorMessage}`
            : `STEP3_MISSING_BATCHES: ${missingBatchIndexes.map((idx) => `#${idx}`).join(', ') || 'unknown'}`;
          const nextStepState = isStep3Complete
            ? {
                ...makeStepSuccess(session.steps[stepKey], stepMetrics),
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
              };

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
              lastMessage: isStep3Complete
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
          const fallbackMissingDetails = missingBatchIndexes
            .map((batchIndex) => `#${batchIndex}`)
            .join(', ');
          const fallbackMissingRanges = formatIndexRanges(missingGlobalLineIndexes);
          const missingMessage = finalBatchReports.length > 0
            ? formatMissingBatchMessage(folderName, finalBatchReports)
            : `[${folderName}] Step 3 thiếu batch: ${fallbackMissingDetails || 'không rõ'} | tổng thiếu ${failedLines} dòng global: ${fallbackMissingRanges}`;
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
          outputFormat: 'wav',
        };
        if (!isCapCutVoice) {
          ttsGenerateOptions.rate = cfg.rate;
          ttsGenerateOptions.volume = cfg.volume;
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
          throw new Error(`[${folderName}] Lỗi tạo audio: ${result.error}`);
        }
      }

      // ========== STEP 5: TRIM SILENCE ==========
      if (step === 5) {
        const filesToTrim = currentAudioFiles;
        if (filesToTrim.length > 0) {
          setProgress({ current: 0, total: filesToTrim.length, message: msgCtx('Bước 5: Đang cắt khoảng lặng...') });
          // @ts-ignore
          const result = await window.electronAPI.tts.trimSilence(filesToTrim.map(f => f.path));
          // @ts-ignore
          const resultEnd = await window.electronAPI.tts.trimSilenceEnd(filesToTrim.map(f => f.path));
          if (result.success && result.data && resultEnd.success && resultEnd.data) {
            const trimmedMiddleData = result.data;
            const trimmedEndData = resultEnd.data;
            const trimmedCount = trimmedEndData.trimmedCount;
            setProgress({ current: trimmedCount, total: filesToTrim.length, message: msgCtx(`Bước 5: Đã trim ${trimmedCount} files`) });
            await updateSessionForStep(currentPath, step, folderIdx, (session) => {
              const stepArtifacts: CaptionArtifactFile[] = [];
              for (const file of filesToTrim) {
                pushArtifact(stepArtifacts, 'trimmed_audio_clip', file.path, 'file');
              }
              const inputFingerprint = buildObjectFingerprint(
                filesToTrim.map((file) => ({
                  path: file.path,
                  startMs: file.startMs,
                  durationMs: file.durationMs,
                }))
              );
              const outputFingerprint = buildObjectFingerprint({
                trimmedMiddle: trimmedMiddleData,
                trimmedEnd: trimmedEndData,
              });
              const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
              let nextSession: CaptionSessionV1 = {
                ...session,
                data: {
                  ...session.data,
                  trimResults: {
                    trimmedMiddle: trimmedMiddleData,
                    trimmedEnd: trimmedEndData,
                  },
                },
                steps: {
                  ...session.steps,
                  [stepKey]: {
                    ...makeStepSuccess(session.steps[stepKey], {
                      totalFiles: filesToTrim.length,
                      trimmedCount,
                    }),
                    inputFingerprint,
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
                  'STEP5_OUTPUT_CHANGED',
                  steps as CaptionStepNumber[]
                );
              }
              return nextSession;
            });
          } else {
            throw new Error(`[${folderName}] Lỗi trim silence: ${result.error || resultEnd.error}`);
          }
        } else {
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            let nextSession: CaptionSessionV1 = {
              ...session,
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    totalFiles: 0,
                    skipped: true,
                  }),
                  inputFingerprint: buildObjectFingerprint([]),
                  outputFingerprint: buildObjectFingerprint({ skipped: true }),
                  dependsOn: [4],
                },
              },
            };
            nextSession = setStepArtifacts(nextSession, step as CaptionStepNumber, []);
            return nextSession;
          });
        }
      }

      // ========== STEP 6: MERGE AUDIO ==========
      if (step === 6) {
        let filesToMerge = normalizeAudioFiles(currentAudioFiles);

        if (filesToMerge.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu audio từ Step 4 trong caption_session.json. Hãy chạy Step 4 trước.`);
        }

        if (cfg.autoFitAudio) {
          if (currentEntries.length === 0) {
            throw new Error(`[${folderName}] Thiếu dữ liệu subtitle dịch trong session để fit audio. Hãy chạy Step 3 trước.`);
          }
          setProgress({ current: 0, total: filesToMerge.length, message: msgCtx('Bước 6: Đang scale audio vừa thời lượng...') });
          const fitItems = filesToMerge
            .map(f => {
              const entryByIndex = currentEntries.find(e => e.index === f.index);
              const entryByStart = currentEntries.find(e => e.startMs === f.startMs);
              const allowedDurationMs = f.durationMs > 0
                ? f.durationMs
                : (entryByIndex?.durationMs || entryByStart?.durationMs || 0);
              return { path: f.path, durationMs: allowedDurationMs };
            })
            .filter(item => item.durationMs > 0);

          if (fitItems.length > 0) {
            // @ts-ignore
            const fitResult = await window.electronAPI.tts.fitAudio(fitItems);
            if (fitResult.success && fitResult.data) {
              const fitData = fitResult.data as {
                scaledCount?: number;
                pathMapping?: Array<{ originalPath: string; outputPath: string }>;
              };
              const scaledCount = Number.isFinite(fitData.scaledCount) ? (fitData.scaledCount as number) : 0;
              const pathMapping = Array.isArray(fitData.pathMapping) ? fitData.pathMapping : [];
              setProgress({ current: scaledCount, total: fitItems.length, message: msgCtx(`Bước 6: Đã fit ${scaledCount}/${fitItems.length} files`) });
              for (const mapping of pathMapping) {
                const idx = filesToMerge.findIndex(f => f.path === mapping.originalPath);
                if (idx !== -1 && mapping.outputPath !== mapping.originalPath) {
                  filesToMerge[idx] = { ...filesToMerge[idx], path: mapping.outputPath, success: true };
                }
              }
            } else {
              console.warn(`[${folderName}] Cảnh báo fit audio: ${fitResult.error}`);
            }
          }
        }

        const safeSrtSpeed = cfg.srtSpeed > 0 ? cfg.srtSpeed : 1.0;
        const speedLabel = normalizeSpeedLabel(safeSrtSpeed);
        const mergedPath = `${processOutputDir}/merged_audio_${speedLabel}x.wav`;
        setProgress({ current: 0, total: 1, message: msgCtx('Bước 6: Đang ghép audio...') });
        // @ts-ignore
        const result = await window.electronAPI.tts.mergeAudio(filesToMerge, mergedPath, safeSrtSpeed);
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
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const stepArtifacts: CaptionArtifactFile[] = [];
            pushArtifact(stepArtifacts, 'merged_audio', actualMergedOutputPath, 'file');
            for (const file of filesToMerge) {
              pushArtifact(stepArtifacts, 'merge_input_audio', file.path, 'file');
            }
            const outputFingerprint = buildObjectFingerprint({
              mergedPath: actualMergedOutputPath,
              filesCount: filesToMerge.length,
              srtSpeed: safeSrtSpeed,
              speedLabel,
            });
            const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                mergeResult: mergeResultPayload,
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
                  }),
                  inputFingerprint: buildObjectFingerprint(filesToMerge.map((file) => ({
                    path: file.path,
                    startMs: file.startMs,
                    durationMs: file.durationMs,
                  }))),
                  outputFingerprint,
                  dependsOn: steps.includes(5) ? [4, 5] : [4],
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
          throw new Error(PROCESS_STOP_SIGNAL);
        }
        const sessionPathForStep7 = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        const sessionFallback = {
          projectId,
          inputType: inputType as 'srt' | 'draft',
          sourcePath: currentPath,
          folderPath: inputType === 'draft' ? currentPath : currentPath.replace(/[^/\\]+$/, ''),
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
        const folderPathsToSearch = inputType === 'draft' ? [currentPath] : [currentPath.replace(/[^/\\]+$/, '')];
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
        const sharedPrimaryTextForRender = (
          thumbnailTextForRender
          || cfg.hardsubTextPrimary
          || cfg.hardsubPortraitTextPrimary
          || ''
        ).trim();
        const sharedSecondaryTextForRender = (
          thumbnailTextSecondaryForRender
          || cfg.hardsubTextSecondary
          || cfg.hardsubPortraitTextSecondary
          || ''
        ).trim();
        const finalVideoFileName = buildRenderedVideoName(
          cfg.renderMode,
          cfg.renderContainer || 'mp4',
          thumbnailTextForRender
        );
        const renderOutputDir = resolveRenderOutputDir(inputType, currentPath, finalVideoInputPath);
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
          `text1="${thumbnailTextForRender}", text2="${thumbnailTextSecondaryForRender}"`
        );

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
          thumbnailEnabled,
          thumbnailDurationSec: cfg.thumbnailDurationSec,
          thumbnailTimeSec: cfg.thumbnailFrameTimeSec ?? undefined,
          thumbnailText: thumbnailTextForRender,
          thumbnailTextSecondary: thumbnailTextSecondaryForRender,
          hardsubTextPrimary: sharedPrimaryTextForRender,
          hardsubTextSecondary: sharedSecondaryTextForRender,
          hardsubPortraitTextPrimary: sharedPrimaryTextForRender,
          hardsubPortraitTextSecondary: sharedSecondaryTextForRender,
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
            throw new Error(PROCESS_STOP_SIGNAL);
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
        } else {
          await setRunStateForAllSessions(
            'completed',
            `Hoàn thành ${successCount}/${totalFolders} folder (Bước: ${steps.join(', ')})${failMsg}`
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
        } else if (failedFolders.size > 0) {
          await setRunStateForAllSessions(
            'completed',
            `Hoàn thành ${successCount}/${totalFolders} folder, có cảnh báo.${warningDetails ? ` ${warningDetails}${warningTail}` : ''}`
          );
        } else {
          await setRunStateForAllSessions(
            'completed',
            isMulti
              ? `Hoàn thành tất cả ${totalFolders} project! (Các bước: ${steps.join(', ')})`
              : `Hoàn thành các bước: ${steps.join(', ')}`
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
        console.error(err);
      }
    }

    translateBatchProgressHandlerRef.current = null;
    setCurrentStep(null);
    setCurrentFolder(null);
  }, [
    projectId, enabledSteps, entries, inputType, captionFolder,
    settings, audioFiles, stopStep7AudioPreview, resolvedInputPaths, isDraftFilterEmpty,
  ]);

  return {
    enabledSteps,
    toggleStep,
    handleStart,
    handleStop,
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
