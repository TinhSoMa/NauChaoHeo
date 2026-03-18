import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import sharedStyles from './Settings.module.css';
import styles from './DebugLogsSettings.module.css';
import type { SettingsDetailProps } from './types';
import type { AppLogEntry, AppLogLevel, AppLogSource } from '@shared/types/appLogs';

const MAX_LOCAL_LOGS = 1500;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function getLevelClass(level: AppLogLevel): string {
  if (level === 'error') return styles.badgeError;
  if (level === 'warn') return styles.badgeWarn;
  return styles.badgeInfo;
}

export function DebugLogsSettings({ onBack }: SettingsDetailProps) {
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<AppLogLevel | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<AppLogSource | 'all'>('all');
  const [textFilter, setTextFilter] = useState('');
  const isMountedRef = useRef(true);

  const loadLogs = useCallback(async () => {
    const result = await window.electronAPI.appLogs.getLogs(500);
    if (!isMountedRef.current) return;
    if (result.success && result.data) {
      setLogs(result.data);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void loadLogs();
    const unsubscribe = window.electronAPI.appLogs.onLog((entry) => {
      setLogs((prev) => {
        const next = [entry, ...prev];
        if (next.length > MAX_LOCAL_LOGS) {
          next.length = MAX_LOCAL_LOGS;
        }
        return next;
      });
    });
    return () => {
      isMountedRef.current = false;
      unsubscribe?.();
    };
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const text = textFilter.trim().toLowerCase();
    return logs.filter((entry) => {
      if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
      if (text && !entry.message.toLowerCase().includes(text)) return false;
      return true;
    });
  }, [levelFilter, logs, sourceFilter, textFilter]);

  const handleClear = useCallback(async () => {
    const result = await window.electronAPI.appLogs.clearLogs();
    if (result.success) {
      setLogs([]);
    }
  }, []);

  return (
    <div className={sharedStyles.detailContainer}>
      <div className={sharedStyles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.headerInfo}>
          <div className={sharedStyles.detailTitle}>Debug Logs</div>
          <div className={styles.headerSubtitle}>
            Theo dõi log runtime từ main + renderer theo thời gian thực.
          </div>
        </div>
      </div>

      <div className={sharedStyles.detailContent}>
        <div className={styles.toolbar}>
          <div className={styles.filters}>
            <select
              className={styles.select}
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value as AppLogLevel | 'all')}
            >
              <option value="all">All levels</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
            <select
              className={styles.select}
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as AppLogSource | 'all')}
            >
              <option value="all">All sources</option>
              <option value="main">Main</option>
              <option value="renderer">Renderer</option>
            </select>
            <Input
              placeholder="Filter message"
              value={textFilter}
              onChange={(event) => setTextFilter(event.target.value)}
            />
          </div>
          <Button variant="danger" onClick={handleClear}>
            <Trash2 size={16} />
            Clear
          </Button>
        </div>

        <div className={styles.logPanel}>
          <div className={styles.logPanelHeader}>
            <div className={styles.logPanelTitle}>Console Stream</div>
            <div className={styles.logMeta}>{filteredLogs.length} entries</div>
          </div>
          <div className={styles.logPanelBody}>
            {filteredLogs.map((entry) => (
              <div key={entry.seq} className={styles.logRow}>
                <div className={styles.logMeta}>
                  <span className={`${styles.badge} ${getLevelClass(entry.level)}`}>{entry.level}</span>
                  <span className={styles.sourceChip}>{entry.source}</span>
                  <span className={styles.mono}>#{entry.seq}</span>
                  <span>{formatTime(entry.timestamp)}</span>
                </div>
                <div className={styles.message}>{entry.message}</div>
                {entry.meta?.stack && (
                  <div className={`${styles.message} ${styles.mono}`}>{String(entry.meta.stack)}</div>
                )}
              </div>
            ))}
            {filteredLogs.length === 0 && (
              <div className={styles.emptyState}>Không có log phù hợp bộ lọc.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
