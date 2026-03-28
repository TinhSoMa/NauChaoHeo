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
  disableAccount: (accountId: string) => Promise<IpcApiResponse<boolean>>;
  enableAccount: (accountId: string) => Promise<IpcApiResponse<boolean>>;
  disableProject: (accountId: string, projectIndex: number) => Promise<IpcApiResponse<boolean>>;
  enableProject: (accountId: string, projectIndex: number) => Promise<IpcApiResponse<boolean>>;
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
  translateMethod?: 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui';
  retryBatchIndexes?: number[];
  projectId?: string;
  sourcePath?: string;
  runId?: string;
}

interface TranslationResult {
  success: boolean;
  entries: SubtitleEntry[];
  totalLines: number;
  translatedLines: number;
  failedLines: number;
  errors?: string[];
  batchReports?: TranslationBatchReport[];
  missingBatchIndexes?: number[];
  missingGlobalLineIndexes?: number[];
}

interface TranslationBatchReport {
  batchIndex: number;
  startIndex: number;
  endIndex: number;
  expectedLines: number;
  translatedLines: number;
  missingLinesInBatch: number[];
  missingGlobalLineIndexes: number[];
  attempts: number;
  status: 'success' | 'failed';
  error?: string;
}

interface TranslationProgress {
  current: number;
  total: number;
  batchIndex: number;
  totalBatches: number;
  status: 'translating' | 'completed' | 'error';
  message: string;
  runId?: string;
  eventType?: 'batch_started' | 'batch_retry' | 'batch_completed' | 'batch_failed' | 'summary';
  batchReport?: TranslationBatchReport;
  translatedChunk?: {
    startIndex: number;
    texts: string[];
  };
  folderHint?: string;
  transport?: 'api' | 'impit' | 'gemini_webapi_queue' | 'grok_ui';
  resourceId?: string;
  resourceLabel?: string;
  queueRuntimeKey?: string;
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

// ============================================
// CUT VIDEO TYPES
// ============================================

interface ScanFolderResult {
  success: boolean;
  data?: {
    folderPath: string;
    mediaFiles: string[];
    count: number;
  };
  error?: string;
}

interface CutVideoAPI {
  scanFolder: (folderPath: string) => Promise<ScanFolderResult>;
  startAudioExtraction: (options: {
    folders: string[];
    format: 'mp3' | 'aac' | 'wav' | 'flac';
    keepStructure: boolean;
    overwrite: boolean;
    capcutProjectPath?: string;
    capcutDraftsPath?: string;
    autoAttachToCapcut?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  stopExtraction: () => Promise<{ success: boolean }>;
  onExtractionProgress: (callback: (data: { totalPercent: number; currentFile: string; currentPercent: number }) => void) => () => void;
  onExtractionLog: (callback: (data: {
    file: string;
    folder: string;
    status: string;
    time: string;
    phase?: 'extract' | 'capcut_attach';
    detail?: string;
  }) => void) => () => void;

  getVideoInfo: (filePath: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  getMediaInfo: (filePath: string) => Promise<{
    success: boolean;
    data?: {
      duration: number;
      hasVideo: boolean;
      hasAudio: boolean;
      width?: number;
      height?: number;
    };
    error?: string;
  }>;
  detectSilences: (options: {
    inputPath: string;
    noiseDb?: number;
    minDurationSec?: number;
  }) => Promise<{
    success: boolean;
    data?: {
      durationSec: number;
      silences: Array<{ startSec: number; endSec: number; durationSec: number }>;
    };
    error?: string;
  }>;
  startVideoSplit: (options: {
    inputPath: string;
    clips: { name: string; startStr: string; durationStr: string }[];
  }) => Promise<{ success: boolean; error?: string }>;
  stopVideoSplit: () => Promise<{ success: boolean }>;
  onSplitProgress: (callback: (data: { totalPercent: number; currentClipName: string; currentPercent: number }) => void) => () => void;
  onSplitLog: (callback: (data: { clipName: string; status: string; time: string }) => void) => () => void;

  scanRenderedForMerge: (options: {
    folders: string[];
    mode: '16_9' | '9_16';
  }) => Promise<{
    success: boolean;
    data?: {
      canMerge: boolean;
      outputAspect: '16_9' | '9_16';
      items: Array<{
        inputFolder: string;
        scanDir: string;
        status: 'ok' | 'missing' | 'invalid' | 'mismatch';
        message?: string;
        matchedFilePath?: string;
        fileName?: string;
        metadata?: {
          duration: number;
          width: number;
          height: number;
          fps: number;
          hasAudio: boolean;
          videoCodec: string;
          audioCodec?: string;
        };
      }>;
      sortedVideoPaths: string[];
      blockingReason?: string;
    };
    error?: string;
  }>;
  startVideoMerge: (options: {
    folders: string[];
    mode: '16_9' | '9_16';
    outputDir: string;
  }) => Promise<{ success: boolean; data?: { outputPath: string }; error?: string }>;
  stopVideoMerge: () => Promise<{ success: boolean }>;
  onMergeProgress: (callback: (data: {
    percent: number;
    stage: 'scan' | 'preflight' | 'concat' | 'completed' | 'stopped' | 'error';
    message: string;
    currentFile?: string;
  }) => void) => () => void;
  onMergeLog: (callback: (data: {
    status: 'info' | 'success' | 'error' | 'processing';
    message: string;
    time: string;
  }) => void) => () => void;

  startVideoAudioMix: (options: {
    videoPath: string;
    audioPaths: string[];
    videoVolumePercent: number;
    musicVolumePercent: number;
    outputPath?: string;
  }) => Promise<{ success: boolean; data?: { outputPath: string }; error?: string }>;
  stopVideoAudioMix: () => Promise<{ success: boolean }>;
  onAudioMixProgress: (callback: (data: {
    percent: number;
    stage: 'preflight' | 'building_playlist' | 'mixing' | 'completed' | 'stopped' | 'error';
    message: string;
    currentFile?: string;
  }) => void) => () => void;
  onAudioMixLog: (callback: (data: {
    status: 'info' | 'success' | 'error' | 'processing';
    message: string;
    time: string;
  }) => void) => () => void;

  scanVideosForCapcut: (folderPath: string) => Promise<{
    success: boolean;
    data?: {
      folderPath: string;
      videos: Array<{
        fileName: string;
        fullPath: string;
        ext: string;
      }>;
      count: number;
    };
    error?: string;
  }>;
  startCapcutProjectBatch: (options: {
    sourceFolderPath: string;
    capcutDraftsPath?: string;
    namingMode: 'index_plus_filename' | 'month_day_suffix';
    orderedVideoPaths?: string[];
  }) => Promise<{
    success: boolean;
    data?: {
      total: number;
      created: number;
      failed: number;
      stopped: boolean;
      projects: Array<{
        videoName: string;
        projectName: string;
        status: 'success' | 'error';
        copiedClipCount?: number;
        assetFolder?: string;
        error?: string;
      }>;
    };
    error?: string;
  }>;
  stopCapcutProjectBatch: () => Promise<{ success: boolean }>;
  onCapcutProgress: (callback: (data: {
    total: number;
    current: number;
    percent: number;
    currentVideoName?: string;
    stage: 'preflight' | 'scanning' | 'creating' | 'copying_clips' | 'completed' | 'stopped' | 'error';
    message: string;
  }) => void) => () => void;
  onCapcutLog: (callback: (data: {
    time: string;
    status: 'info' | 'processing' | 'success' | 'error';
    message: string;
    videoName?: string;
    projectName?: string;
  }) => void) => () => void;
}

/**
 * Caption API interface
 */
interface CaptionAPI {
  parseSrt: (filePath: string) => Promise<IpcApiResponse<ParseSrtResult>>;
  parseDraft: (filePath: string) => Promise<IpcApiResponse<ParseSrtResult>>; // Parse draft_content.json
  exportSrt: (entries: SubtitleEntry[], outputPath: string) => Promise<IpcApiResponse<string>>;
  exportPlainText: (content: string, outputPath: string) => Promise<IpcApiResponse<string>>;
  translate: (options: TranslationOptions) => Promise<IpcApiResponse<TranslationResult>>;
  onTranslateProgress: (callback: (progress: TranslationProgress) => void) => void;
  ackTranslateProgress: (payload: { runId?: string; batchIndex: number; eventType: 'batch_completed' | 'batch_failed' }) => Promise<IpcApiResponse<void>>;
  split: (options: SplitOptions) => Promise<IpcApiResponse<SplitResult>>;
  stopAll: (payload?: { runId?: string }) => Promise<IpcApiResponse<{ stopped: boolean; message?: string }>>;
  readSession: (sessionPath: string) => Promise<IpcApiResponse<any | null>>;
  writeSessionAtomic: (sessionPath: string, data: any) => Promise<IpcApiResponse<string>>;
  patchSession: (sessionPath: string, patch: any) => Promise<IpcApiResponse<any>>;
}

interface CaptionDefaultsAPI {
  get: () => Promise<IpcApiResponse<{ schemaVersion: 1; settings: Record<string, unknown>; updatedAt: number } | null>>;
  save: (settings: Record<string, unknown>) => Promise<IpcApiResponse<{ updatedAt: number }>>;
}

// ============================================
// TTS TYPES
// ============================================

interface TTSOptions {
  provider?: 'edge' | 'capcut';
  voice?: string;
  rate?: string;
  volume?: string;
  pitch?: string;
  outputFormat?: 'wav' | 'mp3';
  outputDir: string;
  maxConcurrent?: number;
  runId?: string;
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

interface TTSTestVoiceRequest {
  text: string;
  voice: string;
  rate?: string;
  volume?: string;
  outputFormat?: 'wav' | 'mp3';
}

interface TTSTestVoiceResponse {
  audioDataUri: string;
  mime: string;
  durationMs?: number;
  provider: 'edge' | 'capcut';
  voice: string;
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

interface TrimSilencePathItem {
  inputPath: string;
  outputPath: string;
}

interface VoiceInfo {
  name: string;
  provider: 'edge' | 'capcut';
  voiceId: string;
  displayName: string;
  language: string;
  gender: 'Male' | 'Female';
  tier?: 'free' | 'pro';
  value?: string;
}

/**
 * TTS API interface
 */
interface TTSAPI {
  getVoices: () => Promise<IpcApiResponse<VoiceInfo[]>>;
  testVoice: (request: TTSTestVoiceRequest) => Promise<IpcApiResponse<TTSTestVoiceResponse>>;
  generate: (entries: SubtitleEntry[], options: Partial<TTSOptions>) => Promise<IpcApiResponse<TTSResult>>;
  stop: () => Promise<IpcApiResponse<{ stopped: boolean; message?: string }>>;
  onProgress: (callback: (progress: TTSProgress) => void) => void;
  analyzeAudio: (audioFiles: AudioFile[], srtDuration: number) => Promise<IpcApiResponse<unknown>>;
  mergeAudio: (audioFiles: AudioFile[], outputPath: string, timeScale?: number) => Promise<IpcApiResponse<MergeResult>>;
  trimSilence: (audioPaths: string[]) => Promise<IpcApiResponse<TrimSilenceResult>>;
  trimSilenceEnd: (audioPaths: string[]) => Promise<IpcApiResponse<TrimSilenceResult>>;
  trimSilenceToPaths: (targets: TrimSilencePathItem[]) => Promise<IpcApiResponse<TrimSilenceResult>>;
  trimSilenceEndToPaths: (targets: TrimSilencePathItem[]) => Promise<IpcApiResponse<TrimSilenceResult>>;
  fitAudio: (audioItems: Array<{ path: string; durationMs: number }>) => Promise<IpcApiResponse<TrimSilenceResult>>;
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
  renderVideoOutputDir: string | null;
  useRenderVideoOutputDir: boolean;
  theme: 'light' | 'dark' | 'system';
  language: 'vi' | 'en';
  recentProjectIds: string[];
  lastActiveProjectId: string | null;
  useProxy: boolean;
  proxyMode: 'off' | 'direct-list' | 'rotating-endpoint';
  rotatingProxyEndpoint: string | null;
  webshareApiKey: string | null;
  capcutDraftsPath: string | null;
  proxyScopes: {
    caption: { mode: 'off' | 'direct-list' | 'rotating-endpoint'; typePreference: 'any' | 'http' | 'https' | 'socks5'; rotatingEndpoint?: string | null };
    story: { mode: 'off' | 'direct-list' | 'rotating-endpoint'; typePreference: 'any' | 'http' | 'https' | 'socks5'; rotatingEndpoint?: string | null };
    chat: { mode: 'off' | 'direct-list' | 'rotating-endpoint'; typePreference: 'any' | 'http' | 'https' | 'socks5'; rotatingEndpoint?: string | null };
    tts: { mode: 'off' | 'direct-list' | 'rotating-endpoint'; typePreference: 'any' | 'http' | 'https' | 'socks5'; rotatingEndpoint?: string | null };
    other: { mode: 'off' | 'direct-list' | 'rotating-endpoint'; typePreference: 'any' | 'http' | 'https' | 'socks5'; rotatingEndpoint?: string | null };
  };
  createChatOnWeb: boolean;
  useStoredContextOnFirstSend: boolean;
  geminiMinSendIntervalMs: number;
  geminiMaxSendIntervalMs: number;
  geminiSendIntervalMode: 'fixed' | 'random';
  translationPromptId: string | null;
  summaryPromptId: string | null;
  captionPromptId: string | null;
  grokUiProfileDir: string | null;
  grokUiProfileName: string | null;
  grokUiAnonymous: boolean;
  grokUiProfiles: GrokUiProfileConfig[];
  grokUiTimeoutMs: number;
  grokUiRequestDelayMs: number;
  // Caption logo (global)
  captionLogoPath: string | null;
  captionLogoPosition: { x: number; y: number } | null;
  captionLogoScale: number;
  captionTypographyDefaults: CaptionTypographyDefaults | null;
  captionStandaloneSettings: string | null;
  capcutTtsSecrets: {
    appKey: string | null;
    token: string | null;
    wsUrl: string | null;
    userAgent: string | null;
    xSsDp: string | null;
    extraHeaders: Record<string, string> | null;
  };
}

interface GrokUiProfileConfig {
  id: string;
  profileDir: string | null;
  profileName: string | null;
  anonymous: boolean;
  enabled: boolean;
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

/**
 * App Settings API interface
 */
interface AppSettingsAPI {
  getAll: () => Promise<IpcApiResponse<AppSettings>>;
  update: (partial: Partial<AppSettings>) => Promise<IpcApiResponse<AppSettings>>;
  getProjectsBasePath: () => Promise<IpcApiResponse<string | null>>;
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
  blLabel?: string;
  fSid?: string;
  atToken?: string;
  secure1psid?: string;
  secure1psidts?: string;
  proxyId?: string;
  convId: string;
  respId: string;
  candId: string;
  reqId?: string;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
  isActive: boolean;
  isError?: boolean;
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
  isError?: boolean;
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
  checkDuplicateToken: (payload: { cookie: string; excludeId?: string }) => Promise<IpcApiResponse<{ isDuplicate: boolean; duplicate?: GeminiChatConfig }>>;
  
  // Cookie config methods (bảng gemini_cookie)
  getCookieConfig: () => Promise<IpcApiResponse<GeminiCookieConfig | null>>;
  saveCookieConfig: (data: { cookie: string; blLabel: string; fSid: string; atToken: string; reqId?: string }) => Promise<IpcApiResponse<null>>;

  // Impit browser management
  getMaxImpitBrowsers: () => Promise<IpcApiResponse<number>>;
  releaseAllImpitBrowsers: () => Promise<IpcApiResponse<void>>;

  // Token stats
  getTokenStats: () => Promise<IpcApiResponse<TokenStatsResponse>>;
  clearConfigError: (configId: string) => Promise<IpcApiResponse<void>>;
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
  isRotatingEndpoint?: boolean;
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

interface RotatingProxyConfig {
  scope: 'caption' | 'story' | 'chat' | 'tts' | 'other';
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'socks5';
  updatedAt: number;
}

interface RotatingProxyConfigInput {
  scope: RotatingProxyConfig['scope'];
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: RotatingProxyConfig['protocol'];
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
  testRotatingEndpoint: (endpoint?: string) => Promise<{ success: boolean; latency?: number; error?: string }>;
  webshareSync: (payload: { apiKey: string; typePreference: 'http' | 'socks5' | 'both' }) => Promise<{ success: boolean; removed?: number; added?: number; skipped?: number; totalFetched?: number; error?: string }>;
  getRotatingConfigs: () => Promise<{ success: boolean; data?: RotatingProxyConfig[]; error?: string }>;
  saveRotatingConfig: (payload: RotatingProxyConfigInput) => Promise<{ success: boolean; data?: RotatingProxyConfig; error?: string }>;
  getWebshareApiKey: () => Promise<{ success: boolean; data?: { apiKey: string; updatedAt: number } | null; error?: string }>;
  saveWebshareApiKey: (payload: { apiKey: string }) => Promise<{ success: boolean; data?: { apiKey: string; updatedAt: number }; error?: string }>;
}

interface CreatePromptDTO {
  name: string;
  description?: string;
  sourceLang: string;
  targetLang: string;
  content: string;
  isDefault?: boolean;
}

interface PromptAPI {
  getAll: () => Promise<any>;
  getById: (id: string) => Promise<any>;
  create: (data: CreatePromptDTO) => Promise<any>;
  update: (id: string, data: Partial<CreatePromptDTO>) => Promise<any>;
  delete: (id: string) => Promise<any>;
  setDefault: (id: string) => Promise<any>;
}

interface RotationQueueViewOptions {
  includePayload?: boolean;
  poolId?: string;
  serviceId?: string;
  feature?: string;
  state?: 'queued' | 'retry_wait' | 'running' | 'all';
  limit?: number;
}

interface RotationQueueDispatchEvent {
  type: string;
  timestamp: number;
  poolId?: string;
  serviceId?: string;
  jobId?: string;
  feature?: string;
  jobType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RotationQueueEventRecord {
  seq: number;
  timestamp: number;
  event: RotationQueueDispatchEvent;
}

interface RotationQueueInspectorSnapshot {
  timestamp: number;
  scheduler: Record<string, unknown>;
  jobs: Array<Record<string, unknown>>;
  runningByResource: Record<string, Record<string, string | null>>;
  historySize: number;
  droppedHistoryCount: number;
}

interface RotationQueueRuntimeInfo {
  key: string;
  jobCounts?: {
    queued: number;
    running: number;
  };
}

interface RotationQueueInspectorStatus {
  enabled: boolean;
  reason?: string;
  snapshotThrottleMs: number;
  historyCapacity: number;
  payloadDebugEnabled?: boolean;
}

interface GeminiWebApiAPI {
  getHealth: () => Promise<IpcApiResponse<GeminiWebApiHealthSnapshot>>;
  getAccountStatuses: () => Promise<IpcApiResponse<GeminiWebApiOpsSnapshot>>;
  getLogs: (limit?: number) => Promise<IpcApiResponse<GeminiWebApiLogEntry[]>>;
  clearLogs: () => Promise<IpcApiResponse<void>>;
}

interface GrokUiHealthSnapshot {
  checkedAt: number;
  pythonOk: boolean;
  modulesOk: boolean;
  runtimeMode?: 'embedded' | 'system';
  pythonPath?: string;
  pythonVersion?: string;
  modules?: Record<string, boolean>;
  error?: string;
}

interface GrokUiProfileCreateResult {
  id: string;
  profileDir: string;
  profileName: string;
  profilePath: string;
}

interface GrokUiProfileStatus {
  state: 'ok' | 'rate_limited' | 'error';
  lastErrorCode?: string;
  lastError?: string;
  updatedAt: number;
}

interface GrokUiProfileStatusEntry {
  profile: GrokUiProfileConfig;
  status: GrokUiProfileStatus;
}

interface GrokUiAPI {
  getHealth: () => Promise<IpcApiResponse<GrokUiHealthSnapshot>>;
  testAsk: (payload: { prompt: string; timeoutMs?: number }) => Promise<IpcApiResponse<{ text: string }>>;
  shutdown: () => Promise<IpcApiResponse<void>>;
  createProfile: (payload: { id?: string; profileDir?: string | null; profileName?: string | null; anonymous?: boolean }) => Promise<IpcApiResponse<GrokUiProfileCreateResult>>;
  getProfileStatuses: () => Promise<IpcApiResponse<GrokUiProfileStatusEntry[]>>;
  resetProfileStatuses: () => Promise<IpcApiResponse<void>>;
  getProfiles: () => Promise<IpcApiResponse<GrokUiProfileConfig[]>>;
  saveProfiles: (payload: { profiles: GrokUiProfileConfig[] }) => Promise<IpcApiResponse<void>>;
  setProfileEnabled: (payload: { id: string; enabled: boolean }) => Promise<IpcApiResponse<void>>;
  deleteProfile: (payload: { id: string }) => Promise<IpcApiResponse<void>>;
}

type AppLogLevel = 'info' | 'warn' | 'error' | 'success';
type AppLogSource = 'main' | 'renderer';

interface AppLogEntry {
  seq: number;
  timestamp: number;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  meta?: Record<string, unknown>;
}

interface AppLogsAPI {
  getLogs: (limit?: number) => Promise<IpcApiResponse<AppLogEntry[]>>;
  clearLogs: () => Promise<IpcApiResponse<void>>;
  append: (payload: {
    level: AppLogLevel;
    source?: AppLogSource;
    message: string;
    timestamp?: number;
    meta?: Record<string, unknown>;
  }) => void;
  onLog: (callback: (entry: AppLogEntry) => void) => () => void;
}

interface RotationQueueAPI {
  getStatus: () => Promise<IpcApiResponse<RotationQueueInspectorStatus>>;
  listRuntimes: () => Promise<IpcApiResponse<RotationQueueRuntimeInfo[]>>;
  getSnapshot: (options?: RotationQueueViewOptions, runtimeKey?: string) => Promise<IpcApiResponse<RotationQueueInspectorSnapshot>>;
  getHistory: (limit?: number, runtimeKey?: string) => Promise<IpcApiResponse<RotationQueueEventRecord[]>>;
  clearHistory: (options?: { runtimeKey?: string; resetDroppedCounter?: boolean }) => Promise<IpcApiResponse<void>>;
  startStream: (options?: RotationQueueViewOptions, runtimeKey?: string) => Promise<IpcApiResponse<void>>;
  stopStream: () => Promise<IpcApiResponse<void>>;
  onEvent: (callback: (event: RotationQueueEventRecord) => void) => () => void;
  onSnapshot: (callback: (snapshot: RotationQueueInspectorSnapshot) => void) => () => void;
}

declare global {
  interface GeminiWebApiHealthSnapshot {
    checkedAt: number;
    pythonOk: boolean;
    modulesOk: boolean;
    cookieReady: boolean;
    runtimeMode?: 'embedded' | 'system';
    pythonPath?: string;
    pythonVersion?: string;
    modules?: Record<string, boolean>;
    error?: string;
  }

  interface GeminiWebApiAccountStatus {
    accountConfigId: string;
    accountName: string;
    isActive: boolean;
    hasStoredCookie: boolean;
    hasSecure1PSID: boolean;
    hasSecure1PSIDTS: boolean;
    cookieSource: 'sqlite' | 'app_settings' | 'browser_refresh' | 'none';
    lastRefreshStatus: 'idle' | 'running' | 'success' | 'failed';
    lastRefreshAt: number | null;
    lastRefreshBrowser?: 'chrome' | 'edge';
    updatedPrimary?: boolean;
    updatedFallback?: boolean;
    lastError?: string;
  }

  interface GeminiWebApiAccountSummary {
    totalAccounts: number;
    activeAccounts: number;
    refreshSuccessCount: number;
    refreshFailCount: number;
    refreshRunningCount: number;
    cookieReadyCount: number;
  }

  interface GeminiWebApiOpsSnapshot {
    summary: GeminiWebApiAccountSummary;
    accounts: GeminiWebApiAccountStatus[];
  }

  interface GeminiWebApiLogEntry {
    seq: number;
    timestamp: number;
    level: 'info' | 'success' | 'warning' | 'error';
    type:
      | 'health_checked'
      | 'cookie_refresh_started'
      | 'cookie_refresh_succeeded'
      | 'cookie_refresh_failed'
      | 'request_succeeded'
      | 'request_failed'
      | 'worker_started'
      | 'worker_log'
      | 'worker_error';
    message: string;
    accountConfigId?: string;
    accountName?: string;
    sourceBrowser?: 'chrome' | 'edge';
    errorCode?: string;
    error?: string;
    metadata?: Record<string, unknown>;
  }

  interface Window {
    electronAPI: {
      // Cac method co ban
      sendMessage: (channel: string, data: unknown) => void;
      onMessage: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      invoke: (channel: string, data?: unknown) => Promise<unknown>;
      
      dialog: {
        showOpenDialog: (options: any) => Promise<string[] | undefined>;
      };

      // Gemini API
      gemini: GeminiAPI;

      // Caption API (dich phu de)
      caption: CaptionAPI;
      captionDefaults: CaptionDefaultsAPI;

      // TTS API (text-to-speech)
      tts: TTSAPI;

      // Project API (quan ly du an dich)
      project: ProjectAPI;

      // App Settings API (cai dat ung dung)
      appSettings: AppSettingsAPI;

      // Gemini Chat API (cau hinh Gemini web)
      geminiChat: GeminiChatAPI;

      // Gemini WebAPI Ops API
      geminiWebApi: GeminiWebApiAPI;

      // Grok UI API
      grokUi: GrokUiAPI;

      // App Logs API
      appLogs: AppLogsAPI;

      // Proxy API (quan ly proxy rotation)
      proxy: ProxyAPI;

      // Prompt API (quan ly prompts)
      prompt: PromptAPI;

      // Caption Video API (subtitle strip)
      captionVideo: any; 

      // Cut Video API
      cutVideo: CutVideoAPI;

      // Rotation Queue Inspector API
      rotationQueue: RotationQueueAPI;
    };
  }
}

export {};
