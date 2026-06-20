import type { Chapter } from './story';

export const AGENT_TRANSLATION_IPC_CHANNELS = {
  DETECT: 'agentTranslation:detect',
  START: 'agentTranslation:start',
  CANCEL: 'agentTranslation:cancel',
  STATUS: 'agentTranslation:status',
  PROGRESS: 'agentTranslation:progress',
} as const;

export interface AgentTranslationDetectResult {
  detected: boolean;
  agentId?: string;
  agentName?: string;
  executablePath?: string;
  version?: string;
  models?: Array<{ id: string; label: string }>;
  error?: string;
}

export interface AgentTranslationStartPayload {
  agentId?: string;
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  memory?: {
    glossary?: string;
    continuity?: string;
  } | null;
  batchSize?: number;
  outputDir?: string;
}

export interface AgentTranslationBatchResult {
  batchNumber: number;
  chapterIds: string[];
  filePath: string;
  timestamp: number;
}

export interface AgentTranslationProgress {
  batchNumber: number;
  totalBatches: number;
  filePath: string;
  status: 'batch_done' | 'processing' | 'error';
  chapterIds?: string[];
  error?: string;
}

export interface AgentTranslationStatus {
  running: boolean;
  currentBatch: number;
  totalBatches: number;
  completedBatches: number;
  outputDir?: string;
  processId?: number;
  error?: string;
}

export interface AgentTranslationStartResult {
  success: boolean;
  outputDir?: string;
  totalBatches: number;
  error?: string;
}
