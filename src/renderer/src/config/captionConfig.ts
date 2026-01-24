/**
 * Caption Config - Cấu hình mặc định cho chức năng dịch caption
 * File này chứa tất cả constants và default values dùng chung
 */

// ============================================
// GEMINI MODELS - Import từ file tập trung
// ============================================

import { 
  GEMINI_MODEL_LIST, 
  DEFAULT_GEMINI_MODEL as SHARED_DEFAULT_MODEL,
  type GeminiModelInfo 
} from '../../../shared/types/gemini';

// Re-export để sử dụng trong UI components
export { GEMINI_MODEL_LIST, type GeminiModelInfo };

// Alias cho compatibility
export const GEMINI_MODELS = GEMINI_MODEL_LIST.map(m => ({ value: m.id, label: m.label }));
export const DEFAULT_GEMINI_MODEL = SHARED_DEFAULT_MODEL;

// ============================================
// TTS VOICES
// ============================================

export interface VoiceOption {
  value: string;
  label: string;
}

export const VOICES: VoiceOption[] = [
  { value: 'vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ)' },
  { value: 'vi-VN-NamMinhNeural', label: 'Nam Minh (Nam)' },
];

export const DEFAULT_VOICE = VOICES[0].value;

// ============================================
// TTS OPTIONS
// ============================================

export const RATE_OPTIONS = ['+0%', '+10%', '+20%', '+30%', '+40%', '+50%'];
export const VOLUME_OPTIONS = ['+0%', '+10%', '+20%', '+30%'];

export const DEFAULT_RATE = '+30%';
export const DEFAULT_VOLUME = '+30%';
export const DEFAULT_SRT_SPEED = 1.0;

// ============================================
// SPLIT OPTIONS
// ============================================

export const LINES_PER_FILE_OPTIONS = [50, 100, 200, 500];
export const DEFAULT_LINES_PER_FILE = 100;
export const DEFAULT_NUMBER_OF_PARTS = 5;
export const DEFAULT_SPLIT_BY_LINES = true;

// ============================================
// TRANSLATION OPTIONS
// ============================================

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_TARGET_LANGUAGE = 'Vietnamese';

// ============================================
// STEP LABELS
// ============================================

export const STEP_LABELS = ['Input', 'Split', 'Dịch', 'TTS', 'Trim', 'Merge'];

export const DEFAULT_INPUT_TYPE: 'srt' | 'draft' = 'draft';

