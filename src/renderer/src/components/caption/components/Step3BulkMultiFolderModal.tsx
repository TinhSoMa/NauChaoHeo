import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import styles from '../CaptionTranslator.module.css';

export type Step3BulkFileItem = {
  id: string;
  file: File;
};

interface Step3BulkMultiFolderModalProps {
  visible: boolean;
  folders: string[];
  files: Step3BulkFileItem[];
  busy: boolean;
  error?: string;
  message?: string;
  autoPickOnOpen?: boolean;
  onClose: () => void;
  onPickFiles: (files: FileList | null) => void;
  onClearFiles: () => void;
  onMoveFile: (fromIndex: number, toIndex: number) => void;
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

export function Step3BulkMultiFolderModal(props: Step3BulkMultiFolderModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoOpenRef = useRef(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

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

  if (!props.visible) {
    return null;
  }

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

  const handlePickClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    props.onPickFiles(event.target.files);
    event.target.value = '';
  };

  const handleDragStart = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    setDraggingIndex(index);
    setDragOverIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    const fromIndex = raw ? Number.parseInt(raw, 10) : draggingIndex;
    if (Number.isFinite(fromIndex) && fromIndex !== null && fromIndex !== index) {
      props.onMoveFile(fromIndex as number, index);
    }
    setDragOverIndex(null);
    setDraggingIndex(null);
  };

  const handleDragEnd = () => {
    setDragOverIndex(null);
    setDraggingIndex(null);
  };

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
              accept=".txt,application/json"
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

          <div className={styles.step3BulkMultiGrid}>
            <div className={styles.step3BulkMultiColumn}>
              <div className={styles.step3BulkMultiColumnTitle}>Folders đang chọn</div>
              <div className={styles.step3BulkMultiList}>
                {props.folders.map((folder, idx) => (
                  <div key={folder} className={styles.step3BulkMultiRow} title={folder}>
                    <span className={styles.step3BulkMultiBadge}>#{idx + 1}</span>
                    <span className={styles.step3BulkMultiText}>{getPathBaseName(folder)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.step3BulkMultiColumn}>
              <div className={styles.step3BulkMultiColumnTitle}>File TXT (kéo thả để đổi thứ tự)</div>
              <div className={styles.step3BulkMultiList}>
                {props.files.length === 0 && (
                  <div className={styles.step3BulkMultiEmpty}>Chưa có file TXT</div>
                )}
                {props.files.map((item, idx) => (
                  <div
                    key={item.id}
                    className={[
                      styles.step3BulkMultiRow,
                      styles.step3BulkMultiFileRow,
                      draggingIndex === idx ? styles.step3BulkMultiRowDragging : '',
                      dragOverIndex === idx ? styles.step3BulkMultiRowOver : '',
                    ].join(' ').trim()}
                    draggable={!props.busy}
                    onDragStart={handleDragStart(idx)}
                    onDragOver={handleDragOver(idx)}
                    onDrop={handleDrop(idx)}
                    onDragEnd={handleDragEnd}
                    title={item.file.name}
                  >
                    <span className={styles.step3BulkMultiBadge}>#{idx + 1}</span>
                    <span className={styles.step3BulkMultiText}>{item.file.name}</span>
                    <span className={styles.step3BulkMultiMeta}>{formatFileSize(item.file.size)}</span>
                  </div>
                ))}
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
                <span className={styles.step3BulkMultiArrow}>←</span>
                <span className={styles.step3BulkMultiText}>
                  {row.file?.file?.name || '--'}
                </span>
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
      </div>
    </div>
  );
}
