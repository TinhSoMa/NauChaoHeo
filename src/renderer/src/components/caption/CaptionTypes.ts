
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

export interface ThumbnailFolderItem {
  index: number;
  folderPath: string;
  folderName: string;
  videoName: string;
  text: string;
  hasError: boolean;
}

export interface HardsubTimingMetrics {
  isMultiFolder: boolean;
  isEstimated: boolean;
  displayPath: string;
  videoName?: string;
  baseAudioDuration: number;
  audioExpectedDuration: number;
  videoSubBaseDuration: number;
  videoMarkerSec: number;
  autoVideoSpeed: number;
  formatDuration: (seconds: number) => string;
}

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type ProcessStatus = 'idle' | 'running' | 'success' | 'error';
export type ProcessingMode = 'folder-first' | 'step-first';

export interface StepGuardState {
  step: Step;
  runnable: boolean;
  reason?: string;
}

export interface StepDependencyIssue {
  step: Step;
  folderPath: string;
  folderName: string;
  code: string;
  reason: string;
  missingDeps: Step[];
}

export type StepBadgeStatus = 'off' | 'idle' | 'running' | 'done' | 'error' | 'stale' | 'skipped';

export type CaptionStepPanelKey = 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'b6' | 'b7' | 'run';

export interface StepPanelState {
  expanded: boolean;
  advanced: boolean;
}

export interface PreviewDockState {
  pinned: boolean;
  compact: boolean;
  disabledReason?: string;
}
