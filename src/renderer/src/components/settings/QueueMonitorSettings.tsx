import { useMemo, useState } from 'react';
import { ArrowLeft, PauseCircle, PlayCircle, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';
import { SettingsDetailProps } from './types';
import { useQueueMonitor } from './hooks/useQueueMonitor';

type UnknownRecord = Record<string, unknown>;

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

function normalizeState(value: unknown): string {
  const text = asString(value, '').toLowerCase();
  if (text === 'queued' || text === 'retry_wait' || text === 'running' || text === 'all') {
    return text;
  }
  return 'all';
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

  const scheduler = asRecord(snapshot?.scheduler);
  const queueDepthByPool = asRecord(scheduler.queueDepthByPool);
  const runningJobsByPool = asRecord(scheduler.runningJobsByPool);
  const resourceStateCountsByPool = asRecord(scheduler.resourceStateCountsByPool);
  const resourceAssignmentsByPool = asRecord(scheduler.resourceAssignmentsByPool);
  const resources = asArray(scheduler.resources).map((item) => asRecord(item));

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
      if (
        timelineResourceFilter &&
        !resourceId.toLowerCase().includes(timelineResourceFilter.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [events, timelineJobFilter, timelineResourceFilter, timelineTypeFilter]);

  const jobs = asArray(snapshot?.jobs).map((item) => asRecord(item));

  const handleToggleStream = () => {
    setIsPaused((prev) => !prev);
  };

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1">
          <div className={styles.detailTitle}>Queue Monitor</div>
          <div className="text-xs text-(--color-text-secondary) mt-1">
            Theo dõi hàng đợi, account/resource assignment và timeline event theo runtime.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-1 rounded-full border ${
              status?.enabled
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-orange-50 text-orange-700 border-orange-200'
            }`}
          >
            {status?.enabled ? 'Inspector Enabled' : 'Inspector Disabled'}
          </span>
          <span
            className={`text-xs px-2 py-1 rounded-full border ${
              isStreaming ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200'
            }`}
          >
            {isStreaming ? 'Streaming' : 'Paused'}
          </span>
          <Button variant="secondary" onClick={handleToggleStream} disabled={!status?.enabled}>
            {isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="secondary" onClick={refreshNow} disabled={isLoading}>
            <RefreshCw size={16} />
            Refresh
          </Button>
          <Button variant="danger" onClick={clearHistory} disabled={!status?.enabled}>
            <Trash2 size={16} />
            Clear History
          </Button>
        </div>
      </div>

      <div className={styles.detailContent}>
        {!status?.enabled && (
          <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm">
            Rotation Queue Inspector đang tắt. Bật biến môi trường
            <code className="mx-1">ENABLE_ROTATION_QUEUE_INSPECTOR=1</code>
            rồi khởi động lại app để theo dõi realtime.
          </div>
        )}

        {errorMessage && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
            {errorMessage}
          </div>
        )}

        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Runtime Key</span>
              <span className={styles.labelDesc}>Chọn queue runtime cần theo dõi</span>
            </div>
            <select
              className={styles.select}
              value={selectedRuntimeKey}
              onChange={(e) => setSelectedRuntimeKey(e.target.value)}
            >
              {runtimeInfos.map((runtime) => (
                <option key={runtime.key} value={runtime.key}>
                  {runtime.key}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className="w-full flex gap-3 items-end">
              <Input
                label="poolId"
                value={asString(viewOptions.poolId, '')}
                onChange={(e) => setViewOptions((prev) => ({ ...prev, poolId: e.target.value || undefined }))}
                placeholder="story-geminiweb-accounts"
                containerClassName="flex-1"
              />
              <Input
                label="serviceId"
                value={asString(viewOptions.serviceId, '')}
                onChange={(e) => setViewOptions((prev) => ({ ...prev, serviceId: e.target.value || undefined }))}
                placeholder="story-translator-ui"
                containerClassName="flex-1"
              />
              <Input
                label="feature"
                value={asString(viewOptions.feature, '')}
                onChange={(e) => setViewOptions((prev) => ({ ...prev, feature: e.target.value || undefined }))}
                placeholder="story.translate.geminiWeb"
                containerClassName="flex-1"
              />
              <div className="min-w-[160px]">
                <label className={styles.labelText}>State</label>
                <select
                  className={styles.select}
                  value={normalizeState(viewOptions.state)}
                  onChange={(e) =>
                    setViewOptions((prev) => ({
                      ...prev,
                      state: normalizeState(e.target.value) as 'queued' | 'retry_wait' | 'running' | 'all'
                    }))
                  }
                >
                  <option value="all">all</option>
                  <option value="queued">queued</option>
                  <option value="retry_wait">retry_wait</option>
                  <option value="running">running</option>
                </select>
              </div>
              <div className="w-[120px]">
                <label className={styles.labelText}>Limit</label>
                <Input
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
          </div>

          <div className={styles.row}>
            <div className="flex items-center gap-4 w-full justify-between">
              <label className="flex items-center gap-2 text-sm">
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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 border rounded-lg bg-(--color-card)">
            <div className="text-xs text-(--color-text-secondary)">Total Queued</div>
            <div className="text-xl font-bold">{asNumber(scheduler.totalQueued, 0)}</div>
          </div>
          <div className="p-3 border rounded-lg bg-(--color-card)">
            <div className="text-xs text-(--color-text-secondary)">Total Running</div>
            <div className="text-xl font-bold">{asNumber(scheduler.totalRunning, 0)}</div>
          </div>
          <div className="p-3 border rounded-lg bg-(--color-card)">
            <div className="text-xs text-(--color-text-secondary)">Oldest Queued</div>
            <div className="text-xl font-bold">{formatDuration(scheduler.oldestQueuedMs)}</div>
          </div>
          <div className="p-3 border rounded-lg bg-(--color-card)">
            <div className="text-xs text-(--color-text-secondary)">Next Wake</div>
            <div className="text-sm font-semibold">{formatTimestamp(scheduler.nextWakeAt)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className={styles.section}>
            <div className="p-3 border-b font-semibold">Queue Depth By Pool</div>
            <div className="p-3 text-sm space-y-2">
              {Object.entries(queueDepthByPool).map(([poolId, depth]) => (
                <div key={poolId} className="flex justify-between">
                  <span>{poolId}</span>
                  <span className="font-semibold">{asNumber(depth, 0)}</span>
                </div>
              ))}
              {Object.keys(queueDepthByPool).length === 0 && <div className="text-(--color-text-secondary)">Không có dữ liệu.</div>}
            </div>
          </div>
          <div className={styles.section}>
            <div className="p-3 border-b font-semibold">Running Jobs By Pool</div>
            <div className="p-3 text-sm space-y-2">
              {Object.entries(runningJobsByPool).map(([poolId, count]) => (
                <div key={poolId} className="flex justify-between">
                  <span>{poolId}</span>
                  <span className="font-semibold">{asNumber(count, 0)}</span>
                </div>
              ))}
              {Object.keys(runningJobsByPool).length === 0 && <div className="text-(--color-text-secondary)">Không có dữ liệu.</div>}
            </div>
          </div>
          <div className={styles.section}>
            <div className="p-3 border-b font-semibold">Resource State Counts</div>
            <div className="p-3 text-sm space-y-2">
              {Object.entries(resourceStateCountsByPool).map(([poolId, counts]) => {
                const countRecord = asRecord(counts);
                return (
                  <div key={poolId} className="border rounded p-2">
                    <div className="font-medium mb-1">{poolId}</div>
                    <div className="text-xs text-(--color-text-secondary)">
                      ready {asNumber(countRecord.ready, 0)} | busy {asNumber(countRecord.busy, 0)} |
                      cooldown {asNumber(countRecord.cooldown, 0)} | disabled {asNumber(countRecord.disabled, 0)} |
                      error {asNumber(countRecord.error, 0)}
                    </div>
                  </div>
                );
              })}
              {Object.keys(resourceStateCountsByPool).length === 0 && <div className="text-(--color-text-secondary)">Không có dữ liệu.</div>}
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className="p-3 border-b font-semibold">Running & Pending Jobs</div>
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-(--color-card)">
                <tr className="border-b">
                  <th className="text-left p-2">jobId</th>
                  <th className="text-left p-2">state</th>
                  <th className="text-left p-2">pool/service</th>
                  <th className="text-left p-2">feature/jobType</th>
                  <th className="text-left p-2">resource</th>
                  <th className="text-left p-2">attempt</th>
                  <th className="text-left p-2">queued/start</th>
                  <th className="text-left p-2">payload</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, index) => (
                  <tr key={asString(job.jobId, `job-${index}`)} className="border-b hover:bg-(--color-surface)">
                    <td className="p-2 font-mono text-xs">{asString(job.jobId)}</td>
                    <td className="p-2">{asString(job.state)}</td>
                    <td className="p-2">
                      <div>{asString(job.poolId)}</div>
                      <div className="text-xs text-(--color-text-secondary)">{asString(job.serviceId)}</div>
                    </td>
                    <td className="p-2">
                      <div>{asString(job.feature)}</div>
                      <div className="text-xs text-(--color-text-secondary)">{asString(job.jobType)}</div>
                    </td>
                    <td className="p-2">{asString(job.assignedResourceId)}</td>
                    <td className="p-2">
                      {asNumber(job.attempt, 0)}/{asNumber(job.maxAttempts, 0)}
                    </td>
                    <td className="p-2 text-xs">
                      <div>{formatTimestamp(job.queuedAt)}</div>
                      <div>{formatTimestamp(job.startedAt)}</div>
                    </td>
                    <td className="p-2 text-xs max-w-[280px] truncate">
                      {asString(asRecord(job.payloadPreview).summary)}
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-3 text-(--color-text-secondary)">
                      Không có job trong snapshot hiện tại.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className={styles.section}>
            <div className="p-3 border-b font-semibold">Resource Assignment</div>
            <div className="p-3 space-y-3 max-h-[320px] overflow-auto">
              {Object.entries(resourceAssignmentsByPool).map(([poolId, assignmentMap]) => {
                const assignmentRecord = asRecord(assignmentMap);
                const runningByResourceMap = asRecord(snapshot?.runningByResource?.[poolId] ?? {});
                return (
                  <div key={poolId} className="border rounded p-2">
                    <div className="font-medium mb-2">{poolId}</div>
                    <div className="space-y-1 text-xs">
                      {Object.entries(assignmentRecord).map(([resourceId, serviceId]) => {
                        const runtimeMeta = resources.find((resource) => asString(resource.resourceId) === resourceId);
                        const state = runtimeMeta ? asString(runtimeMeta.state) : '-';
                        const inFlight = runtimeMeta ? asNumber(runtimeMeta.inFlight) : 0;
                        const runningJobId = asString(runningByResourceMap[resourceId], '');
                        return (
                          <div key={resourceId} className="flex justify-between gap-2">
                            <span className="font-mono">{resourceId}</span>
                            <span>{asString(serviceId, 'unassigned')}</span>
                            <span>state:{state}</span>
                            <span>inFlight:{inFlight}</span>
                            <span>job:{runningJobId || '-'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {Object.keys(resourceAssignmentsByPool).length === 0 && (
                <div className="text-sm text-(--color-text-secondary)">Chưa có assignment data.</div>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <div className="p-3 border-b font-semibold">Event Timeline</div>
            <div className="p-3 border-b grid grid-cols-1 md:grid-cols-3 gap-2">
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
            <div className="p-3 space-y-2 max-h-[320px] overflow-auto text-xs">
              {filteredEvents.map((record) => {
                const event = asRecord(record.event);
                return (
                  <div key={record.seq} className="border rounded p-2 bg-(--color-card)">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold">#{record.seq}</span>
                      <span>{formatTimestamp(record.timestamp)}</span>
                    </div>
                    <div className="mt-1">
                      <span className="font-medium">{asString(event.type)}</span>
                      <span className="ml-2 text-(--color-text-secondary)">job {asString(event.jobId)}</span>
                      <span className="ml-2 text-(--color-text-secondary)">
                        resource {asString(event.resourceId)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {filteredEvents.length === 0 && (
                <div className="text-(--color-text-secondary)">Không có event phù hợp bộ lọc.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
