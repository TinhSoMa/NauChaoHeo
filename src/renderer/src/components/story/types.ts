import type { Chapter } from '@shared/types';

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
  phase?: 'queued' | 'running';
  queuedAt?: number;
  resourceId?: string | null;
  resourceLabel?: string | null;
}

export type StoryStatus = 'idle' | 'running' | 'paused' | 'error' | 'stopped';

export interface StoryMemoryRuntimeState {
  enabled: boolean;
  topK: number;
  namespace?: string;
  status?: 'ready' | 'missing_runtime' | 'missing_provider' | 'error';
}

export interface StoryPromptSaveSettings {
  autoSaveSentPrompt: boolean;
}

export function buildStoryMemoryPayload(args: {
  projectId: string | null;
  filePath: string;
  chapter: Chapter;
  chapterIndex: number;
  totalChapters: number;
  settings: StoryMemoryRuntimeState;
}) {
  const { projectId, filePath, chapter, chapterIndex, totalChapters, settings } = args;
  return {
    projectId,
    storyFilePath: filePath,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    chapterIndex,
    totalChapters,
    settings: {
      enabled: settings.enabled,
      topK: settings.topK,
      namespace: settings.namespace,
      status: settings.status
    }
  };
}
