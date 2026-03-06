/**
 * Caption Preload API - Expose Caption và TTS APIs cho Renderer process
 */

import { ipcRenderer } from 'electron';
import {
  CAPTION_IPC_CHANNELS,
  CAPTION_SESSION_IPC_CHANNELS,
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
  CaptionSessionV1,
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

  // Unified session (single JSON per folder)
  readSession: (sessionPath: string) => Promise<IpcApiResponse<CaptionSessionV1 | null>>;
  writeSessionAtomic: (sessionPath: string, data: CaptionSessionV1) => Promise<IpcApiResponse<string>>;
  patchSession: (
    sessionPath: string,
    patch: Partial<CaptionSessionV1>
  ) => Promise<IpcApiResponse<CaptionSessionV1>>;
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
      ipcRenderer.removeAllListeners(CAPTION_IPC_CHANNELS.TRANSLATE_PROGRESS);
      ipcRenderer.on(CAPTION_IPC_CHANNELS.TRANSLATE_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },

    split: (options: SplitOptions) =>
      ipcRenderer.invoke(CAPTION_IPC_CHANNELS.SPLIT, options),

    readSession: (sessionPath: string) =>
      ipcRenderer.invoke(CAPTION_SESSION_IPC_CHANNELS.READ, { sessionPath }),

    writeSessionAtomic: (sessionPath: string, data: CaptionSessionV1) =>
      ipcRenderer.invoke(CAPTION_SESSION_IPC_CHANNELS.WRITE_ATOMIC, { sessionPath, data }),

    patchSession: (sessionPath: string, patch: Partial<CaptionSessionV1>) =>
      ipcRenderer.invoke(CAPTION_SESSION_IPC_CHANNELS.PATCH, { sessionPath, patch }),
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
      ipcRenderer.removeAllListeners(CAPTION_IPC_CHANNELS.TTS_PROGRESS);
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
  RenderAudioPreviewOptions,
  RenderAudioPreviewProgress,
  RenderAudioPreviewResult,
  RenderVideoPreviewFrameOptions,
  RenderVideoPreviewFrameResult,
  VideoMetadata,
  RenderProgress,
  CAPTION_VIDEO_IPC_CHANNELS,
  RenderThumbnailPreviewFrameOptions,
  RenderThumbnailPreviewFrameResult,
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
    hardwareAcceleration?: 'none' | 'qsv' | 'nvenc';
    srtTimeScale?: number;
    step4SrtScale?: number;
    timingContextPath?: string;
    audioSpeedModel?: 'step4_minus_step7_delta';
    ttsRate?: string;
    renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
    renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
    position?: { x: number; y: number };
    blackoutTop?: number;
    coverMode?: 'blackout_bottom' | 'copy_from_above';
    coverQuad?: {
      tl: { x: number; y: number };
      tr: { x: number; y: number };
      br: { x: number; y: number };
      bl: { x: number; y: number };
    };
    coverFeatherPx?: number;
    audioSpeed?: number;
    step7AudioSpeedInput?: number;
    audioPath?: string;
    videoVolume?: number;
    audioVolume?: number;
    logoPath?: string;
    logoPosition?: { x: number; y: number };
    logoScale?: number;
    portraitForegroundCropPercent?: number;
    style?: any;
    thumbnailEnabled?: boolean;
    thumbnailDurationSec?: number;
    thumbnailTimeSec?: number;
    thumbnailText?: string;
    thumbnailTextSecondary?: string;
    thumbnailFontName?: string;
    thumbnailFontSize?: number;
    thumbnailTextPrimaryFontName?: string;
    thumbnailTextPrimaryFontSize?: number;
    thumbnailTextPrimaryColor?: string;
    thumbnailTextSecondaryFontName?: string;
    thumbnailTextSecondaryFontSize?: number;
    thumbnailTextSecondaryColor?: string;
    thumbnailLineHeightRatio?: number;
    thumbnailTextPrimaryPosition?: { x: number; y: number };
    thumbnailTextSecondaryPosition?: { x: number; y: number };
    step7SubtitleSource?: 'session_translated_entries';
    step7AudioSource?: 'session_merged_audio';
  }) => Promise<IpcApiResponse<{ outputPath: string; duration: number; timingPayload?: Record<string, unknown> }>>;

  // Stop current render process immediately
  stopRender: () => Promise<IpcApiResponse<{ stopped: boolean; message: string }>>;

  // Mix audio preview for Step 7 without rendering full video
  mixAudioPreview: (
    options: RenderAudioPreviewOptions
  ) => Promise<IpcApiResponse<RenderAudioPreviewResult>>;

  // Stop current audio preview process
  stopAudioPreview: () => Promise<IpcApiResponse<{ stopped: boolean; message: string }>>;

  // Listen to render progress
  onRenderProgress: (callback: (progress: RenderProgress) => void) => void;

  // Render one real preview frame using Step 7 visual pipeline (no audio)
  renderVideoPreviewFrame: (
    options: RenderVideoPreviewFrameOptions
  ) => Promise<IpcApiResponse<RenderVideoPreviewFrameResult>>;

  // Stop current real preview frame render process
  stopVideoPreviewFrame: (
    requestToken?: string
  ) => Promise<IpcApiResponse<{ stopped: boolean; message: string }>>;

  // Listen to audio preview progress
  onAudioPreviewProgress: (callback: (progress: RenderAudioPreviewProgress) => void) => void;

  // Get video metadata
  getVideoMetadata: (videoPath: string) => Promise<IpcApiResponse<VideoMetadata>>;

  // Extract frame from video
  extractFrame: (videoPath: string, frameNumber?: number) => Promise<IpcApiResponse<{
    frameData: string;
    width: number;
    height: number;
  }>>;

  // Render thumbnail preview frame thật (pipeline thumbnail)
  renderThumbnailPreviewFrame: (
    options: RenderThumbnailPreviewFrameOptions
  ) => Promise<IpcApiResponse<RenderThumbnailPreviewFrameResult>>;

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

    stopRender: () =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.STOP_RENDER),

    mixAudioPreview: (options: RenderAudioPreviewOptions) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.MIX_AUDIO_PREVIEW, options),

    stopAudioPreview: () =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.STOP_AUDIO_PREVIEW),

    onRenderProgress: (callback: (progress: RenderProgress) => void) => {
      ipcRenderer.on(CAPTION_VIDEO_IPC_CHANNELS.RENDER_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },

    renderVideoPreviewFrame: (options: RenderVideoPreviewFrameOptions) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.RENDER_VIDEO_PREVIEW_FRAME, options),

    stopVideoPreviewFrame: (requestToken?: string) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.STOP_VIDEO_PREVIEW_FRAME, requestToken),

    onAudioPreviewProgress: (callback: (progress: RenderAudioPreviewProgress) => void) => {
      ipcRenderer.removeAllListeners(CAPTION_VIDEO_IPC_CHANNELS.AUDIO_PREVIEW_PROGRESS);
      ipcRenderer.on(CAPTION_VIDEO_IPC_CHANNELS.AUDIO_PREVIEW_PROGRESS, (_event, progress) => {
        callback(progress);
      });
    },

    getVideoMetadata: (videoPath: string) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.GET_VIDEO_METADATA, videoPath),

    extractFrame: (videoPath: string, frameNumber?: number) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.EXTRACT_FRAME, videoPath, frameNumber),

    renderThumbnailPreviewFrame: (options: RenderThumbnailPreviewFrameOptions) =>
      ipcRenderer.invoke(CAPTION_VIDEO_IPC_CHANNELS.RENDER_THUMBNAIL_PREVIEW_FRAME, options),

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
