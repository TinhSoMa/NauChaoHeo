import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  DEFAULT_INPUT_TYPE,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
  DEFAULT_SRT_SPEED,
  DEFAULT_SPLIT_BY_LINES,
  DEFAULT_LINES_PER_FILE,
  DEFAULT_NUMBER_OF_PARTS,
  InputType,
} from '../../../config/captionConfig';
import { Step, ProcessingMode } from '../CaptionTypes';
import { ASSStyleConfig, CaptionProjectSettings } from '@shared/types/caption';
import { useProjectContext } from '../../../context/ProjectContext';
import { nowIso } from '@shared/utils/captionSession';

const PROJECT_SETTINGS_FILE = 'caption-settings.json';

type RenderMode = 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
type RenderResolution = 'original' | '1080p' | '720p' | '540p' | '360p';
type LayoutKey = 'landscape' | 'portrait';

interface LayoutProfile {
  style: ASSStyleConfig;
  renderResolution: RenderResolution;
  renderContainer: 'mp4' | 'mov';
  blackoutTop: number | null;
  foregroundCropPercent: number;
  subtitlePosition: { x: number; y: number } | null;
  thumbnailFrameTimeSec: number | null;
  thumbnailDurationSec: number;
  thumbnailTextSecondary: string;
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale: number;
  // Legacy font chung (giữ để tương thích dữ liệu cũ)
  thumbnailFontName: string;
  thumbnailFontSize: number;
  // Font riêng cho từng text
  thumbnailTextPrimaryFontName: string;
  thumbnailTextPrimaryFontSize: number;
  thumbnailTextSecondaryFontName: string;
  thumbnailTextSecondaryFontSize: number;
  thumbnailLineHeightRatio: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
}

interface LayoutProfilesState {
  landscape: LayoutProfile;
  portrait: LayoutProfile;
}

interface CaptionTypographyLayoutDefaults {
  style: ASSStyleConfig;
  subtitlePosition: { x: number; y: number } | null;
  thumbnailTextPrimaryFontName: string;
  thumbnailTextPrimaryFontSize: number;
  thumbnailTextSecondaryFontName: string;
  thumbnailTextSecondaryFontSize: number;
  thumbnailLineHeightRatio: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
}

interface CaptionTypographyDefaults {
  schemaVersion: 1;
  landscape: CaptionTypographyLayoutDefaults;
  portrait: CaptionTypographyLayoutDefaults;
}

export const DEFAULT_STYLE: ASSStyleConfig = {
  fontName: 'ZYVNA Fairy',
  fontSize: 62,
  fontColor: '#FFFF00',
  shadow: 4,
  marginV: 50,
  alignment: 2,
};

const MIN_SUBTITLE_FONT_SIZE = 1;
const MAX_SUBTITLE_FONT_SIZE = 1000;
const MIN_SUBTITLE_SHADOW = 0;
const MAX_SUBTITLE_SHADOW = 20;

const DEFAULT_THUMBNAIL_FONT_NAME = 'BrightwallPersonal';
const DEFAULT_THUMBNAIL_FONT_SIZE = 145;
const DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO = 1.16;
const MIN_THUMBNAIL_FONT_SIZE = 24;
const MAX_THUMBNAIL_FONT_SIZE = 400;
const MIN_THUMBNAIL_LINE_HEIGHT_RATIO = 0;
const MAX_THUMBNAIL_LINE_HEIGHT_RATIO = 4;

function normalizeAssStyle(style: ASSStyleConfig, fallback: ASSStyleConfig = DEFAULT_STYLE): ASSStyleConfig {
  const fontName = typeof style.fontName === 'string' && style.fontName.trim().length > 0
    ? style.fontName.trim()
    : fallback.fontName;
  const fontColor = typeof style.fontColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(style.fontColor)
    ? style.fontColor
    : fallback.fontColor;
  const fontSize = Number.isFinite(style.fontSize)
    ? Math.min(MAX_SUBTITLE_FONT_SIZE, Math.max(MIN_SUBTITLE_FONT_SIZE, Math.round(style.fontSize)))
    : fallback.fontSize;
  const shadow = Number.isFinite(style.shadow)
    ? Math.min(MAX_SUBTITLE_SHADOW, Math.max(MIN_SUBTITLE_SHADOW, style.shadow))
    : fallback.shadow;
  const marginV = Number.isFinite(style.marginV) ? style.marginV : fallback.marginV;
  const alignment = [2, 5, 8].includes(style.alignment) ? style.alignment : fallback.alignment;

  return {
    fontName,
    fontSize,
    fontColor,
    shadow,
    marginV,
    alignment,
  };
}

const DEFAULT_LANDSCAPE_PROFILE: LayoutProfile = {
  style: { ...DEFAULT_STYLE },
  renderResolution: 'original',
  renderContainer: 'mp4',
  blackoutTop: 0.9,
  foregroundCropPercent: 0,
  subtitlePosition: null,
  thumbnailFrameTimeSec: null,
  thumbnailDurationSec: 0.5,
  thumbnailTextSecondary: '',
  logoPath: undefined,
  logoPosition: undefined,
  logoScale: 1.0,
  thumbnailFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextPrimaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextPrimaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextSecondaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextSecondaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailLineHeightRatio: DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO,
  thumbnailTextPrimaryPosition: { x: 0.5, y: 0.5 },
  thumbnailTextSecondaryPosition: { x: 0.5, y: 0.64 },
};

