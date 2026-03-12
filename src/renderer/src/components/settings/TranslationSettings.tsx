/**
 * TranslationSettings - Cau hinh dich thuat
 */

import { useState, useCallback } from 'react';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';
import { GeminiModel } from '@shared/types/gemini';
import {
  GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETRY_COUNT,
} from '../../config/captionConfig';

interface TranslationSettingsProps {
  onBack: () => void;
}

export function TranslationSettings({ onBack }: TranslationSettingsProps) {
  const [defaultModel, setDefaultModel] = useState<GeminiModel>(DEFAULT_GEMINI_MODEL);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [retryCount, setRetryCount] = useState(DEFAULT_RETRY_COUNT);

  const handleSave = useCallback(() => {
    console.log('[TranslationSettings] Luu cai dat:', { defaultModel, batchSize, retryCount });
    alert('Đã lưu cài đặt dịch thuật!');
  }, [defaultModel, batchSize, retryCount]);

  const handleReset = useCallback(() => {
    setDefaultModel(DEFAULT_GEMINI_MODEL);
    setBatchSize(DEFAULT_BATCH_SIZE);
    setRetryCount(DEFAULT_RETRY_COUNT);
  }, []);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Dịch thuật</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>AI Model</span>
              <span className={styles.labelDesc}>Model được sử dụng để dịch nội dung</span>
            </div>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value as GeminiModel)}
              className={styles.select}
            >
              {GEMINI_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Batch Size</span>
              <span className={styles.labelDesc}>Số dòng caption xử lý trong một lần gọi API</span>
            </div>
            <Input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              min={10}
              max={200}
              variant="small"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Retry Count</span>
              <span className={styles.labelDesc}>Số lần thử lại khi gặp lỗi API</span>
            </div>
            <Input
              type="number"
              value={retryCount}
              onChange={(e) => setRetryCount(Number(e.target.value))}
              min={0}
              max={10}
              variant="small"
            />
          </div>
        </div>

        <div className={styles.saveBar}>
          <Button onClick={handleReset} variant="secondary">
            <RotateCcw size={16} />
            Đặt lại mặc định
          </Button>
          <Button onClick={handleSave} variant="primary">
            <Save size={16} />
            Lưu cài đặt
          </Button>
        </div>
      </div>
    </div>
  );
}
