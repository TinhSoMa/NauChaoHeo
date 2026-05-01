import { useEffect, useMemo, useState } from 'react';
import styles from '../CaptionTranslator.module.css';
import type {
  ManualBulkPreviewBatch,
  ManualBulkPreviewLine,
  ManualBulkPreviewResult,
} from '../hooks/useCaptionProcessing';

type Step3BulkFolderDetailPopupProps = {
  visible: boolean;
  folderIndex: number;
  folderName: string;
  busy: boolean;
  previewResult: ManualBulkPreviewResult | null;
  error?: string;
  onClose: () => void;
  onRefresh: () => void;
};

function isLineIssue(line: ManualBulkPreviewLine): boolean {
  return line.status === 'error' || line.status === 'missing' || line.status === 'empty';
}

function getLineStatusLabel(line: ManualBulkPreviewLine): string {
  switch (line.status) {
    case 'missing':
      return 'MISSING';
    case 'error':
      return 'ERROR';
    case 'empty':
      return 'EMPTY';
    case 'unchanged':
      return 'NO-CHANGE';
    default:
      return 'CHANGED';
  }
}

function getBatchStatusLabel(batch: ManualBulkPreviewBatch): string {
  if (batch.status === 'error') return 'ERROR';
  if (batch.status === 'warning') return 'WARNING';
  return 'OK';
}

