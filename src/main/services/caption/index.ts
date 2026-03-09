/**
 * Caption Services - Export tất cả services liên quan đến caption
 */

// SRT Parser
export {
  parseSrtFile,
  exportToSrt,
  extractTextLines,
  srtTimeToMs,
  msToSrtTime,
} from './srtParser';

// Draft Parser (CapCut draft_content.json)
export {
  parseDraftJson,
  exportDraftToSrt,
} from './draftParser';

// Text Splitter
export {
  splitForTranslation,
  mergeTranslatedTexts,
  createTranslationPrompt,
  parseJsonTranslationResponse,
  parseTranslationResponse,
  splitText,
  type TextBatch,
} from './textSplitter';

// Caption Translator
export {
  translateAll,
  translateSingleText,
} from './captionTranslator';

export {
  CAPTION_GEMINI_WEB_QUEUE_RUNTIME_KEY,
  CAPTION_GEMINI_WEB_QUEUE_POOL_ID,
  CAPTION_GEMINI_WEB_QUEUE_FEATURE,
  CAPTION_GEMINI_WEB_QUEUE_SERVICE_ID,
  ensureCaptionGeminiWebQueueRuntime,
} from './captionGeminiWebQueueRuntime';

export {
  getConversation as getCaptionGeminiConversation,
  upsertConversation as upsertCaptionGeminiConversation,
  clearConversation as clearCaptionGeminiConversation,
} from './captionGeminiConversationStore';

// ASS Converter (SRT -> ASS)
export {
  srtTimeToAss,
  hexToAssColor,
  convertSrtToAss,
  getAssDuration,
  DEFAULT_ASS_STYLE,
} from './assConverter';

// Video Renderer (SRT -> Video)
export {
  getVideoMetadata,
  extractVideoFrame,
  renderVideo,
  renderVideoPreviewFrame,
  stopActiveVideoPreviewFrame,
  stopActiveRender,
  renderStep7AudioPreview,
  stopActiveAudioPreview,
  renderThumbnailPreviewFrame,
  findBestVideoInFolders,
} from './videoRenderer';
