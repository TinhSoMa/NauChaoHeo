export type JobPriority = 'high' | 'normal' | 'low';

export type JobState =
  | 'queued'
  | 'retry_wait'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TerminalJobState = 'succeeded' | 'failed' | 'cancelled';

export type ResourceState = 'ready' | 'busy' | 'cooldown' | 'disabled' | 'error';

export type PoolSelector = 'round_robin' | 'weighted_round_robin';

export type Unsubscribe = () => void;

export type RotationJobErrorCode =
  | 'CANCELLED_BY_USER'
  | 'CANCELLED_BY_SHUTDOWN'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'RESOURCE_UNAVAILABLE'
  | 'EXECUTION_ERROR';

export interface PoolDefinition {
  poolId: string;
  label?: string;
  selector?: PoolSelector;
  dispatchSpacingMs?: number;
  defaultCooldownMinMs?: number;
  defaultCooldownMaxMs?: number;
  defaultMaxConcurrencyPerResource?: number;
  metadata?: Record<string, unknown>;
}

export interface ResourceDefinition {
  poolId: string;
  resourceId: string;
  label?: string;
  capabilities?: string[];
  enabled?: boolean;
  weight?: number;
  maxConcurrency?: number;
  cooldownMinMs?: number;
  cooldownMaxMs?: number;
  metadata?: Record<string, unknown>;
}

