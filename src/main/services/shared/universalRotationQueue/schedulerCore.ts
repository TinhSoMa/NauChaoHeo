import {
  CancelledJobError,
  InvalidJobRequestError,
  QueueShuttingDownError,
  RotationJobExecutionError
} from './rotationErrors';
import { DispatchOrderResult, PriorityJobQueue } from './priorityJobQueue';
import { QueueInspector, QueueInspectorRunningJob } from './queueInspector';
import { ResourceRegistry, ResourceRuntime } from './resourceRegistry';
import { ServiceAllocator } from './serviceAllocator';
import {
  ClearEventHistoryOptions,
  DispatchEvent,
  JobExecutionContext,
  QueueEventRecord,
  QueueInspectorSnapshot,
  QueueInspectorViewOptions,
  JobRequest,
  JobResult,
  QueuedJobRecord,
  RotationJobErrorCode,
  SchedulerSnapshot,
  ServicePolicy,
  ShutdownOptions,
  Unsubscribe
} from './rotationTypes';

interface SchedulerCoreOptions {
  globalMaxConcurrentJobs: number;
  maxConcurrentPerFeature: number;
  defaultJobTimeoutMs: number;
  defaultMaxAttempts: number;
  antiStarvationStepMs: number;
  enableServiceAllocator: boolean;
  enableRotationQueueInspector: boolean;
  inspectorHistoryCapacity: number;
  allowInspectorPayloadRaw: boolean;
}

interface DeferredJobResult {
  resolve: (result: JobResult<unknown>) => void;
}

interface RunningJob {
  jobId: string;
  poolId: string;
  serviceId: string;
  feature: string;
  jobType: string;
  priority: 'high' | 'normal' | 'low';
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  queuedAt: number;
  startedAt: number;
  resourceId: string;
  request: JobRequest<unknown, unknown>;
  abortController: AbortController;
  cancelRequested: boolean;
  completion: Promise<void>;
}

type DispatchListener = (event: DispatchEvent, snapshot: SchedulerSnapshot) => void;
type DispatchRecordListener = (record: QueueEventRecord, snapshot: SchedulerSnapshot) => void;

interface DispatchCandidate {
  record: QueuedJobRecord<unknown, unknown>;
  resource: ResourceRuntime;
}

export class SchedulerCore {
  private readonly queue = new PriorityJobQueue();
  private readonly runningJobs = new Map<string, RunningJob>();
  private readonly runningCountByFeature = new Map<string, number>();
  private readonly queuedDemandByPoolService = new Map<string, Map<string, number>>();
  private readonly runningDemandByPoolService = new Map<string, Map<string, number>>();
  private readonly queuedCapabilityDemandByPoolService = new Map<
    string,
    Map<string, Map<string, number>>
  >();
  private readonly deferredByJobId = new Map<string, DeferredJobResult>();
  private readonly listeners = new Set<DispatchListener>();
  private readonly recordListeners = new Set<DispatchRecordListener>();
  private readonly registry: ResourceRegistry;
  private readonly serviceAllocator: ServiceAllocator;
  private readonly queueInspector: QueueInspector;
  private readonly options: SchedulerCoreOptions;

  private acceptingJobs = true;
  private shuttingDown = false;
  private dispatchScheduled = false;
  private dispatchRunning = false;
  private nextWakeAtHint: number | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeTimerDueAt: number | null = null;
  private snapshotDirty = true;
  private cachedSnapshot: SchedulerSnapshot | null = null;
  private snapshotUpdatedAt = 0;
  private stateVersion = 0;
  private snapshotVersion = 0;
  private snapshotFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly snapshotTickMs = 500;
  private sequenceCounter = 0;
  private jobCounter = 0;

  constructor(registry: ResourceRegistry, options: SchedulerCoreOptions) {
    this.registry = registry;
    this.serviceAllocator = new ServiceAllocator(registry);
    this.queueInspector = new QueueInspector({
      historyCapacity: options.inspectorHistoryCapacity,
      allowPayloadRaw: options.allowInspectorPayloadRaw
    });
    this.options = options;
  }

  registerPool(poolDef: Parameters<ResourceRegistry['registerPool']>[0]): void {
    this.registry.registerPool(poolDef);
    this.markStateChanged();
    this.runServiceRebalance(poolDef.poolId);
    this.requestDispatch();
  }

  upsertResource(resourceDef: Parameters<ResourceRegistry['upsertResource']>[0]): void {
    this.registry.upsertResource(resourceDef);
    this.markStateChanged();
    this.runServiceRebalance(resourceDef.poolId);

    const nowMs = Date.now();
    const state = this.registry.getResourceState(resourceDef.poolId, resourceDef.resourceId, nowMs);
    this.emit({
      type: 'resource_state_changed',
      timestamp: nowMs,
      poolId: resourceDef.poolId,
      resourceId: resourceDef.resourceId,
      message: 'Resource upserted.',
      metadata: { state }
    });
    this.requestDispatch();
  }

  removeResource(poolId: string, resourceId: string): boolean {
    const removed = this.registry.removeResource(poolId, resourceId);
    if (removed) {
      this.markStateChanged();
      this.runServiceRebalance(poolId);
      this.emit({
        type: 'resource_state_changed',
        timestamp: Date.now(),
        poolId,
        resourceId,
        message: 'Resource removed.'
      });
      this.requestDispatch();
    }
    return removed;
  }

  setResourceCooldown(poolId: string, resourceId: string, untilMs: number): void {
    this.registry.setResourceCooldown(poolId, resourceId, untilMs);
    this.markStateChanged();
    const nowMs = Date.now();
    this.emit({
      type: 'resource_cooldown_set',
      timestamp: nowMs,
      poolId,
      resourceId,
      cooldownUntil: untilMs
    });
    this.emitResourceStateChanged(poolId, resourceId);
    this.requestDispatch(untilMs);
  }

