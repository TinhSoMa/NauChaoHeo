import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Trash2,
  ListOrdered,
  Activity,
  Server,
  Clock3
} from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import sharedStyles from './Settings.module.css';
import styles from './QueueMonitorSettings.module.css';
import { SettingsDetailProps } from './types';
import { useQueueMonitor } from './hooks/useQueueMonitor';

type UnknownRecord = Record<string, unknown>;
type JobStateFilter = 'all' | 'queued' | 'retry_wait' | 'running';
type SideTab = 'jobs' | 'timeline';
type QueueTaskLabel = { primary: string; detail: string };

interface QueueResourceViewModel {
  key: string;
  poolId: string;
  resourceId: string;
  displayName: string;
  state: string;
  inFlight: number;
  maxConcurrency: number;
  assignedServiceId: string;
  runningJobId: string;
  runningTask: QueueTaskLabel;
  runningState: string;
  runningDurationMs: number | null;
}

interface QueueJobViewModel {
  key: string;
  jobId: string;
  state: string;
  stateFilter: JobStateFilter;
  poolId: string;
  serviceId: string;
  feature: string;
  jobType: string;
  task: QueueTaskLabel;
  assignedResourceId: string;
  accountDisplayName: string;
  attempt: number;
  maxAttempts: number;
  queuedAt: number;
  startedAt: number;
  availableAt: number;
  payloadSummary: string;
}

interface QueueTimelineViewModel {
  key: string;
  seq: number;
  timestamp: number;
  eventLabel: string;
  eventType: string;
  jobId: string;
  poolId: string;
  serviceId: string;
  resourceId: string;
  accountDisplayName: string;
  task: QueueTaskLabel;
  contextSearch: string;
}

function asRecord(value: unknown): UnknownRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = '-'): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function humanizeToken(value: string): string {
  const normalized = value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '-';
  return normalized
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTaskLabel(featureRaw: unknown, jobTypeRaw: unknown): QueueTaskLabel {
  const feature = asOptionalString(featureRaw) ?? '';
  const jobType = asOptionalString(jobTypeRaw) ?? '';
  const source = jobType || feature;
  const normalized = source.toLowerCase();

  let primary: string;
  if (normalized.includes('translate')) {
    primary = 'Dịch nội dung';
  } else if (normalized.includes('summary')) {
    primary = 'Tạo tóm tắt';
  } else if (normalized.includes('caption')) {
    primary = 'Xử lý phụ đề';
  } else if (normalized.includes('retry')) {
    primary = 'Thử lại tác vụ';
  } else if (normalized.includes('render')) {
    primary = 'Render đầu ra';
  } else if (normalized.includes('audio') || normalized.includes('tts')) {
    primary = 'Xử lý âm thanh';
  } else {
    primary = humanizeToken(source || 'unknown task');
  }

  return { primary, detail: `${feature || '-'} / ${jobType || '-'}` };
}

function formatQueueEventLabel(eventTypeRaw: unknown): string {
  const eventType = asString(eventTypeRaw, '').toLowerCase();
  const mapping: Record<string, string> = {
    job_queued: 'Đã vào hàng chờ',
    job_started: 'Bắt đầu xử lý',
    job_retry_scheduled: 'Lên lịch thử lại',
    job_succeeded: 'Hoàn thành thành công',
    job_failed: 'Kết thúc lỗi',
    job_cancelled: 'Đã hủy',
    resource_selected: 'Đã chọn account',
    resource_cooldown_set: 'Đặt cooldown account',
    resource_state_changed: 'Đổi trạng thái account',
    service_active: 'Service hoạt động',
    service_idle: 'Service nhàn rỗi',
    service_inactive: 'Service ngừng',
    resource_assignment_changed: 'Đổi account cho service',
    service_quota_rebalanced: 'Cân bằng quota service'
  };
  return mapping[eventType] ?? humanizeToken(eventType || 'unknown');
}

function formatTimestamp(ms: unknown): string {
  const num = asNumber(ms, 0);
  if (num <= 0) {
    return '-';
  }
  return new Date(num).toLocaleString();
}

function formatDuration(ms: unknown): string {
  const num = asNumber(ms, -1);
  if (num < 0) {
    return '-';
  }
  if (num < 1000) {
    return `${num} ms`;
  }
  const sec = Math.floor(num / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

function normalizeState(value: unknown): JobStateFilter {
  const text = asString(value, '').toLowerCase();
  if (text === 'queued' || text === 'retry_wait' || text === 'running' || text === 'all') {
    return text;
  }
  return 'all';
}

function toPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function getToneClass(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes('running') || normalized.includes('busy') || normalized.includes('started')) {
    return styles.toneRunning;
  }
  if (normalized.includes('queued')) return styles.toneQueued;
  if (normalized.includes('retry')) return styles.toneRetry;
  if (
    normalized.includes('ready') ||
    normalized.includes('succeed') ||
    normalized.includes('success') ||
    normalized.includes('info')
  ) {
    return styles.toneSuccess;
  }
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')) {
    return styles.toneError;
  }
  if (normalized.includes('cooldown')) return styles.toneCooldown;
  if (normalized.includes('disabled')) return styles.toneDisabled;
  return styles.toneNeutral;
}

function getResourceStateClass(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === 'ready') return styles.resourceReady;
  if (normalized === 'busy') return styles.resourceBusy;
  if (normalized === 'cooldown') return styles.resourceCooldown;
  if (normalized === 'disabled') return styles.resourceDisabled;
  if (normalized === 'error') return styles.resourceError;
  return styles.resourceUnknown;
}

