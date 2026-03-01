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
  logoPath?: string;
  logoPosition?: { x: number; y: number };
  logoScale: number;
  thumbnailFontName: string;
  thumbnailFontSize: number;
}

interface LayoutProfilesState {
  landscape: LayoutProfile;
  portrait: LayoutProfile;
}

export const DEFAULT_STYLE: ASSStyleConfig = {
  fontName: 'ZYVNA Fairy',
  fontSize: 62,
  fontColor: '#FFFF00',
  shadow: 4,
  marginV: 50,
  alignment: 2,
};

const DEFAULT_LANDSCAPE_PROFILE: LayoutProfile = {
  style: { ...DEFAULT_STYLE },
  renderResolution: 'original',
  renderContainer: 'mp4',
  blackoutTop: 0.9,
  foregroundCropPercent: 0,
  subtitlePosition: null,
  thumbnailFrameTimeSec: null,
  thumbnailDurationSec: 0.5,
  logoPath: undefined,
  logoPosition: undefined,
  logoScale: 1.0,
  thumbnailFontName: 'BrightwallPersonal',
  thumbnailFontSize: 145,
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
  logoPath: undefined,
  logoPosition: undefined,
  logoScale: 1.0,
  thumbnailFontName: 'BrightwallPersonal',
  thumbnailFontSize: 145,
};

function cloneProfile(profile: LayoutProfile): LayoutProfile {
  return {
    ...profile,
    style: { ...profile.style },
    subtitlePosition: profile.subtitlePosition ? { ...profile.subtitlePosition } : null,
    logoPosition: profile.logoPosition ? { ...profile.logoPosition } : undefined,
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
    next.style = { ...next.style, ...style };
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
  if (typeof patch.thumbnailFontName === 'string' && patch.thumbnailFontName.trim().length > 0) {
    next.thumbnailFontName = patch.thumbnailFontName;
  }
  if (typeof patch.thumbnailFontSize === 'number' && Number.isFinite(patch.thumbnailFontSize)) {
    next.thumbnailFontSize = Math.min(260, Math.max(24, Math.round(patch.thumbnailFontSize)));
  }
  return next;
}

function resolveLayoutKey(renderMode: RenderMode): LayoutKey {
  return renderMode === 'hardsub_portrait_9_16' ? 'portrait' : 'landscape';
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

  const [layoutProfiles, setLayoutProfiles] = useState<LayoutProfilesState>({
    landscape: cloneProfile(DEFAULT_LANDSCAPE_PROFILE),
    portrait: cloneProfile(DEFAULT_PORTRAIT_PROFILE),
  });

  const [enabledSteps, setEnabledSteps] = useState<Set<Step>>(new Set([1, 2, 3, 4, 5, 6, 7]));
  const [translateMethod, setTranslateMethod] = useState<'api' | 'impit'>('api');
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('folder-first');

  const [settingsRevision, setSettingsRevision] = useState<number>(0);
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState<string>(nowIso());

  const loadedRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef(0);

  useEffect(() => {
    saveQueueRef.current = Promise.resolve();
    revisionRef.current = 0;
  }, [projectId]);

  const activeLayoutKey = resolveLayoutKey(renderMode);
  const activeProfile = layoutProfiles[activeLayoutKey];

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
      updateActiveProfile((current) => {
        const nextStyle = typeof value === 'function'
          ? (value as (prev: ASSStyleConfig) => ASSStyleConfig)(current.style)
          : value;
        return { ...current, style: { ...nextStyle } };
      });
    },
    [updateActiveProfile]
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

  const setThumbnailFontName = useCallback((value: string) => {
    updateActiveProfile((current) => ({ ...current, thumbnailFontName: value }));
  }, [updateActiveProfile]);

  const setThumbnailFontSize = useCallback((value: number) => {
    const normalized = Math.min(260, Math.max(24, Number.isFinite(value) ? Math.round(value) : 145));
    updateActiveProfile((current) => ({ ...current, thumbnailFontSize: normalized }));
  }, [updateActiveProfile]);

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
    updateActiveProfile((current) => ({ ...current, subtitlePosition: value ? { ...value } : null }));
  }, [updateActiveProfile]);

  const setThumbnailFrameTimeSec = useCallback((value: number | null) => {
    updateActiveProfile((current) => ({ ...current, thumbnailFrameTimeSec: value }));
  }, [updateActiveProfile]);

  const setThumbnailDurationSec = useCallback((value: number) => {
    const normalized = Math.min(10, Math.max(0.1, Number.isFinite(value) ? value : 0.5));
    updateActiveProfile((current) => ({ ...current, thumbnailDurationSec: normalized }));
  }, [updateActiveProfile]);

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
      thumbnailFontName: activeProfile.thumbnailFontName,
      thumbnailFontSize: activeProfile.thumbnailFontSize,
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

  const applyLoadedSettings = useCallback((saved: any) => {
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
          DEFAULT_LANDSCAPE_PROFILE,
          'landscape'
        ),
        portrait: normalizeProfile(
          loadedProfiles.portrait as Record<string, unknown> | undefined,
          DEFAULT_PORTRAIT_PROFILE,
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
    };

    const mergedLegacyLandscape = normalizeProfile(legacyPatch, DEFAULT_LANDSCAPE_PROFILE, 'landscape');
    const mergedLegacyPortrait = normalizeProfile(legacyPatch, DEFAULT_PORTRAIT_PROFILE, 'portrait');
    setLayoutProfiles({
      landscape: mergedLegacyLandscape,
      portrait: mergedLegacyPortrait,
    });
  }, []);

  useEffect(() => {
    if (!projectId || !paths) {
      loadedRef.current = false;
      return;
    }
    loadedRef.current = false;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await window.electronAPI.project.readFeatureFile({
          projectId,
          feature: 'caption',
          fileName: PROJECT_SETTINGS_FILE,
        });
        if (!res?.success || !res.data) {
          revisionRef.current = 0;
          if (!cancelled) {
            setSettingsRevision(0);
            setSettingsUpdatedAt(nowIso());
          }
          return;
        }

        const parsed = JSON.parse(res.data);
        if (parsed?.schemaVersion === 1 && parsed?.settings && typeof parsed.settings === 'object') {
          applyLoadedSettings(parsed.settings);
          revisionRef.current = typeof parsed.settingsRevision === 'number' ? parsed.settingsRevision : 0;
          if (!cancelled) {
            setSettingsRevision(revisionRef.current);
            setSettingsUpdatedAt(typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso());
          }
          return;
        }

        applyLoadedSettings(parsed || {});
        revisionRef.current = 1;
        if (!cancelled) {
          setSettingsRevision(1);
          setSettingsUpdatedAt(nowIso());
        }
      } catch (error) {
        console.error('[CaptionSettings] Lỗi load caption-settings.json:', error);
      } finally {
        if (!cancelled) {
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
    thumbnailFontName: activeProfile.thumbnailFontName,
    setThumbnailFontName,
    thumbnailFontSize: activeProfile.thumbnailFontSize,
    setThumbnailFontSize,
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