const DEFAULT_PORTRAIT_PROFILE: LayoutProfile = {
  style: { ...DEFAULT_STYLE },
  renderResolution: '1080p',
  renderContainer: 'mp4',
  blackoutTop: 0.9,
  foregroundCropPercent: 0,
  subtitlePosition: null,
  thumbnailFrameTimeSec: null,
  thumbnailDurationSec: 0.5,
  thumbnailTextSecondary: '',
  logoPath: undefined,
  logoPosition: undefined,
  logoScale: 1.0,
  thumbnailFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextPrimaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextPrimaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailTextSecondaryFontName: DEFAULT_THUMBNAIL_FONT_NAME,
  thumbnailTextSecondaryFontSize: DEFAULT_THUMBNAIL_FONT_SIZE,
  thumbnailLineHeightRatio: DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO,
  thumbnailTextPrimaryPosition: { x: 0.5, y: 0.5 },
  thumbnailTextSecondaryPosition: { x: 0.5, y: 0.64 },
};

function cloneProfile(profile: LayoutProfile): LayoutProfile {
  return {
    ...profile,
    style: { ...profile.style },
    subtitlePosition: profile.subtitlePosition ? { ...profile.subtitlePosition } : null,
    logoPosition: profile.logoPosition ? { ...profile.logoPosition } : undefined,
    thumbnailTextPrimaryPosition: { ...profile.thumbnailTextPrimaryPosition },
    thumbnailTextSecondaryPosition: { ...profile.thumbnailTextSecondaryPosition },
  };
}

