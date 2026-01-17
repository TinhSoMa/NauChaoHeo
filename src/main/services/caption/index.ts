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
  parseTranslationResponse,
  type TextBatch,
} from './textSplitter';

// Caption Translator
export {
  translateAll,
  translateSingleText,
} from './captionTranslator';

