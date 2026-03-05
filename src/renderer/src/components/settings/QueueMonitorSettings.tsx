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
  if (normalized.includes('running') || normalized.includes('busy')) return styles.toneRunning;
  if (normalized.includes('queued')) return styles.toneQueued;
  if (normalized.includes('retry')) return styles.toneRetry;
  if (normalized.includes('ready') || normalized.includes('succeed') || normalized.includes('info')) {
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
  const [timelineJobFilter, setTimelineJobFilter] = useState('');
  const [timelineResourceFilter, setTimelineResourceFilter] = useState('');
  const [sideTab, setSideTab] = useState<SideTab>('jobs');
  const [jobStateFilter, setJobStateFilter] = useState<JobStateFilter>('all');

  const scheduler = asRecord(snapshot?.scheduler);
  const queueDepthByPool = asRecord(scheduler.queueDepthByPool);
  const runningJobsByPool = asRecord(scheduler.runningJobsByPool);
  const resourceStateCountsByPool = asRecord(scheduler.resourceStateCountsByPool);
  const resourceAssignmentsByPool = asRecord(scheduler.resourceAssignmentsByPool);
  const resources = asArray(scheduler.resources).map((item) => asRecord(item));

  const jobs = asArray(snapshot?.jobs).map((item) => asRecord(item));

  const filteredEvents = useMemo(() => {
    return events.filter((record) => {
      const event = asRecord(record.event);
      const type = asString(event.type, '');
      const jobId = asString(event.jobId, '');
      const resourceId = asString(event.resourceId, '');

      if (timelineTypeFilter && !type.toLowerCase().includes(timelineTypeFilter.toLowerCase())) {
        return false;
      }
      if (timelineJobFilter && !jobId.toLowerCase().includes(timelineJobFilter.toLowerCase())) {
        return false;
      }
      if (timelineResourceFilter && !resourceId.toLowerCase().includes(timelineResourceFilter.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [events, timelineJobFilter, timelineResourceFilter, timelineTypeFilter]);

  const filteredJobs = useMemo(() => {
    if (jobStateFilter === 'all') return jobs;
    return jobs.filter((job) => normalizeState(job.state) === jobStateFilter);
  }, [jobStateFilter, jobs]);

  const poolRows = useMemo(() => {
    const poolIds = new Set<string>([
      ...Object.keys(queueDepthByPool),
      ...Object.keys(runningJobsByPool),
      ...Object.keys(resourceStateCountsByPool),
      ...Object.keys(resourceAssignmentsByPool)
    ]);

    const maxQueue = Math.max(1, ...Object.values(queueDepthByPool).map((value) => asNumber(value, 0)));
    const maxRunning = Math.max(1, ...Object.values(runningJobsByPool).map((value) => asNumber(value, 0)));

    return Array.from(poolIds).map((poolId) => {
      const queueDepth = asNumber(queueDepthByPool[poolId], 0);
      const runningCount = asNumber(runningJobsByPool[poolId], 0);
      const stateCounts = asRecord(resourceStateCountsByPool[poolId]);
      return {
        poolId,
        queueDepth,
        runningCount,
        queuePercent: toPercent(queueDepth, maxQueue),
        runningPercent: toPercent(runningCount, maxRunning),
        ready: asNumber(stateCounts.ready, 0),
        busy: asNumber(stateCounts.busy, 0),
        cooldown: asNumber(stateCounts.cooldown, 0),
        disabled: asNumber(stateCounts.disabled, 0),
        error: asNumber(stateCounts.error, 0)
      };
    });
  }, [queueDepthByPool, runningJobsByPool, resourceAssignmentsByPool, resourceStateCountsByPool]);

  const sortedResources = useMemo(() => {
    return [...resources].sort((a, b) => {
      const poolA = asString(a.poolId, '');
      const poolB = asString(b.poolId, '');
      if (poolA !== poolB) return poolA.localeCompare(poolB);
      return asString(a.resourceId, '').localeCompare(asString(b.resourceId, ''));
    });
  }, [resources]);

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
                          <span className={styles.poolStats}>Q {pool.queueDepth} | R {pool.runningCount}</span>
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
                      const poolId = asString(resource.poolId);
                      const resourceId = asString(resource.resourceId);
                      const state = asString(resource.state);
                      const inFlight = asNumber(resource.inFlight, 0);
                      const maxConcurrency = asNumber(resource.maxConcurrency, 0);
                      const assignedServiceId = asString(resource.assignedServiceId, '-');
                      const runningByPool = asRecord(snapshot?.runningByResource?.[poolId] ?? {});
                      const runningJobId = asString(runningByPool[resourceId], '-');

                      return (
                        <div key={`${poolId}-${resourceId}`} className={styles.resourceCard}>
                          <div className={styles.resourceHead}>
                            <div className={styles.resourceId}>{resourceId}</div>
                            <span className={`${styles.stateChip} ${getResourceStateClass(state)}`}>{state}</span>
                          </div>
                          <div className={styles.resourceMeta}>pool: {poolId}</div>
                          <div className={styles.resourceMeta}>inFlight: {inFlight}/{maxConcurrency}</div>
                          <div className={styles.resourceMeta} title={assignedServiceId}>
                            service: {assignedServiceId}
                          </div>
                          <div className={styles.resourceMeta} title={runningJobId}>
                            job: {runningJobId}
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
                            <th>feature/type</th>
                            <th>resource</th>
                            <th>attempt</th>
                            <th>queued/start</th>
                            <th>payload</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredJobs.map((job, index) => {
                            const state = asString(job.state);
                            return (
                              <tr key={asString(job.jobId, `job-${index}`)}>
                                <td className={styles.monoCell}>{asString(job.jobId)}</td>
                                <td>
                                  <span className={`${styles.stateChip} ${getToneClass(state)}`}>{state}</span>
                                </td>
                                <td>
                                  <div>{asString(job.poolId)}</div>
                                  <div className={styles.subCell}>{asString(job.serviceId)}</div>
                                </td>
                                <td>
                                  <div>{asString(job.feature)}</div>
                                  <div className={styles.subCell}>{asString(job.jobType)}</div>
                                </td>
                                <td>{asString(job.assignedResourceId)}</td>
                                <td>
                                  {asNumber(job.attempt, 0)}/{asNumber(job.maxAttempts, 0)}
                                </td>
                                <td className={styles.subCell}>
                                  <div>{formatTimestamp(job.queuedAt)}</div>
                                  <div>{formatTimestamp(job.startedAt)}</div>
                                </td>
                                <td className={styles.payloadCell} title={asString(asRecord(job.payloadPreview).summary)}>
                                  {asString(asRecord(job.payloadPreview).summary)}
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
                        placeholder="Filter jobId"
                        value={timelineJobFilter}
                        onChange={(e) => setTimelineJobFilter(e.target.value)}
                      />
                      <Input
                        placeholder="Filter resourceId"
                        value={timelineResourceFilter}
                        onChange={(e) => setTimelineResourceFilter(e.target.value)}
                      />
                    </div>

                    <div className={styles.timelineFeed}>
                      {filteredEvents.map((record) => {
                        const event = asRecord(record.event);
                        const eventType = asString(event.type);
                        return (
                          <article key={record.seq} className={styles.timelineItem}>
                            <div className={styles.timelineHead}>
                              <span className={styles.timelineSeq}>#{record.seq}</span>
                              <span className={styles.timelineTime}>{formatTimestamp(record.timestamp)}</span>
                            </div>
                            <div className={styles.timelineBody}>
                              <span className={`${styles.stateChip} ${getToneClass(eventType)}`}>{eventType}</span>
                              <span>job: {asString(event.jobId)}</span>
                              <span>resource: {asString(event.resourceId)}</span>
                              <span>pool: {asString(event.poolId)}</span>
                              <span>service: {asString(event.serviceId)}</span>
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
