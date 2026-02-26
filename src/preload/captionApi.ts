/**
 * Caption Preload API - Expose Caption và TTS APIs cho Renderer process
 */

import { ipcRenderer } from 'electron';
import {
  CAPTION_IPC_CHANNELS,
  ParseSrtResult,
  TranslationOptions,
  TranslationResult,
  TranslationProgress,
  SubtitleEntry,
  TTSOptions,
  TTSResult,
  TTSProgress,
  MergeResult,
  TrimSilenceResult,
  VoiceInfo,
  AudioFile,
  SplitOptions,
  SplitResult,
} from '../shared/types/caption';

// Response type từ IPC
interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Caption API interface cho Renderer process
 */
export interface CaptionAPI {
  // SRT Operations
  parseSrt: (filePath: string) => Promise<IpcApiResponse<ParseSrtResult>>;
  parseDraft: (filePath: string) => Promise<IpcApiResponse<ParseSrtResult>>; // Parse draft_content.json
  exportSrt: (entries: SubtitleEntry[], outputPath: string) => Promise<IpcApiResponse<string>>;

  // Translation
  translate: (options: TranslationOptions) => Promise<IpcApiResponse<TranslationResult>>;
  onTranslateProgress: (callback: (progress: TranslationProgress) => void) => void;

  // Split text files
  split: (options: SplitOptions) => Promise<IpcApiResponse<SplitResult>>;
}

/**
 * TTS API interface cho Renderer process
 */
export interface TTSAPI {
  // Voice
  getVoices: () => Promise<IpcApiResponse<VoiceInfo[]>>;

  // Generate Audio
  generate: (
    entries: SubtitleEntry[],
    options: Partial<TTSOptions>
  ) => Promise<IpcApiResponse<TTSResult>>;
  onProgress: (callback: (progress: TTSProgress) => void) => void;

  // Audio Merge
  analyzeAudio: (
    audioFiles: AudioFile[],
    srtDuration: number
  ) => Promise<IpcApiResponse<unknown>>;
  mergeAudio: (
    audioFiles: AudioFile[],
    outputPath: string,
    timeScale?: number
  ) => Promise<IpcApiResponse<MergeResult>>;

  // Trim Silence
  trimSilence: (audioPaths: string[]) => Promise<IpcApiResponse<TrimSilenceResult>>;
  trimSilenceEnd: (audioPaths: string[]) => Promise<IpcApiResponse<TrimSilenceResult>>;

  // Fit Audio to Duration
  fitAudio: (audioItems: Array<{ path: string; durationMs: number }>) => Promise<IpcApiResponse<TrimSilenceResult>>;
}

/**
 * Tạo Caption API object
 */
export function createCaptionAPI(): CaptionAPI {
  return {
    parseSrt: (filePath: string) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.PARSE_SRT, filePath),

    parseDraft: (filePath: string) =>
      ipcRenderer.invoke('caption:parseDraft', filePath),

    exportSrt: (entries: SubtitleEntry[], outputPath: string) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.EXPORT_SRT, entries, outputPath),

    translate: (options: TranslationOptions) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TRANSLATE, options),

    onTranslateProgress: (callback: (progress: TranslationProgress) => void) => {
      ipcRenderer.on(CAPTION_IPC_CHANNELS.TRANSLATE_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },

    split: (options: SplitOptions) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.SPLIT, options),
  };
}

/**
 * Tạo TTS API object
 */
export function createTTSAPI(): TTSAPI {
  return {
    getVoices: () => ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_GET_VOICES),

    generate: (entries: SubtitleEntry[], options: Partial<TTSOptions>) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_GENERATE, entries, options),

    onProgress: (callback: (progress: TTSProgress) => void) => {
      ipcRenderer.on(CAPTION_IPC_CHANNELS.TTS_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },

    analyzeAudio: (audioFiles: AudioFile[], srtDuration: number) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.AUDIO_ANALYZE, audioFiles, srtDuration),

    mergeAudio: (audioFiles: AudioFile[], outputPath: string, timeScale: number = 1.0) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.AUDIO_MERGE, audioFiles, outputPath, timeScale),

    trimSilence: (audioPaths: string[]) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE, audioPaths),

    trimSilenceEnd: (audioPaths: string[]) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE_END, audioPaths),

    fitAudio: (audioItems: Array<{ path: string; durationMs: number }>) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.TTS_FIT_AUDIO, audioItems),
  };
}

// ============================================
// CAPTION VIDEO API (Subtitle Strip)
// ============================================

import {
  VideoMetadata,
  RenderProgress,
  CAPTION_VIDEO_IPC_CHANNELS,
} from '../shared/types/caption';

/**
 * Caption Video API interface cho Renderer process
 */
export interface CaptionVideoAPI {
  // Render video
  renderVideo: (options: {
    srtPath: string;
    outputPath: string;
    width: number;
    height: number;
    videoPath?: string;
    targetDuration?: number;
    hardwareAcceleration?: 'none' | 'qsv';
    srtTimeScale?: number;
    step4SrtScale?: number;
    timingContextPath?: string;
    audioSpeedModel?: 'step4_minus_step7_delta';
    ttsRate?: string;
    renderMode?: 'hardsub' | 'black_bg';
    renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
    position?: { x: number; y: number };
    blackoutTop?: number;
    audioSpeed?: number;
    step7AudioSpeedInput?: number;
    audioPath?: string;
    videoVolume?: number;
    audioVolume?: number;
    logoPath?: string;
    logoPosition?: { x: number; y: number };
    logoScale?: number;
    style?: any;
  }) => Promise<IpcApiResponse<{ outputPath: string; duration: number }>>;

  // Listen to render progress
  onRenderProgress: (callback: (progress: RenderProgress) => void) => void;

  // Get video metadata
  getVideoMetadata: (videoPath: string) => Promise<IpcApiResponse<VideoMetadata>>;

  // Extract frame from video
  extractFrame: (videoPath: string, frameNumber?: number) => Promise<IpcApiResponse<{
    frameData: string;
    width: number;
    height: number;
  }>>;

  // Auto-detect best video in folders
  findBestVideoInFolders: (folderPaths: string[]) => Promise<IpcApiResponse<{
    videoPath?: string;
    metadata?: VideoMetadata;
  }>>;

  // Get available fonts in resources/fonts
  getAvailableFonts: () => Promise<IpcApiResponse<string[]>>;

  // Get base64 font data for injection in preview
  getFontData: (fontName: string) => Promise<IpcApiResponse<string>>;

  // Read local image as base64 for preview
  readLocalImage: (imagePath: string) => Promise<IpcApiResponse<string>>;
}

/**
 * Tạo Caption Video API object
 */
export function createCaptionVideoAPI(): CaptionVideoAPI {
  return {
    renderVideo: (options) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.RENDER_VIDEO, options),

    onRenderProgress: (callback: (progress: RenderProgress) => void) => {
      ipcRenderer.on(CAPTION_VIDEO_IPC_CHANNELS.RENDER_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },

    getVideoMetadata: (videoPath: string) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.GET_VIDEO_METADATA, videoPath),

    extractFrame: (videoPath: string, frameNumber?: number) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.EXTRACT_FRAME, videoPath, frameNumber),

    findBestVideoInFolders: (folderPaths: string[]) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.FIND_BEST_VIDEO, folderPaths),

    getAvailableFonts: () =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.GET_AVAILABLE_FONTS),

    getFontData: (fontName: string) =>
      ipcRenderer.invoke('captionVideo:getFontData', fontName),

    readLocalImage: (imagePath: string) =>
      ipcRenderer.invoke('captionVideo:readLocalImage', imagePath),
  };
}
