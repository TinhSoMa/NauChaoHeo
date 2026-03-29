import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './CaptionRuntimeConsole.module.css';
import type { AppLogEntry, AppLogLevel } from '@shared/types/appLogs';

const MAX_LOGS = 600;
const CAPTION_LOG_MARKERS = [
  '[Caption',
  '[CaptionProcessing',
  '[TTS',
  '[AudioMerger',
  '[SrtParser',
  '[VideoRenderer',
  '[TextSplitter',
  '[Subtitle',
];

function isCaptionLog(message: string): boolean {
  return CAPTION_LOG_MARKERS.some((marker) => message.includes(marker));
}

function formatTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString('vi-VN', { hour12: false });
  } catch {
    return '--:--:--';
  }
}

function getLevelClass(level: AppLogLevel): string {
  if (level === 'error') return styles.levelError;
  if (level === 'warn') return styles.levelWarn;
  if (level === 'success') return styles.levelSuccess;
  return styles.levelInfo;
}

type CaptionRuntimeConsoleProps = {
  open: boolean;
  onClose: () => void;
};

export function CaptionRuntimeConsole({ open, onClose }: CaptionRuntimeConsoleProps) {
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let mounted = true;
    const loadLogs = async () => {
      try {
        const result = await window.electronAPI.appLogs.getLogs(MAX_LOGS);
        if (!mounted || !result?.success || !result.data) return;
        const filtered = result.data
          .filter((entry) => entry?.message && isCaptionLog(entry.message))
          .reverse();
        setLogs(filtered);
      } catch {
        // ignore load errors
      }
    };
    void loadLogs();

    const unsubscribe = window.electronAPI.appLogs.onLog((entry) => {
      if (!entry?.message || !isCaptionLog(entry.message)) {
        return;
      }
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
      });
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs.length]);

  const logCountLabel = useMemo(() => `${logs.length} dòng`, [logs.length]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Đóng console"
        onClick={onClose}
      />
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <div className={styles.title}>Console Caption</div>
          <div className={styles.meta}>
            <span className={styles.count}>{logCountLabel}</span>
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => setLogs([])}
            >
              Clear log
            </button>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>
        <div className={styles.list} ref={listRef}>
          {logs.length === 0 && (
            <div className={styles.empty}>Chưa có log caption.</div>
          )}
          {logs.map((entry) => (
            <div key={`caption-log-${entry.seq}`} className={styles.row}>
              <div className={styles.rowMeta}>
                <span className={styles.time}>{formatTime(entry.timestamp)}</span>
                <span className={`${styles.level} ${getLevelClass(entry.level)}`}>
                  {entry.level}
                </span>
                <span className={styles.source}>{entry.source}</span>
              </div>
              <pre className={styles.message}>{entry.message}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