export function Step3BulkFolderDetailPopup(props: Step3BulkFolderDetailPopupProps) {
  const [showOnlyIssueLines, setShowOnlyIssueLines] = useState(true);
  const [expandedBatchIndexes, setExpandedBatchIndexes] = useState<number[]>([]);

  useEffect(() => {
    if (!props.visible) {
      return;
    }
    setShowOnlyIssueLines(true);
    const batches = props.previewResult?.ok ? (props.previewResult.batches || []) : [];
    if (batches.length === 0) {
      setExpandedBatchIndexes([]);
      return;
    }
    const firstErrorBatch = batches.find((batch) => batch.status === 'error');
    const firstBatch = firstErrorBatch || batches[0];
    setExpandedBatchIndexes(firstBatch ? [firstBatch.batchIndex] : []);
  }, [props.folderIndex, props.previewResult, props.visible]);

  const previewBatches = useMemo(
    () => (props.previewResult?.ok ? (props.previewResult.batches || []) : []),
    [props.previewResult]
  );

  if (!props.visible) {
    return null;
  }

  const handleToggleBatch = (batchIndex: number) => {
    setExpandedBatchIndexes((prev) => (
      prev.includes(batchIndex)
        ? prev.filter((idx) => idx !== batchIndex)
        : [...prev, batchIndex]
    ));
  };

  return (
    <div
      className={styles.step3BulkMultiDetailPopupBackdrop}
      onClick={() => {
        if (!props.busy) {
          props.onClose();
        }
      }}
    >
      <div
        className={styles.step3BulkMultiDetailPopupCard}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.step3BulkMultiDetailPopupHeader}>
          <div className={styles.step3BulkMultiDetailPopupTitle}>
            Chi tiết folder #{props.folderIndex + 1} · {props.folderName}
          </div>
          <div className={styles.step3BulkMultiDetailPopupActions}>
            <button
              type="button"
              className={styles.modalSecondaryBtn}
              onClick={props.onRefresh}
              disabled={props.busy}
            >
              Làm mới
            </button>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={props.onClose}
              disabled={props.busy}
            >
              ✕
            </button>
          </div>
        </div>

        <div className={styles.step3BulkMultiDetailPopupBody}>
          <div className={styles.step3BulkMultiDetailHeader}>
            <div className={styles.step3BulkMultiDetailTitle}>
              So sánh line-by-line cho folder đã chọn
            </div>
            <label className={styles.step3BulkMultiDetailFilter}>
              <input
                type="checkbox"
                checked={showOnlyIssueLines}
                onChange={(event) => setShowOnlyIssueLines(event.target.checked)}
                disabled={props.busy || !props.previewResult?.ok}
              />
              Chỉ hiện dòng lỗi/thiếu
            </label>
          </div>

          {props.busy && (
            <div className={styles.step3BulkMultiDetailHint}>Đang phân tích file của folder đã chọn...</div>
          )}

          {!props.busy && props.error && (
            <div className={styles.step3BulkMultiDetailError}>{props.error}</div>
          )}

          {!props.busy && props.previewResult?.ok && (
            <>
              <div className={styles.step3BulkMultiDetailMeta}>
                Batch: {props.previewResult.totalBatches || 0}
                {' · '}OK: {props.previewResult.okBatches || 0}
                {' · '}Warning: {props.previewResult.warningBatches || 0}
                {' · '}Error: {props.previewResult.errorBatches || 0}
                {' · '}Input: {props.previewResult.inputLines || 0}
                {' · '}Accepted: {props.previewResult.acceptedLines || 0}
                {' · '}Skipped: {props.previewResult.skippedLines || 0}
              </div>

              <div className={styles.step3BulkMultiDetailBatchList}>
                {previewBatches.length === 0 && (
                  <div className={styles.step3BulkMultiDetailHint}>Không có batch để so sánh.</div>
                )}

                {previewBatches.map((batch) => {
                  const isExpanded = expandedBatchIndexes.includes(batch.batchIndex);
                  const visibleLines = showOnlyIssueLines
                    ? batch.lines.filter((line) => isLineIssue(line))
                    : batch.lines;
                  const hasErrorBatch = batch.status === 'error';
                  const hasWarningBatch = batch.status === 'warning';

                  return (
                    <div
                      key={`preview-batch-${batch.batchIndex}`}
                      className={[
                        styles.step3BulkMultiDetailBatchCard,
                        hasErrorBatch ? styles.step3BulkMultiDetailBatchCardError : '',
                        hasWarningBatch ? styles.step3BulkMultiDetailBatchCardWarning : '',
                      ].join(' ').trim()}
                    >
                      <button
                        type="button"
                        className={styles.step3BulkMultiDetailBatchHeader}
                        onClick={() => handleToggleBatch(batch.batchIndex)}
                      >
                        <span className={styles.step3BulkMultiBadge}>#{batch.batchIndex}</span>
                        <span className={styles.step3BulkMultiDetailBatchMeta}>
                          Expected {batch.expectedLines} · Imported {batch.importedLines}
                        </span>
                        <span
                          className={[
                            styles.step3BulkMultiDetailBatchStatus,
                            hasErrorBatch
                              ? styles.step3BulkMultiDetailBatchStatusError
                              : hasWarningBatch
                                ? styles.step3BulkMultiDetailBatchStatusWarning
                                : styles.step3BulkMultiDetailBatchStatusOk,
                          ].join(' ').trim()}
                        >
                          {getBatchStatusLabel(batch)}
                        </span>
                      </button>

                      {(batch.missingIndexes.length > 0 || batch.duplicateIndexes.length > 0 || batch.outOfRangeIndexes.length > 0) && (
                        <div className={styles.step3BulkMultiDetailIndexSummary}>
                          {batch.missingIndexes.length > 0 && (
                            <div className={styles.step3BulkMultiDetailIndexError}>
                              Missing: {batch.missingIndexes.map((idx) => `#${idx}`).join(', ')}
                            </div>
                          )}
                          {batch.duplicateIndexes.length > 0 && (
                            <div className={styles.step3BulkMultiDetailIndexError}>
                              Duplicate: {batch.duplicateIndexes.map((idx) => `#${idx}`).join(', ')}
                            </div>
                          )}
                          {batch.outOfRangeIndexes.length > 0 && (
                            <div className={styles.step3BulkMultiDetailIndexError}>
                              Out-of-range: {batch.outOfRangeIndexes.map((idx) => `#${idx}`).join(', ')}
                            </div>
                          )}
                        </div>
                      )}

                      {batch.issues.length > 0 && (
                        <div className={styles.step3BulkMultiDetailIssueList}>
                          {Array.from(batch.issues.reduce((map, issue) => {
                            const key = `${issue.level}::${issue.code}`;
                            const item = map.get(key) || {
                              code: issue.code,
                              level: issue.level,
                              count: 0,
                            };
                            item.count += 1;
                            map.set(key, item);
                            return map;
                          }, new Map<string, { code: string; level: 'error' | 'warning'; count: number }>()).values()).map((item) => (
                            <div
                              key={`issue-${batch.batchIndex}-${item.level}-${item.code}`}
                              className={[
                                styles.step3BulkMultiDetailIssue,
                                item.level === 'error'
                                  ? styles.step3BulkMultiDetailIssueError
                                  : styles.step3BulkMultiDetailIssueWarning,
                              ].join(' ').trim()}
                            >
                              [{item.code}] {item.count} mục
                            </div>
                          ))}
                        </div>
                      )}

                      {isExpanded && (
                        <div className={styles.step3BulkMultiDetailLineTableWrap}>
                          <table className={styles.step3BulkMultiDetailLineTable}>
                            <thead>
                              <tr>
                                <th>Index</th>
                                <th>Global</th>
                                <th>Expected</th>
                                <th>Current</th>
                                <th>Imported</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleLines.length === 0 && (
                                <tr>
                                  <td colSpan={6}>Không có dòng lỗi/thiếu trong batch này.</td>
                                </tr>
                              )}

                              {visibleLines.map((line) => {
                                const lineHasIssue = isLineIssue(line);
                                return (
                                  <tr
                                    key={`line-${batch.batchIndex}-${line.lineNo}`}
                                    className={lineHasIssue ? styles.step3BulkMultiDetailLineErrorRow : ''}
                                  >
                                    <td className={lineHasIssue ? styles.step3BulkMultiDetailLineIndexError : ''}>#{line.lineNo}</td>
                                    <td>{line.globalIndex}</td>
                                    <td title={line.originalText}>{line.originalText || '--'}</td>
                                    <td title={line.currentText}>{line.currentText || '--'}</td>
                                    <td title={line.importedText}>{line.importedText || '--'}</td>
                                    <td>
                                      <span
                                        className={[
                                          styles.step3BulkMultiDetailLineStatus,
                                          lineHasIssue
                                            ? styles.step3BulkMultiDetailLineStatusError
                                            : styles.step3BulkMultiDetailLineStatusOk,
                                        ].join(' ').trim()}
                                      >
                                        {getLineStatusLabel(line)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
