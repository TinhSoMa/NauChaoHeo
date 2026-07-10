/**
 * TTS Services - Export tất cả services liên quan đến TTS
 */

// TTS Service
export {
  generateSingleAudio,
  testVoiceSample,
  generateBatchAudio,
  generateBatchAudioEdge,
  generateBatchAudioCapCut,
  stopActiveTts,
  resetTtsStopRequest,
  isTtsStopRequested,
  throwIfTtsStopped,
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
  stopActiveAudioMerger,
  trimSilence,
  trimSilenceEnd,
  trimSilenceToPath,
  trimSilenceEndToPath,
  fitAudioToDuration,
} from './audioMerger';
