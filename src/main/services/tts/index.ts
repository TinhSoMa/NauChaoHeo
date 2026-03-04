/**
 * TTS Services - Export tất cả services liên quan đến TTS
 */

// TTS Service
export {
  generateSingleAudio,
  generateBatchAudio,
  generateBatchAudioEdge,
  generateBatchAudioCapCut,
  getAvailableVoices,
  normalizeVoiceSelection,
  resolveVoiceSelection,
  getSafeFilename,
  getAudioDuration,
} from './ttsService';

// Audio Merger
export {
  analyzeAudioFiles,
  mergeAudioFiles,
  smartMerge,
  trimSilence,
  trimSilenceEnd,
  fitAudioToDuration,
} from './audioMerger';
