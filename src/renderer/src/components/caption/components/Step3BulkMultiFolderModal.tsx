import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import styles from '../CaptionTranslator.module.css';
import { useDragAutoScroll } from '../../../hooks/useDragAutoScroll';
import type { ManualBulkPreviewResult } from '../hooks/useCaptionProcessing';
import { Step3BulkFolderDetailPopup } from './Step3BulkFolderDetailPopup';

export type Step3BulkFileItem = {
  id: string;
  file: File;
  batchIndexCount?: number;
};

export type Step3BulkMultiFolderPreviewResult = ManualBulkPreviewResult;

export type Step3BulkMultiFolderBatchIssue = {
  batchIndex: number;
  level: 'error' | 'warning';
  message: string;
  indexes?: number[];
  count?: number;
};

export type Step3BulkMultiFolderApplyResult = {
  folderIndex: number;
  folderName: string;
  fileName: string;
  success: boolean;
  appliedBatches: number;
  skippedBatches: number;
  skippedLines: number;
  error?: string;
  batchIssues?: Step3BulkMultiFolderBatchIssue[];
};

interface Step3BulkMultiFolderModalProps {
  visible: boolean;
  folders: string[];
  files: Step3BulkFileItem[];
  folderBatchCounts?: Record<number, number | null>;
  busy: boolean;
  error?: string;
  message?: string;
  applyResults?: Step3BulkMultiFolderApplyResult[];
  autoPickOnOpen?: boolean;
  onClose: () => void;
  onPickFiles: (files: FileList | null) => void;
  onClearFiles: () => void;
  onMoveFile: (fromIndex: number, toIndex: number) => void;
  onRequestPreview: (folderIndex: number) => Promise<Step3BulkMultiFolderPreviewResult>;
  onApply: () => void;
}