  setResourceEnabled(poolId: string, resourceId: string, enabled: boolean): void {
    this.registry.setResourceEnabled(poolId, resourceId, enabled);
    this.markStateChanged();
    this.runServiceRebalance(poolId);

    this.emit({
      type: 'resource_state_changed',
      timestamp: Date.now(),
      poolId,
      resourceId,
      message: enabled ? 'Resource enabled.' : 'Resource disabled.'
    });
    this.requestDispatch();
  }

  markResourceFailure(
    poolId: string,
    resourceId: string,
    reason: string,
    retryAfterMs?: number
  ): void {
    this.registry.markResourceFailure(poolId, resourceId, reason, retryAfterMs);
    this.markStateChanged();
    this.runServiceRebalance(poolId);

    const nowMs = Date.now();
    if ((retryAfterMs ?? 0) > 0) {
      this.emit({
        type: 'resource_cooldown_set',
        timestamp: nowMs,
        poolId,
        resourceId,
        cooldownUntil: nowMs + (retryAfterMs ?? 0),
        message: 'Resource failure cooldown set.'
      });
    }
    this.emit({
      type: 'resource_state_changed',
      timestamp: nowMs,
      poolId,
      resourceId,
      error: reason,
      message: 'Resource marked as failed.'
    });
    this.requestDispatch();
  }

  upsertServicePolicy(policy: ServicePolicy): void {
    this.serviceAllocator.upsertServicePolicy(policy);
    this.markStateChanged();
    this.runServiceRebalance(policy.poolId);
    this.requestDispatch();
  }

  removeServicePolicy(poolId: string, serviceId: string): boolean {
    const removed = this.serviceAllocator.removeServicePolicy(poolId, serviceId);
    if (removed) {
      this.markStateChanged();
      this.runServiceRebalance(poolId);
      this.requestDispatch();
    }
    return removed;
  }

  setServiceActive(poolId: string, serviceId: string, active: boolean): void {
    this.serviceAllocator.setServiceActive(poolId, serviceId, active);
    this.markStateChanged();
    this.runServiceRebalance(poolId);
    this.requestDispatch();
  }

  rebalance(poolId?: string): void {
    this.markStateChanged();
    this.runServiceRebalance(poolId);
    this.requestDispatch();
  }

  enqueue<TPayload = unknown, TResult = unknown>(
    request: JobRequest<TPayload, TResult>
  ): Promise<JobResult<TResult>> {
    this.validateJobRequest(request);
    if (!this.acceptingJobs || this.shuttingDown) {
      throw new QueueShuttingDownError();
    }
    if (!this.registry.hasPool(request.poolId)) {
      throw new InvalidJobRequestError(`Pool "${request.poolId}" is not registered.`);
    }

    const nowMs = Date.now();
    const serviceId = this.resolveServiceId(request);
    const normalizedPriority = request.priority ?? 'normal';
    const normalizedRequest: JobRequest<unknown, unknown> = {
      poolId: request.poolId,
      feature: request.feature,
      serviceId,
      jobType: request.jobType,
      payload: request.payload as unknown,
      execute: async (ctx) =>
        request.execute(ctx as JobExecutionContext<TPayload>) as Promise<unknown>,
      priority: normalizedPriority,
      requiredCapabilities: request.requiredCapabilities,
      preferredResourceId: request.preferredResourceId,
      maxAttempts: request.maxAttempts ?? this.options.defaultMaxAttempts,
      timeoutMs: request.timeoutMs ?? this.options.defaultJobTimeoutMs,
      metadata: request.metadata
    };

    const jobId = this.nextJobId();
    const record: QueuedJobRecord<unknown, unknown> = {
      jobId,
      request: normalizedRequest,
      state: 'queued',
      attemptsMade: 0,
      queuedAt: nowMs,
      availableAt: nowMs,
      sequence: this.sequenceCounter++
    };

    const resultPromise = new Promise<JobResult<TResult>>((resolve) => {
      this.deferredByJobId.set(jobId, {
        resolve: resolve as unknown as (result: JobResult<unknown>) => void
      });
    });

    this.queue.enqueue(record);
    this.incQueuedDemand(record);
    this.emit({
      type: 'job_queued',
      timestamp: nowMs,
      poolId: request.poolId,
      serviceId,
      jobId,
      feature: request.feature,
      jobType: request.jobType
    });
    this.runServiceRebalance(request.poolId, nowMs);
    this.requestDispatch();

    return resultPromise;
  }

  cancel(jobId: string): boolean {
    const pending = this.queue.remove(jobId);
    if (pending) {
      this.decQueuedDemand(pending);
      const nowMs = Date.now();
      this.resolveTerminalJob({
        success: false,
        state: 'cancelled',
        jobId,
        poolId: pending.request.poolId,
        feature: pending.request.feature,
        jobType: pending.request.jobType,
        attempts: pending.attemptsMade,
        queuedAt: pending.queuedAt,
        endedAt: nowMs,
        error: 'Job cancelled before execution.',
        errorCode: 'CANCELLED_BY_USER'
      });
      this.emit({
        type: 'job_cancelled',
        timestamp: nowMs,
        poolId: pending.request.poolId,
        serviceId: pending.request.serviceId ?? pending.request.feature,
        jobId,
        feature: pending.request.feature,
        jobType: pending.request.jobType,
        errorCode: 'CANCELLED_BY_USER'
      });
      this.requestDispatch();
      return true;
    }

    const running = this.runningJobs.get(jobId);
    if (!running) return false;

    running.cancelRequested = true;
    running.abortController.abort(new CancelledJobError('CANCELLED_BY_USER'));
    return true;
  }

