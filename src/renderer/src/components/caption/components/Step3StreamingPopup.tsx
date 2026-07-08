import { useEffect, useState } from 'react';
import styles from './Step3StreamingPopup.module.css';

type Step3StreamingPopupProps = {
  streamingChunks: Record<number, { accumulated: string; done: boolean }>;
  currentBatchIndex: number | null;
};

export function Step3StreamingPopup({ streamingChunks, currentBatchIndex }: Step3StreamingPopupProps) {
  const [dismissedBatch, setDismissedBatch] = useState<number | null>(null);

  useEffect(() => {
    if (currentBatchIndex !== null && currentBatchIndex !== dismissedBatch) {
      setDismissedBatch(null);
    }
  }, [currentBatchIndex, dismissedBatch]);

  if (currentBatchIndex === null) return null;

  const chunk = streamingChunks[currentBatchIndex];
  if (!chunk || chunk.done) return null;
  if (dismissedBatch === currentBatchIndex) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.indicator} />
          Batch #{currentBatchIndex}
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => setDismissedBatch(currentBatchIndex)}
          title="Ẩn popup (batch tiếp theo sẽ hiện lại)"
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