function getPathBaseName(pathValue: string): string {
  const clean = (pathValue || '').trim();
  if (!clean) return '--';
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || clean;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function normalizeRange(first: number, second: number): { start: number; end: number } {
  return {
    start: Math.min(first, second),
    end: Math.max(first, second),
  };
}

function formatIndexRanges(indexes: number[]): string {
  const normalized = Array.from(
    new Set(
      indexes
        .map((value) => Math.floor(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => a - b);

  if (normalized.length === 0) {
    return 'không rõ';
  }

  const ranges: string[] = [];
  let start = normalized[0];
  let prev = normalized[0];
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(',');
}

function formatBatchIssueLabel(issue: Step3BulkMultiFolderBatchIssue): string {
  const base = `Batch #${issue.batchIndex}: ${issue.message}`;
  if (issue.indexes && issue.indexes.length > 0) {
    return `${base} (index ${formatIndexRanges(issue.indexes)})`;
  }
  if (typeof issue.count === 'number' && issue.count > 0) {
    return `${base} (${issue.count} mục)`;
  }
  return base;
}

function isIndexInRange(index: number, range: { start: number; end: number } | null): boolean {
  if (!range) return false;
  return index >= range.start && index <= range.end;
}

function isInsertionInsideRange(
  range: { start: number; end: number } | null,
  targetIndex: number,
  position: 'before' | 'after',
): boolean {
  if (!range) return false;
  const rawInsertIndex = targetIndex + (position === 'after' ? 1 : 0);
  return rawInsertIndex >= range.start && rawInsertIndex <= range.end + 1;
}

export function Step3BulkMultiFolderModal(props: Step3BulkMultiFolderModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileListRef = useRef<HTMLDivElement | null>(null);
  const previewRequestRef = useRef(0);
  const autoOpenRef = useRef(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);
  const [dragSelectionRange, setDragSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after'>('before');
  const [selectedFolderIndex, setSelectedFolderIndex] = useState(0);
  const [detailPopupOpen, setDetailPopupOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState<Step3BulkMultiFolderPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState('');
  const isPointerDragging = dragSelectionRange !== null && !props.busy;
  const dragAutoScroll = useDragAutoScroll(fileListRef, isPointerDragging, {
    edgeThreshold: 52,
    maxSpeed: 18,
  });

  useEffect(() => {
    if (!props.visible) {
      autoOpenRef.current = false;
      return;
    }
    if (props.autoPickOnOpen && props.files.length === 0 && !autoOpenRef.current) {
      autoOpenRef.current = true;
      fileInputRef.current?.click();
    }
  }, [props.autoPickOnOpen, props.files.length, props.visible]);

  useEffect(() => {
    if (!props.visible || props.busy || props.files.length === 0) {
      setSelectionAnchorIndex(null);
      setSelectedRange(null);
      setDragSelectionRange(null);
      setDragOverIndex(null);
      setDragOverPosition('before');
      dragAutoScroll.stopAutoScroll();
    }
  }, [dragAutoScroll, props.busy, props.files.length, props.visible]);

  useEffect(() => {
    if (!props.visible) {
      setPreviewResult(null);
      setPreviewError('');
      setPreviewBusy(false);
      setDetailPopupOpen(false);
      return;
    }
    if (props.folders.length > 0) {
      setSelectedFolderIndex((prev) => {
        if (prev >= 0 && prev < props.folders.length) {
          return prev;
        }
        return 0;
      });
    } else {
      setSelectedFolderIndex(0);
    }
  }, [props.folders.length, props.visible]);

  const countMismatch = props.files.length !== props.folders.length;
  const isApplyDisabled =
    props.busy || props.files.length === 0 || props.folders.length === 0 || countMismatch;

  const mappingRows = useMemo(() => {
    const max = Math.max(props.files.length, props.folders.length);
    return Array.from({ length: max }, (_, idx) => ({
      index: idx,
      folder: props.folders[idx],
      file: props.files[idx],
    }));
  }, [props.files, props.folders]);

  const loadPreviewForFolder = useCallback(async (folderIndex: number) => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;

    if (folderIndex < 0 || folderIndex >= props.folders.length) {
      if (requestId !== previewRequestRef.current) {
        return;
      }
      setPreviewBusy(false);
      setPreviewResult(null);
      setPreviewError('Folder không hợp lệ để xem chi tiết.');
      return;
    }

    setPreviewBusy(true);
    setPreviewError('');
    setPreviewResult(null);

    try {
      const result = await props.onRequestPreview(folderIndex);
      if (requestId !== previewRequestRef.current) {
        return;
      }
      setPreviewResult(result);
      setPreviewError(result.ok ? '' : (result.error || 'Không thể phân tích file của folder này.'));
    } catch (error) {
      if (requestId !== previewRequestRef.current) {
        return;
      }
      setPreviewResult(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === previewRequestRef.current) {
        setPreviewBusy(false);
      }
    }
  }, [props.folders.length, props.onRequestPreview]);

  useEffect(() => {
    if (!props.visible || !detailPopupOpen || props.folders.length === 0) {
      return;
    }
    void loadPreviewForFolder(selectedFolderIndex);
  }, [detailPopupOpen, loadPreviewForFolder, props.files, props.folders.length, props.visible, selectedFolderIndex]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
  }, []);

  const commitRangeReorder = useCallback((
    range: { start: number; end: number },
    targetIndex: number,
    position: 'before' | 'after',
  ) => {
    if (targetIndex < 0 || targetIndex >= props.files.length) {
      return range;
    }

    const blockLength = range.end - range.start + 1;
    const rawInsertIndex = targetIndex + (position === 'after' ? 1 : 0);
    if (rawInsertIndex >= range.start && rawInsertIndex <= range.end + 1) {
      return range;
    }

    if (rawInsertIndex < range.start) {
      let insertIndex = rawInsertIndex;
      for (let from = range.start; from <= range.end; from += 1) {
        props.onMoveFile(from, insertIndex);
        insertIndex += 1;
      }
      return {
        start: rawInsertIndex,
        end: rawInsertIndex + blockLength - 1,
      };
    }

    const moveToIndex = Math.min(rawInsertIndex - 1, props.files.length - 1);
    for (let from = range.end; from >= range.start; from -= 1) {
      props.onMoveFile(from, moveToIndex);
    }
    const nextStart = rawInsertIndex - blockLength;
    return {
      start: nextStart,
      end: nextStart + blockLength - 1,
    };
  }, [props.files.length, props.onMoveFile]);

  useEffect(() => {
    if (!props.visible || props.busy || dragSelectionRange === null || props.files.length === 0) {
      return undefined;
    }

    const container = fileListRef.current;
    if (!container) {
      return undefined;
    }

    document.body.style.userSelect = 'none';

    const findTargetIndex = (clientX: number, clientY: number): { index: number; position: 'before' | 'after' } | null => {
      const element = document.elementFromPoint(clientX, clientY);
      if (!element) return null;

      const row = element.closest('[data-file-row-index]') as HTMLElement | null;
      if (row?.dataset.fileRowIndex) {
        const parsed = Number.parseInt(row.dataset.fileRowIndex, 10);
        if (Number.isInteger(parsed)) {
          const rowRect = row.getBoundingClientRect();
          const position = clientY <= rowRect.top + rowRect.height / 2 ? 'before' : 'after';
          return { index: parsed, position };
        }
      }

      const rect = container.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      if (props.files.length === 0) return null;
      if (clientY <= rect.top + 18) return { index: 0, position: 'before' };
      if (clientY >= rect.bottom - 18) return { index: props.files.length - 1, position: 'after' };
      return null;
    };

    const onMouseMove = (event: MouseEvent) => {
      dragAutoScroll.handlePointerMove(event.clientX, event.clientY);
      const target = findTargetIndex(event.clientX, event.clientY);
      if (!target) return;

      if (dragOverIndex !== target.index) {
        setDragOverIndex(target.index);
      }
      if (dragOverPosition !== target.position) {
        setDragOverPosition(target.position);
      }
    };

    const onMouseUp = () => {
      const targetIndex = dragOverIndex ?? dragSelectionRange.start;
      const nextRange = commitRangeReorder(dragSelectionRange, targetIndex, dragOverPosition);
      setSelectedRange(nextRange);
      setSelectionAnchorIndex(nextRange.start);
      setDragSelectionRange(null);
      setDragOverIndex(null);
      setDragOverPosition('before');
      dragAutoScroll.stopAutoScroll();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });

    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dragAutoScroll.stopAutoScroll();
    };
  }, [
    dragAutoScroll,
    commitRangeReorder,
    dragOverIndex,
    dragOverPosition,
    dragSelectionRange,
    props.busy,
    props.files.length,
    props.visible,
  ]);

  if (!props.visible) {
    return null;
  }

  const handlePickClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onPickFiles(event.target.files);
    event.target.value = '';
  };

  const handlePointerDragStart = (index: number, event: ReactMouseEvent<HTMLDivElement>) => {
    if (props.busy || event.button !== 0) {
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      if (selectionAnchorIndex === null) {
        const range = { start: index, end: index };
        setSelectionAnchorIndex(index);
        setSelectedRange(range);
      } else {
        setSelectedRange(normalizeRange(selectionAnchorIndex, index));
      }
      return;
    }

    event.preventDefault();

    const nextDragRange = isIndexInRange(index, selectedRange)
      ? (selectedRange ?? { start: index, end: index })
      : { start: index, end: index };

    setSelectionAnchorIndex(index);
    setSelectedRange(nextDragRange);
    setDragSelectionRange(nextDragRange);
    setDragOverIndex(index);
    setDragOverPosition('before');
  };

  const handleOpenFolderDetail = (index: number) => {
    if (index < 0 || index >= props.folders.length) return;
    setSelectedFolderIndex(index);
    setDetailPopupOpen(true);
  };

  const selectedFolderPath = props.folders[selectedFolderIndex] || '';
  const selectedFolderName = selectedFolderPath ? getPathBaseName(selectedFolderPath) : '--';

  return (
    <div
      className={styles.modalBackdrop}
      onClick={() => {
        if (!props.busy) props.onClose();
      }}
    >
      <div
        className={styles.modalCard}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Bulk JSON cho nhiều folder</div>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={props.onClose}
            disabled={props.busy}
          >
            ✕
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.step3BulkMultiActions}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.json,.jsonl,application/json"
              multiple
              className={styles.step3BulkMultiFileInput}
              onChange={handleFileInputChange}
              disabled={props.busy}
            />
            <button
              type="button"
              className={styles.step3BulkMultiBtn}
              onClick={handlePickClick}
              disabled={props.busy}
            >
              Chọn file TXT
            </button>
            <button
              type="button"
              className={styles.step3BulkMultiBtn}
              onClick={props.onClearFiles}
              disabled={props.busy || props.files.length === 0}
            >
              Xóa hết
            </button>
            <div className={styles.step3BulkMultiCount}>
              Folder: {props.folders.length} · File: {props.files.length}
            </div>
          </div>

          {countMismatch && (
            <div className={styles.step3BulkMultiWarning}>
              Số file không khớp số folder. Hãy chọn đủ file để Apply.
            </div>
          )}
          {props.error && <div className={styles.modalError}>{props.error}</div>}
          {props.message && <div className={styles.step3BulkMultiMessage}>{props.message}</div>}

          {!!props.applyResults?.length && (
            <div className={styles.step3BulkMultiResultPanel}>
              <div className={styles.step3BulkMultiResultTitle}>Kết quả áp dụng</div>
              <div className={styles.step3BulkMultiResultList}>
                {props.applyResults.map((result) => {
                  const hasWarningIssue = (result.batchIssues || []).some((issue) => issue.level === 'warning');
                  const hasWarning = result.success && (result.skippedBatches > 0 || result.skippedLines > 0 || hasWarningIssue);
                  const issueList = result.batchIssues || [];
                  return (
                    <div
                      key={`apply-result-${result.folderIndex}`}
                      className={[
                        styles.step3BulkMultiResultRow,
                        result.success
                          ? (hasWarning
                              ? styles.step3BulkMultiResultRowWarning
                              : styles.step3BulkMultiResultRowSuccess)
                          : styles.step3BulkMultiResultRowError,
                      ].join(' ').trim()}
                    >
                      <span className={styles.step3BulkMultiBadge}>#{result.folderIndex + 1}</span>
                      <span className={styles.step3BulkMultiText} title={result.folderName}>{result.folderName}</span>
                      <span className={styles.step3BulkMultiMeta} title={result.fileName}>{result.fileName || '--'}</span>
                      <span className={styles.step3BulkMultiMeta}>Batch OK: {result.appliedBatches}</span>
                      {(result.skippedBatches > 0 || result.skippedLines > 0) && (
                        <span className={styles.step3BulkMultiResultSkipMeta}>
                          Skip: {result.skippedBatches} batch · {result.skippedLines} dòng
                        </span>
                      )}
                      {!result.success && (
                        <span className={styles.step3BulkMultiResultErrorText} title={result.error || ''}>
                          {result.error || 'Không áp dụng được dữ liệu.'}
                        </span>
                      )}
                      {issueList.length > 0 && (
                        <div className={styles.step3BulkMultiResultIssueList}>
                          {issueList.slice(0, 5).map((issue, issueIndex) => (
                            <div
                              key={`apply-issue-${result.folderIndex}-${issue.batchIndex}-${issueIndex}`}
                              className={[
                                styles.step3BulkMultiResultIssue,
                                issue.level === 'error'
                                  ? styles.step3BulkMultiResultIssueError
                                  : styles.step3BulkMultiResultIssueWarning,
                              ].join(' ').trim()}
                              title={formatBatchIssueLabel(issue)}
                            >
                              {formatBatchIssueLabel(issue)}
                            </div>
                          ))}
                          {issueList.length > 5 && (
                            <div className={styles.step3BulkMultiResultIssueMore}>
                              +{issueList.length - 5} lỗi/cảnh báo khác
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.step3BulkMultiGrid}>
            <div className={styles.step3BulkMultiColumn}>
              <div className={styles.step3BulkMultiColumnTitle}>Folders đang chọn (nhấn để xem popup chi tiết)</div>
              <div className={styles.step3BulkMultiList}>
                {props.folders.map((folder, idx) => (
                  <button
                    key={`${folder}-${idx}`}
                    type="button"
                    className={[
                      styles.step3BulkMultiRow,
                      styles.step3BulkMultiFolderRowBtn,
                      idx === selectedFolderIndex ? styles.step3BulkMultiFolderRowBtnActive : '',
                    ].join(' ').trim()}
                    title={folder}
                    onClick={() => handleOpenFolderDetail(idx)}
                    disabled={props.busy || props.folders.length === 0}
                  >
                    <span className={styles.step3BulkMultiBadge}>#{idx + 1}</span>
                    <span className={styles.step3BulkMultiText}>{getPathBaseName(folder)}</span>
                    <span className={styles.step3BulkMultiMeta}>
                      Batch: {typeof props.folderBatchCounts?.[idx] === 'number' ? props.folderBatchCounts[idx] : '--'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.step3BulkMultiColumn}>
              <div className={styles.step3BulkMultiColumnTitle}>File TXT (kéo thả để đổi thứ tự)</div>
              <div
                ref={fileListRef}
                className={[styles.step3BulkMultiList, isPointerDragging ? styles.step3BulkMultiListDragging : ''].join(' ').trim()}
                onWheelCapture={(event) => dragAutoScroll.handleWheelWhileDragging(event)}
              >
                {props.files.length === 0 && (
                  <div className={styles.step3BulkMultiEmpty}>Chưa có file TXT</div>
                )}
                {props.files.map((item, idx) => {
                  const isSelected = isIndexInRange(idx, selectedRange);
                  const isDragging = isIndexInRange(idx, dragSelectionRange);
                  const showDropIndicator = dragSelectionRange !== null
                    && dragOverIndex === idx
                    && !isInsertionInsideRange(dragSelectionRange, dragOverIndex, dragOverPosition);
                  return (
                    <div
                      key={item.id}
                      data-file-row-index={idx}
                      className={[
                        styles.step3BulkMultiRow,
                        styles.step3BulkMultiFileRow,
                        isSelected ? styles.step3BulkMultiRowSelected : '',
                        isDragging ? styles.step3BulkMultiRowDragging : '',
                        showDropIndicator ? styles.step3BulkMultiRowOver : '',
                        showDropIndicator && dragOverPosition === 'before' ? styles.step3BulkMultiRowDropBefore : '',
                        showDropIndicator && dragOverPosition === 'after' ? styles.step3BulkMultiRowDropAfter : '',
                      ].join(' ').trim()}
                      onMouseDown={(event) => handlePointerDragStart(idx, event)}
                      aria-grabbed={isDragging}
                      title={item.file.name}
                    >
                      <span className={styles.step3BulkMultiBadge}>#{idx + 1}</span>
                      <span className={styles.step3BulkMultiText}>{item.file.name}</span>
                      <span className={styles.step3BulkMultiMeta}>{formatFileSize(item.file.size)}</span>
                      <span className={styles.step3BulkMultiMeta}>
                        BatchIndex: {typeof item.batchIndexCount === 'number' ? item.batchIndexCount : '--'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={styles.step3BulkMultiMapping}>
            {mappingRows.map((row) => (
              <div key={`map-${row.index}`} className={styles.step3BulkMultiMappingRow}>
                <span className={styles.step3BulkMultiBadge}>#{row.index + 1}</span>
                <span className={styles.step3BulkMultiText}>
                  {row.folder ? getPathBaseName(row.folder) : '--'}
                </span>
                <span className={styles.step3BulkMultiMeta}>
                  Batch: {typeof props.folderBatchCounts?.[row.index] === 'number' ? props.folderBatchCounts[row.index] : '--'}
                </span>
                <span className={styles.step3BulkMultiArrow}>←</span>
                <span className={styles.step3BulkMultiText}>
                  {row.file?.file?.name || '--'}
                </span>
                <span className={styles.step3BulkMultiMeta}>
                  BatchIndex: {typeof row.file?.batchIndexCount === 'number' ? row.file.batchIndexCount : '--'}
                </span>
                {row.folder && (
                  <button
                    type="button"
                    className={styles.step3BulkMultiBtn}
                    onClick={() => handleOpenFolderDetail(row.index)}
                    disabled={props.busy || row.index >= props.folders.length}
                  >
                    Xem chi tiết
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.modalSecondaryBtn}
            onClick={props.onClose}
            disabled={props.busy}
          >
            Hủy
          </button>
          <button
            type="button"
            className={styles.modalPrimaryBtn}
            onClick={props.onApply}
            disabled={isApplyDisabled}
          >
            {props.busy ? 'Đang áp dụng...' : 'Apply'}
          </button>
        </div>

        <Step3BulkFolderDetailPopup
          visible={detailPopupOpen}
          folderIndex={selectedFolderIndex}
          folderName={selectedFolderName}
          busy={previewBusy}
          previewResult={previewResult}
          error={previewError}
          onRefresh={() => {
            void loadPreviewForFolder(selectedFolderIndex);
          }}
          onClose={() => {
            setDetailPopupOpen(false);
          }}
        />
      </div>
    </div>
  );
}
