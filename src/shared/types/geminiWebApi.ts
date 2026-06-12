export const GEMINI_WEB_API_IPC_CHANNELS = {
  GET_HEALTH: 'geminiWebApi:getHealth',
  GET_ACCOUNT_STATUSES: 'geminiWebApi:getAccountStatuses',
  GET_LOGS: 'geminiWebApi:getLogs',
  CLEAR_LOGS: 'geminiWebApi:clearLogs'
} as const;

export type GeminiWebApiLogLevel = 'info' | 'success' | 'warning' | 'error';

export type GeminiWebApiLogType =
  | 'health_checked'
  | 'cookie_refresh_started'
  | 'cookie_refresh_succeeded'
  | 'cookie_refresh_failed'
  | 'request_succeeded'
  | 'request_failed'
  | 'worker_started'
  | 'worker_log'
  | 'worker_error';

export interface GeminiWebApiHealthSnapshot {
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

export interface GeminiWebApiAccountStatus {
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

export interface GeminiWebApiAccountSummary {
  totalAccounts: number;
  activeAccounts: number;
  refreshSuccessCount: number;
  refreshFailCount: number;
  refreshRunningCount: number;
  cookieReadyCount: number;
}

export interface GeminiWebApiOpsSnapshot {
  summary: GeminiWebApiAccountSummary;
  accounts: GeminiWebApiAccountStatus[];
}

export interface GeminiWebApiLogEntry {
  seq: number;
  timestamp: number;
  level: GeminiWebApiLogLevel;
  type: GeminiWebApiLogType;
  message: string;
  accountConfigId?: string;
  accountName?: string;
  sourceBrowser?: 'chrome' | 'edge';
  errorCode?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
