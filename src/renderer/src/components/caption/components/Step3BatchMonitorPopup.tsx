import { useEffect, useMemo, useState } from 'react';
import styles from './Step3BatchMonitorPopup.module.css';

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

  useEffect(() => {
    if (!props.visible) {
      return;
    }
    setDraftLines(props.lines.map((line) => ({ ...line })));
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
          <div className={styles.list}>
            {draftLines.map((line) => (
              <div key={`s3-edit-${line.lineNo}-${line.globalIndex}`} className={styles.item}>
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
