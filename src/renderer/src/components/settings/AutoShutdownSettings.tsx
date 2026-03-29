import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Save, RotateCcw, Power, TimerReset } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';

interface AutoShutdownSettingsProps {
  onBack: () => void;
}

const DEFAULT_DELAY_MINUTES = 5;
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 30;

function clampDelay(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_DELAY_MINUTES;
  }
  return Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, Math.round(numeric)));
}

export function AutoShutdownSettings({ onBack }: AutoShutdownSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [delayInput, setDelayInput] = useState(String(DEFAULT_DELAY_MINUTES));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await window.electronAPI.appSettings.getAll();
        if (!mounted || !res.success || !res.data) {
          return;
        }
        setEnabled(res.data.autoShutdownEnabled === true);
        setDelayInput(String(clampDelay(res.data.autoShutdownDelayMinutes)));
      } catch (error) {
        console.error('[AutoShutdownSettings] Không thể load settings:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const delayMinutes = useMemo(() => clampDelay(delayInput), [delayInput]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const result = await window.electronAPI.appSettings.update({
        autoShutdownEnabled: enabled,
        autoShutdownDelayMinutes: delayMinutes,
      });
      if (!result.success) {
        throw new Error(result.error || 'Save failed');
      }
      alert('Đã lưu cài đặt Auto Shutdown.');
    } catch (error) {
      console.error('[AutoShutdownSettings] Không thể lưu:', error);
      alert(`Không thể lưu cài đặt: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [delayMinutes, enabled]);

  const handleReset = useCallback(() => {
    setEnabled(false);
    setDelayInput(String(DEFAULT_DELAY_MINUTES));
  }, []);

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Auto Shutdown</div>
      </div>

      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Bật mặc định auto shutdown</span>
              <span className={styles.labelDesc}>
                Khi bật, toggle Auto Shutdown ở màn hình Caption sẽ mặc định ON cho run tiếp theo.
              </span>
            </div>
            <button
              type="button"
              className={`${styles.toggle} ${enabled ? styles.toggleActive : ''}`}
              onClick={() => setEnabled((prev) => !prev)}
              aria-label={enabled ? 'Tắt auto shutdown mặc định' : 'Bật auto shutdown mặc định'}
              disabled={loading || saving}
            >
              <span className={`${styles.toggleKnob} ${enabled ? styles.toggleKnobActive : ''}`} />
            </button>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Delay tắt máy (phút)</span>
              <span className={styles.labelDesc}>
                Cho phép từ {MIN_DELAY_MINUTES}-{MAX_DELAY_MINUTES} phút. Giá trị hiện tại: {delayMinutes} phút.
              </span>
            </div>
            <div className={styles.flexRow}>
              <Input
                type="number"
                value={delayInput}
                onChange={(e) => setDelayInput(e.target.value)}
                min={MIN_DELAY_MINUTES}
                max={MAX_DELAY_MINUTES}
                step={1}
                disabled={loading || saving}
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Hành vi trigger</span>
              <span className={styles.labelDesc}>
                Lên lịch tắt máy ở terminal success hoặc terminal error. User bấm Stop thì không lên lịch.
              </span>
            </div>
            <div className={styles.flexRow}>
              <Power size={16} />
              <TimerReset size={16} />
            </div>
          </div>
        </div>

        <div className={styles.saveBar}>
          <Button onClick={handleReset} variant="secondary" disabled={loading || saving}>
            <RotateCcw size={16} />
            Đặt lại mặc định
          </Button>
          <Button onClick={handleSave} variant="primary" disabled={loading || saving}>
            <Save size={16} />
            Lưu cài đặt
          </Button>
        </div>
      </div>
    </div>
  );
}
