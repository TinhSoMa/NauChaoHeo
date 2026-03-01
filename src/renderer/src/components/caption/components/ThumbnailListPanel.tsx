import styles from '../CaptionTranslator.module.css';
import { ThumbnailFolderItem } from '../CaptionTypes';

interface ThumbnailListPanelProps {
  visible: boolean;
  items: ThumbnailFolderItem[];
  autoStartValue: string;
  onAutoStartValueChange: (value: string) => void;
  onAutoFill: () => void;
  secondaryGlobalText: string;
  onSecondaryGlobalTextChange: (value: string) => void;
  onItemTextChange: (indexZeroBased: number, value: string) => void;
  onItemSecondaryTextChange: (indexZeroBased: number, value: string) => void;
  onResetSecondaryOverride: (indexZeroBased: number) => void;
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
        <div className={styles.thumbnailListTitleWrap}>
          <span>Danh sách Thumbnail theo folder</span>
          <span className={styles.thumbnailListHint}>Map theo thứ tự folder đã chọn</span>
        </div>
        <span className={styles.thumbnailListCountBadge}>{props.items.length} folder</span>
      </div>

      <div className={styles.thumbnailListToolbar}>
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

        <div className={styles.thumbnailSecondaryGlobalRow}>
          <span className={styles.thumbnailSecondaryGlobalLabel}>Text2 global</span>
          <textarea
            className={`${styles.thumbnailAutoFillInput} ${styles.thumbnailGlobalTextarea}`}
            value={props.secondaryGlobalText}
            onChange={(e) => props.onSecondaryGlobalTextChange(e.target.value)}
            rows={2}
            placeholder="Tên phim (áp dụng cho folder chưa override)..."
          />
        </div>
      </div>

      <div className={styles.thumbnailListTable}>
        {props.items.map((item) => (
          <div
            key={`${item.folderPath}-${item.index}`}
            className={`${styles.thumbnailListCard} ${item.hasError ? styles.thumbnailListRowError : ''}`}
          >
            <div className={styles.thumbnailListCardHeader}>
              <span className={styles.thumbnailListOrderBadge}>#{item.index}</span>
              <div className={styles.thumbnailListCardHeaderInfo}>
                <div className={styles.thumbnailListFolder} title={item.folderPath}>
                  {item.folderName}
                </div>
                <div className={styles.thumbnailListVideo} title={item.videoName}>
                  {item.videoName}
                </div>
              </div>
              <div className={styles.thumbnailSecondarySyncCell}>
                <span className={item.secondaryOverridden ? styles.thumbnailOverrideBadge : styles.thumbnailFollowBadge}>
                  {item.secondaryOverridden ? 'Override' : 'Global'}
                </span>
                {item.secondaryOverridden && (
                  <button
                    type="button"
                    className={styles.thumbnailResetOverrideBtn}
                    onClick={() => props.onResetSecondaryOverride(item.index - 1)}
                    title="Bỏ override, dùng lại text2 global"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            <div className={styles.thumbnailListPath} title={item.folderPath}>
              {item.folderPath}
            </div>

            <div className={styles.thumbnailListCardBody}>
              <label className={styles.thumbnailListField}>
                <span className={styles.thumbnailListFieldLabel}>Text1</span>
                <textarea
                  className={styles.thumbnailListTextarea}
                  value={item.text}
                  onChange={(e) => props.onItemTextChange(item.index - 1, e.target.value)}
                  rows={2}
                  placeholder="Text1 theo folder..."
                />
              </label>

              <label className={styles.thumbnailListField}>
                <span className={styles.thumbnailListFieldLabel}>Text2</span>
                <textarea
                  className={styles.thumbnailListTextarea}
                  value={item.secondaryText}
                  onChange={(e) => props.onItemSecondaryTextChange(item.index - 1, e.target.value)}
                  rows={2}
                  placeholder="Text2 (tên phim)..."
                />
              </label>
            </div>
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
