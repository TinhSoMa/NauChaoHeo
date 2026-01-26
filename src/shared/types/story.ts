
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

export const STORY_IPC_CHANNELS = {
  PARSE: 'story:parse',
  PREPARE_PROMPT: 'story:preparePrompt',
  SAVE_PROMPT: 'story:savePrompt',
  TRANSLATE_CHAPTER: 'story:translateChapter',
  TRANSLATE_CHAPTER_STREAM: 'story:translateChapterStream',
  TRANSLATE_CHAPTER_STREAM_REPLY: 'story:translateChapterStreamReply',
  CREATE_EBOOK: 'story:createEbook'
} as const;
