import styles from '../CaptionTranslator.module.css';
import { ThumbnailFolderItem } from '../CaptionTypes';

interface ThumbnailListPanelProps {
  visible: boolean;
  items: ThumbnailFolderItem[];
  autoStartValue: string;
  onAutoStartValueChange: (value: string) => void;
  onAutoFill: () => void;
  onItemTextChange: (indexZeroBased: number, value: string) => void;
  showMissingWarning: boolean;
  dependencyWarning?: string;
}

export function ThumbnailListPanel(props: ThumbnailListPanelProps) {
  if (!props.visible) {
    return null;
  }

  return (
    <div className={styles.thumbnailListSection}>
      <div className={styles.thumbnailListHeader}>
        <span>Danh sách Thumbnail theo folder</span>
        <span className={styles.thumbnailListHint}>Map theo thứ tự folder đã chọn</span>
      </div>
      <div className={styles.thumbnailAutoFillRow}>
        <input
          type="text"
          className={styles.thumbnailAutoFillInput}
          value={props.autoStartValue}
          onChange={(e) => props.onAutoStartValueChange(e.target.value)}
          placeholder="Nhập số bắt đầu (vd: 4 hoặc 1.)"
        />
        <button
          type="button"
          className={styles.thumbnailAutoFillBtn}
          onClick={props.onAutoFill}
          title="Tự động điền theo mẫu Tập N, Tập N+1..."
        >
          Tự động điền Tập
        </button>
      </div>
      <div className={styles.thumbnailListTable}>
        <div className={styles.thumbnailListRowHead}>
          <span>STT</span>
          <span>Folder</span>
          <span>Video</span>
          <span>Thumbnail text</span>
        </div>
        {props.items.map((item) => (
          <div
            key={`${item.folderPath}-${item.index}`}
            className={`${styles.thumbnailListRow} ${item.hasError ? styles.thumbnailListRowError : ''}`}
          >
            <span className={styles.thumbnailListIdx}>{item.index}</span>
            <span className={styles.thumbnailListFolder} title={item.folderPath}>
              {item.folderName}
            </span>
            <span className={styles.thumbnailListVideo} title={item.videoName}>
              {item.videoName}
            </span>
            <input
              type="text"
              className={styles.thumbnailListInput}
              value={item.text}
              onChange={(e) => props.onItemTextChange(item.index - 1, e.target.value)}
              placeholder="Nhập text thumbnail cho folder này..."
            />
          </div>
        ))}
      </div>
      {props.showMissingWarning && (
        <div className={styles.thumbnailListWarning}>
          Thiếu thumbnail text ở một hoặc nhiều folder. Step 7 sẽ bị chặn cho đến khi nhập đủ.
        </div>
      )}
      {props.dependencyWarning && (
        <div className={styles.thumbnailListWarning}>
          {props.dependencyWarning}
        </div>
      )}
    </div>
  );
}
