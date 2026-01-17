/**
 * TTS Services - Export tất cả services liên quan đến TTS
 */

// TTS Service
export {
  generateSingleAudio,
  generateBatchAudio,
  getSafeFilename,
  getAudioDuration,
} from './ttsService';

// Audio Merger
export {
  analyzeAudioFiles,
  mergeAudioFiles,
  smartMerge,
  trimSilence,
} from './audioMerger';
