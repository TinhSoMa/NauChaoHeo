/**
 * TtsSettings - Cau hinh Voice & TTS
 */

import { useState, useCallback } from 'react';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';
import {
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
} from '../../config/captionConfig';

interface TtsSettingsProps {
  onBack: () => void;
}

export function TtsSettings({ onBack }: TtsSettingsProps) {
  const [defaultVoice, setDefaultVoice] = useState(DEFAULT_VOICE);
  const [defaultRate, setDefaultRate] = useState(DEFAULT_RATE);
  const [defaultVolume, setDefaultVolume] = useState(DEFAULT_VOLUME);

  const handleSave = useCallback(() => {
    console.log('[TtsSettings] Luu cai dat:', { defaultVoice, defaultRate, defaultVolume });
    alert('Đã lưu cài đặt TTS!');
  }, [defaultVoice, defaultRate, defaultVolume]);

  const handleReset = useCallback(() => {
    setDefaultVoice(DEFAULT_VOICE);
    setDefaultRate(DEFAULT_RATE);
    setDefaultVolume(DEFAULT_VOLUME);
  }, []);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Voice & TTS</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Giọng đọc mặc định</span>
            </div>
            <select
              value={defaultVoice}
              onChange={(e) => setDefaultVoice(e.target.value)}
              className={styles.select}
            >
              {VOICES.map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Tốc độ đọc (Rate)</span>
            </div>
            <select
              value={defaultRate}
              onChange={(e) => setDefaultRate(e.target.value)}
              className={styles.select}
            >
              {RATE_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Âm lượng (Volume)</span>
            </div>
            <select
              value={defaultVolume}
              onChange={(e) => setDefaultVolume(e.target.value)}
              className={styles.select}
            >
              {VOLUME_OPTIONS.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
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
