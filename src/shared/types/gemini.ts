/**
 * Types cho Gemini API Manager
 * Quản lý API keys, rotation state và thống kê
 */

// Trạng thái của một project/API key
export type ProjectStatus = 'available' | 'rate_limited' | 'exhausted' | 'error' | 'disabled';

// Trạng thái của một account
export type AccountStatus = 'active' | 'disabled';

// Thống kê sử dụng của một project
export interface ProjectStats {
  totalRequestsToday: number;
  successCount: number;
  errorCount: number;
  lastSuccessTimestamp: string | null;
  lastErrorMessage: string | null;
}

// Theo dõi giới hạn của một project
export interface LimitTracking {
  lastUsedTimestamp: string | null;
  minuteRequestCount: number;
  rateLimitResetAt: string | null;
  dailyLimitResetAt: string | null;
}

// Thông tin một project (chứa API key)
export interface Project {
  projectIndex: number;
  projectName: string;
  apiKey: string;
  status: ProjectStatus;
  stats: ProjectStats;
  limitTracking: LimitTracking;
}

// Thông tin một account (chứa nhiều projects)
export interface Account {
  accountId: string;
  email: string;
  accountStatus: AccountStatus;
  projects: Project[];
}

// Cài đặt hệ thống
export interface ApiSettings {
  globalCooldownSeconds: number;
  defaultRpmLimit: number;
  maxRpdLimit: number;
  rotationStrategy: 'horizontal_sweep' | 'round_robin';
  retryExhaustedAfterHours: number;
  delayBetweenRequestsMs: number;
}

// Trạng thái rotation
export interface RotationState {
  currentProjectIndex: number;
  currentAccountIndex: number;
  totalRequestsSent: number;
  rotationRound: number;
  lastDailyReset: string | null;
}

// Config hoàn chỉnh (merge từ embedded keys + state)
export interface ApiConfig {
  settings: ApiSettings;
  rotationState: RotationState;
  accounts: Account[];
}

// State lưu vào file (không chứa API keys)
export interface ApiState {
  settings: ApiSettings;
  rotationState: RotationState;
  accounts: AccountState[];
}

// State của account (không chứa API keys)
export interface AccountState {
  accountId: string;
  accountStatus: AccountStatus;
  projects: ProjectState[];
}

// State của project (không chứa API key)
export interface ProjectState {
  projectIndex: number;
  status: ProjectStatus;
  stats: ProjectStats;
  limitTracking: LimitTracking;
}

// Thông tin API key trả về khi lấy key
export interface KeyInfo {
  accountId: string;
  accountEmail: string;
  projectName: string;
  apiKey: string;
  name: string;
  accountIndex: number;
  projectIndex: number;
}

// Thống kê tổng quan
export interface ApiStats {
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

// Response từ Gemini API
export interface GeminiResponse {
  success: boolean;
  data?: string;
  error?: string;
}

// Embedded API key format (hardcoded trong code)
export interface EmbeddedAccount {
  email: string;
  projects: EmbeddedProject[];
}

export interface EmbeddedProject {
  projectName: string;
  apiKey: string;
}

// IPC Channels cho Gemini
export const GEMINI_IPC_CHANNELS = {
  // API Key Management
  GET_NEXT_API_KEY: 'gemini:getNextApiKey',
  GET_ALL_AVAILABLE_KEYS: 'gemini:getAllAvailableKeys',
  GET_STATS: 'gemini:getStats',
  RECORD_SUCCESS: 'gemini:recordSuccess',
  RECORD_RATE_LIMIT: 'gemini:recordRateLimit',
  RECORD_EXHAUSTED: 'gemini:recordExhausted',
  RECORD_ERROR: 'gemini:recordError',
  RESET_ALL_STATUS: 'gemini:resetAllStatus',
  RELOAD_CONFIG: 'gemini:reloadConfig',
  
  // Gemini API calls
  CALL_GEMINI: 'gemini:callApi',
  TRANSLATE_TEXT: 'gemini:translateText',
  
  // Key Storage Management
  KEYS_IMPORT: 'gemini:keys:import',
  KEYS_EXPORT: 'gemini:keys:export',
  KEYS_ADD_ACCOUNT: 'gemini:keys:addAccount',
  KEYS_REMOVE_ACCOUNT: 'gemini:keys:removeAccount',
  KEYS_REMOVE_PROJECT: 'gemini:keys:removeProject',
  KEYS_HAS_KEYS: 'gemini:keys:hasKeys',
  KEYS_GET_LOCATION: 'gemini:keys:getLocation',
  KEYS_GET_ALL: 'gemini:keys:getAll',
} as const;

