import styles from './Step3StreamingPopup.module.css';

type Step3StreamingPopupProps = {
  streamingChunks: Record<number, { accumulated: string; done: boolean }>;
  currentBatchIndex: number | null;
  onClose: () => void;
};

export function Step3StreamingPopup({ streamingChunks, currentBatchIndex, onClose }: Step3StreamingPopupProps) {
  if (currentBatchIndex === null) return null;

  const chunk = streamingChunks[currentBatchIndex];
  if (!chunk) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={chunk.done ? styles.indicatorDone : styles.indicator} />
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
        {chunk.accumulated}
      </div>
    </div>
  );
}