function normalizeProfile(
  patch: Record<string, unknown> | undefined,
  fallback: LayoutProfile,
  layoutKey: LayoutKey
): LayoutProfile {
  const next = cloneProfile(fallback);
  if (!patch || typeof patch !== 'object') {
    return next;
  }

  const style = patch.style as ASSStyleConfig | undefined;
  if (style && typeof style === 'object') {
    next.style = normalizeAssStyle({ ...next.style, ...style }, fallback.style);
  }
  if (patch.renderResolution && typeof patch.renderResolution === 'string') {
    const requested = patch.renderResolution as RenderResolution;
    // Portrait không hỗ trợ "original" trong thực tế render canvas.
    next.renderResolution = layoutKey === 'portrait' && requested === 'original'
      ? '1080p'
      : requested;
  }
  if (patch.renderContainer === 'mp4' || patch.renderContainer === 'mov') {
    next.renderContainer = patch.renderContainer;
  }
  if (patch.blackoutTop === null || typeof patch.blackoutTop === 'number') {
    next.blackoutTop = patch.blackoutTop as number | null;
  }
  if (typeof patch.foregroundCropPercent === 'number') {
    next.foregroundCropPercent = Math.min(20, Math.max(0, patch.foregroundCropPercent));
  }
  if (patch.subtitlePosition === null) {
    next.subtitlePosition = null;
  } else if (patch.subtitlePosition && typeof patch.subtitlePosition === 'object') {
    const p = patch.subtitlePosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.subtitlePosition = { x: p.x, y: p.y };
    }
  }
  if (patch.thumbnailFrameTimeSec === null || typeof patch.thumbnailFrameTimeSec === 'number') {
    next.thumbnailFrameTimeSec = patch.thumbnailFrameTimeSec as number | null;
  }
  if (typeof patch.thumbnailDurationSec === 'number' && Number.isFinite(patch.thumbnailDurationSec)) {
    next.thumbnailDurationSec = Math.min(10, Math.max(0.1, patch.thumbnailDurationSec));
  }
  if (typeof patch.thumbnailTextSecondary === 'string') {
    next.thumbnailTextSecondary = patch.thumbnailTextSecondary;
  }
  if (typeof patch.logoPath === 'string' && patch.logoPath.trim().length > 0) {
    next.logoPath = patch.logoPath;
  } else if (patch.logoPath === null || patch.logoPath === undefined) {
    next.logoPath = undefined;
  }
  if (patch.logoPosition === null) {
    next.logoPosition = undefined;
  } else if (patch.logoPosition && typeof patch.logoPosition === 'object') {
    const p = patch.logoPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.logoPosition = { x: p.x, y: p.y };
    }
  }
  if (typeof patch.logoScale === 'number') {
    next.logoScale = patch.logoScale;
  }
  const legacyFontName = typeof patch.thumbnailFontName === 'string' && patch.thumbnailFontName.trim().length > 0
    ? patch.thumbnailFontName.trim()
    : null;
  const legacyFontSize = typeof patch.thumbnailFontSize === 'number' && Number.isFinite(patch.thumbnailFontSize)
    ? Math.min(MAX_THUMBNAIL_FONT_SIZE, Math.max(MIN_THUMBNAIL_FONT_SIZE, Math.round(patch.thumbnailFontSize)))
    : null;
  if (legacyFontName) {
    next.thumbnailFontName = legacyFontName;
    next.thumbnailTextPrimaryFontName = legacyFontName;
    next.thumbnailTextSecondaryFontName = legacyFontName;
  }
  if (legacyFontSize != null) {
    next.thumbnailFontSize = legacyFontSize;
    next.thumbnailTextPrimaryFontSize = legacyFontSize;
    next.thumbnailTextSecondaryFontSize = legacyFontSize;
  }
  if (typeof patch.thumbnailTextPrimaryFontName === 'string' && patch.thumbnailTextPrimaryFontName.trim().length > 0) {
    next.thumbnailTextPrimaryFontName = patch.thumbnailTextPrimaryFontName.trim();
  }
  if (typeof patch.thumbnailTextPrimaryFontSize === 'number' && Number.isFinite(patch.thumbnailTextPrimaryFontSize)) {
    next.thumbnailTextPrimaryFontSize = Math.min(
      MAX_THUMBNAIL_FONT_SIZE,
      Math.max(MIN_THUMBNAIL_FONT_SIZE, Math.round(patch.thumbnailTextPrimaryFontSize))
    );
  }
  if (typeof patch.thumbnailTextSecondaryFontName === 'string' && patch.thumbnailTextSecondaryFontName.trim().length > 0) {
    next.thumbnailTextSecondaryFontName = patch.thumbnailTextSecondaryFontName.trim();
  }
  if (typeof patch.thumbnailTextSecondaryFontSize === 'number' && Number.isFinite(patch.thumbnailTextSecondaryFontSize)) {
    next.thumbnailTextSecondaryFontSize = Math.min(
      MAX_THUMBNAIL_FONT_SIZE,
      Math.max(MIN_THUMBNAIL_FONT_SIZE, Math.round(patch.thumbnailTextSecondaryFontSize))
    );
  }
  if (typeof patch.thumbnailLineHeightRatio === 'number' && Number.isFinite(patch.thumbnailLineHeightRatio)) {
    next.thumbnailLineHeightRatio = Math.min(
      MAX_THUMBNAIL_LINE_HEIGHT_RATIO,
      Math.max(MIN_THUMBNAIL_LINE_HEIGHT_RATIO, patch.thumbnailLineHeightRatio)
    );
  }
  // Legacy fields luôn mirror theo Text1 để giữ tương thích các luồng cũ.
  next.thumbnailFontName = next.thumbnailTextPrimaryFontName;
  next.thumbnailFontSize = next.thumbnailTextPrimaryFontSize;
  if (patch.thumbnailTextPrimaryPosition && typeof patch.thumbnailTextPrimaryPosition === 'object') {
    const p = patch.thumbnailTextPrimaryPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.thumbnailTextPrimaryPosition = {
        x: Math.min(1, Math.max(0, p.x)),
        y: Math.min(1, Math.max(0, p.y)),
      };
    }
  }
  if (patch.thumbnailTextSecondaryPosition && typeof patch.thumbnailTextSecondaryPosition === 'object') {
    const p = patch.thumbnailTextSecondaryPosition as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      next.thumbnailTextSecondaryPosition = {
        x: Math.min(1, Math.max(0, p.x)),
        y: Math.min(1, Math.max(0, p.y)),
      };
    }
  }
  next.style = normalizeAssStyle(next.style, fallback.style);
  return next;
}

function resolveLayoutKey(renderMode: RenderMode): LayoutKey {
  return renderMode === 'hardsub_portrait_9_16' ? 'portrait' : 'landscape';
}

function createDefaultLayoutProfiles(): LayoutProfilesState {
  return {
    landscape: cloneProfile(DEFAULT_LANDSCAPE_PROFILE),
    portrait: cloneProfile(DEFAULT_PORTRAIT_PROFILE),
  };
}

function toTypographyLayoutDefaults(profile: LayoutProfile): CaptionTypographyLayoutDefaults {
  return {
    style: { ...profile.style },
    subtitlePosition: profile.subtitlePosition ? { ...profile.subtitlePosition } : null,
    thumbnailTextPrimaryFontName: profile.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: profile.thumbnailTextPrimaryFontSize,
    thumbnailTextSecondaryFontName: profile.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: profile.thumbnailTextSecondaryFontSize,
    thumbnailLineHeightRatio: profile.thumbnailLineHeightRatio,
    thumbnailTextPrimaryPosition: { ...profile.thumbnailTextPrimaryPosition },
    thumbnailTextSecondaryPosition: { ...profile.thumbnailTextSecondaryPosition },
  };
}

function buildTypographyDefaults(layoutProfiles: LayoutProfilesState): CaptionTypographyDefaults {
  return {
    schemaVersion: 1,
    landscape: toTypographyLayoutDefaults(layoutProfiles.landscape),
    portrait: toTypographyLayoutDefaults(layoutProfiles.portrait),
  };
}

