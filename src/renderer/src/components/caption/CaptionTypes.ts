
export interface SubtitleEntry {
  index: number;
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  text: string;
  translatedText?: string;
}

export interface TranslationProgress {
  current: number;
  total: number;
  message: string;
}

export interface TTSProgress {
  current: number;
  total: number;
  message: string;
}

export type Step = 1 | 2 | 3 | 4 | 5 | 6;
export type ProcessStatus = 'idle' | 'running' | 'success' | 'error';