  subscribe(listener: DispatchListener): Unsubscribe {
    const unsubscribeRecord = this.subscribeEventRecords((record, snapshot) => {
      listener(record.event, snapshot);
    });
    this.listeners.add(listener);
    return () => {
      unsubscribeRecord();
      this.listeners.delete(listener);
    };
  }

  subscribeEventRecords(listener: DispatchRecordListener): Unsubscribe {
    this.recordListeners.add(listener);
    return () => {
      this.recordListeners.delete(listener);
    };
  }

  getSnapshot(): SchedulerSnapshot {
    const nowMs = Date.now();
    if (this.canReuseSnapshot(nowMs)) {
      const snapshot = this.cachedSnapshot as SchedulerSnapshot;
      return snapshot.freshness === 'fresh_read'
        ? snapshot
        : {
            ...snapshot,
            freshness: 'fresh_read'
          };
    }
    return this.rebuildSnapshot(nowMs, 'fresh_read');
  }

  getSnapshotForCoalescedEmit(): SchedulerSnapshot {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot.freshness === 'coalesced_emit'
        ? this.cachedSnapshot
        : {
            ...this.cachedSnapshot,
            freshness: 'coalesced_emit'
          };
    }
    return this.rebuildSnapshot(Date.now(), 'coalesced_emit');
  }

  getInspectorSnapshot(options: QueueInspectorViewOptions = {}): QueueInspectorSnapshot {
    const schedulerSnapshot = this.getSnapshot();
    return this.queueInspector.buildSnapshot(
      {
        schedulerSnapshot,
        queuedJobs: this.queue.listRecords(),
        runningJobs: this.getRunningJobsForInspector()
      },
      options
    );
  }

  getEventHistory(limit?: number): QueueEventRecord[] {
    return this.queueInspector.getHistory(limit);
  }

  clearEventHistory(options: ClearEventHistoryOptions = {}): void {
    this.queueInspector.clearHistory(options);
  }

  private canReuseSnapshot(nowMs: number): boolean {
    if (!this.cachedSnapshot || this.snapshotDirty) return false;
    if (nowMs - this.snapshotUpdatedAt > this.snapshotTickMs) return false;

    const nextWakeAt = this.cachedSnapshot.nextWakeAt;
    if (nextWakeAt !== null && nowMs >= nextWakeAt) return false;
    return true;
  }

  private rebuildSnapshot(
    nowMs: number,
    freshness: SchedulerSnapshot['freshness']
  ): SchedulerSnapshot {
    const runningJobsByPool: Record<string, number> = {};
    for (const running of this.runningJobs.values()) {
      runningJobsByPool[running.poolId] = (runningJobsByPool[running.poolId] ?? 0) + 1;
    }

    const pendingDispatch: DispatchOrderResult = this.queue.getDispatchOrder(
      nowMs,
      this.options.antiStarvationStepMs
    );
    const resourceWakeAt = this.registry.getGlobalNextWakeAt(nowMs);
    const serviceWakeAt = this.options.enableServiceAllocator
      ? this.serviceAllocator.getNextWakeAt(nowMs)
      : null;
    const nextWakeAt = this.minWakeAt(
      pendingDispatch.nextWakeAt,
      resourceWakeAt,
      serviceWakeAt,
      this.nextWakeAtHint
    );

    const snapshot: SchedulerSnapshot = {
      timestamp: nowMs,
      snapshotVersion: ++this.snapshotVersion,
      stateVersionAtBuild: this.stateVersion,
      freshness,
      totalQueued: this.queue.size(),
      totalRunning: this.runningJobs.size,
      queueDepthByPool: this.queue.getQueueDepthByPool(),
      runningJobsByPool,
      resourceStateCountsByPool: this.registry.getResourceStateCountsByPool(nowMs),
      oldestQueuedMs: this.queue.getOldestQueuedMs(nowMs),
      nextWakeAt,
      resources: this.registry.getResourceSnapshots(nowMs),
      serviceStatsByPool: this.options.enableServiceAllocator
        ? this.serviceAllocator.getServiceStatsByPool()
        : {},
      resourceAssignmentsByPool: this.registry.getResourceAssignmentsByPool()
    };

    this.cachedSnapshot = snapshot;
    this.snapshotUpdatedAt = nowMs;
    this.snapshotDirty = false;
    return snapshot;
  }

  private markSnapshotDirty(): void {
    this.snapshotDirty = true;
    this.scheduleSnapshotFlush();
  }

  private scheduleSnapshotFlush(): void {
    if (this.snapshotFlushTimer || this.shuttingDown) return;
    this.snapshotFlushTimer = setTimeout(() => {
      this.snapshotFlushTimer = null;
      this.flushSnapshotNow();
    }, this.snapshotTickMs);
  }

  private flushSnapshotNow(): void {
    if (!this.snapshotDirty) return;
    this.rebuildSnapshot(Date.now(), 'coalesced_emit');
  }

  async shutdown(options: ShutdownOptions = {}): Promise<void> {
    this.acceptingJobs = false;
    this.shuttingDown = true;
    this.clearWakeTimer();
    this.clearSnapshotFlushTimer();

    if (options.force) {
      for (const running of this.runningJobs.values()) {
        running.cancelRequested = true;
        running.abortController.abort(new CancelledJobError('CANCELLED_BY_SHUTDOWN'));
      }
    }

    const runningCompletions = [...this.runningJobs.values()].map((entry) => entry.completion);
    await Promise.allSettled(runningCompletions);

    const pendingJobs = this.queue.drain();
    const nowMs = Date.now();
    for (const pending of pendingJobs) {
      this.decQueuedDemand(pending);
      this.resolveTerminalJob({
        success: false,
        state: 'cancelled',
        jobId: pending.jobId,
        poolId: pending.request.poolId,
        feature: pending.request.feature,
        jobType: pending.request.jobType,
        attempts: pending.attemptsMade,
        queuedAt: pending.queuedAt,
        endedAt: nowMs,
        error: options.reason || 'Scheduler shutdown.',
        errorCode: 'CANCELLED_BY_SHUTDOWN'
      });
      this.emit({
        type: 'job_cancelled',
        timestamp: nowMs,
        poolId: pending.request.poolId,
        serviceId: pending.request.serviceId ?? pending.request.feature,
        jobId: pending.jobId,
        feature: pending.request.feature,
        jobType: pending.request.jobType,
        message: options.reason || 'Cancelled due to shutdown.',
        errorCode: 'CANCELLED_BY_SHUTDOWN'
      });
    }
    this.flushSnapshotNow();
  }

  private validateJobRequest<TPayload, TResult>(request: JobRequest<TPayload, TResult>): void {
    if (!request.poolId?.trim()) throw new InvalidJobRequestError('poolId is required.');
    if (!request.feature?.trim()) throw new InvalidJobRequestError('feature is required.');
    if (!request.jobType?.trim()) throw new InvalidJobRequestError('jobType is required.');
    if (typeof request.execute !== 'function') {
      throw new InvalidJobRequestError('execute must be a function.');
    }
  }

  private requestDispatch(wakeAtMs?: number): void {
    if (this.shuttingDown) return;

    if (wakeAtMs !== undefined) {
      this.nextWakeAtHint = this.minWakeAt(this.nextWakeAtHint, wakeAtMs);
      this.scheduleWakeTimer(wakeAtMs);
    }

    if (this.dispatchScheduled) return;
    this.dispatchScheduled = true;

    setImmediate(() => {
      this.dispatchScheduled = false;
      void this.runDispatch();
    });
  }

  private async runDispatch(): Promise<void> {
    if (this.dispatchRunning || this.shuttingDown) return;

    this.dispatchRunning = true;
    try {
      this.runServiceRebalance(undefined, Date.now());
      while (!this.shuttingDown && this.canStartNewJob()) {
        const candidate = this.pickDispatchCandidate(Date.now());
        if (!candidate) break;
        this.startJob(candidate.record, candidate.resource);
      }
      this.refreshWakeTimer();
    } finally {
      this.dispatchRunning = false;
    }
  }

  private pickDispatchCandidate(nowMs: number): DispatchCandidate | null {
    const dispatchOrder = this.queue.getDispatchOrder(nowMs, this.options.antiStarvationStepMs);
    let nextWakeAt = dispatchOrder.nextWakeAt;

    for (const record of dispatchOrder.candidates) {
      if (!this.registry.hasPool(record.request.poolId)) {
        const removed = this.queue.remove(record.jobId);
        if (!removed) continue;
        this.decQueuedDemand(removed);

        const error = `Pool "${record.request.poolId}" does not exist.`;
        this.emit({
          type: 'job_failed',
          timestamp: nowMs,
          poolId: record.request.poolId,
          serviceId: record.request.serviceId ?? record.request.feature,
          jobId: record.jobId,
          feature: record.request.feature,
          jobType: record.request.jobType,
          error,
          errorCode: 'EXECUTION_ERROR'
        });
        this.resolveTerminalJob({
          success: false,
          state: 'failed',
          jobId: record.jobId,
          poolId: record.request.poolId,
          feature: record.request.feature,
          jobType: record.request.jobType,
          attempts: removed.attemptsMade,
          queuedAt: removed.queuedAt,
          endedAt: nowMs,
          error,
          errorCode: 'EXECUTION_ERROR'
        });
        continue;
      }

      const featureRunning = this.runningCountByFeature.get(record.request.feature) ?? 0;
      if (featureRunning >= this.options.maxConcurrentPerFeature) {
        continue;
      }

      const selection = this.registry.selectResource({
        poolId: record.request.poolId,
        serviceId: record.request.serviceId ?? record.request.feature,
        requiredCapabilities: record.request.requiredCapabilities,
        preferredResourceId: record.request.preferredResourceId,
        nowMs
      });

      if (selection.resource) {
        return { record, resource: selection.resource };
      }

      nextWakeAt = this.minWakeAt(nextWakeAt, selection.nextWakeAt);
    }

    const serviceWakeAt = this.options.enableServiceAllocator
      ? this.serviceAllocator.getNextWakeAt(nowMs)
      : null;
    this.nextWakeAtHint = this.minWakeAt(nextWakeAt, serviceWakeAt);
    return null;
  }

  private startJob(record: QueuedJobRecord<unknown, unknown>, resource: ResourceRuntime): void {
    const dequeued = this.queue.remove(record.jobId);
    if (!dequeued) return;
    this.decQueuedDemand(dequeued);

    const nowMs = Date.now();
    const attempt = dequeued.attemptsMade + 1;
    const maxAttempts = dequeued.request.maxAttempts ?? this.options.defaultMaxAttempts;
    const timeoutMs = dequeued.request.timeoutMs ?? this.options.defaultJobTimeoutMs;
    const serviceId = dequeued.request.serviceId ?? dequeued.request.feature;

    this.registry.acquireResource(resource.poolId, resource.resourceId, nowMs, serviceId);
    this.emit({
      type: 'resource_selected',
      timestamp: nowMs,
      poolId: resource.poolId,
      serviceId,
      jobId: dequeued.jobId,
      feature: dequeued.request.feature,
      jobType: dequeued.request.jobType,
      resourceId: resource.resourceId,
      attempt,
      maxAttempts
    });
    this.emitResourceStateChanged(resource.poolId, resource.resourceId);
    this.emit({
      type: 'job_started',
      timestamp: nowMs,
      poolId: resource.poolId,
      serviceId,
      jobId: dequeued.jobId,
      feature: dequeued.request.feature,
      jobType: dequeued.request.jobType,
      resourceId: resource.resourceId,
      attempt,
      maxAttempts
    });

    const abortController = new AbortController();
    const runningEntry: RunningJob = {
      jobId: dequeued.jobId,
      poolId: dequeued.request.poolId,
      serviceId,
      feature: dequeued.request.feature,
      jobType: dequeued.request.jobType,
      priority: dequeued.request.priority ?? 'normal',
      attempt,
      maxAttempts,
      timeoutMs,
      queuedAt: dequeued.queuedAt,
      startedAt: nowMs,
      resourceId: resource.resourceId,
      request: dequeued.request,
      abortController,
      cancelRequested: false,
      completion: Promise.resolve()
    };

    this.runningJobs.set(dequeued.jobId, runningEntry);
    this.incRunningDemand(runningEntry);
    this.runningCountByFeature.set(
      runningEntry.feature,
      (this.runningCountByFeature.get(runningEntry.feature) ?? 0) + 1
    );
    this.runServiceRebalance(dequeued.request.poolId, nowMs);

    const executionContext: JobExecutionContext<unknown> = {
      jobId: dequeued.jobId,
      poolId: dequeued.request.poolId,
      feature: dequeued.request.feature,
      jobType: dequeued.request.jobType,
      priority: dequeued.request.priority ?? 'normal',
      payload: dequeued.request.payload,
      attempt,
      maxAttempts,
      queuedAt: dequeued.queuedAt,
      startedAt: nowMs,
      signal: abortController.signal,
      resource: {
        poolId: resource.poolId,
        resourceId: resource.resourceId,
        label: resource.label,
        capabilities: [...resource.capabilities],
        metadata: resource.metadata
      },
      metadata: dequeued.request.metadata
    };

    const completion = this.executeWithTimeout(
      () => dequeued.request.execute(executionContext),
      timeoutMs,
      abortController
    )
      .then(async (result) => {
        await this.handleJobSuccess(dequeued, runningEntry, result);
      })
      .catch(async (error: unknown) => {
        await this.handleJobFailure(dequeued, runningEntry, error);
      })
      .finally(() => {
        this.decRunningDemand(runningEntry);
        this.runningJobs.delete(dequeued.jobId);
        const featureRunning = (this.runningCountByFeature.get(runningEntry.feature) ?? 1) - 1;
        if (featureRunning <= 0) {
          this.runningCountByFeature.delete(runningEntry.feature);
        } else {
          this.runningCountByFeature.set(runningEntry.feature, featureRunning);
        }
        this.runServiceRebalance(dequeued.request.poolId);
        this.requestDispatch();
      });

    runningEntry.completion = completion;
  }

  private async handleJobSuccess(
    record: QueuedJobRecord<unknown, unknown>,
    running: RunningJob,
    result: unknown
  ): Promise<void> {
    const nowMs = Date.now();
    this.registry.releaseResource(record.request.poolId, running.resourceId);

    const resource = this.registry.getResource(record.request.poolId, running.resourceId);
    const cooldownMs = this.getRandomInt(resource.cooldownMinMs, resource.cooldownMaxMs);
    const cooldownUntil = nowMs + cooldownMs;

    this.registry.setResourceCooldown(record.request.poolId, running.resourceId, cooldownUntil);
    this.emit({
      type: 'resource_cooldown_set',
      timestamp: nowMs,
      poolId: record.request.poolId,
      resourceId: running.resourceId,
      cooldownUntil
    });
    this.emitResourceStateChanged(record.request.poolId, running.resourceId);

    this.emit({
      type: 'job_succeeded',
      timestamp: nowMs,
      poolId: record.request.poolId,
      serviceId: record.request.serviceId ?? record.request.feature,
      jobId: record.jobId,
      feature: record.request.feature,
      jobType: record.request.jobType,
      resourceId: running.resourceId,
      attempt: running.attempt,
      maxAttempts: running.maxAttempts
    });

    this.resolveTerminalJob({
      success: true,
      state: 'succeeded',
      jobId: record.jobId,
      poolId: record.request.poolId,
      feature: record.request.feature,
      jobType: record.request.jobType,
      attempts: running.attempt,
      queuedAt: running.queuedAt,
      startedAt: running.startedAt,
      endedAt: nowMs,
      resourceId: running.resourceId,
      result
    });
  }

  private async handleJobFailure(
    record: QueuedJobRecord<unknown, unknown>,
    running: RunningJob,
    error: unknown
  ): Promise<void> {
    const nowMs = Date.now();
    this.registry.releaseResource(record.request.poolId, running.resourceId);
    this.emitResourceStateChanged(record.request.poolId, running.resourceId);

    const failure = this.classifyJobError(error, running);

    if (failure.errorCode === 'CANCELLED_BY_USER' || failure.errorCode === 'CANCELLED_BY_SHUTDOWN') {
      this.emit({
        type: 'job_cancelled',
        timestamp: nowMs,
        poolId: record.request.poolId,
        serviceId: record.request.serviceId ?? record.request.feature,
        jobId: record.jobId,
        feature: record.request.feature,
        jobType: record.request.jobType,
        resourceId: running.resourceId,
        error: failure.errorMessage,
        errorCode: failure.errorCode
      });
      this.resolveTerminalJob({
        success: false,
        state: 'cancelled',
        jobId: record.jobId,
        poolId: record.request.poolId,
        feature: record.request.feature,
        jobType: record.request.jobType,
        attempts: running.attempt,
        queuedAt: running.queuedAt,
        startedAt: running.startedAt,
        endedAt: nowMs,
        resourceId: running.resourceId,
        error: failure.errorMessage,
        errorCode: failure.errorCode
      });
      return;
    }

    if (failure.errorCode === 'RATE_LIMIT' && (failure.retryAfterMs ?? 0) > 0) {
      const cooldownUntil = nowMs + (failure.retryAfterMs ?? 0);
      this.registry.setResourceCooldown(record.request.poolId, running.resourceId, cooldownUntil);
      this.emit({
        type: 'resource_cooldown_set',
        timestamp: nowMs,
        poolId: record.request.poolId,
        resourceId: running.resourceId,
        cooldownUntil,
        message: 'Retry-After cooldown applied.',
        errorCode: failure.errorCode
      });
    }

    if (running.attempt < running.maxAttempts) {
      const retryDelayMs = Math.min(30_000, 2_000 * running.attempt) + this.getRandomInt(0, 500);
      const retryAt = nowMs + retryDelayMs;
      const retryRecord: QueuedJobRecord<unknown, unknown> = {
        ...record,
        state: 'retry_wait',
        attemptsMade: running.attempt,
        availableAt: retryAt,
        lastError: failure.errorMessage
      };

      this.queue.enqueue(retryRecord);
      this.incQueuedDemand(retryRecord);
      this.emit({
        type: 'job_retry_scheduled',
        timestamp: nowMs,
        poolId: record.request.poolId,
        serviceId: record.request.serviceId ?? record.request.feature,
        jobId: record.jobId,
        feature: record.request.feature,
        jobType: record.request.jobType,
        resourceId: running.resourceId,
        attempt: running.attempt,
        maxAttempts: running.maxAttempts,
        retryAt,
        error: failure.errorMessage,
        errorCode: failure.errorCode
      });
      this.runServiceRebalance(record.request.poolId, nowMs);
      this.requestDispatch(retryAt);
      return;
    }

    this.emit({
      type: 'job_failed',
      timestamp: nowMs,
      poolId: record.request.poolId,
      serviceId: record.request.serviceId ?? record.request.feature,
      jobId: record.jobId,
      feature: record.request.feature,
      jobType: record.request.jobType,
      resourceId: running.resourceId,
      attempt: running.attempt,
      maxAttempts: running.maxAttempts,
      error: failure.errorMessage,
      errorCode: failure.errorCode
    });
    this.resolveTerminalJob({
      success: false,
      state: 'failed',
      jobId: record.jobId,
      poolId: record.request.poolId,
      feature: record.request.feature,
      jobType: record.request.jobType,
      attempts: running.attempt,
      queuedAt: running.queuedAt,
      startedAt: running.startedAt,
      endedAt: nowMs,
      resourceId: running.resourceId,
      error: failure.errorMessage,
      errorCode: failure.errorCode
    });
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    abortController: AbortController
  ): Promise<T> {
    const timer = setTimeout(() => {
      abortController.abort(
        new RotationJobExecutionError('TIMEOUT', `Job timeout after ${timeoutMs}ms.`)
      );
    }, timeoutMs);

    try {
      const abortPromise = new Promise<T>((_, reject) => {
        abortController.signal.addEventListener(
          'abort',
          () => reject(abortController.signal.reason ?? new Error('Job aborted.')),
          { once: true }
        );
      });

      return await Promise.race([fn(), abortPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveTerminalJob(result: JobResult<unknown>): void {
    const deferred = this.deferredByJobId.get(result.jobId);
    if (!deferred) return;
    this.deferredByJobId.delete(result.jobId);
    deferred.resolve(result);
  }

  private emitResourceStateChanged(poolId: string, resourceId: string): void {
    const nowMs = Date.now();
    const state = this.registry.getResourceState(poolId, resourceId, nowMs);
    this.emit({
      type: 'resource_state_changed',
      timestamp: nowMs,
      poolId,
      resourceId,
      metadata: { state }
    });
  }

  private emit(event: DispatchEvent): void {
    const eventRecord = this.queueInspector.appendEvent(event);
    this.markStateChanged();

    if (this.recordListeners.size === 0) return;
    const snapshot = this.getSnapshotForCoalescedEmit();
    for (const listener of this.recordListeners) {
      try {
        listener(eventRecord, snapshot);
      } catch (error) {
        console.error('[UniversalRotationQueue] listener error:', error);
      }
    }
  }

  private runServiceRebalance(poolId?: string, atMs?: number): void {
    if (!this.options.enableServiceAllocator) return;

    const nowMs = atMs ?? Date.now();
    const queuedByPoolService = this.serializePoolServiceCounters(this.queuedDemandByPoolService);
    const runningByPoolService = this.serializePoolServiceCounters(this.runningDemandByPoolService);
    const capabilityDemandByPoolService = this.serializeCapabilityDemand();

    this.assertDemandCounters();

    const result = this.serviceAllocator.rebalance({
      poolId,
      nowMs,
      queuedByPoolService,
      runningByPoolService,
      capabilityDemandByPoolService
    });

    for (const event of result.events) {
      this.emit(event);
    }

    if (result.nextWakeAt !== null) {
      this.requestDispatch(result.nextWakeAt);
    }
  }

  private scheduleWakeTimer(wakeAtMs: number): void {
    const delayMs = Math.max(0, wakeAtMs - Date.now());
    if (this.wakeTimer) {
      const currentDueAt = this.wakeTimerDueAt ?? Number.POSITIVE_INFINITY;
      if (wakeAtMs >= currentDueAt) return;
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
      this.wakeTimerDueAt = null;
    }
    this.wakeTimerDueAt = wakeAtMs;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.wakeTimerDueAt = null;
      this.requestDispatch();
    }, delayMs);
  }

  private refreshWakeTimer(): void {
    this.clearWakeTimer();
    const snapshot = this.getSnapshot();
    if (snapshot.nextWakeAt !== null) {
      this.nextWakeAtHint = snapshot.nextWakeAt;
      this.scheduleWakeTimer(snapshot.nextWakeAt);
    } else {
      this.nextWakeAtHint = null;
    }
  }

  private clearWakeTimer(): void {
    if (!this.wakeTimer) return;
    clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    this.wakeTimerDueAt = null;
  }

  private clearSnapshotFlushTimer(): void {
    if (!this.snapshotFlushTimer) return;
    clearTimeout(this.snapshotFlushTimer);
    this.snapshotFlushTimer = null;
  }

  private canStartNewJob(): boolean {
    return this.runningJobs.size < this.options.globalMaxConcurrentJobs;
  }

  private nextJobId(): string {
    this.jobCounter += 1;
    return `job_${Date.now()}_${this.jobCounter}`;
  }

  private minWakeAt(...values: Array<number | null | undefined>): number | null {
    let minValue: number | null = null;
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (minValue === null || value < minValue) {
        minValue = value;
      }
    }
    return minValue;
  }

  private getRandomInt(minMs: number, maxMs: number): number {
    const min = Math.max(0, Math.floor(minMs));
    const max = Math.max(min, Math.floor(maxMs));
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private classifyJobError(
    error: unknown,
    running: RunningJob
  ): { errorCode: RotationJobErrorCode; errorMessage: string; retryAfterMs?: number } {
    const errorMessage = this.stringifyError(error);

    if (running.cancelRequested) {
      return { errorCode: 'CANCELLED_BY_USER', errorMessage };
    }

    if (this.shuttingDown && running.abortController.signal.aborted) {
      return { errorCode: 'CANCELLED_BY_SHUTDOWN', errorMessage };
    }

    if (error instanceof RotationJobExecutionError) {
      return {
        errorCode: error.code as RotationJobErrorCode,
        errorMessage,
        retryAfterMs: error.retryAfterMs
      };
    }

    const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
    const response = (record?.response as Record<string, unknown> | undefined) ?? undefined;
    const status = Number(response?.status ?? record?.status);
    const retryAfterMs = this.extractRetryAfterMsFromObject(record);
    const code = this.extractErrorCodeFromUnknown(error);

    if (code) {
      return { errorCode: code, errorMessage, retryAfterMs };
    }

    if (status === 429) {
      return { errorCode: 'RATE_LIMIT', errorMessage, retryAfterMs };
    }

    if (errorMessage.toLowerCase().includes('timeout')) {
      return { errorCode: 'TIMEOUT', errorMessage };
    }

    if (running.abortController.signal.aborted) {
      return { errorCode: 'CANCELLED_BY_USER', errorMessage };
    }

    return { errorCode: 'EXECUTION_ERROR', errorMessage, retryAfterMs };
  }

  private extractErrorCodeFromUnknown(error: unknown): RotationJobErrorCode | null {
    if (!error || typeof error !== 'object') return null;
    const code = (error as Record<string, unknown>).code;
    if (
      code === 'CANCELLED_BY_USER' ||
      code === 'CANCELLED_BY_SHUTDOWN' ||
      code === 'TIMEOUT' ||
      code === 'RATE_LIMIT' ||
      code === 'RESOURCE_UNAVAILABLE' ||
      code === 'EXECUTION_ERROR'
    ) {
      return code;
    }
    return null;
  }

  private extractRetryAfterMsFromObject(error: Record<string, unknown> | null): number | undefined {
    if (!error) return undefined;
    const directValue = error.retryAfterMs;
    if (typeof directValue === 'number' && Number.isFinite(directValue) && directValue > 0) {
      return directValue;
    }

    const nested = error.response as Record<string, unknown> | undefined;
    const nestedValue = nested?.retryAfterMs;
    if (typeof nestedValue === 'number' && Number.isFinite(nestedValue) && nestedValue > 0) {
      return nestedValue;
    }

    return undefined;
  }

  private markStateChanged(): void {
    this.stateVersion += 1;
    this.markSnapshotDirty();
  }

  private incQueuedDemand(record: QueuedJobRecord<unknown, unknown>): void {
    const serviceId = record.request.serviceId ?? record.request.feature;
    this.bumpPoolServiceCounter(this.queuedDemandByPoolService, record.request.poolId, serviceId, 1);

    const signature = this.buildCapabilitySignature(record.request.requiredCapabilities);
    let byService = this.queuedCapabilityDemandByPoolService.get(record.request.poolId);
    if (!byService) {
      byService = new Map<string, Map<string, number>>();
      this.queuedCapabilityDemandByPoolService.set(record.request.poolId, byService);
    }

    let bySignature = byService.get(serviceId);
    if (!bySignature) {
      bySignature = new Map<string, number>();
      byService.set(serviceId, bySignature);
    }

    bySignature.set(signature, (bySignature.get(signature) ?? 0) + 1);
    this.markStateChanged();
  }

  private decQueuedDemand(record: QueuedJobRecord<unknown, unknown>): void {
    const serviceId = record.request.serviceId ?? record.request.feature;
    this.bumpPoolServiceCounter(this.queuedDemandByPoolService, record.request.poolId, serviceId, -1);

    const signature = this.buildCapabilitySignature(record.request.requiredCapabilities);
    const byService = this.queuedCapabilityDemandByPoolService.get(record.request.poolId);
    const bySignature = byService?.get(serviceId);
    if (bySignature) {
      const next = (bySignature.get(signature) ?? 0) - 1;
      if (next <= 0) {
        bySignature.delete(signature);
      } else {
        bySignature.set(signature, next);
      }
      if (bySignature.size === 0) {
        byService?.delete(serviceId);
      }
      if (byService && byService.size === 0) {
        this.queuedCapabilityDemandByPoolService.delete(record.request.poolId);
      }
    }

    this.markStateChanged();
  }

  private incRunningDemand(running: RunningJob): void {
    this.bumpPoolServiceCounter(this.runningDemandByPoolService, running.poolId, running.serviceId, 1);
    this.markStateChanged();
  }

  private decRunningDemand(running: RunningJob): void {
    this.bumpPoolServiceCounter(this.runningDemandByPoolService, running.poolId, running.serviceId, -1);
    this.markStateChanged();
  }

  private bumpPoolServiceCounter(
    store: Map<string, Map<string, number>>,
    poolId: string,
    serviceId: string,
    delta: number
  ): void {
    let byService = store.get(poolId);
    if (!byService) {
      byService = new Map<string, number>();
      store.set(poolId, byService);
    }

    const next = (byService.get(serviceId) ?? 0) + delta;
    if (next <= 0) {
      byService.delete(serviceId);
    } else {
      byService.set(serviceId, next);
    }

    if (byService.size === 0) {
      store.delete(poolId);
    }
  }

  private buildCapabilitySignature(requiredCapabilities?: string[]): string {
    if (!requiredCapabilities || requiredCapabilities.length === 0) return '';
    const unique = new Set<string>();
    for (const cap of requiredCapabilities) {
      const normalized = cap.trim().toLowerCase();
      if (!normalized) continue;
      unique.add(normalized);
    }
    if (unique.size === 0) return '';
    return [...unique].sort().join('|');
  }

  private serializePoolServiceCounters(
    source: Map<string, Map<string, number>>
  ): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [poolId, byService] of source.entries()) {
      result[poolId] = {};
      for (const [serviceId, count] of byService.entries()) {
        if (count > 0) {
          result[poolId][serviceId] = count;
        }
      }
    }
    return result;
  }

  private serializeCapabilityDemand(): Record<string, Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, Record<string, number>>> = {};
    for (const [poolId, byService] of this.queuedCapabilityDemandByPoolService.entries()) {
      result[poolId] = {};
      for (const [serviceId, bySignature] of byService.entries()) {
        result[poolId][serviceId] = {};
        for (const [signature, count] of bySignature.entries()) {
          if (count > 0) {
            result[poolId][serviceId][signature] = count;
          }
        }
      }
    }
    return result;
  }

  private assertDemandCounters(): void {
    if (process.env.NODE_ENV === 'production') return;

    const expectedQueued = new Map<string, Map<string, number>>();
    const expectedRunning = new Map<string, Map<string, number>>();
    const expectedCapability = new Map<string, Map<string, Map<string, number>>>();

    for (const queued of this.queue.listRecords()) {
      const serviceId = queued.request.serviceId ?? queued.request.feature;
      this.bumpPoolServiceCounter(expectedQueued, queued.request.poolId, serviceId, 1);

      let byService = expectedCapability.get(queued.request.poolId);
      if (!byService) {
        byService = new Map<string, Map<string, number>>();
        expectedCapability.set(queued.request.poolId, byService);
      }
      let bySignature = byService.get(serviceId);
      if (!bySignature) {
        bySignature = new Map<string, number>();
        byService.set(serviceId, bySignature);
      }
      const signature = this.buildCapabilitySignature(queued.request.requiredCapabilities);
      bySignature.set(signature, (bySignature.get(signature) ?? 0) + 1);
    }

    for (const running of this.runningJobs.values()) {
      this.bumpPoolServiceCounter(expectedRunning, running.poolId, running.serviceId, 1);
    }

    const expectedQueuedObj = this.serializePoolServiceCounters(expectedQueued);
    const expectedRunningObj = this.serializePoolServiceCounters(expectedRunning);
    const expectedCapabilityObj = (() => {
      const obj: Record<string, Record<string, Record<string, number>>> = {};
      for (const [poolId, byService] of expectedCapability.entries()) {
        obj[poolId] = {};
        for (const [serviceId, bySignature] of byService.entries()) {
          obj[poolId][serviceId] = {};
          for (const [signature, count] of bySignature.entries()) {
            obj[poolId][serviceId][signature] = count;
          }
        }
      }
      return obj;
    })();

    const actualQueuedObj = this.serializePoolServiceCounters(this.queuedDemandByPoolService);
    const actualRunningObj = this.serializePoolServiceCounters(this.runningDemandByPoolService);
    const actualCapabilityObj = this.serializeCapabilityDemand();

    if (this.stableStringify(expectedQueuedObj) !== this.stableStringify(actualQueuedObj)) {
      throw new Error('Queued demand counter mismatch.');
    }
    if (this.stableStringify(expectedRunningObj) !== this.stableStringify(actualRunningObj)) {
      throw new Error('Running demand counter mismatch.');
    }
    if (
      this.stableStringify(expectedCapabilityObj) !== this.stableStringify(actualCapabilityObj)
    ) {
      throw new Error('Queued capability demand counter mismatch.');
    }
  }

  private stableStringify(value: unknown): string {
    const normalize = (input: unknown): unknown => {
      if (Array.isArray(input)) {
        return input.map((item) => normalize(item));
      }
      if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
          normalized[key] = normalize(record[key]);
        }
        return normalized;
      }
      return input;
    };

    return JSON.stringify(normalize(value));
  }

  private resolveServiceId<TPayload, TResult>(request: JobRequest<TPayload, TResult>): string {
    const explicitServiceId = request.serviceId?.trim();
    return explicitServiceId || request.feature;
  }

  private getRunningJobsForInspector(): QueueInspectorRunningJob[] {
    const result: QueueInspectorRunningJob[] = [];
    for (const running of this.runningJobs.values()) {
      result.push({
        jobId: running.jobId,
        poolId: running.poolId,
        serviceId: running.serviceId,
        feature: running.feature,
        jobType: running.jobType,
        priority: running.priority,
        attempt: running.attempt,
        maxAttempts: running.maxAttempts,
        queuedAt: running.queuedAt,
        startedAt: running.startedAt,
        resourceId: running.resourceId,
        request: running.request
      });
    }
    return result;
  }
}
