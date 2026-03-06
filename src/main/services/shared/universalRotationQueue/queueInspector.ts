import {
  ClearEventHistoryOptions,
  DispatchEvent,
  JobPriority,
  JobRequest,
  QueueEventRecord,
  QueueInspectorSnapshot,
  QueueInspectorViewOptions,
  QueueJobRuntimeSnapshot,
  QueuedJobRecord,
  SchedulerSnapshot
} from './rotationTypes';

export interface QueueInspectorRunningJob {
  jobId: string;
  poolId: string;
  serviceId: string;
  feature: string;
  jobType: string;
  priority: JobPriority;
  attempt: number;
  maxAttempts: number;
  queuedAt: number;
  startedAt: number;
  resourceId: string;
  request: JobRequest<unknown, unknown>;
}

interface QueueInspectorBuildInput {
  schedulerSnapshot: SchedulerSnapshot;
  queuedJobs: QueuedJobRecord<unknown, unknown>[];
  runningJobs: QueueInspectorRunningJob[];
}

interface QueueInspectorOptions {
  historyCapacity: number;
  allowPayloadRaw: boolean;
}

export class QueueInspector {
  private readonly historyCapacity: number;
  private readonly allowPayloadRaw: boolean;
  private readonly eventHistory: QueueEventRecord[] = [];
  private sequence = 0;
  private droppedHistoryCount = 0;

  constructor(options: QueueInspectorOptions) {
    this.historyCapacity = Math.max(10, Math.floor(options.historyCapacity));
    this.allowPayloadRaw = options.allowPayloadRaw;
  }

  appendEvent(event: DispatchEvent): QueueEventRecord {
    const nextSeq = this.sequence + 1;
    const normalizedEvent: DispatchEvent = {
      ...event,
      metadata: {
        ...(event.metadata ?? {}),
        seq: nextSeq
      }
    };
    const record: QueueEventRecord = {
      seq: ++this.sequence,
      timestamp: normalizedEvent.timestamp,
      event: normalizedEvent
    };

    this.eventHistory.push(record);
    if (this.eventHistory.length > this.historyCapacity) {
      const extra = this.eventHistory.length - this.historyCapacity;
      this.eventHistory.splice(0, extra);
      this.droppedHistoryCount += extra;
    }

    return record;
  }

  getHistory(limit?: number): QueueEventRecord[] {
    const normalized = this.normalizeLimit(limit, this.eventHistory.length);
    if (normalized <= 0) return [];
    return this.eventHistory.slice(-normalized);
  }

  clearHistory(options: ClearEventHistoryOptions = {}): void {
    this.eventHistory.length = 0;
    if (options.resetDroppedCounter ?? true) {
      this.droppedHistoryCount = 0;
    }
  }

  getHistorySize(): number {
    return this.eventHistory.length;
  }

  getDroppedHistoryCount(): number {
    return this.droppedHistoryCount;
  }

  buildSnapshot(
    input: QueueInspectorBuildInput,
    options: QueueInspectorViewOptions = {}
  ): QueueInspectorSnapshot {
    const jobs = [
      ...input.queuedJobs.map((record) => this.toQueuedJobSnapshot(record, options)),
      ...input.runningJobs.map((running) => this.toRunningJobSnapshot(running, options))
    ]
      .filter((item): item is QueueJobRuntimeSnapshot => item !== null)
      .sort((a, b) => {
        const timeA = a.startedAt ?? a.availableAt ?? a.queuedAt;
        const timeB = b.startedAt ?? b.availableAt ?? b.queuedAt;
        return timeB - timeA;
      });

    const normalizedLimit = this.normalizeLimit(options.limit, jobs.length);
    const limitedJobs = normalizedLimit > 0 ? jobs.slice(0, normalizedLimit) : jobs;

    const runningByResource: Record<string, Record<string, string | null>> = {};
    for (const resource of input.schedulerSnapshot.resources) {
      if (!runningByResource[resource.poolId]) {
        runningByResource[resource.poolId] = {};
      }
      runningByResource[resource.poolId][resource.resourceId] = null;
    }
    for (const running of input.runningJobs) {
      if (!runningByResource[running.poolId]) {
        runningByResource[running.poolId] = {};
      }
      runningByResource[running.poolId][running.resourceId] = running.jobId;
    }

    return {
      timestamp: Date.now(),
      scheduler: input.schedulerSnapshot,
      jobs: limitedJobs,
      runningByResource,
      historySize: this.eventHistory.length,
      droppedHistoryCount: this.droppedHistoryCount
    };
  }

