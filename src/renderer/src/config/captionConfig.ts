/**
 * Caption Config - Cấu hình mặc định cho chức năng dịch caption
 * File này chứa tất cả constants và default values dùng chung
 */

// ============================================
// GEMINI MODELS
// ============================================

export interface GeminiModelOption {
  value: string;
  label: string;
}

export const GEMINI_MODELS: GeminiModelOption[] = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Nhanh)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Chất lượng)' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Dự phòng)' },
];

export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0].value;

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

