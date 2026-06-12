import { useEffect, useMemo } from 'react';
import type { FitAudioAuditResponse, FitAudioAuditRow } from '@shared/types/caption';
import styles from './FitAudioAuditPopup.module.css';

const MAX_RENDER_TOP_FASTEST = 200;

type FitAudioAuditPopupProps = {
  visible: boolean;
  busy: boolean;
  data: FitAudioAuditResponse | null;
  error?: string;
  onClose: () => void;
  onRefresh: () => void;
};

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  return `${Math.round(ms)}ms`;
}

function formatRatio(value: number, digits = 2): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return `${value.toFixed(digits)}x`;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatPercent(value: unknown, digits = 2): string {
  return toSafeNumber(value).toFixed(digits);
}

function shortenMiddle(value: string, maxLength = 68): string {
  const safe = String(value || '');
  if (safe.length <= maxLength) return safe;
  const head = Math.max(8, Math.floor((maxLength - 3) / 2));
  const tail = Math.max(8, maxLength - 3 - head);
  return `${safe.slice(0, head)}...${safe.slice(-tail)}`;
}

function renderStatusBadge(row: FitAudioAuditRow) {
  if (row.error) {
    return <span className={`${styles.badge} ${styles.badgeError}`}>Loi</span>;
  }
  if (row.isTooFast) {
    return <span className={`${styles.badge} ${styles.badgeWarn}`}>Nhanh</span>;
  }
  if (!row.withinAllowed) {
    return <span className={`${styles.badge} ${styles.badgeWarn}`}>Lech</span>;
  }
  return <span className={styles.badge}>OK</span>;
}

export function FitAudioAuditPopup(props: FitAudioAuditPopupProps) {
  useEffect(() => {
    if (!props.visible) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.busy) {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [props.busy, props.onClose, props.visible]);

  const topFastest = useMemo(() => {
    const list = Array.isArray(props.data?.topFastest) ? props.data?.topFastest : [];
    return list.slice(0, MAX_RENDER_TOP_FASTEST);
  }, [props.data?.topFastest]);
  const totalTopFastest = Array.isArray(props.data?.topFastest) ? props.data.topFastest.length : 0;

  if (!props.visible) {
    return null;
  }

  const summary = props.data?.summary;
  const totalChecked = toSafeNumber(summary?.totalItems, props.data?.rows?.length || 0);
  const hasRows = totalChecked > 0;

  return (
    <div className={styles.overlay} onClick={() => !props.busy && props.onClose()}>
      <div className={styles.card} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Audit audio fit (Step 6)</div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={props.onRefresh}
              disabled={props.busy}
            >
              {props.busy ? 'Dang quet...' : 'Quet lai'}
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={props.onClose}
              disabled={props.busy}
            >
              Dong
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {summary && (
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <div className={styles.summaryLabel}>Tong file valid</div>
                <div className={styles.summaryValue}>{toSafeNumber(summary.validItems)}/{toSafeNumber(summary.totalItems)}</div>
              </div>
              <div className={styles.summaryItem}>
                <div className={styles.summaryLabel}>Da fit</div>
                <div className={styles.summaryValue}>{toSafeNumber(summary.scaledCount)} ({formatPercent(summary.scaledPercent)}%)</div>
              </div>
              <div className={styles.summaryItem}>
                <div className={styles.summaryLabel}>Skipped</div>
                <div className={styles.summaryValue}>{toSafeNumber(summary.skippedCount)}</div>
              </div>
              <div className={styles.summaryItem}>
                <div className={styles.summaryLabel}>Qua nhanh</div>
                <div className={`${styles.summaryValue} ${toSafeNumber(summary.tooFastCount) > 0 ? styles.summaryValueError : ''}`}>
                  {toSafeNumber(summary.tooFastCount)} ({formatPercent(summary.tooFastPercent)}%)
                </div>
              </div>
              <div className={styles.summaryItem}>
                <div className={styles.summaryLabel}>Trong nguong allowed</div>
                <div className={`${styles.summaryValue} ${toSafeNumber(summary.withinAllowedPercent) < 90 ? styles.summaryValueWarn : ''}`}>
                  {toSafeNumber(summary.withinAllowedCount)} ({formatPercent(summary.withinAllowedPercent)}%)
                </div>
              </div>
              <div className={styles.summaryItem}>
                <div className={styles.summaryLabel}>Toc do fit min/avg/max</div>
                <div className={styles.summaryValue}>
                  {formatRatio(summary.minSpeedRatio)} / {formatRatio(summary.avgSpeedRatio)} / {formatRatio(summary.maxSpeedRatio)}
                </div>
                <div className={styles.muted}>Canh bao tu {formatRatio(summary.speedWarningThreshold)}</div>
              </div>
            </div>
          )}

          {props.error && <div className={styles.error}>{props.error}</div>}

          <div className={styles.sectionTitle}>Top audio fit nhanh nhat</div>
          {totalTopFastest > topFastest.length && (
            <div className={styles.muted}>Dang hien thi {topFastest.length}/{totalTopFastest} file de tranh giat lag.</div>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Folder</th>
                  <th>File</th>
                  <th>Speed</th>
                  <th>Output/Allowed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {topFastest.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.muted}>Khong co file fit de hien thi.</td>
                  </tr>
                )}
                {topFastest.map((row, index) => (
                  <tr key={`${row.originalPath}__${row.outputPath}__${index}`}>
                    <td>{index + 1}</td>
                    <td>{row.folderLabel || '--'}</td>
                    <td className={styles.pathCell} title={row.outputPath}>{shortenMiddle(row.outputPath)}</td>
                    <td title={`Goc ${formatMs(row.originalDurationMs)} -> Moi ${formatMs(row.outputDurationMs)}`}>
                      {formatRatio(row.speedRatio)}
                    </td>
                    <td>{formatRatio(row.outputVsAllowedRatio)}</td>
                    <td>{renderStatusBadge(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.muted}>
            {hasRows
              ? `Tong ${totalChecked} file duoc kiem tra.`
              : 'Chua co du lieu fit audio de audit.'}
          </div>
          <div className={styles.footerActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={props.onClose}
              disabled={props.busy}
            >
              Dong
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
