import { useState, useEffect, useCallback } from 'react';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';
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
import { Step } from '../CaptionTypes';
import { ASSStyleConfig } from '@shared/types/caption';

export const DEFAULT_STYLE: ASSStyleConfig = {
  fontName: 'ZYVNA Fairy',
  fontSize: 62,
  fontColor: '#FFFF00',
  shadow: 4,
  marginV: 50,
  alignment: 2,
};

export function useCaptionSettings() {
   // State - Config
  const [inputType, setInputType] = useState<InputType>(DEFAULT_INPUT_TYPE);
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [srtSpeed, setSrtSpeed] = useState(DEFAULT_SRT_SPEED);
  
  // State - Split Config
  const [splitByLines, setSplitByLines] = useState(DEFAULT_SPLIT_BY_LINES);
  const [linesPerFile, setLinesPerFile] = useState(DEFAULT_LINES_PER_FILE);
  const [numberOfParts, setNumberOfParts] = useState(DEFAULT_NUMBER_OF_PARTS);
  
  // State - Audio Dir (persist this too)
  const [audioDir, setAudioDir] = useState('');

  // State - Auto Fit Audio (tự động scale audio vừa thời lượng)
  const [autoFitAudio, setAutoFitAudio] = useState(false);

  // State - Video Output
  const [useGpu, setUseGpu] = useState(true);
  const [style, setStyle] = useState<ASSStyleConfig>(DEFAULT_STYLE);
  const [renderMode, setRenderMode] = useState<'hardsub' | 'black_bg'>('hardsub');
  const [renderResolution, setRenderResolution] = useState<'original' | '1080p' | '720p' | '540p' | '360p'>('original');
  const [blackoutTop, setBlackoutTop] = useState<number | null>(0.9); // Mặc định che 10% dưới video
  const [audioSpeed, setAudioSpeed] = useState<number>(1.0); // Merge Audio Speed
  const [renderAudioSpeed, setRenderAudioSpeed] = useState<number>(1.0); // Render Audio Speed
  const [videoVolume, setVideoVolume] = useState<number>(100);
  const [audioVolume, setAudioVolume] = useState<number>(100);

  const [logoPath, setLogoPathState] = useState<string | undefined>(undefined);
  const [logoPosition, setLogoPositionState] = useState<{ x: number; y: number } | undefined>(undefined);
  const [logoScale, setLogoScaleState] = useState<number>(1.0);

  // ========== LOAD LOGO TỪ GLOBAL APP SETTINGS (một lần khi mount) ==========
  useEffect(() => {
    (window.electronAPI as any).appSettings.getAll().then((res: any) => {
      if (res?.success && res.data) {
        if (res.data.captionLogoPath != null) setLogoPathState(res.data.captionLogoPath);
        if (res.data.captionLogoPosition != null) setLogoPositionState(res.data.captionLogoPosition);
        if (typeof res.data.captionLogoScale === 'number') setLogoScaleState(res.data.captionLogoScale);
      }
    });
  }, []);

  // Setters: cập nhật state VÀ lưu vào global appSettings ngay lập tức
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

  const [enabledSteps, setEnabledSteps] = useState<Set<Step>>(new Set([1, 2, 3, 4, 5, 6, 7]));

  // ========== AUTO SAVE/LOAD VÀO PROJECT ==========
  useProjectFeatureState<{
    inputType?: InputType;
    geminiModel?: string;
    voice?: string;
    rate?: string;
    volume?: string;
    srtSpeed?: number;
    splitByLines?: boolean;
    linesPerFile?: number;
    numberOfParts?: number;
    enabledSteps?: Step[];
    audioDir?: string;
    autoFitAudio?: boolean;
    useGpu?: boolean;
    style?: ASSStyleConfig;
    renderMode?: 'hardsub' | 'black_bg';
    renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
    blackoutTop?: number | null;
    audioSpeed?: number;
    renderAudioSpeed?: number;
    videoVolume?: number;
    audioVolume?: number;
  }>({
    feature: 'caption',
    fileName: 'caption-settings.json', // Changed filename slightly to avoid conflict if any
    serialize: () => ({
      inputType,
      geminiModel,
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
      useGpu,
      style,
      renderMode,
      renderResolution,
      blackoutTop,
      audioSpeed,
      renderAudioSpeed,
      videoVolume,
      audioVolume,
      // logo fields are global — saved via appSettings, not per-project
    }),
    deserialize: (saved) => {
      if (saved.inputType) setInputType(saved.inputType);
      if (saved.geminiModel) setGeminiModel(saved.geminiModel);
      if (saved.voice) setVoice(saved.voice);
      if (saved.rate) setRate(String(saved.rate));
      if (saved.volume) setVolume(String(saved.volume));
      if (typeof saved.srtSpeed === 'number') setSrtSpeed(saved.srtSpeed);
      if (typeof saved.splitByLines === 'boolean') setSplitByLines(saved.splitByLines);
      if (typeof saved.linesPerFile === 'number') setLinesPerFile(saved.linesPerFile);
      if (typeof saved.numberOfParts === 'number') setNumberOfParts(saved.numberOfParts);
      if (saved.enabledSteps) setEnabledSteps(new Set(saved.enabledSteps));
      if (saved.audioDir) setAudioDir(saved.audioDir);
      if (saved.autoFitAudio !== undefined) setAutoFitAudio(saved.autoFitAudio);
      if (saved.useGpu !== undefined) setUseGpu(saved.useGpu);
      if (saved.style) setStyle(saved.style);
      if (saved.renderMode) setRenderMode(saved.renderMode);
      if (saved.renderResolution) setRenderResolution(saved.renderResolution);
      if (saved.blackoutTop !== undefined) setBlackoutTop(saved.blackoutTop);
      if (typeof saved.audioSpeed === 'number') setAudioSpeed(saved.audioSpeed);
      if (typeof saved.renderAudioSpeed === 'number') setRenderAudioSpeed(saved.renderAudioSpeed);
      if (typeof saved.videoVolume === 'number') setVideoVolume(saved.videoVolume);
      if (typeof saved.audioVolume === 'number') setAudioVolume(saved.audioVolume);
      // logo fields are global — loaded from appSettings, not per-project
    },
    deps: [
      srtSpeed, splitByLines, linesPerFile, numberOfParts, enabledSteps, audioDir, autoFitAudio,
      useGpu, style, renderMode, renderResolution, blackoutTop, audioSpeed, renderAudioSpeed, videoVolume, audioVolume
    ],
  });

  return {
    inputType, setInputType,
    geminiModel, setGeminiModel,
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
    useGpu, setUseGpu,
    style, setStyle,
    renderMode, setRenderMode,
    renderResolution, setRenderResolution,
    blackoutTop, setBlackoutTop,
    audioSpeed, setAudioSpeed,
    renderAudioSpeed, setRenderAudioSpeed,
    videoVolume, setVideoVolume,
    audioVolume, setAudioVolume,
    logoPath, setLogoPath,
    logoPosition, setLogoPosition,
    logoScale, setLogoScale
  };
}
