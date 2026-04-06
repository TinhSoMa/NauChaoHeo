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
  provider?: 'edge' | 'capcut';
  tier?: 'free' | 'pro';
}

export const VOICES: VoiceOption[] = [
  { value: 'edge:vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ)', provider: 'edge', tier: 'free' },
  { value: 'edge:vi-VN-NamMinhNeural', label: 'Nam Minh (Nam)', provider: 'edge', tier: 'free' },
];

export const DEFAULT_VOICE = VOICES[0].value;

export function normalizeVoiceValue(value?: string | null): string {
  if (typeof value !== 'string') {
    return DEFAULT_VOICE;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_VOICE;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('edge:')) {
    const voiceId = trimmed.slice(5).trim();
    return voiceId ? `edge:${voiceId}` : DEFAULT_VOICE;
  }
  if (lower.startsWith('capcut:')) {
    const voiceId = trimmed.slice(7).trim();
    return voiceId ? `capcut:${voiceId}` : DEFAULT_VOICE;
  }

  return `edge:${trimmed}`;
}

// ============================================
// TTS OPTIONS
// ============================================

export const RATE_OPTIONS = ['+0%', '+10%', '+20%', '+30%', '+40%', '+50%'];
export const VOLUME_OPTIONS = ['+0%', '+10%', '+20%', '+30%'];
export const EDGE_OUTPUT_FORMAT_OPTIONS = ['wav', 'mp3'] as const;
export type EdgeOutputFormat = typeof EDGE_OUTPUT_FORMAT_OPTIONS[number];
export const EDGE_WORKER_ENGINE_OPTIONS = ['python', 'go'] as const;
export type EdgeWorkerEngine = typeof EDGE_WORKER_ENGINE_OPTIONS[number];

export const DEFAULT_RATE = '+30%';
export const DEFAULT_VOLUME = '+30%';
export const DEFAULT_SRT_SPEED = 1.0;
export const DEFAULT_EDGE_TTS_BATCH_SIZE = 250;
export const DEFAULT_EDGE_OUTPUT_FORMAT: EdgeOutputFormat = 'wav';
export const DEFAULT_EDGE_WORKER_ENGINE: EdgeWorkerEngine = 'python';
export const DEFAULT_EDGE_WORKER_ITEM_CONCURRENCY = 10;
export const MIN_EDGE_WORKER_ITEM_CONCURRENCY = 1;
export const MAX_EDGE_WORKER_ITEM_CONCURRENCY = 200;
export const DEFAULT_FIT_AUDIO_WORKERS = 5;
export const MIN_FIT_AUDIO_WORKERS = 1;
export const MAX_FIT_AUDIO_WORKERS = 16;

export function normalizeEdgeOutputFormat(value?: string | null): EdgeOutputFormat {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'mp3') {
    return 'mp3';
  }
  return 'wav';
}

export function normalizeEdgeWorkerEngine(value?: string | null): EdgeWorkerEngine {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'go' ? 'go' : 'python';
}

export function normalizeEdgeWorkerItemConcurrency(value?: number | null): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_EDGE_WORKER_ITEM_CONCURRENCY;
  }
  const rounded = Math.round(numeric);
  if (rounded < MIN_EDGE_WORKER_ITEM_CONCURRENCY) {
    return DEFAULT_EDGE_WORKER_ITEM_CONCURRENCY;
  }
  return Math.min(MAX_EDGE_WORKER_ITEM_CONCURRENCY, rounded);
}

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

export const STEP_LABELS = ['Input', 'Split', 'Dịch', 'TTS', 'Merge', 'Render Video'];

export type InputType = 'srt' | 'draft';
export const DEFAULT_INPUT_TYPE: InputType = 'draft';