function typographyDefaultsFingerprint(value: CaptionTypographyDefaults): string {
  return JSON.stringify(value);
}

function buildGlobalFallbackProfiles(rawDefaults: unknown): LayoutProfilesState {
  const defaults = createDefaultLayoutProfiles();
  if (!rawDefaults || typeof rawDefaults !== 'object') {
    return defaults;
  }
  const typed = rawDefaults as Partial<CaptionTypographyDefaults>;
  if (typed.schemaVersion !== 1) {
    return defaults;
  }

  return {
    landscape: normalizeProfile(
      typed.landscape as unknown as Record<string, unknown> | undefined,
      defaults.landscape,
      'landscape'
    ),
    portrait: normalizeProfile(
      typed.portrait as unknown as Record<string, unknown> | undefined,
      defaults.portrait,
      'portrait'
    ),
  };
}

export function useCaptionSettings() {
  const { projectId, paths } = useProjectContext();

  const [inputType, setInputType] = useState<InputType>(DEFAULT_INPUT_TYPE);
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [srtSpeed, setSrtSpeed] = useState(DEFAULT_SRT_SPEED);

  const [splitByLines, setSplitByLines] = useState(DEFAULT_SPLIT_BY_LINES);
  const [linesPerFile, setLinesPerFile] = useState(DEFAULT_LINES_PER_FILE);
  const [numberOfParts, setNumberOfParts] = useState(DEFAULT_NUMBER_OF_PARTS);

  const [audioDir, setAudioDir] = useState('');
  const [autoFitAudio, setAutoFitAudio] = useState(false);

  const [hardwareAcceleration, setHardwareAcceleration] = useState<'none' | 'qsv'>('qsv');
  const [renderMode, setRenderMode] = useState<RenderMode>('hardsub');
  const [audioSpeed, setAudioSpeed] = useState<number>(1.0);
  const [renderAudioSpeed, setRenderAudioSpeed] = useState<number>(1.0);
  const [videoVolume, setVideoVolume] = useState<number>(100);
  const [audioVolume, setAudioVolume] = useState<number>(100);

  const [layoutProfiles, setLayoutProfiles] = useState<LayoutProfilesState>(createDefaultLayoutProfiles);

  const [enabledSteps, setEnabledSteps] = useState<Set<Step>>(new Set([1, 2, 3, 4, 5, 6, 7]));
  const [translateMethod, setTranslateMethod] = useState<'api' | 'impit'>('api');
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('folder-first');

  const [settingsRevision, setSettingsRevision] = useState<number>(0);
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState<string>(nowIso());

  const loadedRef = useRef(false);
  const isHydratingRef = useRef(false);
  const typographyDefaultsDirtyRef = useRef(false);
  const [typographyDefaultsDirtyTick, setTypographyDefaultsDirtyTick] = useState(0);
  const lastSavedGlobalTypographyFingerprintRef = useRef('');
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef(0);

  useEffect(() => {
    saveQueueRef.current = Promise.resolve();
    revisionRef.current = 0;
    typographyDefaultsDirtyRef.current = false;
    setTypographyDefaultsDirtyTick(0);
  }, [projectId]);

  const activeLayoutKey = resolveLayoutKey(renderMode);
  const activeProfile = layoutProfiles[activeLayoutKey];

  const markTypographyDefaultsDirty = useCallback(() => {
    if (isHydratingRef.current) {
      return;
    }
    typographyDefaultsDirtyRef.current = true;
    setTypographyDefaultsDirtyTick((prev) => prev + 1);
  }, []);

  const updateActiveProfile = useCallback(
    (updater: (current: LayoutProfile) => LayoutProfile) => {
      setLayoutProfiles((prev) => ({
        ...prev,
        [activeLayoutKey]: updater(prev[activeLayoutKey]),
      }));
    },
    [activeLayoutKey]
  );

  const setStyle = useCallback(
    (value: ASSStyleConfig | ((prev: ASSStyleConfig) => ASSStyleConfig)) => {
      markTypographyDefaultsDirty();
      updateActiveProfile((current) => {
        const nextStyle = typeof value === 'function'
          ? (value as (prev: ASSStyleConfig) => ASSStyleConfig)(current.style)
          : value;
        return { ...current, style: normalizeAssStyle({ ...nextStyle }, current.style) };
      });
    },
    [markTypographyDefaultsDirty, updateActiveProfile]
  );

  const setRenderResolution = useCallback((value: RenderResolution) => {
    updateActiveProfile((current) => ({ ...current, renderResolution: value }));
  }, [updateActiveProfile]);

  const setRenderContainer = useCallback((value: 'mp4' | 'mov') => {
    updateActiveProfile((current) => ({ ...current, renderContainer: value }));
  }, [updateActiveProfile]);

  const setBlackoutTop = useCallback((value: number | null) => {
    updateActiveProfile((current) => ({ ...current, blackoutTop: value }));
  }, [updateActiveProfile]);

  const setForegroundCropPercent = useCallback((value: number) => {
    const normalized = Math.min(20, Math.max(0, Number.isFinite(value) ? value : 0));
    updateActiveProfile((current) => ({ ...current, foregroundCropPercent: normalized }));
  }, [updateActiveProfile]);

  const setPortraitForegroundCropPercent = useCallback((value: number) => {
    const normalized = Math.min(20, Math.max(0, Number.isFinite(value) ? value : 0));
    setLayoutProfiles((prev) => ({
      ...prev,
      portrait: {
        ...prev.portrait,
        foregroundCropPercent: normalized,
      },
    }));
  }, []);

  const setThumbnailTextPrimaryFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextPrimaryFontName: nextValue,
      thumbnailFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextPrimaryFontSize = useCallback((value: number) => {
    const normalized = Math.min(
      MAX_THUMBNAIL_FONT_SIZE,
      Math.max(MIN_THUMBNAIL_FONT_SIZE, Number.isFinite(value) ? Math.round(value) : DEFAULT_THUMBNAIL_FONT_SIZE)
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextPrimaryFontSize: normalized,
      thumbnailFontSize: normalized,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextSecondaryFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextSecondaryFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextSecondaryFontSize = useCallback((value: number) => {
    const normalized = Math.min(
      MAX_THUMBNAIL_FONT_SIZE,
      Math.max(MIN_THUMBNAIL_FONT_SIZE, Number.isFinite(value) ? Math.round(value) : DEFAULT_THUMBNAIL_FONT_SIZE)
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextSecondaryFontSize: normalized,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailLineHeightRatio = useCallback((value: number) => {
    const normalized = Math.min(
      MAX_THUMBNAIL_LINE_HEIGHT_RATIO,
      Math.max(MIN_THUMBNAIL_LINE_HEIGHT_RATIO, Number.isFinite(value) ? value : DEFAULT_THUMBNAIL_LINE_HEIGHT_RATIO)
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailLineHeightRatio: normalized,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  // Legacy setters giữ hành vi font chung cho cả 2 text.
  const setThumbnailFontName = useCallback((value: string) => {
    const nextValue = value && value.trim().length > 0 ? value.trim() : DEFAULT_THUMBNAIL_FONT_NAME;
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailFontName: nextValue,
      thumbnailTextPrimaryFontName: nextValue,
      thumbnailTextSecondaryFontName: nextValue,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailFontSize = useCallback((value: number) => {
    const normalized = Math.min(
      MAX_THUMBNAIL_FONT_SIZE,
      Math.max(MIN_THUMBNAIL_FONT_SIZE, Number.isFinite(value) ? Math.round(value) : DEFAULT_THUMBNAIL_FONT_SIZE)
    );
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailFontSize: normalized,
      thumbnailTextPrimaryFontSize: normalized,
      thumbnailTextSecondaryFontSize: normalized,
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setLogoPath = useCallback((value: string | undefined) => {
    updateActiveProfile((current) => ({ ...current, logoPath: value }));
  }, [updateActiveProfile]);

  const setLogoPosition = useCallback((value: { x: number; y: number } | undefined) => {
    updateActiveProfile((current) => ({ ...current, logoPosition: value }));
  }, [updateActiveProfile]);

  const setLogoScale = useCallback((value: number) => {
    updateActiveProfile((current) => ({ ...current, logoScale: value }));
  }, [updateActiveProfile]);

  const setSubtitlePosition = useCallback((value: { x: number; y: number } | null) => {
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({ ...current, subtitlePosition: value ? { ...value } : null }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailFrameTimeSec = useCallback((value: number | null) => {
    updateActiveProfile((current) => ({ ...current, thumbnailFrameTimeSec: value }));
  }, [updateActiveProfile]);

  const setThumbnailDurationSec = useCallback((value: number) => {
    const normalized = Math.min(10, Math.max(0.1, Number.isFinite(value) ? value : 0.5));
    updateActiveProfile((current) => ({ ...current, thumbnailDurationSec: normalized }));
  }, [updateActiveProfile]);

  const setThumbnailTextSecondary = useCallback((value: string) => {
    updateActiveProfile((current) => ({ ...current, thumbnailTextSecondary: value }));
  }, [updateActiveProfile]);

  const setThumbnailTextPrimaryPosition = useCallback((value: { x: number; y: number }) => {
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextPrimaryPosition: {
        x: Math.min(1, Math.max(0, Number.isFinite(value.x) ? value.x : current.thumbnailTextPrimaryPosition.x)),
        y: Math.min(1, Math.max(0, Number.isFinite(value.y) ? value.y : current.thumbnailTextPrimaryPosition.y)),
      },
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const setThumbnailTextSecondaryPosition = useCallback((value: { x: number; y: number }) => {
    markTypographyDefaultsDirty();
    updateActiveProfile((current) => ({
      ...current,
      thumbnailTextSecondaryPosition: {
        x: Math.min(1, Math.max(0, Number.isFinite(value.x) ? value.x : current.thumbnailTextSecondaryPosition.x)),
        y: Math.min(1, Math.max(0, Number.isFinite(value.y) ? value.y : current.thumbnailTextSecondaryPosition.y)),
      },
    }));
  }, [markTypographyDefaultsDirty, updateActiveProfile]);

  const settingsValues = useMemo(
    () => ({
      inputType,
      geminiModel,
      translateMethod,
      voice,
      rate,
      volume,
      srtSpeed,
      splitByLines,
      linesPerFile,
      numberOfParts,
      enabledSteps: Array.from(enabledSteps.values()),
      audioDir,
      autoFitAudio,
      hardwareAcceleration,
      style: activeProfile.style,
      renderMode,
      renderResolution: activeProfile.renderResolution,
      renderContainer: activeProfile.renderContainer,
      blackoutTop: activeProfile.blackoutTop,
      portraitForegroundCropPercent: layoutProfiles.portrait.foregroundCropPercent,
      audioSpeed,
      renderAudioSpeed,
      videoVolume,
      audioVolume,
      thumbnailFontName: activeProfile.thumbnailTextPrimaryFontName,
      thumbnailFontSize: activeProfile.thumbnailTextPrimaryFontSize,
      thumbnailTextPrimaryFontName: activeProfile.thumbnailTextPrimaryFontName,
      thumbnailTextPrimaryFontSize: activeProfile.thumbnailTextPrimaryFontSize,
      thumbnailTextSecondaryFontName: activeProfile.thumbnailTextSecondaryFontName,
      thumbnailTextSecondaryFontSize: activeProfile.thumbnailTextSecondaryFontSize,
      thumbnailLineHeightRatio: activeProfile.thumbnailLineHeightRatio,
      thumbnailTextSecondary: activeProfile.thumbnailTextSecondary,
      thumbnailTextPrimaryPosition: activeProfile.thumbnailTextPrimaryPosition,
      thumbnailTextSecondaryPosition: activeProfile.thumbnailTextSecondaryPosition,
      subtitlePosition: activeProfile.subtitlePosition,
      thumbnailFrameTimeSec: activeProfile.thumbnailFrameTimeSec,
      thumbnailDurationSec: activeProfile.thumbnailDurationSec,
      logoPath: activeProfile.logoPath,
      logoPosition: activeProfile.logoPosition,
      logoScale: activeProfile.logoScale,
      layoutProfiles: {
        landscape: cloneProfile(layoutProfiles.landscape),
        portrait: cloneProfile(layoutProfiles.portrait),
      },
      processingMode,
    }),
    [
      inputType,
      geminiModel,
      translateMethod,
      voice,
      rate,
      volume,
      srtSpeed,
      splitByLines,
      linesPerFile,
      numberOfParts,
      enabledSteps,
      audioDir,
      autoFitAudio,
      hardwareAcceleration,
      activeProfile,
      renderMode,
      audioSpeed,
      renderAudioSpeed,
      videoVolume,
      audioVolume,
      layoutProfiles,
      processingMode,
    ]
  );

  const applyLoadedSettings = useCallback((saved: any, fallbackProfiles?: LayoutProfilesState) => {
    const fallback = fallbackProfiles ?? createDefaultLayoutProfiles();
    if (saved.inputType) setInputType(saved.inputType);
    if (saved.geminiModel) setGeminiModel(saved.geminiModel);
    if (saved.translateMethod) setTranslateMethod(saved.translateMethod as 'api' | 'impit');
    if (saved.voice) setVoice(saved.voice);
    if (saved.rate) setRate(String(saved.rate));
    if (saved.volume) setVolume(String(saved.volume));
    if (typeof saved.srtSpeed === 'number') setSrtSpeed(saved.srtSpeed);
    if (typeof saved.splitByLines === 'boolean') setSplitByLines(saved.splitByLines);
    if (typeof saved.linesPerFile === 'number') setLinesPerFile(saved.linesPerFile);
    if (typeof saved.numberOfParts === 'number') setNumberOfParts(saved.numberOfParts);
    if (saved.enabledSteps) setEnabledSteps(new Set(saved.enabledSteps as Step[]));
    if (saved.audioDir) setAudioDir(saved.audioDir);
    if (saved.autoFitAudio !== undefined) setAutoFitAudio(saved.autoFitAudio);
    if (saved.hardwareAcceleration) setHardwareAcceleration(saved.hardwareAcceleration);
    if (saved.renderMode) setRenderMode(saved.renderMode as RenderMode);
    if (typeof saved.audioSpeed === 'number') setAudioSpeed(saved.audioSpeed);
    if (typeof saved.renderAudioSpeed === 'number') setRenderAudioSpeed(saved.renderAudioSpeed);
    if (typeof saved.videoVolume === 'number') setVideoVolume(saved.videoVolume);
    if (typeof saved.audioVolume === 'number') setAudioVolume(saved.audioVolume);
    if (saved.processingMode === 'folder-first' || saved.processingMode === 'step-first') {
      setProcessingMode(saved.processingMode);
    }

    const loadedProfiles = saved.layoutProfiles as Record<string, unknown> | undefined;
    if (loadedProfiles && typeof loadedProfiles === 'object') {
      setLayoutProfiles({
        landscape: normalizeProfile(
          loadedProfiles.landscape as Record<string, unknown> | undefined,
          fallback.landscape,
          'landscape'
        ),
        portrait: normalizeProfile(
          loadedProfiles.portrait as Record<string, unknown> | undefined,
          fallback.portrait,
          'portrait'
        ),
      });
      return;
    }

    const legacyPatch: Record<string, unknown> = {
      style: saved.style,
      renderResolution: saved.renderResolution,
      renderContainer: saved.renderContainer,
      blackoutTop: saved.blackoutTop,
      foregroundCropPercent: saved.portraitForegroundCropPercent,
      subtitlePosition: saved.subtitlePosition,
      thumbnailFrameTimeSec: saved.thumbnailFrameTimeSec,
      thumbnailDurationSec: saved.thumbnailDurationSec,
      logoPath: saved.logoPath,
      logoPosition: saved.logoPosition,
      logoScale: saved.logoScale,
      thumbnailFontName: saved.thumbnailFontName,
      thumbnailFontSize: saved.thumbnailFontSize,
      thumbnailTextPrimaryFontName: saved.thumbnailTextPrimaryFontName,
      thumbnailTextPrimaryFontSize: saved.thumbnailTextPrimaryFontSize,
      thumbnailTextSecondaryFontName: saved.thumbnailTextSecondaryFontName,
      thumbnailTextSecondaryFontSize: saved.thumbnailTextSecondaryFontSize,
      thumbnailLineHeightRatio: saved.thumbnailLineHeightRatio,
      thumbnailTextSecondary: saved.thumbnailTextSecondary,
      thumbnailTextPrimaryPosition: saved.thumbnailTextPrimaryPosition,
      thumbnailTextSecondaryPosition: saved.thumbnailTextSecondaryPosition,
    };

    const mergedLegacyLandscape = normalizeProfile(legacyPatch, fallback.landscape, 'landscape');
    const mergedLegacyPortrait = normalizeProfile(legacyPatch, fallback.portrait, 'portrait');
    setLayoutProfiles({
      landscape: mergedLegacyLandscape,
      portrait: mergedLegacyPortrait,
    });
  }, []);

  useEffect(() => {
    if (!projectId || !paths) {
      loadedRef.current = false;
      isHydratingRef.current = false;
      return;
    }
    loadedRef.current = false;
    isHydratingRef.current = true;
    typographyDefaultsDirtyRef.current = false;
    let cancelled = false;

    const load = async () => {
      try {
        const [appSettingsRes, projectSettingsRes] = await Promise.all([
          window.electronAPI.appSettings.getAll(),
          window.electronAPI.project.readFeatureFile({
            projectId,
            feature: 'caption',
            fileName: PROJECT_SETTINGS_FILE,
          }),
        ]);

        const globalFallbackProfiles = buildGlobalFallbackProfiles(appSettingsRes?.data?.captionTypographyDefaults);
        const normalizedGlobalDefaults = buildTypographyDefaults(globalFallbackProfiles);
        lastSavedGlobalTypographyFingerprintRef.current = typographyDefaultsFingerprint(normalizedGlobalDefaults);

        if (!projectSettingsRes?.success || !projectSettingsRes.data) {
          setLayoutProfiles(globalFallbackProfiles);
          revisionRef.current = 0;
          if (!cancelled) {
            setSettingsRevision(0);
            setSettingsUpdatedAt(nowIso());
          }
          return;
        }

        const parsed = JSON.parse(projectSettingsRes.data);
        if (parsed?.schemaVersion === 1 && parsed?.settings && typeof parsed.settings === 'object') {
          applyLoadedSettings(parsed.settings, globalFallbackProfiles);
          revisionRef.current = typeof parsed.settingsRevision === 'number' ? parsed.settingsRevision : 0;
          if (!cancelled) {
            setSettingsRevision(revisionRef.current);
            setSettingsUpdatedAt(typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso());
          }
          return;
        }

        applyLoadedSettings(parsed || {}, globalFallbackProfiles);
        revisionRef.current = 1;
        if (!cancelled) {
          setSettingsRevision(1);
          setSettingsUpdatedAt(nowIso());
        }
      } catch (error) {
        console.error('[CaptionSettings] Lỗi load caption-settings.json:', error);
      } finally {
        if (!cancelled) {
          isHydratingRef.current = false;
          loadedRef.current = true;
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, paths, applyLoadedSettings]);

  const saveSettings = useCallback(async (source: 'ui' | 'system' = 'ui') => {
    if (!projectId) return;
    const nextRevision = revisionRef.current + 1;
    const updatedAt = nowIso();
    const payload: CaptionProjectSettings = {
      schemaVersion: 1,
      settingsRevision: nextRevision,
      source,
      updatedAt,
      settings: settingsValues,
    };

    const queued = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const writeRes = await window.electronAPI.project.writeFeatureFile({
          projectId,
          feature: 'caption',
          fileName: PROJECT_SETTINGS_FILE,
          content: payload,
        });
        if (!writeRes?.success) {
          throw new Error(writeRes?.error || 'Không thể lưu caption-settings.json');
        }
        revisionRef.current = nextRevision;
        setSettingsRevision(nextRevision);
        setSettingsUpdatedAt(updatedAt);
      });
    saveQueueRef.current = queued;
    await queued;
  }, [projectId, settingsValues]);

  useEffect(() => {
    if (!projectId || !paths || !loadedRef.current) return;
    const timer = window.setTimeout(() => {
      saveSettings('ui').catch((error) => {
        console.error('[CaptionSettings] Lỗi auto-save:', error);
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
    };
  }, [projectId, paths, settingsValues, saveSettings]);

  useEffect(() => {
    if (!projectId || !paths || !loadedRef.current || isHydratingRef.current) {
      return;
    }
    if (!typographyDefaultsDirtyRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      const snapshot = buildTypographyDefaults(layoutProfiles);
      const nextFingerprint = typographyDefaultsFingerprint(snapshot);
      if (nextFingerprint === lastSavedGlobalTypographyFingerprintRef.current) {
        typographyDefaultsDirtyRef.current = false;
        return;
      }
      window.electronAPI.appSettings.update({ captionTypographyDefaults: snapshot }).then((res) => {
        if (!res?.success) {
          console.error('[CaptionSettings] Lỗi lưu captionTypographyDefaults vào appSettings:', res?.error);
          return;
        }
        lastSavedGlobalTypographyFingerprintRef.current = nextFingerprint;
        typographyDefaultsDirtyRef.current = false;
      }).catch((error) => {
        console.error('[CaptionSettings] Lỗi lưu captionTypographyDefaults vào AppData:', error);
      });
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [projectId, paths, layoutProfiles, typographyDefaultsDirtyTick]);

  return {
    inputType, setInputType,
    geminiModel, setGeminiModel,
    translateMethod, setTranslateMethod,
    voice, setVoice,
    rate, setRate,
    volume, setVolume,
    srtSpeed, setSrtSpeed,
    splitByLines, setSplitByLines,
    linesPerFile, setLinesPerFile,
    numberOfParts, setNumberOfParts,
    enabledSteps, setEnabledSteps,
    audioDir, setAudioDir,
    autoFitAudio, setAutoFitAudio,
    hardwareAcceleration, setHardwareAcceleration,
    style: activeProfile.style,
    setStyle,
    renderMode, setRenderMode,
    renderResolution: activeProfile.renderResolution,
    setRenderResolution,
    renderContainer: activeProfile.renderContainer,
    setRenderContainer,
    blackoutTop: activeProfile.blackoutTop,
    setBlackoutTop,
    foregroundCropPercent: activeProfile.foregroundCropPercent,
    setForegroundCropPercent,
    portraitForegroundCropPercent: layoutProfiles.portrait.foregroundCropPercent,
    setPortraitForegroundCropPercent,
    subtitlePosition: activeProfile.subtitlePosition,
    setSubtitlePosition,
    thumbnailFrameTimeSec: activeProfile.thumbnailFrameTimeSec,
    setThumbnailFrameTimeSec,
    thumbnailDurationSec: activeProfile.thumbnailDurationSec,
    setThumbnailDurationSec,
    audioSpeed, setAudioSpeed,
    renderAudioSpeed, setRenderAudioSpeed,
    videoVolume, setVideoVolume,
    audioVolume, setAudioVolume,
    // Legacy font chung = font của Text1 để tương thích ngược.
    thumbnailFontName: activeProfile.thumbnailTextPrimaryFontName,
    setThumbnailFontName,
    thumbnailFontSize: activeProfile.thumbnailTextPrimaryFontSize,
    setThumbnailFontSize,
    thumbnailTextPrimaryFontName: activeProfile.thumbnailTextPrimaryFontName,
    setThumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: activeProfile.thumbnailTextPrimaryFontSize,
    setThumbnailTextPrimaryFontSize,
    thumbnailTextSecondaryFontName: activeProfile.thumbnailTextSecondaryFontName,
    setThumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: activeProfile.thumbnailTextSecondaryFontSize,
    setThumbnailTextSecondaryFontSize,
    thumbnailLineHeightRatio: activeProfile.thumbnailLineHeightRatio,
    setThumbnailLineHeightRatio,
    thumbnailTextSecondary: activeProfile.thumbnailTextSecondary,
    setThumbnailTextSecondary,
    thumbnailTextPrimaryPosition: activeProfile.thumbnailTextPrimaryPosition,
    setThumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: activeProfile.thumbnailTextSecondaryPosition,
    setThumbnailTextSecondaryPosition,
    logoPath: activeProfile.logoPath,
    setLogoPath,
    logoPosition: activeProfile.logoPosition,
    setLogoPosition,
    logoScale: activeProfile.logoScale,
    setLogoScale,
    layoutProfiles,
    processingMode, setProcessingMode,
    settingsRevision,
    settingsUpdatedAt,
    saveSettings,
  };
}
