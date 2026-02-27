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

export const DEFAULT_STYLE: ASSStyleConfig = {
  fontName: 'ZYVNA Fairy',
  fontSize: 62,
  fontColor: '#FFFF00',
  shadow: 4,
  marginV: 50,
  alignment: 2,
};

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
  const [style, setStyle] = useState<ASSStyleConfig>(DEFAULT_STYLE);
  const [renderMode, setRenderMode] = useState<'hardsub' | 'black_bg'>('hardsub');
  const [renderResolution, setRenderResolution] = useState<'original' | '1080p' | '720p' | '540p' | '360p'>('original');
  const [blackoutTop, setBlackoutTop] = useState<number | null>(0.9);
  const [audioSpeed, setAudioSpeed] = useState<number>(1.0);
  const [renderAudioSpeed, setRenderAudioSpeed] = useState<number>(1.0);
  const [videoVolume, setVideoVolume] = useState<number>(100);
  const [audioVolume, setAudioVolume] = useState<number>(100);
  const [thumbnailFontName, setThumbnailFontName] = useState<string>('BrightwallPersonal');

  const [logoPath, setLogoPathState] = useState<string | undefined>(undefined);
  const [logoPosition, setLogoPositionState] = useState<{ x: number; y: number } | undefined>(undefined);
  const [logoScale, setLogoScaleState] = useState<number>(1.0);

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

  useEffect(() => {
    (window.electronAPI as any).appSettings.getAll().then((res: any) => {
      if (res?.success && res.data) {
        if (res.data.captionLogoPath != null) setLogoPathState(res.data.captionLogoPath);
        if (res.data.captionLogoPosition != null) setLogoPositionState(res.data.captionLogoPosition);
        if (typeof res.data.captionLogoScale === 'number') setLogoScaleState(res.data.captionLogoScale);
      }
    });
  }, []);

  const setLogoPath = useCallback((v: string | undefined) => {
    setLogoPathState(v);
    (window.electronAPI as any).appSettings.update({ captionLogoPath: v ?? null });
  }, []);
  const setLogoPosition = useCallback((v: { x: number; y: number } | undefined) => {
    setLogoPositionState(v);
    (window.electronAPI as any).appSettings.update({ captionLogoPosition: v ?? null });
  }, []);
  const setLogoScale = useCallback((v: number) => {
    setLogoScaleState(v);
    (window.electronAPI as any).appSettings.update({ captionLogoScale: v });
  }, []);

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
      style,
      renderMode,
      renderResolution,
      blackoutTop,
      audioSpeed,
      renderAudioSpeed,
      videoVolume,
      audioVolume,
      thumbnailFontName,
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
      style,
      renderMode,
      renderResolution,
      blackoutTop,
      audioSpeed,
      renderAudioSpeed,
      videoVolume,
      audioVolume,
      thumbnailFontName,
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
    if (saved.style) setStyle(saved.style);
    if (saved.renderMode) setRenderMode(saved.renderMode);
    if (saved.renderResolution) setRenderResolution(saved.renderResolution);
    if (saved.blackoutTop !== undefined) setBlackoutTop(saved.blackoutTop);
    if (typeof saved.audioSpeed === 'number') setAudioSpeed(saved.audioSpeed);
    if (typeof saved.renderAudioSpeed === 'number') setRenderAudioSpeed(saved.renderAudioSpeed);
    if (typeof saved.videoVolume === 'number') setVideoVolume(saved.videoVolume);
    if (typeof saved.audioVolume === 'number') setAudioVolume(saved.audioVolume);
    if (typeof saved.thumbnailFontName === 'string' && saved.thumbnailFontName.trim().length > 0) {
      setThumbnailFontName(saved.thumbnailFontName);
    }
    if (saved.processingMode === 'folder-first' || saved.processingMode === 'step-first') {
      setProcessingMode(saved.processingMode);
    }
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

        // Legacy fallback: file cũ chỉ chứa object settings.
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
    style, setStyle,
    renderMode, setRenderMode,
    renderResolution, setRenderResolution,
    blackoutTop, setBlackoutTop,
    audioSpeed, setAudioSpeed,
    renderAudioSpeed, setRenderAudioSpeed,
    videoVolume, setVideoVolume,
    audioVolume, setAudioVolume,
    thumbnailFontName, setThumbnailFontName,
    logoPath, setLogoPath,
    logoPosition, setLogoPosition,
    logoScale, setLogoScale,
    processingMode, setProcessingMode,
    settingsRevision,
    settingsUpdatedAt,
    saveSettings,
  };
}
