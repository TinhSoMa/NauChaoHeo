export type GeminiCookieSource = 'sqlite' | 'app_settings' | 'browser_refresh' | 'none';

export type GeminiBrowserType = 'chrome' | 'edge';

export type GeminiErrorCode =
  | 'PYTHON_RUNTIME_MISSING'
  | 'PYTHON_MODULE_MISSING'
  | 'COOKIE_NOT_FOUND'
  | 'COOKIE_INVALID'
  | 'GEMINI_REQUEST_FAILED'
  | 'GEMINI_TIMEOUT';

export type GeminiConversationMetadata = Record<string, unknown>;

export interface GeminiGenerateRequest {
  prompt: string;
  proxy?: string | null;
  timeoutMs?: number;
  forceCookieRefresh?: boolean;
  browserPriority?: GeminiBrowserType[];
  accountConfigId?: string;
  conversationMetadata?: GeminiConversationMetadata | null;
  conversationKey?: string;
  resetConversation?: boolean;
  temporary?: boolean;
  useChatSession?: boolean;
}

export interface GeminiGenerateResult {
  success: boolean;
  text?: string;
  errorCode?: GeminiErrorCode;
  error?: string;
  cookieSource: GeminiCookieSource;
  refreshed: boolean;
  conversationKey?: string;
  conversationMetadata?: GeminiConversationMetadata | null;
  conversationContinued?: boolean;
}

export interface GeminiWebApiHealth {
  pythonOk: boolean;
  modulesOk: boolean;
  cookieReady: boolean;
  details: {
    runtimeMode?: 'embedded' | 'system';
    pythonPath?: string;
    pythonVersion?: string;
    modules?: Record<string, boolean>;
    error?: string;
  };
}

export interface GeminiCookieStatus {
  hasStoredCookie: boolean;
  hasSecure1PSID: boolean;
  hasSecure1PSIDTS: boolean;
  source: GeminiCookieSource;
}

export interface GeminiCookieRefreshResult {
  success: boolean;
  cookieSource: GeminiCookieSource;
  sourceBrowser?: GeminiBrowserType;
  updatedPrimary: boolean;
  updatedFallback: boolean;
  warnings: string[];
  errorCode?: GeminiErrorCode;
  error?: string;
}

export interface ParsedGeminiCookieTokens {
  secure1psid?: string;
  secure1psidts?: string;
}

export interface ResolvedStoredCookie {
  cookie: string | null;
  secure1psid: string | null;
  secure1psidts: string | null;
  source: GeminiCookieSource;
}
