import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './Step3BatchMonitorPopup.module.css';
import { useDragAutoScroll } from '../../../hooks/useDragAutoScroll';

export type Step3BatchEditableLine = {
  lineNo: number;
  globalIndex: number;
  originalText: string;
  translatedText: string;
};

type Step3BatchMonitorPopupProps = {
  visible: boolean;
  batchIndex: number;
  lineRangeLabel: string;
  lines: Step3BatchEditableLine[];
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSave: (lines: Step3BatchEditableLine[]) => Promise<void> | void;
};

function normalizeLineSnapshot(lines: Step3BatchEditableLine[]): string {
  return JSON.stringify(lines.map((line) => ({ lineNo: line.lineNo, translatedText: line.translatedText || '' })));
}

export function Step3BatchMonitorPopup(props: Step3BatchMonitorPopupProps) {
  const [draftLines, setDraftLines] = useState<Step3BatchEditableLine[]>(props.lines);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragAutoScroll = useDragAutoScroll(listRef, draggingIndex !== null, {
    edgeThreshold: 52,
    maxSpeed: 18,
  });

  useEffect(() => {
    if (!props.visible) {
      return;
    }
    setDraftLines(props.lines.map((line) => ({ ...line })));
    setDraggingIndex(null);
    setDragOverIndex(null);
    dragAutoScroll.stopAutoScroll();
  }, [props.lines, props.visible, props.batchIndex]);

  const initialSnapshot = useMemo(() => normalizeLineSnapshot(props.lines), [props.lines]);
  const currentSnapshot = useMemo(() => normalizeLineSnapshot(draftLines), [draftLines]);
  const isDirty = initialSnapshot !== currentSnapshot;

  useEffect(() => {
    if (!props.visible) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (props.busy) {
          return;
        }
        if (isDirty) {
          const confirmed = window.confirm('Bạn có thay đổi chưa lưu. Đóng popup sẽ mất thay đổi, tiếp tục?');
          if (!confirmed) {
            return;
          }
        }
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isDirty, props.busy, props.onClose, props.visible]);

  if (!props.visible) {
    return null;
  }

  const handleLineChange = (lineNo: number, value: string) => {
    setDraftLines((prev) => prev.map((line) => (
      line.lineNo === lineNo
        ? { ...line, translatedText: value }
        : line
    )));
  };

  const handleLineDelete = (lineNo: number) => {
    setDraftLines((prev) => prev.map((line) => (
      line.lineNo === lineNo
        ? { ...line, translatedText: '' }
        : line
    )));
  };

  const handleSave = async () => {
    if (props.busy) {
      return;
    }
    await props.onSave(draftLines);
  };

  const commitReorder = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= draftLines.length || toIndex >= draftLines.length) {
      return;
    }
    setDraftLines((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handlePointerDragStart = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (props.busy || event.button !== 0) return;
    event.preventDefault();
    setDraggingIndex(index);
    setDragOverIndex(index);
  };

  useEffect(() => {
    if (draggingIndex === null || props.busy) {
      return undefined;
    }

    const container = listRef.current;
    if (!container) {
      return undefined;
    }

    document.body.style.userSelect = 'none';

    const findTargetIndex = (clientX: number, clientY: number): number | null => {
      const element = document.elementFromPoint(clientX, clientY);
      if (!element) return null;

      const item = element.closest('[data-line-index]') as HTMLElement | null;
      if (item?.dataset.lineIndex) {
        const parsed = Number.parseInt(item.dataset.lineIndex, 10);
        if (Number.isInteger(parsed)) return parsed;
      }

      const rect = container.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      if (draftLines.length === 0) return null;
      if (clientY <= rect.top + 24) return 0;
      if (clientY >= rect.bottom - 24) return draftLines.length - 1;
      return null;
    };

    const onMouseMove = (event: MouseEvent) => {
      dragAutoScroll.handlePointerMove(event.clientX, event.clientY);
      const nextIndex = findTargetIndex(event.clientX, event.clientY);
      if (nextIndex !== null && nextIndex !== dragOverIndex) {
        setDragOverIndex(nextIndex);
      }
    };

    const onMouseUp = () => {
      const toIndex = dragOverIndex ?? draggingIndex;
      commitReorder(draggingIndex, toIndex);
      setDraggingIndex(null);
      setDragOverIndex(null);
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
  }, [dragAutoScroll, draggingIndex, dragOverIndex, draftLines.length, props.busy]);

  const handleRequestClose = async () => {
    if (props.busy) {
      return;
    }
    if (isDirty) {
      const confirmed = window.confirm('Bạn có thay đổi chưa lưu. Đóng popup sẽ mất thay đổi, tiếp tục?');
      if (!confirmed) {
        return;
      }
    }
    props.onClose();
  };

  return (
    <div className={styles.overlay} onClick={() => { void handleRequestClose(); }}>
      <div className={styles.card} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Step 3 Batch #{props.batchIndex}</div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => { void handleRequestClose(); }}
            disabled={props.busy}
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {draggingIndex !== null && dragOverIndex !== null ? (
            <div className={styles.dragStatusPill}>
              {`Dang keo dong #${draggingIndex + 1} -> vi tri #${dragOverIndex + 1}`}
            </div>
          ) : null}
          <div
            ref={listRef}
            className={[styles.list, draggingIndex !== null ? styles.listDragging : ''].join(' ').trim()}
            onWheelCapture={(event) => dragAutoScroll.handleWheelWhileDragging(event as React.WheelEvent<HTMLElement>)}
          >
            {draftLines.map((line, index) => (
              <div
                key={`s3-edit-${line.lineNo}-${line.globalIndex}`}
                data-line-index={index}
                className={[
                  styles.item,
                  draggingIndex === index ? styles.itemDragging : '',
                  dragOverIndex === index ? styles.itemDragOver : '',
                  dragOverIndex === index && draggingIndex !== null && dragOverIndex < draggingIndex ? styles.dropBeforeItem : '',
                  dragOverIndex === index && draggingIndex !== null && dragOverIndex > draggingIndex ? styles.dropAfterItem : '',
                ].join(' ').trim()}
                onMouseDown={(event) => handlePointerDragStart(index, event)}
              >
                <div className={styles.itemHeader}>
                  <span className={styles.itemMeta}>Batch line #{line.lineNo} · Global #{line.globalIndex}</span>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => handleLineDelete(line.lineNo)}
                    disabled={props.busy}
                    title="Xóa bản dịch dòng này"
                  >
                    Xóa dòng
                  </button>
                </div>
                <div className={styles.originalText} title={line.originalText || ''}>
                  {line.originalText || '--'}
                </div>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={line.translatedText}
                  onChange={(event) => handleLineChange(line.lineNo, event.target.value)}
                  disabled={props.busy}
                  placeholder="Nhập subtitle đã dịch..."
                />
              </div>
            ))}
          </div>

          {props.error && <div className={styles.error}>{props.error}</div>}
          <div className={styles.hint}>
            Xóa dòng = clear bản dịch. Lưu vào caption_session khi bấm Lưu.
          </div>
        </div>

        <div className={styles.footer}>
          <span className={styles.state}>{isDirty ? 'Có thay đổi chưa lưu' : 'Không có thay đổi'}</span>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => { void handleRequestClose(); }}
              disabled={props.busy}
            >
              Đóng
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => { void handleSave(); }}
              disabled={props.busy || !isDirty}
            >
              {props.busy ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
