import { ResourceRegistry } from './resourceRegistry';
import { SchedulerCore } from './schedulerCore';
import {
  ClearEventHistoryOptions,
  DispatchEvent,
  JobRequest,
  JobResult,
  PoolDefinition,
  QueueEventRecord,
  QueueInspectorSnapshot,
  QueueInspectorViewOptions,
  ResourceDefinition,
  SchedulerSnapshot,
  ServicePolicy,
  ShutdownOptions,
  UniversalRotationQueueServiceOptions,
  Unsubscribe
} from './rotationTypes';

type DispatchListener = (event: DispatchEvent, snapshot: SchedulerSnapshot) => void;
type DispatchRecordListener = (record: QueueEventRecord, snapshot: SchedulerSnapshot) => void;

const DEFAULT_OPTIONS = {
  globalMaxConcurrentJobs: 20,
  maxConcurrentPerFeature: 5,
  defaultJobTimeoutMs: 120_000,
  defaultMaxAttempts: 3,
  defaultCooldownMinMs: 10_000,
  defaultCooldownMaxMs: 20_000,
  antiStarvationStepMs: 15_000,
  inspectorHistoryCapacity: 1_000
};

export class UniversalRotationQueueService {
  private readonly scheduler: SchedulerCore;

  constructor(options: UniversalRotationQueueServiceOptions = {}) {
    const normalized = {
      globalMaxConcurrentJobs:
        options.globalMaxConcurrentJobs ?? DEFAULT_OPTIONS.globalMaxConcurrentJobs,
      maxConcurrentPerFeature:
        options.maxConcurrentPerFeature ?? DEFAULT_OPTIONS.maxConcurrentPerFeature,
      defaultJobTimeoutMs: options.defaultJobTimeoutMs ?? DEFAULT_OPTIONS.defaultJobTimeoutMs,
      defaultMaxAttempts: options.defaultMaxAttempts ?? DEFAULT_OPTIONS.defaultMaxAttempts,
      defaultCooldownMinMs: options.defaultCooldownMinMs ?? DEFAULT_OPTIONS.defaultCooldownMinMs,
      defaultCooldownMaxMs: options.defaultCooldownMaxMs ?? DEFAULT_OPTIONS.defaultCooldownMaxMs,
      antiStarvationStepMs: options.antiStarvationStepMs ?? DEFAULT_OPTIONS.antiStarvationStepMs,
      enableServiceAllocator: options.enableServiceAllocator ?? false,
      enableRotationQueueInspector: options.enableRotationQueueInspector ?? false,
      inspectorHistoryCapacity:
        options.inspectorHistoryCapacity ?? DEFAULT_OPTIONS.inspectorHistoryCapacity,
      allowInspectorPayloadRaw: options.allowInspectorPayloadRaw ?? false
    };

    const registry = new ResourceRegistry({
      defaultCooldownMinMs: normalized.defaultCooldownMinMs,
      defaultCooldownMaxMs: normalized.defaultCooldownMaxMs,
      defaultMaxConcurrencyPerResource: 1
    });

    this.scheduler = new SchedulerCore(registry, {
      globalMaxConcurrentJobs: normalized.globalMaxConcurrentJobs,
      maxConcurrentPerFeature: normalized.maxConcurrentPerFeature,
      defaultJobTimeoutMs: normalized.defaultJobTimeoutMs,
      defaultMaxAttempts: normalized.defaultMaxAttempts,
      antiStarvationStepMs: normalized.antiStarvationStepMs,
      enableServiceAllocator: normalized.enableServiceAllocator,
      enableRotationQueueInspector: normalized.enableRotationQueueInspector,
      inspectorHistoryCapacity: normalized.inspectorHistoryCapacity,
      allowInspectorPayloadRaw: normalized.allowInspectorPayloadRaw
    });
  }

  registerPool(poolDef: PoolDefinition): void {
    this.scheduler.registerPool(poolDef);
  }

  upsertResource(resourceDef: ResourceDefinition): void {
    this.scheduler.upsertResource(resourceDef);
  }

  removeResource(poolId: string, resourceId: string): boolean {
    return this.scheduler.removeResource(poolId, resourceId);
  }

  enqueue<TPayload = unknown, TResult = unknown>(
    jobRequest: JobRequest<TPayload, TResult>
  ): Promise<JobResult<TResult>> {
    return this.scheduler.enqueue(jobRequest);
  }

  cancel(jobId: string): boolean {
    return this.scheduler.cancel(jobId);
  }

  setResourceCooldown(poolId: string, resourceId: string, untilMs: number): void {
    this.scheduler.setResourceCooldown(poolId, resourceId, untilMs);
  }

  setResourceEnabled(poolId: string, resourceId: string, enabled: boolean): void {
    this.scheduler.setResourceEnabled(poolId, resourceId, enabled);
  }

  markResourceFailure(
    poolId: string,
    resourceId: string,
    reason: string,
    retryAfterMs?: number
  ): void {
    this.scheduler.markResourceFailure(poolId, resourceId, reason, retryAfterMs);
  }

  upsertServicePolicy(policy: ServicePolicy): void {
    this.scheduler.upsertServicePolicy(policy);
  }

  removeServicePolicy(poolId: string, serviceId: string): boolean {
    return this.scheduler.removeServicePolicy(poolId, serviceId);
  }

  rebalance(poolId?: string): void {
    this.scheduler.rebalance(poolId);
  }

  setServiceActive(poolId: string, serviceId: string, active: boolean): void {
    this.scheduler.setServiceActive(poolId, serviceId, active);
  }

  getSnapshot(): SchedulerSnapshot {
    return this.scheduler.getSnapshot();
  }

  getInspectorSnapshot(options?: QueueInspectorViewOptions): QueueInspectorSnapshot {
    return this.scheduler.getInspectorSnapshot(options);
  }

  getEventHistory(limit?: number): QueueEventRecord[] {
    return this.scheduler.getEventHistory(limit);
  }

  clearEventHistory(options: ClearEventHistoryOptions = {}): void {
    this.scheduler.clearEventHistory(options);
  }

  subscribe(listener: DispatchListener): Unsubscribe {
    return this.scheduler.subscribe(listener);
  }

  subscribeEventRecords(listener: DispatchRecordListener): Unsubscribe {
    return this.scheduler.subscribeEventRecords(listener);
  }

  shutdown(options?: ShutdownOptions): Promise<void> {
    return this.scheduler.shutdown(options);
  }
}
