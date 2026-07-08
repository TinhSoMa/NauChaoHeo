import styles from './Step3StreamingPopup.module.css';

type Step3StreamingPopupProps = {
  streamingChunks: Record<number, { accumulated: string; done: boolean; serverError?: string }>;
  currentBatchIndex: number | null;
  onClose: () => void;
};

export function Step3StreamingPopup({ streamingChunks, currentBatchIndex, onClose }: Step3StreamingPopupProps) {
  if (currentBatchIndex === null) return null;

  const chunk = streamingChunks[currentBatchIndex];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          {chunk ? (
            <span className={chunk.done ? styles.indicatorDone : styles.indicator} />
          ) : (
            <span className={styles.indicatorWaiting} />
          )}
          Batch #{currentBatchIndex}
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          title="Đóng"
        >
          ✕
        </button>
      </div>
      <div className={styles.body}>
        {chunk?.serverError ? (
          <span className={styles.serverError}>{chunk.serverError}</span>
        ) : chunk ? (
          chunk.accumulated
        ) : (
          <span className={styles.emptyText}>Đang chờ dữ liệu stream...</span>
        )}
      </div>
    </div>
  );
}
