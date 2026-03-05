export const ROTATION_QUEUE_IPC_CHANNELS = {
  GET_STATUS: 'rotationQueue:getStatus',
  LIST_RUNTIMES: 'rotationQueue:listRuntimes',
  GET_SNAPSHOT: 'rotationQueue:getSnapshot',
  GET_HISTORY: 'rotationQueue:getHistory',
  CLEAR_HISTORY: 'rotationQueue:clearHistory',
  START_STREAM: 'rotationQueue:startStream',
  STOP_STREAM: 'rotationQueue:stopStream',
  STREAM_EVENT: 'rotationQueue:stream:event',
  STREAM_SNAPSHOT: 'rotationQueue:stream:snapshot'
} as const;

export type RotationQueueJobState = 'queued' | 'retry_wait' | 'running';

export interface RotationQueueViewOptions {
  includePayload?: boolean;
  poolId?: string;
  serviceId?: string;
  feature?: string;
  state?: RotationQueueJobState | 'all';
  limit?: number;
}

export interface RotationQueueRuntimeInfo {
  key: string;
  jobCounts?: {
    queued: number;
    running: number;
  };
}

export interface RotationQueueInspectorStatus {
  enabled: boolean;
  reason?: string;
  snapshotThrottleMs: number;
  historyCapacity: number;
  payloadDebugEnabled?: boolean;
}

export interface RotationQueueSnapshotRequest {
  runtimeKey?: string;
  viewOptions?: RotationQueueViewOptions;
}

export interface RotationQueueHistoryRequest {
  runtimeKey?: string;
  limit?: number;
}

export interface RotationQueueClearHistoryRequest {
  runtimeKey?: string;
  resetDroppedCounter?: boolean;
}

export interface RotationQueueStreamRequest {
  runtimeKey?: string;
  viewOptions?: RotationQueueViewOptions;
}

export interface RotationQueueDispatchEvent {
  type: string;
  timestamp: number;
  poolId?: string;
  serviceId?: string;
  jobId?: string;
  feature?: string;
  jobType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RotationQueueEventRecord {
  seq: number;
  timestamp: number;
  event: RotationQueueDispatchEvent;
}

export interface RotationQueueInspectorSnapshot {
  timestamp: number;
  scheduler: Record<string, unknown>;
  jobs: Array<Record<string, unknown>>;
  runningByResource: Record<string, Record<string, string | null>>;
  historySize: number;
  droppedHistoryCount: number;
}
