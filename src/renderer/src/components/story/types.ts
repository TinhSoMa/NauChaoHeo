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

export interface ProcessingChapterInfo {
  startTime: number;
  workerId: number;
  channel: 'api' | 'token';
  retryCount?: number;
  maxRetries?: number;
}

export type StoryStatus = 'idle' | 'running' | 'paused' | 'error' | 'stopped';
