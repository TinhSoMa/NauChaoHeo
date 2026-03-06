
export interface Chapter {
  id: string;
  title: string;
  content: string;
}

export interface ParseStoryResult {
  success: boolean;
  chapters?: Chapter[];
  error?: string;
}

export interface PreparePromptResult {
  success: boolean;
  prompt?: any;
  error?: string;
}

export interface StoryTranslateGeminiWebQueuePayload {
  prompt: any;
  model?: string;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  conversationKey?: string;
  resetConversation?: boolean;
}

export interface StoryTranslateGeminiWebQueueMetadata extends Record<string, unknown> {
  queuePacingMode?: 'after_finish_per_resource';
  queueGapMs?: number;
  startedAt?: number;
  endedAt?: number;
  nextAllowedAt?: number;
}

export interface StoryTranslateGeminiWebQueueResult {
  success: boolean;
  data?: string;
  error?: string;
  resourceId?: string;
  queueRuntimeKey: string;
  errorCode?: string;
  metadata?: StoryTranslateGeminiWebQueueMetadata;
}

export const STORY_IPC_CHANNELS = {
  PARSE: 'story:parse',
  PREPARE_PROMPT: 'story:preparePrompt',
  PREPARE_SUMMARY_PROMPT: 'story:prepareSummaryPrompt',
  SAVE_PROMPT: 'story:savePrompt',
  TRANSLATE_CHAPTER: 'story:translateChapter',
  TRANSLATE_CHAPTER_GEMINI_WEB_QUEUE: 'story:translateChapterGeminiWebQueue',
  IS_GEMINI_WEB_QUEUE_ENABLED: 'story:isGeminiWebQueueEnabled',
  TRANSLATE_CHAPTER_RESULT: 'story:translate-chapter-result',
  TRANSLATION_PROGRESS: 'story:translation-progress',
  TRANSLATE_CHAPTER_STREAM_REPLY: 'story:translateChapterStreamReply',
  CREATE_EBOOK: 'story:createEbook'
} as const;