function getResourceSortRank(stateRaw: string): number {
  const state = stateRaw.toLowerCase();
  if (state === 'busy' || state === 'running') return 0;
  if (state === 'cooldown') return 1;
  if (state === 'ready') return 2;
  if (state === 'disabled') return 3;
  if (state === 'error') return 4;
  return 5;
}

function getJobSortRank(stateRaw: string): number {
  const state = stateRaw.toLowerCase();
  if (state === 'running') return 0;
  if (state === 'retry_wait') return 1;
  if (state === 'queued') return 2;
  return 3;
}

function getPoolHealthStatus(
  queueDepth: number,
  runningCount: number,
  ready: number,
  busy: number
): { label: string; toneClass: string } {
  if (queueDepth > 0 && ready <= 0 && busy > 0) {
    return { label: 'Tắc nghẽn', toneClass: styles.toneError };
  }
  if (queueDepth > Math.max(3, ready * 2) && runningCount > 0) {
    return { label: 'Căng tải', toneClass: styles.toneQueued };
  }
  return { label: 'Đang ổn', toneClass: styles.toneSuccess };
}

function makeResourceKey(poolId: string, resourceId: string): string {
  return `${poolId}::${resourceId}`;
}

export function QueueMonitorSettings({ onBack }: SettingsDetailProps) {
  const {
    status,
    runtimeInfos,
    selectedRuntimeKey,
    setSelectedRuntimeKey,
    viewOptions,
    setViewOptions,
    applyFilters,
    snapshot,
    events,
    isPaused,
    setIsPaused,
    isStreaming,
    isLoading,
    errorMessage,
    refreshNow,
    clearHistory
  } = useQueueMonitor();

  const [timelineTypeFilter, setTimelineTypeFilter] = useState('');
  const [timelineContextFilter, setTimelineContextFilter] = useState('');
  const [timelineScopeFilter, setTimelineScopeFilter] = useState('');
  const [sideTab, setSideTab] = useState<SideTab>('jobs');
  const [jobStateFilter, setJobStateFilter] = useState<JobStateFilter>('all');

  const scheduler = asRecord(snapshot?.scheduler);
  const queueDepthByPool = asRecord(scheduler.queueDepthByPool);
  const runningJobsByPool = asRecord(scheduler.runningJobsByPool);
  const resourceStateCountsByPool = asRecord(scheduler.resourceStateCountsByPool);
  const resourceAssignmentsByPool = asRecord(scheduler.resourceAssignmentsByPool);
  const resourcesRaw = asArray(scheduler.resources).map((item) => asRecord(item));
  const jobsRaw = asArray(snapshot?.jobs).map((item) => asRecord(item));

  const resourceDisplayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const resource of resourcesRaw) {
      const poolId = asOptionalString(resource.poolId) ?? '';
      const resourceId = asOptionalString(resource.resourceId) ?? '';
      if (!poolId || !resourceId) continue;
      const metadata = asRecord(resource.metadata);
      const displayName =
        asOptionalString(resource.label) ??
        asOptionalString(metadata.accountName) ??
        resourceId;
      map.set(makeResourceKey(poolId, resourceId), displayName);
    }
    return map;
  }, [resourcesRaw]);

  const jobs = useMemo<QueueJobViewModel[]>(() => {
    const rows: QueueJobViewModel[] = [];
    for (const job of jobsRaw) {
      const jobId = asOptionalString(job.jobId) ?? '-';
      const state = asOptionalString(job.state) ?? 'queued';
      const poolId = asOptionalString(job.poolId) ?? '-';
      const assignedResourceId = asOptionalString(job.assignedResourceId) ?? '';
      const accountDisplayName = assignedResourceId
        ? (resourceDisplayNameMap.get(makeResourceKey(poolId, assignedResourceId)) ?? assignedResourceId)
        : 'Chờ cấp account';
      const feature = asOptionalString(job.feature) ?? '-';
      const jobType = asOptionalString(job.jobType) ?? '-';

      rows.push({
        key: jobId,
        jobId,
        state,
        stateFilter: normalizeState(state),
        poolId,
        serviceId: asOptionalString(job.serviceId) ?? '-',
        feature,
        jobType,
        task: formatTaskLabel(feature, jobType),
        assignedResourceId,
        accountDisplayName,
        attempt: asNumber(job.attempt, 0),
        maxAttempts: asNumber(job.maxAttempts, 0),
        queuedAt: asNumber(job.queuedAt, 0),
        startedAt: asNumber(job.startedAt, 0),
        availableAt: asNumber(job.availableAt, 0),
        payloadSummary: asString(asRecord(job.payloadPreview).summary)
      });
    }

    return rows.sort((a, b) => {
      const rankDiff = getJobSortRank(a.state) - getJobSortRank(b.state);
      if (rankDiff !== 0) return rankDiff;
      const timeA = a.startedAt || a.availableAt || a.queuedAt || 0;
      const timeB = b.startedAt || b.availableAt || b.queuedAt || 0;
      return timeB - timeA;
    });
  }, [jobsRaw, resourceDisplayNameMap]);

  const filteredJobs = useMemo(() => {
    if (jobStateFilter === 'all') return jobs;
    return jobs.filter((job) => job.stateFilter === jobStateFilter);
  }, [jobStateFilter, jobs]);

  const jobByIdMap = useMemo(() => {
    const map = new Map<string, QueueJobViewModel>();
    for (const job of jobs) {
      map.set(job.jobId, job);
    }
    return map;
  }, [jobs]);

  const runningJobByResource = useMemo(() => {
    const result = new Map<string, string>();
    const runningByResource = asRecord(snapshot?.runningByResource);
    for (const [poolId, resourcesValue] of Object.entries(runningByResource)) {
      const byResource = asRecord(resourcesValue);
      for (const [resourceId, jobIdValue] of Object.entries(byResource)) {
        const jobId = asOptionalString(jobIdValue) ?? '';
        if (!jobId) continue;
        result.set(makeResourceKey(poolId, resourceId), jobId);
      }
    }
    return result;
  }, [snapshot?.runningByResource]);

  const poolRows = useMemo(() => {
    const poolIds = new Set<string>([
      ...Object.keys(queueDepthByPool),
      ...Object.keys(runningJobsByPool),
      ...Object.keys(resourceStateCountsByPool),
      ...Object.keys(resourceAssignmentsByPool)
    ]);

    const maxQueue = Math.max(1, ...Object.values(queueDepthByPool).map((value) => asNumber(value, 0)));
    const maxRunning = Math.max(1, ...Object.values(runningJobsByPool).map((value) => asNumber(value, 0)));

    const rows = Array.from(poolIds).map((poolId) => {
      const queueDepth = asNumber(queueDepthByPool[poolId], 0);
      const runningCount = asNumber(runningJobsByPool[poolId], 0);
      const stateCounts = asRecord(resourceStateCountsByPool[poolId]);
      const ready = asNumber(stateCounts.ready, 0);
      const busy = asNumber(stateCounts.busy, 0);
      return {
        poolId,
        queueDepth,
        runningCount,
        queuePercent: toPercent(queueDepth, maxQueue),
        runningPercent: toPercent(runningCount, maxRunning),
        ready,
        busy,
        cooldown: asNumber(stateCounts.cooldown, 0),
        disabled: asNumber(stateCounts.disabled, 0),
        error: asNumber(stateCounts.error, 0),
        health: getPoolHealthStatus(queueDepth, runningCount, ready, busy)
      };
    });

    return rows.sort((a, b) => {
      if (a.runningCount !== b.runningCount) return b.runningCount - a.runningCount;
      if (a.queueDepth !== b.queueDepth) return b.queueDepth - a.queueDepth;
      return a.poolId.localeCompare(b.poolId);
    });
  }, [queueDepthByPool, runningJobsByPool, resourceAssignmentsByPool, resourceStateCountsByPool]);

  const sortedResources = useMemo<QueueResourceViewModel[]>(() => {
    const nowMs = Date.now();
    const rows: QueueResourceViewModel[] = [];
    for (const resource of resourcesRaw) {
      const poolId = asOptionalString(resource.poolId) ?? '-';
      const resourceId = asOptionalString(resource.resourceId) ?? '-';
      const key = makeResourceKey(poolId, resourceId);
      const runningJobId = runningJobByResource.get(key) ?? '';
      const runningJob = runningJobId ? jobByIdMap.get(runningJobId) : undefined;

      rows.push({
        key,
        poolId,
        resourceId,
        displayName: resourceDisplayNameMap.get(key) ?? resourceId,
        state: asOptionalString(resource.state) ?? '-',
        inFlight: asNumber(resource.inFlight, 0),
        maxConcurrency: asNumber(resource.maxConcurrency, 0),
        assignedServiceId: asOptionalString(resource.assignedServiceId) ?? '-',
        runningJobId,
        runningTask: runningJob?.task ?? { primary: 'Rảnh', detail: '-' },
        runningState: runningJob?.state ?? '-',
        runningDurationMs:
          runningJob && runningJob.startedAt > 0 ? Math.max(0, nowMs - runningJob.startedAt) : null
      });
    }

    return rows.sort((a, b) => {
      if (a.poolId !== b.poolId) return a.poolId.localeCompare(b.poolId);
      const rankDiff = getResourceSortRank(a.state) - getResourceSortRank(b.state);
      if (rankDiff !== 0) return rankDiff;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [jobByIdMap, resourceDisplayNameMap, resourcesRaw, runningJobByResource]);

  const timelineRows = useMemo<QueueTimelineViewModel[]>(() => {
    return events.map((record) => {
      const event = asRecord(record.event);
      const jobId = asOptionalString(event.jobId) ?? '-';
      const poolId = asOptionalString(event.poolId) ?? '-';
      const serviceId = asOptionalString(event.serviceId) ?? '-';
      const resourceId = asOptionalString(event.resourceId) ?? '-';
      const resourceKey = resourceId !== '-' ? makeResourceKey(poolId, resourceId) : '';
      const accountDisplayName =
        resourceKey && resourceDisplayNameMap.has(resourceKey)
          ? (resourceDisplayNameMap.get(resourceKey) as string)
          : resourceId === '-'
            ? 'Không có account'
            : resourceId;
      const eventType = asString(event.type);
      const relatedJob = jobByIdMap.get(jobId);
      const task = relatedJob ? relatedJob.task : formatTaskLabel(event.feature, event.jobType);

      return {
        key: `${record.seq}`,
        seq: asNumber(record.seq, 0),
        timestamp: asNumber(record.timestamp, 0),
        eventLabel: formatQueueEventLabel(eventType),
        eventType,
        jobId,
        poolId,
        serviceId,
        resourceId,
        accountDisplayName,
        task,
        contextSearch: `${jobId} ${accountDisplayName} ${resourceId} ${task.primary} ${task.detail} ${poolId} ${serviceId}`.toLowerCase()
      };
    });
  }, [events, jobByIdMap, resourceDisplayNameMap]);

  const filteredEvents = useMemo(() => {
    return timelineRows.filter((item) => {
      if (
        timelineTypeFilter &&
        !item.eventType.toLowerCase().includes(timelineTypeFilter.toLowerCase()) &&
        !item.eventLabel.toLowerCase().includes(timelineTypeFilter.toLowerCase())
      ) {
        return false;
      }
      if (timelineContextFilter && !item.contextSearch.includes(timelineContextFilter.toLowerCase())) {
        return false;
      }
      if (
        timelineScopeFilter &&
        !`${item.poolId} ${item.serviceId}`.toLowerCase().includes(timelineScopeFilter.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [timelineContextFilter, timelineRows, timelineScopeFilter, timelineTypeFilter]);

  const handleToggleStream = () => {
    setIsPaused((prev) => !prev);
  };

  const kpiCards = [
    { label: 'Queued', value: asNumber(scheduler.totalQueued, 0), icon: ListOrdered, tone: styles.toneQueued },
    { label: 'Running', value: asNumber(scheduler.totalRunning, 0), icon: Activity, tone: styles.toneRunning },
    { label: 'Oldest Queued', value: formatDuration(scheduler.oldestQueuedMs), icon: Clock3, tone: styles.toneRetry },
    { label: 'Next Wake', value: formatTimestamp(scheduler.nextWakeAt), icon: Clock3, tone: styles.toneCooldown },
    { label: 'History', value: asNumber(snapshot?.historySize, 0), icon: ListOrdered, tone: styles.toneNeutral },
    { label: 'Dropped', value: asNumber(snapshot?.droppedHistoryCount, 0), icon: Server, tone: styles.toneError }
  ];

  return (
    <div className={sharedStyles.detailContainer}>
      <div className={sharedStyles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.headerInfo}>
          <div className={sharedStyles.detailTitle}>Queue Monitor</div>
          <div className={styles.headerSubTitle}>
            Màn hình vận hành realtime cho queue, resource assignment và timeline event.
          </div>
        </div>
      </div>

      <div className={styles.monitorContent}>
        {!status?.enabled && (
          <div className={styles.noticeWarning}>
            Rotation Queue Inspector đang tắt. Bật
            <code> ENABLE_ROTATION_QUEUE_INSPECTOR=1 </code>
            và khởi động lại app để theo dõi realtime.
          </div>
        )}

        <div className={styles.monitorShell}>
          <div className={styles.monitorControlBar}>
            <div className={styles.controlCluster}>
              <label className={styles.fieldLabel}>Runtime</label>
              <select
                className={styles.runtimeSelect}
                value={selectedRuntimeKey}
                onChange={(e) => setSelectedRuntimeKey(e.target.value)}
              >
                {runtimeInfos.map((runtime) => (
                  <option key={runtime.key} value={runtime.key}>
                    {runtime.key}
                  </option>
                ))}
              </select>
              <span className={`${styles.statusPill} ${status?.enabled ? styles.statusEnabled : styles.statusDisabled}`}>
                {status?.enabled ? 'Inspector Enabled' : 'Inspector Disabled'}
              </span>
            </div>

            <div className={styles.controlCluster}>
              <span className={`${styles.statusPill} ${isStreaming ? styles.statusStreaming : styles.statusPaused}`}>
                {isStreaming ? 'Streaming' : 'Paused'}
              </span>
              <Button variant="secondary" onClick={handleToggleStream} disabled={!status?.enabled}>
                {isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
            </div>

            <div className={styles.controlCluster}>
              <Button variant="secondary" onClick={refreshNow} disabled={isLoading}>
                <RefreshCw size={16} className={isLoading ? styles.spin : ''} />
                Refresh
              </Button>
              <Button variant="danger" onClick={clearHistory} disabled={!status?.enabled}>
                <Trash2 size={16} />
                Clear History
              </Button>
            </div>
          </div>

          {(errorMessage || isLoading) && (
            <div className={styles.inlineStatusBar}>
              {isLoading && <span className={styles.loadingText}>Đang đồng bộ snapshot...</span>}
              {errorMessage && <span className={styles.errorText}>{errorMessage}</span>}
            </div>
          )}

          <div className={styles.monitorWorkspace}>
            <aside className={`${styles.pane} ${styles.leftPane}`}>
              <div className={styles.paneHeader}>
                <h3>Runtime & Filters</h3>
              </div>
              <div className={styles.paneBody}>
                <div className={styles.cardBlock}>
                  <div className={styles.cardTitle}>Runtime Load</div>
                  <div className={styles.runtimeList}>
                    {runtimeInfos.map((runtime) => {
                      const queued = asNumber(runtime.jobCounts?.queued, 0);
                      const running = asNumber(runtime.jobCounts?.running, 0);
                      const isActive = runtime.key === selectedRuntimeKey;
                      return (
                        <button
                          key={runtime.key}
                          type="button"
                          className={`${styles.runtimeItem} ${isActive ? styles.runtimeItemActive : ''}`}
                          onClick={() => setSelectedRuntimeKey(runtime.key)}
                        >
                          <span className={styles.runtimeKey}>{runtime.key}</span>
                          <span className={styles.runtimeMeta}>Q {queued} | R {running}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.cardBlock}>
                  <div className={styles.cardTitle}>Snapshot Filters</div>
                  <div className={styles.filterStack}>
                    <Input
                      label="poolId"
                      value={asString(viewOptions.poolId, '')}
                      onChange={(e) => setViewOptions((prev) => ({ ...prev, poolId: e.target.value || undefined }))}
                      placeholder="story-geminiweb-accounts"
                    />
                    <Input
                      label="serviceId"
                      value={asString(viewOptions.serviceId, '')}
                      onChange={(e) => setViewOptions((prev) => ({ ...prev, serviceId: e.target.value || undefined }))}
                      placeholder="story-translator-ui"
                    />
                    <Input
                      label="feature"
                      value={asString(viewOptions.feature, '')}
                      onChange={(e) => setViewOptions((prev) => ({ ...prev, feature: e.target.value || undefined }))}
                      placeholder="story.translate.geminiWeb"
                    />
                    <div className={styles.inlineFieldRow}>
                      <div className={styles.inlineField}>
                        <label className={styles.fieldLabel}>State</label>
                        <select
                          className={styles.runtimeSelect}
                          value={normalizeState(viewOptions.state)}
                          onChange={(e) =>
                            setViewOptions((prev) => ({
                              ...prev,
                              state: normalizeState(e.target.value)
                            }))
                          }
                        >
                          <option value="all">all</option>
                          <option value="queued">queued</option>
                          <option value="retry_wait">retry_wait</option>
                          <option value="running">running</option>
                        </select>
                      </div>
                      <div className={styles.inlineField}>
                        <Input
                          label="Limit"
                          value={String(asNumber(viewOptions.limit, 200))}
                          type="number"
                          min={1}
                          max={1000}
                          onChange={(e) =>
                            setViewOptions((prev) => ({ ...prev, limit: Math.max(1, Number(e.target.value || 200)) }))
                          }
                        />
                      </div>
                    </div>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={viewOptions.includePayload === true}
                        disabled={!status?.payloadDebugEnabled}
                        onChange={(e) =>
                          setViewOptions((prev) => ({
                            ...prev,
                            includePayload: e.target.checked
                          }))
                        }
                      />
                      <span>
                        Include payload raw
                        {!status?.payloadDebugEnabled && ' (debug mode off)'}
                      </span>
                    </label>
                    <Button variant="primary" onClick={applyFilters}>
                      Apply Filters
                    </Button>
                  </div>
                </div>
              </div>
            </aside>

            <section className={`${styles.pane} ${styles.centerPane}`}>
              <div className={styles.paneHeader}>
                <h3>Live State Board</h3>
              </div>
              <div className={styles.paneBody}>
                <div className={styles.kpiGrid}>
                  {kpiCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <div key={card.label} className={styles.kpiCard}>
                        <div className={styles.kpiHead}>
                          <span>{card.label}</span>
                          <Icon size={14} className={card.tone} />
                        </div>
                        <div className={styles.kpiValue}>{card.value}</div>
                      </div>
                    );
                  })}
                </div>

                <div className={styles.cardBlock}>
                  <div className={styles.cardTitle}>Pool Lanes</div>
                  <div className={styles.poolList}>
                    {poolRows.map((pool) => (
                      <div key={pool.poolId} className={styles.poolCard}>
                        <div className={styles.poolHead}>
                          <span className={styles.poolName}>{pool.poolId}</span>
                          <div className={styles.poolHeadRight}>
                            <span className={styles.poolStats}>Q {pool.queueDepth} | R {pool.runningCount}</span>
                            <span className={`${styles.stateChip} ${styles.poolHealthBadge} ${pool.health.toneClass}`}>
                              {pool.health.label}
                            </span>
                          </div>
                        </div>
                        <div className={styles.metricRow}>
                          <span>Queue depth</span>
                          <div className={styles.metricBar}>
                            <div
                              className={`${styles.metricFill} ${styles.metricQueue}`}
                              style={{ width: `${pool.queuePercent}%` }}
                            />
                          </div>
                        </div>
                        <div className={styles.metricRow}>
                          <span>Running jobs</span>
                          <div className={styles.metricBar}>
                            <div
                              className={`${styles.metricFill} ${styles.metricRunning}`}
                              style={{ width: `${pool.runningPercent}%` }}
                            />
                          </div>
                        </div>
                        <div className={styles.stateChipRow}>
                          <span className={`${styles.stateChip} ${styles.toneSuccess}`}>ready {pool.ready}</span>
                          <span className={`${styles.stateChip} ${styles.toneRunning}`}>busy {pool.busy}</span>
                          <span className={`${styles.stateChip} ${styles.toneCooldown}`}>cooldown {pool.cooldown}</span>
                          <span className={`${styles.stateChip} ${styles.toneDisabled}`}>disabled {pool.disabled}</span>
                          <span className={`${styles.stateChip} ${styles.toneError}`}>error {pool.error}</span>
                        </div>
                      </div>
                    ))}
                    {poolRows.length === 0 && <div className={styles.emptyState}>Không có dữ liệu pool.</div>}
                  </div>
                </div>

                <div className={styles.cardBlock}>
                  <div className={styles.cardTitle}>Resource Matrix</div>
                  <div className={styles.resourceGrid}>
                    {sortedResources.map((resource) => {
                      return (
                        <div key={resource.key} className={styles.resourceCard}>
                          <div className={styles.resourceHead}>
                            <div>
                              <div className={styles.resourceName} title={resource.displayName}>
                                {resource.displayName}
                              </div>
                              <div className={styles.resourceDebugId} title={resource.resourceId}>
                                {resource.resourceId}
                              </div>
                            </div>
                            <span className={`${styles.stateChip} ${getResourceStateClass(resource.state)}`}>
                              {resource.state}
                            </span>
                          </div>
                          <div className={styles.resourceMeta}>pool: {resource.poolId}</div>
                          <div className={styles.resourceMeta}>
                            inFlight: {resource.inFlight}/{resource.maxConcurrency}
                          </div>
                          <div className={styles.resourceMeta} title={resource.assignedServiceId}>
                            service: {resource.assignedServiceId}
                          </div>
                          <div className={styles.resourceTaskBlock}>
                            <div className={styles.resourceTaskPrimary} title={resource.runningTask.primary}>
                              {resource.runningTask.primary}
                            </div>
                            <div className={styles.resourceTaskSecondary} title={resource.runningTask.detail}>
                              {resource.runningTask.detail}
                            </div>
                            {resource.runningJobId ? (
                              <div className={styles.resourceTaskSecondary}>
                                job: {resource.runningJobId} | state: {resource.runningState} | chạy:{' '}
                                {formatDuration(resource.runningDurationMs)}
                              </div>
                            ) : (
                              <div className={styles.resourceTaskSecondary}>job: - | state: rảnh</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {sortedResources.length === 0 && (
                      <div className={styles.emptyState}>Không có resource runtime trong snapshot.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className={`${styles.pane} ${styles.rightPane}`}>
              <div className={styles.paneHeader}>
                <h3>Jobs & Timeline</h3>
                <div className={styles.tabSwitch}>
                  <button
                    type="button"
                    className={`${styles.tabButton} ${sideTab === 'jobs' ? styles.tabButtonActive : ''}`}
                    onClick={() => setSideTab('jobs')}
                  >
                    Jobs
                  </button>
                  <button
                    type="button"
                    className={`${styles.tabButton} ${sideTab === 'timeline' ? styles.tabButtonActive : ''}`}
                    onClick={() => setSideTab('timeline')}
                  >
                    Timeline
                  </button>
                </div>
              </div>

              <div className={styles.paneBody}>
                {sideTab === 'jobs' ? (
                  <>
                    <div className={styles.jobsToolbar}>
                      {(['all', 'running', 'queued', 'retry_wait'] as JobStateFilter[]).map((state) => (
                        <button
                          key={state}
                          type="button"
                          className={`${styles.filterChip} ${jobStateFilter === state ? styles.filterChipActive : ''}`}
                          onClick={() => setJobStateFilter(state)}
                        >
                          {state}
                        </button>
                      ))}
                      <span className={styles.jobsCount}>{filteredJobs.length} jobs</span>
                    </div>

                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>jobId</th>
                            <th>state</th>
                            <th>pool/service</th>
                            <th>nhiệm vụ</th>
                            <th>account</th>
                            <th>attempt</th>
                            <th>queued/start</th>
                            <th>payload</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredJobs.map((job) => {
                            return (
                              <tr key={job.key}>
                                <td className={styles.monoCell}>{job.jobId}</td>
                                <td>
                                  <span className={`${styles.stateChip} ${getToneClass(job.state)}`}>
                                    {job.state}
                                  </span>
                                </td>
                                <td>
                                  <div>{job.poolId}</div>
                                  <div className={styles.subCell}>{job.serviceId}</div>
                                </td>
                                <td>
                                  <div className={styles.taskPrimary}>{job.task.primary}</div>
                                  <div className={styles.subCell}>{job.task.detail}</div>
                                </td>
                                <td title={job.assignedResourceId || 'pending'}>
                                  <div className={styles.accountName}>{job.accountDisplayName}</div>
                                  <div className={styles.accountIdDebug}>{job.assignedResourceId || '-'}</div>
                                </td>
                                <td>
                                  {job.attempt}/{job.maxAttempts}
                                </td>
                                <td className={styles.subCell}>
                                  <div>{formatTimestamp(job.queuedAt)}</div>
                                  <div>{formatTimestamp(job.startedAt)}</div>
                                </td>
                                <td className={styles.payloadCell} title={job.payloadSummary}>
                                  {job.payloadSummary}
                                </td>
                              </tr>
                            );
                          })}
                          {filteredJobs.length === 0 && (
                            <tr>
                              <td colSpan={8} className={styles.emptyCell}>
                                Không có job phù hợp bộ lọc.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.timelineFilters}>
                      <Input
                        placeholder="Filter event type"
                        value={timelineTypeFilter}
                        onChange={(e) => setTimelineTypeFilter(e.target.value)}
                      />
                      <Input
                        placeholder="Filter job/account/task"
                        value={timelineContextFilter}
                        onChange={(e) => setTimelineContextFilter(e.target.value)}
                      />
                      <Input
                        placeholder="Filter pool/service"
                        value={timelineScopeFilter}
                        onChange={(e) => setTimelineScopeFilter(e.target.value)}
                      />
                    </div>

                    <div className={styles.timelineFeed}>
                      {filteredEvents.map((item) => {
                        return (
                          <article key={item.key} className={styles.timelineItem}>
                            <div className={styles.timelineHead}>
                              <span className={styles.timelineSeq}>#{item.seq}</span>
                              <span className={styles.timelineTime}>{formatTimestamp(item.timestamp)}</span>
                            </div>
                            <div className={styles.timelineBody}>
                              <span className={`${styles.stateChip} ${getToneClass(item.eventType)}`}>
                                {item.eventLabel}
                              </span>
                              <span title={item.task.detail}>task: {item.task.primary}</span>
                              <span title={item.resourceId}>account: {item.accountDisplayName}</span>
                              <span>job: {item.jobId}</span>
                              <span>pool: {item.poolId}</span>
                              <span>service: {item.serviceId}</span>
                            </div>
                          </article>
                        );
                      })}
                      {filteredEvents.length === 0 && (
                        <div className={styles.emptyState}>Không có event phù hợp bộ lọc.</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