  private toQueuedJobSnapshot(
    record: QueuedJobRecord<unknown, unknown>,
    options: QueueInspectorViewOptions
  ): QueueJobRuntimeSnapshot | null {
    const serviceId = record.request.serviceId ?? record.request.feature;
    const state = record.state;
    const item: QueueJobRuntimeSnapshot = {
      jobId: record.jobId,
      poolId: record.request.poolId,
      serviceId,
      feature: record.request.feature,
      jobType: record.request.jobType,
      state,
      priority: record.request.priority ?? 'normal',
      attempt: Math.max(1, record.attemptsMade + 1),
      maxAttempts: record.request.maxAttempts ?? 1,
      queuedAt: record.queuedAt,
      availableAt: record.availableAt,
      requiredCapabilities: record.request.requiredCapabilities,
      payloadPreview: this.buildPayloadPreview(record.request.payload, options.includePayload === true),
      lastError: record.lastError,
      metadata: record.request.metadata
    };

    return this.matchesFilters(item, options) ? item : null;
  }

  private toRunningJobSnapshot(
    running: QueueInspectorRunningJob,
    options: QueueInspectorViewOptions
  ): QueueJobRuntimeSnapshot | null {
    const item: QueueJobRuntimeSnapshot = {
      jobId: running.jobId,
      poolId: running.poolId,
      serviceId: running.serviceId,
      feature: running.feature,
      jobType: running.jobType,
      state: 'running',
      priority: running.priority,
      attempt: running.attempt,
      maxAttempts: running.maxAttempts,
      queuedAt: running.queuedAt,
      startedAt: running.startedAt,
      assignedResourceId: running.resourceId,
      requiredCapabilities: running.request.requiredCapabilities,
      payloadPreview: this.buildPayloadPreview(
        running.request.payload as unknown,
        options.includePayload === true
      ),
      metadata: running.request.metadata
    };

    return this.matchesFilters(item, options) ? item : null;
  }

  private matchesFilters(
    item: QueueJobRuntimeSnapshot,
    options: QueueInspectorViewOptions
  ): boolean {
    if (options.poolId && item.poolId !== options.poolId) return false;
    if (options.serviceId && item.serviceId !== options.serviceId) return false;
    if (options.feature && item.feature !== options.feature) return false;
    if (options.state && options.state !== 'all' && item.state !== options.state) return false;
    return true;
  }

  private buildPayloadPreview(payload: unknown, includePayload: boolean) {
    const typeName = this.detectType(payload);
    const summary = this.buildPayloadSummary(payload, typeName);
    const canShowRaw = includePayload && this.allowPayloadRaw;

    return canShowRaw
      ? { mode: 'full' as const, summary, raw: payload }
      : { mode: 'masked' as const, summary };
  }

  private buildPayloadSummary(payload: unknown, typeName: string): string {
    if (payload === null || payload === undefined) {
      return `${typeName}`;
    }
    if (typeof payload === 'string') {
      return `string(${payload.length})`;
    }
    if (Array.isArray(payload)) {
      return `array(${payload.length})`;
    }
    if (typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const keys = Object.keys(record);
      const previewKeys = keys.slice(0, 8).join(', ');
      const suffix = keys.length > 8 ? ', ...' : '';
      return `object(keys=${keys.length}${keys.length > 0 ? `: ${previewKeys}${suffix}` : ''})`;
    }
    return String(typeName);
  }

  private detectType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  private normalizeLimit(limit: number | undefined, max: number): number {
    if (limit === undefined || limit === null) return max;
    if (!Number.isFinite(limit)) return max;
    return Math.max(0, Math.min(max, Math.floor(limit)));
  }
}