export interface SelectedResourceInfo {
  poolId: string;
  resourceId: string;
  label: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface JobExecutionContext<TPayload = unknown> {
  jobId: string;
  poolId: string;
  feature: string;
  jobType: string;
  priority: JobPriority;
  payload: TPayload;
  attempt: number;
  maxAttempts: number;
  queuedAt: number;
  startedAt: number;
  signal: AbortSignal;
  resource: SelectedResourceInfo;
  metadata?: Record<string, unknown>;
}

export interface JobRequest<TPayload = unknown, TResult = unknown> {
  poolId: string;
  feature: string;
  serviceId?: string;
  jobType: string;
  payload: TPayload;
  execute: (ctx: JobExecutionContext<TPayload>) => Promise<TResult>;
  priority?: JobPriority;
  requiredCapabilities?: string[];
  preferredResourceId?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface QueuedJobRecord<TPayload = unknown, TResult = unknown> {
  jobId: string;
  request: JobRequest<TPayload, TResult>;
  state: Extract<JobState, 'queued' | 'retry_wait'>;
  attemptsMade: number;
  queuedAt: number;
  availableAt: number;
  sequence: number;
  lastError?: string;
}

export interface ResourceLease {
  poolId: string;
  resourceId: string;
  selectedAt: number;
  info: SelectedResourceInfo;
}

export interface JobResult<TResult = unknown> {
  success: boolean;
  state: TerminalJobState;
  jobId: string;
  poolId: string;
  feature: string;
  jobType: string;
  attempts: number;
  queuedAt: number;
  startedAt?: number;
  endedAt: number;
  resourceId?: string;
  result?: TResult;
  error?: string;
  errorCode?: RotationJobErrorCode;
}

export type DispatchEventType =
  | 'job_queued'
  | 'job_started'
  | 'job_retry_scheduled'
  | 'job_succeeded'
  | 'job_failed'
  | 'job_cancelled'
  | 'resource_selected'
  | 'resource_cooldown_set'
  | 'resource_state_changed'
  | 'service_active'
  | 'service_idle'
  | 'service_inactive'
  | 'resource_assignment_changed'
  | 'service_quota_rebalanced';

export interface DispatchEvent {
  type: DispatchEventType;
  timestamp: number;
  poolId?: string;
  serviceId?: string;
  jobId?: string;
  feature?: string;
  jobType?: string;
  resourceId?: string;
  attempt?: number;
  maxAttempts?: number;
  retryAt?: number;
  cooldownUntil?: number;
  oldQuota?: number;
  newQuota?: number;
  oldServiceId?: string | null;
  newServiceId?: string | null;
  error?: string;
  errorCode?: RotationJobErrorCode;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ResourceStateCounts {
  ready: number;
  busy: number;
  cooldown: number;
  disabled: number;
  error: number;
}

export interface ResourceRuntimeSnapshot {
  poolId: string;
  resourceId: string;
  label: string;
  state: ResourceState;
  enabled: boolean;
  inFlight: number;
  maxConcurrency: number;
  cooldownUntil: number;
  errorUntil: number;
  assignedServiceId: string | null;
  assignmentUpdatedAt: number;
  lastError?: string;
  lastAcquiredAt?: number;
  metadata?: Record<string, unknown>;
}

export type ServiceRuntimeState = 'active' | 'idle' | 'inactive';

export interface ServicePolicy {
  poolId: string;
  serviceId: string;
  weight?: number;
  minReserved?: number;
  maxReserved?: number;
  idleTtlMs?: number;
  requiredCapabilities?: string[];
  preferredCapabilities?: string[];
  capabilityMode?: 'prefer' | 'strict';
}

export interface ServiceRuntimeSnapshot {
  poolId: string;
  serviceId: string;
  queued: number;
  running: number;
  targetQuota: number;
  assignedResources: number;
  lastSeenAt: number;
  state: ServiceRuntimeState;
  policy: {
    weight: number;
    minReserved: number;
    maxReserved?: number;
    idleTtlMs: number;
    requiredCapabilities: string[];
    preferredCapabilities: string[];
    capabilityMode: 'prefer' | 'strict';
  };
}

export interface QueueInspectorViewOptions {
  includePayload?: boolean;
  poolId?: string;
  serviceId?: string;
  feature?: string;
  state?: Extract<JobState, 'queued' | 'retry_wait' | 'running'> | 'all';
  limit?: number;
}

export interface PayloadPreview {
  mode: 'masked' | 'full';
  summary: string;
  raw?: unknown;
}

export interface QueueJobRuntimeSnapshot {
  jobId: string;
  poolId: string;
  serviceId: string;
  feature: string;
  jobType: string;
  state: Extract<JobState, 'queued' | 'retry_wait' | 'running'>;
  priority: JobPriority;
  attempt: number;
  maxAttempts: number;
  queuedAt: number;
  availableAt?: number;
  startedAt?: number;
  assignedResourceId?: string;
  requiredCapabilities?: string[];
  payloadPreview: PayloadPreview;
  lastError?: string;
}

export interface QueueEventRecord {
  seq: number;
  timestamp: number;
  event: DispatchEvent;
}

export interface ClearEventHistoryOptions {
  resetDroppedCounter?: boolean;
}

export interface QueueInspectorSnapshot {
  timestamp: number;
  scheduler: SchedulerSnapshot;
  jobs: QueueJobRuntimeSnapshot[];
  runningByResource: Record<string, Record<string, string | null>>;
  historySize: number;
  droppedHistoryCount: number;
}

export interface SchedulerSnapshot {
  timestamp: number;
  snapshotVersion: number;
  stateVersionAtBuild: number;
  freshness: 'fresh_read' | 'coalesced_emit';
  totalQueued: number;
  totalRunning: number;
  queueDepthByPool: Record<string, number>;
  runningJobsByPool: Record<string, number>;
  resourceStateCountsByPool: Record<string, ResourceStateCounts>;
  oldestQueuedMs: number | null;
  nextWakeAt: number | null;
  resources: ResourceRuntimeSnapshot[];
  serviceStatsByPool: Record<string, ServiceRuntimeSnapshot[]>;
  resourceAssignmentsByPool: Record<string, Record<string, string | null>>;
  dispatchThrottleByPool?: Record<string, DispatchThrottleSnapshot>;
}

export type DispatchThrottleState = 'open' | 'spacing' | 'waiting_resource' | 'rearm_delay';

export interface DispatchThrottleSnapshot {
  spacingMs: number;
  state: DispatchThrottleState;
  nextDispatchAt: number | null;
  waitingSince: number | null;
}

export interface ShutdownOptions {
  force?: boolean;
  reason?: string;
}

export interface RemoveQueueRuntimeOptions {
  shutdown?: boolean;
  force?: boolean;
  reason?: string;
  timeoutMs?: number;
}

export interface UniversalRotationQueueServiceOptions {
  globalMaxConcurrentJobs?: number;
  maxConcurrentPerFeature?: number;
  defaultJobTimeoutMs?: number;
  defaultMaxAttempts?: number;
  defaultCooldownMinMs?: number;
  defaultCooldownMaxMs?: number;
  antiStarvationStepMs?: number;
  enableServiceAllocator?: boolean;
  enableRotationQueueInspector?: boolean;
  inspectorHistoryCapacity?: number;
  allowInspectorPayloadRaw?: boolean;
  defaultDispatchSpacingMs?: number;
  enforceSingleFlightPerResource?: boolean;
  label?: string;
}

export interface RetryAfterErrorLike {
  retryAfterMs?: number;
}
