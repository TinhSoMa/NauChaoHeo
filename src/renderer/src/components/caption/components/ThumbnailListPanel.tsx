import { useEffect, useState } from 'react';
import styles from '../CaptionTranslator.module.css';
import { ThumbnailFolderItem } from '../CaptionTypes';

export interface BulkApplyResult {
  status: 'success' | 'warning' | 'error';
  summary: string;
  detail?: string;
}

interface ThumbnailListPanelProps {
  visible: boolean;
  items: ThumbnailFolderItem[];
  videoNameByFolderPath?: Record<string, string>;
  autoStartValue: string;
  onAutoStartValueChange: (value: string) => void;
  secondaryGlobalText: string;
  onSecondaryGlobalTextChange: (value: string) => void;
  onItemTextChange: (indexZeroBased: number, value: string) => void;
  onItemSecondaryTextChange: (indexZeroBased: number, value: string) => void;
  onResetSecondaryOverride: (indexZeroBased: number) => void;
  onBulkApplyJsonLines: (raw: string) => BulkApplyResult;
  onManualSaveTexts: () => void;
  manualSaveState: 'idle' | 'saving' | 'success' | 'error';
  manualSaveMessage: string;
  manualSaveDisabled?: boolean;
  showMissingWarning: boolean;
  dependencyWarning?: string;
}

const BULK_SAMPLE = `{
  "defaultText2": "Tây Du Ký",
  "blocks": [
    { "match": "0303_*", "episodeStart": 1, "text1Template": "Tập {n}" },
    { "match": "0303_10", "text1": "Tập đặc biệt", "text2": "Tây Du Ký Ngoại Truyện" }
  ]
}`;

