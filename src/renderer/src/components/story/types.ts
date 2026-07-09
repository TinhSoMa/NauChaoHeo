export type StoryPreviousAssistantOutputMode = 'full' | 'sampled';

export interface GeminiChatConfigLite {
  id: string;
  cookie: string;
  atToken: string;
  isActive: boolean;
  isError?: boolean;
  email?: string;
}

export type TokenContext = { 
  conversationId: string; 
  responseId: string; 
  choiceId: string;
};

export type StoryTranslationMethod =
  | 'api'
  | 'token'
  | 'gemini_webapi_queue'
  | 'api_gemini_webapi_queue';

export type StoryChapterMethod = 'api' | 'token' | 'gemini_webapi_queue';

export type StoryReadingTheme = 'light' | 'sepia' | 'dark' | 'warm';

export interface StoryReadingThemePalette {
  panelBackground: string;
  contentBackground: string;
  textPrimary: string;
  textSecondary: string;
  borderColor: string;
  controlBackground: string;
  controlText: string;
  controlBorder: string;
}

export interface ProcessingChapterInfo {
  startTime: number;
  workerId: number;
  channel: 'api' | 'token';
  source?: 'story_web_queue';
  retryCount?: number;
  maxRetries?: number;
  lastError?: string;
  phase?: 'queued' | 'running' | 'retry_wait';
  queuedAt?: number;
  resourceId?: string | null;
  resourceLabel?: string | null;
}

export type StoryStatus = 'idle' | 'running' | 'paused' | 'error' | 'stopped';
export type OperationType = 'idle' | 'translating' | 'summarizing';

export interface StoryPromptSaveSettings {
  autoSaveSentPrompt: boolean;
  previousAssistantOutputMode: StoryPreviousAssistantOutputMode;
  previousAssistantOutputChapterCount: number;
  contextChapterIds?: string[] | null;
}


