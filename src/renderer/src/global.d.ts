/**
 * Global type declarations cho Renderer process
 * Khai báo các types cho window object được expose từ preload script
 */

// ============================================
// CSS MODULES TYPE DECLARATION
// ============================================
declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

// Response type từ IPC
interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Key Info type
interface KeyInfo {
  accountId: string;
  accountEmail: string;
  projectName: string;
  apiKey: string;
  name: string;
  accountIndex: number;
  projectIndex: number;
}

// API Stats type
interface ApiStats {
  totalAccounts: number;
  totalProjects: number;
  available: number;
  rateLimited: number;
  exhausted: number;
  error: number;
  emptyKeys: number;
  totalRequestsToday: number;
  currentAccountIndex: number;
  currentProjectIndex: number;
  rotationRound: number;
}

// Gemini Response type
interface GeminiApiResponse {
  success: boolean;
  data?: string;
  error?: string;
}

/**
 * Gemini API interface cho Renderer process
 */
interface GeminiAPI {
  // API Key Management
  getNextApiKey: () => Promise<IpcApiResponse<{ apiKey: string | null; keyInfo: KeyInfo | null }>>;
  getAllAvailableKeys: () => Promise<IpcApiResponse<KeyInfo[]>>;
  getStats: () => Promise<IpcApiResponse<ApiStats>>;
  recordSuccess: (apiKey: string) => Promise<IpcApiResponse<boolean>>;
  recordRateLimit: (apiKey: string) => Promise<IpcApiResponse<boolean>>;
  recordExhausted: (apiKey: string) => Promise<IpcApiResponse<boolean>>;
  recordError: (apiKey: string, errorMessage: string) => Promise<IpcApiResponse<boolean>>;
  resetAllStatus: () => Promise<IpcApiResponse<boolean>>;
  reloadConfig: () => Promise<IpcApiResponse<boolean>>;

  // Gemini API calls
  callGemini: (prompt: string | object, model?: string) => Promise<IpcApiResponse<GeminiApiResponse>>;
  translateText: (text: string, targetLanguage?: string, model?: string) => Promise<IpcApiResponse<GeminiApiResponse>>;

  // Key Storage Management
  importKeys: (jsonString: string) => Promise<IpcApiResponse<{ count: number }>>;
  exportKeys: () => Promise<IpcApiResponse<string>>;
  hasKeys: () => Promise<IpcApiResponse<boolean>>;
  getKeysLocation: () => Promise<IpcApiResponse<string>>;
  getAllKeys: () => Promise<IpcApiResponse<any[]>>;
  getAllKeysWithStatus: () => Promise<IpcApiResponse<any[]>>; // Lấy tất cả keys với status chi tiết
}

// ============================================
// CAPTION TYPES
// ============================================

interface SubtitleEntry {
  index: number;
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  text: string;
  translatedText?: string;
}

interface ParseSrtResult {
  success: boolean;
  entries: SubtitleEntry[];
  totalEntries: number;
  filePath: string;
  error?: string;
}

interface TranslationOptions {
  entries: SubtitleEntry[];
  targetLanguage: string;
  model: string;
  linesPerBatch: number;
  promptTemplate?: string;
}

interface TranslationResult {
  success: boolean;
  entries: SubtitleEntry[];
  totalLines: number;
  translatedLines: number;
  failedLines: number;
  errors?: string[];
}

interface TranslationProgress {
  current: number;
  total: number;
  batchIndex: number;
  totalBatches: number;
  status: 'translating' | 'completed' | 'error';
  message: string;
}

interface SplitOptions {
  entries: SubtitleEntry[];
  splitByLines: boolean;
  value: number;
  outputDir: string;
}

interface SplitResult {
  success: boolean;
  partsCount: number;
  files: string[];
  error?: string;
}

/**
 * Caption API interface
 */
interface CaptionAPI {
  parseSrt: (filePath: string) => Promise<IpcApiResponse<ParseSrtResult>>;
  parseDraft: (filePath: string) => Promise<IpcApiResponse<ParseSrtResult>>; // Parse draft_content.json
  exportSrt: (entries: SubtitleEntry[], outputPath: string) => Promise<IpcApiResponse<string>>;
  translate: (options: TranslationOptions) => Promise<IpcApiResponse<TranslationResult>>;
  onTranslateProgress: (callback: (progress: TranslationProgress) => void) => void;
  split: (options: SplitOptions) => Promise<IpcApiResponse<SplitResult>>;
}

// ============================================
// TTS TYPES
// ============================================

interface TTSOptions {
  voice?: string;
  rate?: string;
  volume?: string;
  pitch?: string;
  outputFormat?: 'wav' | 'mp3';
  outputDir: string;
  maxConcurrent?: number;
}

interface AudioFile {
  index: number;
  path: string;
  startMs: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

interface TTSResult {
  success: boolean;
  audioFiles: AudioFile[];
  totalGenerated: number;
  totalFailed: number;
  outputDir: string;
  errors?: string[];
}

interface TTSProgress {
  current: number;
  total: number;
  status: 'generating' | 'completed' | 'error';
  currentFile: string;
  message: string;
}

interface MergeResult {
  success: boolean;
  outputPath: string;
  error?: string;
}

interface TrimSilenceResult {
  success: boolean;
  trimmedCount: number;
  failedCount: number;
  errors?: string[];
}

interface VoiceInfo {
  name: string;
  displayName: string;
  language: string;
  gender: 'Male' | 'Female';
}

/**
 * TTS API interface
 */
interface TTSAPI {
  getVoices: () => Promise<IpcApiResponse<VoiceInfo[]>>;
  generate: (entries: SubtitleEntry[], options: Partial<TTSOptions>) => Promise<IpcApiResponse<TTSResult>>;
  onProgress: (callback: (progress: TTSProgress) => void) => void;
  analyzeAudio: (audioFiles: AudioFile[], srtDuration: number) => Promise<IpcApiResponse<unknown>>;
  mergeAudio: (audioFiles: AudioFile[], outputPath: string, timeScale?: number) => Promise<IpcApiResponse<MergeResult>>;
  trimSilence: (audioPaths: string[]) => Promise<IpcApiResponse<TrimSilenceResult>>;
}

/**
 * Mở rộng Window interface để bao gồm electronAPI
 * Được expose từ preload/index.ts thông qua contextBridge
 */
declare global {
  interface Window {
    electronAPI: {
      // Các method cơ bản
      sendMessage: (channel: string, data: unknown) => void;
      onMessage: (channel: string, callback: (...args: unknown[]) => void) => void;
      invoke: (channel: string, data?: unknown) => Promise<unknown>;
      
      // Gemini API
      gemini: GeminiAPI;

      // Caption API (dịch phụ đề)
      caption: CaptionAPI;

      // TTS API (text-to-speech)
      tts: TTSAPI;
    };
  }
}

export {};

