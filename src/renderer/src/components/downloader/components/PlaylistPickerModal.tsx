import React, { useMemo } from 'react';
import { ListOrdered, Loader2 } from 'lucide-react';
import type { PlaylistEntry } from '@shared/types/downloader';
import { Button } from '../../common/Button';
import styles from '../DownloaderPage.module.css';

type PlaylistPickerModalProps = {
  isOpen: boolean;
  title?: string;
  entries: PlaylistEntry[];
  selectedIndexes: number[];
  loading?: boolean;
  error?: string | null;
  metaLoading?: boolean;
  loadedCount?: number;
  totalCount?: number;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
  onToggleIndex: (index: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onApply: () => void;
  onClose: () => void;
};

function formatDurationShort(seconds?: number): string {
  if (!seconds || seconds <= 0) return '--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
  }
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

type DurationTone = 'short' | 'medium' | 'long' | 'xl' | 'unknown';

function getDurationTone(seconds?: number): DurationTone {
  if (!seconds || seconds <= 0) return 'unknown';
  const mins = seconds / 60;
  if (mins < 10) return 'short';
  if (mins < 30) return 'medium';
  if (mins < 60) return 'long';
  return 'xl';
}

export const PlaylistPickerModal: React.FC<PlaylistPickerModalProps> = ({
  isOpen,
  title,
  entries,
  selectedIndexes,
  loading = false,
  error,
  metaLoading = false,
  loadedCount = 0,
  totalCount = 0,
  canLoadMore = false,
  onLoadMore,
  onToggleIndex,
  onSelectAll,
  onClearAll,
  onApply,
  onClose,
}) => {
  const selectedSet = useMemo(() => new Set(selectedIndexes), [selectedIndexes]);
  const selectedCount = selectedSet.size;
  const totalEntries = totalCount || entries.length;
  const [lastClickedIndex, setLastClickedIndex] = React.useState<number | null>(null);
  const entryIndexes = useMemo(
    () => entries.map((entry: PlaylistEntry, idx: number) => entry.playlistIndex ?? (idx + 1)),
    [entries]
  );
  const durationClassMap: Record<DurationTone, string> = {
    short: styles.durationShort,
    medium: styles.durationMedium,
    long: styles.durationLong,
    xl: styles.durationXL,
    unknown: styles.durationUnknown,
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={`${styles.modalCard} ${styles.playlistModalCard}`}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <ListOrdered size={16} className={styles.iconWarning} />
            Chọn video trong playlist
          </div>
          <button onClick={onClose} className={styles.modalClose}>✕</button>
        </div>

        {(title || true) && (
          <div className={styles.playlistModalTitleRow}>
            {title && <div className={styles.playlistModalTitle}>{title}</div>}
            <div className={styles.playlistModalLegend}>
              <span className={`${styles.durationLegendItem} ${styles.durationShort}`}>
                <span className={styles.durationDot} /> &lt;10m
              </span>
              <span className={`${styles.durationLegendItem} ${styles.durationMedium}`}>
                <span className={styles.durationDot} /> 10–30m
              </span>
              <span className={`${styles.durationLegendItem} ${styles.durationLong}`}>
                <span className={styles.durationDot} /> 30–60m
              </span>
              <span className={`${styles.durationLegendItem} ${styles.durationXL}`}>
                <span className={styles.durationDot} /> &gt;60m
              </span>
            </div>
          </div>
        )}

        <div className={styles.playlistModalToolbar}>
          <div className={styles.playlistModalCount}>
            Đã chọn: {selectedCount}/{totalEntries || 0}
            {(metaLoading || canLoadMore) && (
              <span className={styles.playlistModalMetaStat}>
                Metadata: {loadedCount}/{totalEntries || 0}
              </span>
            )}
            {metaLoading && (
              <span className={styles.playlistModalLoadingInline}>
                <Loader2 size={12} className={styles.spin} /> Đang nạp...
              </span>
            )}
          </div>
          <div className={styles.playlistModalActions}>
            <Button variant="secondary" onClick={onSelectAll} disabled={loading || totalEntries === 0}>
              Chọn tất cả
            </Button>
            <Button variant="secondary" onClick={onClearAll} disabled={loading || totalEntries === 0}>
              Bỏ chọn tất cả
            </Button>
            {!metaLoading && canLoadMore && (
              <Button variant="secondary" onClick={onLoadMore} disabled={!onLoadMore}>
                Load more
              </Button>
            )}
          </div>
        </div>

        {loading && (
          <div className={styles.playlistModalLoading}>
            <Loader2 size={16} className={styles.spin} /> Đang tải danh sách...
          </div>
        )}
        {error && <div className={styles.errorText}>{error}</div>}

        {!loading && entries.length > 0 && (
          <div className={styles.playlistModalTable}>
            <div className={styles.playlistModalHeaderRow}>
              <div />
              <div>#</div>
              <div>Tiêu đề</div>
              <div>ID</div>
              <div>Thời lượng</div>
              <div>Uploader</div>
            </div>
            <div className={styles.playlistModalBody}>
              {entries.map((entry: PlaylistEntry, idx: number) => {
                const index = entry.playlistIndex ?? (idx + 1);
                const checked = selectedSet.has(index);
                const titleText = entry.title || entry.id || entry.url || 'item';
                return (
                  <div key={`${entry.id || entry.url || idx}`} className={styles.playlistModalRow}>
                    <input
                      type="checkbox"
                      className={styles.playlistModalCheckbox}
                      checked={checked}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        const isShift = Boolean((event.nativeEvent as MouseEvent).shiftKey);
                        const shouldSelect = !checked;
                        if (isShift && lastClickedIndex != null) {
                          const currentPos = entryIndexes.indexOf(index);
                          const lastPos = entryIndexes.indexOf(lastClickedIndex);
                          if (currentPos !== -1 && lastPos !== -1) {
                            const start = Math.min(currentPos, lastPos);
                            const end = Math.max(currentPos, lastPos);
                            const range = entryIndexes.slice(start, end + 1);
                            range.forEach((value) => {
                              const isSelected = selectedSet.has(value);
                              if (shouldSelect && !isSelected) {
                                onToggleIndex(value);
                              } else if (!shouldSelect && isSelected) {
                                onToggleIndex(value);
                              }
                            });
                          } else {
                            onToggleIndex(index);
                          }
                        } else {
                          onToggleIndex(index);
                        }
                        setLastClickedIndex(index);
                      }}
                    />
                    <div className={styles.playlistModalIndex}>{index}</div>
                    <div className={styles.playlistModalTitleCell}>
                      <div className={styles.playlistModalTitleText} title={titleText}>
                        {titleText}
                      </div>
                      {entry.url && (
                        <div className={styles.playlistModalSubText} title={entry.url}>
                          {entry.url}
                        </div>
                      )}
                    </div>
                    <div className={styles.playlistModalMetaCell}>{entry.id || '--'}</div>
                    <div className={`${styles.playlistModalMetaCell} ${durationClassMap[getDurationTone(entry.duration)]}`}>
                      {formatDurationShort(entry.duration)}
                    </div>
                    <div className={styles.playlistModalMetaCell}>{entry.uploader || '--'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && entries.length === 0 && !error && (
          <div className={styles.playlistModalLoading}>Không có item trong playlist.</div>
        )}

        <div className={styles.playlistModalFooter}>
          <Button variant="secondary" onClick={onClose}>Hủy</Button>
          <Button onClick={onApply}>Áp dụng</Button>
        </div>
      </div>
    </div>
  );
};
