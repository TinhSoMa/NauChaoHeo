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

// ============================================
// PROJECT API TYPES
// ============================================

interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  paths: ProjectPaths;
}

interface ProjectPaths {
  story: string;
  caption: string;
  tts: string;
  gemini: string;
}

interface ProjectResolvedPaths {
  root: string;
  story: string;
  caption: string;
  tts: string;
  gemini: string;
}

/**
 * Project API interface cho quản lý dự án dịch
 */
interface ProjectAPI {
  openProject: (projectId: string) => Promise<IpcApiResponse<void>>;
  createAndOpen: (projectName: string) => Promise<IpcApiResponse<ProjectMetadata>>;
  scanProjects: () => Promise<IpcApiResponse<ProjectMetadata[]>>;
  getMetadata: (projectId: string) => Promise<IpcApiResponse<ProjectMetadata>>;
  getResolvedPaths: (projectId: string) => Promise<IpcApiResponse<ProjectResolvedPaths>>;
  readFeatureFile: (payload: { projectId: string; feature: keyof ProjectPaths; fileName: string }) => Promise<IpcApiResponse<string | null>>;
  writeFeatureFile: (payload: { projectId: string; feature: keyof ProjectPaths; fileName: string; content: unknown }) => Promise<IpcApiResponse<void>>;
  getProjectsPath: () => Promise<IpcApiResponse<string | null>>;
  setProjectsPath: (path: string) => Promise<IpcApiResponse<void>>;
}

// ============================================
// APP SETTINGS API TYPES
// ============================================

interface AppSettings {
  projectsBasePath: string | null;
  theme: 'light' | 'dark' | 'system';
  language: 'vi' | 'en';
  recentProjectIds: string[];
  lastActiveProjectId: string | null;
  useProxy: boolean;
  createChatOnWeb: boolean;
  useStoredContextOnFirstSend: boolean;
  translationPromptId: string | null;
  summaryPromptId: string | null;
}

/**
 * App Settings API interface
 */
interface AppSettingsAPI {
  getAll: () => Promise<IpcApiResponse<AppSettings>>;
  update: (partial: Partial<AppSettings>) => Promise<IpcApiResponse<AppSettings>>;
  getProjectsBasePath: () => Promise<IpcApiResponse<string>>;
  setProjectsBasePath: (basePath: string | null) => Promise<IpcApiResponse<void>>;
  addRecentProject: (projectId: string) => Promise<IpcApiResponse<void>>;
  getRecentProjectIds: () => Promise<IpcApiResponse<string[]>>;
  getLastActiveProjectId: () => Promise<IpcApiResponse<string | null>>;
  removeFromRecent: (projectId: string) => Promise<IpcApiResponse<void>>;
}

// ============================================
// GEMINI CHAT API TYPES
// ============================================

interface GeminiChatConfig {
  id: string;
  name: string;
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  proxyId?: string;
  convId: string;
  respId: string;
  candId: string;
  reqId?: string;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

interface CreateGeminiChatConfigDTO {
  name?: string;
  cookie: string;
  blLabel?: string;
  fSid?: string;
  atToken?: string;
  proxyId?: string;
  convId?: string;
  respId?: string;
  candId?: string;
  reqId?: string;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
}

interface UpdateGeminiChatConfigDTO extends Partial<CreateGeminiChatConfigDTO> {
  isActive?: boolean;
}

// Interface cho cookie config (bảng gemini_cookie - chỉ 1 dòng)
interface GeminiCookieConfig {
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  reqId?: string;
  updatedAt: number;
}

/**
 * Gemini Chat API interface
 */
interface GeminiChatAPI {
  getAll: () => Promise<IpcApiResponse<GeminiChatConfig[]>>;
  getActive: () => Promise<IpcApiResponse<GeminiChatConfig | null>>;
  getById: (id: string) => Promise<IpcApiResponse<GeminiChatConfig | null>>;
  create: (data: CreateGeminiChatConfigDTO) => Promise<IpcApiResponse<GeminiChatConfig>>;
  update: (id: string, data: UpdateGeminiChatConfigDTO) => Promise<IpcApiResponse<GeminiChatConfig | null>>;
  delete: (id: string) => Promise<IpcApiResponse<boolean>>;
  sendMessage: (message: string, configId: string, context?: { conversationId: string; responseId: string; choiceId: string }) => Promise<IpcApiResponse<{ text: string; context: { conversationId: string; responseId: string; choiceId: string } }>>;
  checkDuplicateToken: (payload: { cookie: string; atToken: string; excludeId?: string }) => Promise<IpcApiResponse<{ isDuplicate: boolean; duplicate?: GeminiChatConfig }>>;
  
  // Cookie config methods (bảng gemini_cookie)
  getCookieConfig: () => Promise<IpcApiResponse<GeminiCookieConfig | null>>;
  saveCookieConfig: (data: { cookie: string; blLabel: string; fSid: string; atToken: string; reqId?: string }) => Promise<IpcApiResponse<null>>;
}

/**
 * Mở rộng Window interface để bao gồm electronAPI
 * Được expose từ preload/index.ts thông qua contextBridge
 */

// Proxy API types
interface ProxyConfig {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  type: 'http' | 'https' | 'socks5';
  enabled: boolean;
  successCount?: number;
  failedCount?: number;
  lastUsedAt?: number;
  createdAt: number;
}

interface ProxyStats {
  id: string;
  host: string;
  port: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  lastUsedAt?: number;
  isHealthy: boolean;
}

interface ProxyTestResult {
  success: boolean;
  latency?: number;
  error?: string;
  testedAt: number;
}

interface ProxyAPI {
  getAll: () => Promise<{ success: boolean; data?: ProxyConfig[]; error?: string }>;
  add: (config: Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>) => Promise<{ success: boolean; data?: ProxyConfig; error?: string }>;
  remove: (id: string) => Promise<{ success: boolean; error?: string }>;
  update: (id: string, updates: Partial<ProxyConfig>) => Promise<{ success: boolean; error?: string }>;
  test: (id: string) => Promise<ProxyTestResult>;
  checkAll: () => Promise<{ success: boolean; checked?: number; passed?: number; failed?: number; error?: string }>;
  getStats: () => Promise<{ success: boolean; data?: ProxyStats[]; error?: string }>;
  import: (data: string) => Promise<{ success: boolean; added?: number; skipped?: number; error?: string }>;
  export: () => Promise<{ success: boolean; data?: string; error?: string }>;
  reset: () => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: {
      // Cac method co ban
      sendMessage: (channel: string, data: unknown) => void;
      onMessage: (channel: string, callback: (...args: unknown[]) => void) => void;
      invoke: (channel: string, data?: unknown) => Promise<unknown>;
      
      // Gemini API
      gemini: GeminiAPI;

      // Caption API (dich phu de)
      caption: CaptionAPI;

      // TTS API (text-to-speech)
      tts: TTSAPI;

      // Project API (quan ly du an dich)
      project: ProjectAPI;

      // App Settings API (cai dat ung dung)
      appSettings: AppSettingsAPI;

      // Gemini Chat API (cau hinh Gemini web)
      geminiChat: GeminiChatAPI;

      // Proxy API (quan ly proxy rotation)
      proxy: ProxyAPI;
    };
  }
}

export {};