function normalizeCopyText(value: string | undefined): string {
  return (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toSingleLineText(value: string | undefined): string {
  return normalizeCopyText(value)
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

function resolveVideoNameForCopy(
  item: ThumbnailFolderItem,
  videoNameByFolderPath?: Record<string, string>
): string {
  const mapName = toSingleLineText(videoNameByFolderPath?.[item.folderPath]);
  const itemName = toSingleLineText(item.videoName);
  if (mapName && mapName !== 'Chưa tìm thấy video') {
    return mapName;
  }
  if (itemName) {
    return itemName;
  }
  return 'Chưa tìm thấy video';
}

function buildVideoCopyPayload(
  items: ThumbnailFolderItem[],
  videoNameByFolderPath?: Record<string, string>
): string {
  return items
    .map((item, idx) => {
      const resolvedName = resolveVideoNameForCopy(item, videoNameByFolderPath);
      return `video${idx + 1}: ${resolvedName}`;
    })
    .join('\n');
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function ThumbnailListPanel(props: ThumbnailListPanelProps) {
  const [bulkRawText, setBulkRawText] = useState('');
  const [bulkApplyResult, setBulkApplyResult] = useState<BulkApplyResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [copyMessage, setCopyMessage] = useState('');

  useEffect(() => {
    if (copyStatus === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopyStatus('idle');
      setCopyMessage('');
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copyStatus]);

  if (!props.visible) {
    return null;
  }

  const handleCopyVideoNames = async () => {
    if (!props.items.length) {
      return;
    }
    const payload = buildVideoCopyPayload(props.items, props.videoNameByFolderPath);
    const copied = await copyToClipboard(payload);
    if (copied) {
      setCopyStatus('success');
      setCopyMessage(`Đã copy ${props.items.length} tên video`);
      return;
    }
    setCopyStatus('error');
    setCopyMessage('Không thể copy clipboard');
  };

  return (
    <div className={styles.thumbnailListSection}>
      <div className={styles.thumbnailListHeader}>
        <div className={styles.thumbnailListTitleWrap}>
          <span>Danh sách Thumbnail theo folder</span>
          <span className={styles.thumbnailListHint}>Map theo thứ tự folder đã chọn</span>
        </div>
        <div className={styles.thumbnailListHeaderActions}>
          <span className={styles.thumbnailListCountBadge}>{props.items.length} folder</span>
          <button
            type="button"
            className={`${styles.thumbnailAutoFillBtn} ${styles.thumbnailListSaveBtn}`}
            onClick={props.onManualSaveTexts}
            disabled={props.manualSaveDisabled || props.items.length === 0 || props.manualSaveState === 'saving'}
            title="Lưu thủ công Text1/Text2 cho tất cả folder"
          >
            {props.manualSaveState === 'saving' ? 'Đang lưu...' : 'Lưu Text1/Text2'}
          </button>
          <button
            type="button"
            className={`${styles.thumbnailAutoFillBtn} ${styles.thumbnailListCopyBtn}`}
            onClick={() => {
              void handleCopyVideoNames();
            }}
            disabled={props.items.length === 0}
            title="Copy danh sách tên file video"
          >
            Copy name video
          </button>
        </div>
      </div>
      {copyMessage && (
        <div
          className={`${styles.thumbnailListCopyStatus} ${
            copyStatus === 'success' ? styles.thumbnailListCopyStatusSuccess : styles.thumbnailListCopyStatusError
          }`}
        >
          {copyMessage}
        </div>
      )}
      {!!props.manualSaveMessage && (
        <div
          className={`${styles.thumbnailListCopyStatus} ${
            props.manualSaveState === 'success'
              ? styles.thumbnailListCopyStatusSuccess
              : props.manualSaveState === 'error'
                ? styles.thumbnailListCopyStatusError
                : ''
          }`}
        >
          {props.manualSaveMessage}
        </div>
      )}

      <div className={styles.thumbnailListToolbar}>
        <div className={styles.thumbnailToolbarBlock}>
          <div className={styles.thumbnailToolbarLabel}>Auto text1 by episode</div>
          <div className={styles.thumbnailAutoFillRow}>
            <input
              type="text"
              className={styles.thumbnailAutoFillInput}
              value={props.autoStartValue}
              onChange={(e) => props.onAutoStartValueChange(e.target.value)}
              placeholder="Nhập số bắt đầu (vd: 4 hoặc 1.)"
            />
          </div>
        </div>

        <div className={styles.thumbnailToolbarBlock}>
          <div className={styles.thumbnailToolbarLabel}>Text2 global</div>
          <div className={styles.thumbnailSecondaryGlobalRow}>
            <textarea
              className={`${styles.thumbnailAutoFillInput} ${styles.thumbnailGlobalTextarea}`}
              value={props.secondaryGlobalText}
              onChange={(e) => props.onSecondaryGlobalTextChange(e.target.value)}
              rows={2}
              placeholder="Tên phim (áp dụng cho folder chưa override)..."
            />
          </div>
        </div>

        <div className={styles.thumbnailToolbarBlock}>
          <div className={styles.thumbnailToolbarLabel}>Bulk paste JSON (lines hoặc plan)</div>
          <div className={styles.thumbnailBulkSection}>
            <textarea
              className={styles.thumbnailBulkTextarea}
              rows={6}
              value={bulkRawText}
              onChange={(e) => setBulkRawText(e.target.value)}
              placeholder='Hỗ trợ JSON lines hoặc JSON plan blocks (match/index/target).'
            />
            <div className={styles.thumbnailBulkHint}>
              JSON lines: mỗi dòng 1 object. JSON plan: 1 object có `blocks` để map hàng loạt theo match/index/range.
            </div>
            <div className={styles.thumbnailBulkActions}>
              <button
                type="button"
                className={styles.thumbnailAutoFillBtn}
                onClick={() => {
                  setBulkRawText(BULK_SAMPLE);
                  setBulkApplyResult(null);
                }}
              >
                Dán mẫu
              </button>
              <button
                type="button"
                className={styles.thumbnailAutoFillBtn}
                onClick={() => {
                  const result = props.onBulkApplyJsonLines(bulkRawText);
                  setBulkApplyResult(result);
                }}
              >
                Áp dụng danh sách
              </button>
              <button
                type="button"
                className={styles.thumbnailAutoFillBtn}
                onClick={() => {
                  setBulkRawText('');
                  setBulkApplyResult(null);
                }}
              >
                Xóa
              </button>
            </div>
            {bulkApplyResult && (
              <div
                className={`${styles.thumbnailBulkStatus} ${
                  bulkApplyResult.status === 'error'
                    ? styles.thumbnailBulkError
                    : bulkApplyResult.status === 'warning'
                      ? styles.thumbnailBulkWarning
                      : styles.thumbnailBulkSuccess
                }`}
              >
                <div>{bulkApplyResult.summary}</div>
                {bulkApplyResult.detail && (
                  <div className={styles.thumbnailBulkDetail}>{bulkApplyResult.detail}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.thumbnailListTable}>
        {props.items.map((item) => (
          <div
            key={`${item.folderPath}-${item.index}`}
            className={`${styles.thumbnailListCard} ${item.hasError ? styles.thumbnailListRowError : ''}`}
          >
            <div className={styles.thumbnailListCardHeader}>
              <div className={styles.thumbnailListHeaderLead}>
                <span className={styles.thumbnailListOrderBadge}>#{item.index}</span>
                <div className={styles.thumbnailListCardHeaderInfo}>
                  <div className={styles.thumbnailListFolder} title={item.folderPath}>
                    {item.folderName}
                  </div>
                  <div className={styles.thumbnailListVideo} title={item.videoName}>
                    {item.videoName}
                  </div>
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
