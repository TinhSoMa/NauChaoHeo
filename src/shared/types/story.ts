
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

export type StoryPreviousAssistantOutputMode = 'full' | 'sampled';

export interface StoryPreparePromptPayload {
  chapterContent: string;
  sourceLang: string;
  targetLang: string;
  model?: string;
  previousAssistantOutput?: string | null;
  previousAssistantOutputMode?: StoryPreviousAssistantOutputMode | null;
  previousAssistantOutputChapterCount?: number | null;
}

export interface StoryPrepareSummaryPromptPayload {
  chapterContent: string;
  sourceLang: string;
  targetLang: string;
  model?: string;
  previousSummaryOutput?: string | null;
  previousTranslatedOutput?: string | null;
  previousAssistantOutputMode?: StoryPreviousAssistantOutputMode | null;
  previousAssistantOutputChapterCount?: number | null;
}

export interface StoryTranslateChapterPayload {
  prompt: any;
  method?: 'API' | 'IMPIT';
  model?: string;
  webConfigId?: string;
  context?: any;
  useProxy?: boolean;
  metadata?: Record<string, unknown>;
  onRetry?: (attempt: number, maxRetries: number) => void;
  streamingEnabled?: boolean;
}

export interface StoryStreamChunk {
  chapterId: string;
  text: string;
  accumulated: string;
  done: boolean;
  serverError?: string;
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
  runId?: string;
  chapterId?: string;
  chapterTitle?: string;
  batchId?: string;
  workerId?: number;
  queuePacingMode?: 'dispatch_spacing_global';
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

export interface StoryGeminiWebQueueCapacity {
  workerCount: number;
  resourceCount: number;
  readyCount: number;
  busyCount: number;
  cooldownCount: number;
}

export type StoryGeminiWebQueueJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface StoryGeminiWebQueueJobView {
  jobId: string;
  chapterId?: string;
  chapterTitle?: string;
  batchId?: string;
  workerId?: number;
  state: StoryGeminiWebQueueJobState;
  queuedAt?: number;
  startedAt?: number;
  endedAt?: number;
  resourceId?: string;
  resourceLabel?: string;
  error?: string;
  errorCode?: string;
}

export interface StoryGeminiWebQueueStreamEvent extends StoryGeminiWebQueueJobView {
  seq?: number;
  timestamp: number;
  eventType:
    | 'job_queued'
    | 'job_started'
    | 'job_retry_scheduled'
    | 'job_succeeded'
    | 'job_failed'
    | 'job_cancelled';
}

export interface StoryGeminiWebQueueSnapshot {
  timestamp: number;
  jobs: StoryGeminiWebQueueJobView[];
}

export interface StoryCancelGeminiWebQueueBatchPayload {
  batchId: string;
}

export interface StoryCancelGeminiWebQueueBatchResult {
  success: boolean;
  cancelledJobIds: string[];
  requestedJobCount: number;
  error?: string;
}

export interface EbookChapterPayload {
  title: string;
  content: string;
}

export interface CreateEbookPayload {
  chapters: EbookChapterPayload[];
  title: string;
  author?: string;
  filename?: string;
  outputDir?: string;
  cover?: string;
  sourceEpubPath?: string;
}

export interface StoryGenerateAudioPayload {
  chapterText: string;
  voice: string;
  outputDir?: string;
  filename?: string;
  sourceFile?: string;
  sourceType?: 'translation' | 'summary';
  rate?: string;
  volume?: string;
  outputFormat?: 'mp3' | 'wav';
}

export interface StoryGenerateAudioResult {
  success: boolean;
  filePath?: string;
  error?: string;
  durationMs?: number;
}

export const STORY_IPC_CHANNELS = {
  PARSE: 'story:parse',
  PREPARE_PROMPT: 'story:preparePrompt',
  PREPARE_SUMMARY_PROMPT: 'story:prepareSummaryPrompt',
  SAVE_PROMPT: 'story:savePrompt',
  TRANSLATE_CHAPTER: 'story:translateChapter',
  TRANSLATE_CHAPTER_GEMINI_WEB_QUEUE: 'story:translateChapterGeminiWebQueue',
  IS_GEMINI_WEB_QUEUE_ENABLED: 'story:isGeminiWebQueueEnabled',
  GET_GEMINI_WEB_QUEUE_CAPACITY: 'story:getGeminiWebQueueCapacity',
  GET_GEMINI_WEB_QUEUE_SNAPSHOT: 'story:getGeminiWebQueueSnapshot',
  START_GEMINI_WEB_QUEUE_STREAM: 'story:startGeminiWebQueueStream',
  STOP_GEMINI_WEB_QUEUE_STREAM: 'story:stopGeminiWebQueueStream',
  CANCEL_GEMINI_WEB_QUEUE_BATCH: 'story:cancelGeminiWebQueueBatch',
  GEMINI_WEB_QUEUE_STREAM_EVENT: 'story:geminiWebQueueStream:event',
  GEMINI_WEB_QUEUE_STREAM_SNAPSHOT: 'story:geminiWebQueueStream:snapshot',
  TRANSLATE_CHAPTER_RESULT: 'story:translate-chapter-result',
  TRANSLATION_PROGRESS: 'story:translation-progress',
  TRANSLATE_CHAPTER_STREAM_REPLY: 'story:translateChapterStreamReply',
  STOP_STORY_TRANSLATION: 'story:stopStoryTranslation',
  CREATE_EBOOK: 'story:createEbook',
  GENERATE_CHAPTER_AUDIO: 'story:generateChapterAudio'
} as const;
