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
  VoiceInfo,
  AudioFile,
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
  };
}
