import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Save, RotateCcw, Activity, FolderOpen } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Checkbox } from '../common/Checkbox';
import sharedStyles from './Settings.module.css';
import styles from './GrokUiSettings.module.css';
import type { SettingsDetailProps } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_DELAY_MS = 5_000;

export function GrokUiSettings({ onBack }: SettingsDetailProps) {
  const [profileDir, setProfileDir] = useState('');
  const [profileName, setProfileName] = useState('Default');
  const [anonymous, setAnonymous] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(DEFAULT_TIMEOUT_MS);
  const [requestDelayMs, setRequestDelayMs] = useState(DEFAULT_DELAY_MS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [createProfileError, setCreateProfileError] = useState<string | null>(null);

  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthSnapshot, setHealthSnapshot] = useState<GrokUiHealthSnapshot | null>(null);
  const isDelayLow = requestDelayMs > 0 && requestDelayMs < 3000;

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.appSettings.getAll();
      if (result.success && result.data) {
        setProfileDir(result.data.grokUiProfileDir ?? '');
        setProfileName(result.data.grokUiProfileName ?? 'Default');
        setAnonymous(result.data.grokUiAnonymous === true);
        setTimeoutMs(result.data.grokUiTimeoutMs ?? DEFAULT_TIMEOUT_MS);
        setRequestDelayMs(result.data.grokUiRequestDelayMs ?? DEFAULT_DELAY_MS);
      }
    } catch (error) {
      console.error('[GrokUiSettings] Loi load settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleBrowseProfileDir = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openDirectory', {}) as {
        canceled: boolean;
        filePaths: string[];
      };
      if (!result.canceled && result.filePaths.length > 0) {
        setProfileDir(result.filePaths[0]);
      }
    } catch (error) {
      console.error('[GrokUiSettings] Loi chon thu muc profile:', error);
    }
  }, []);

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      const cleanProfileDir = profileDir.trim();
      const cleanProfileName = profileName.trim();
      const payload = {
        grokUiProfileDir: cleanProfileDir.length > 0 ? cleanProfileDir : null,
        grokUiProfileName: cleanProfileName.length > 0 ? cleanProfileName : null,
        grokUiAnonymous: anonymous,
        grokUiTimeoutMs: Number.isFinite(timeoutMs) ? Math.max(10_000, Math.floor(timeoutMs)) : DEFAULT_TIMEOUT_MS,
        grokUiRequestDelayMs: Number.isFinite(requestDelayMs) ? Math.max(0, Math.floor(requestDelayMs)) : DEFAULT_DELAY_MS,
      };
      const result = await window.electronAPI.appSettings.update(payload);
      if (!result.success) {
        alert(`Lỗi lưu Grok UI settings: ${result.error}`);
        return;
      }
      alert('Đã lưu Grok UI settings!');
    } catch (error) {
      console.error('[GrokUiSettings] Loi luu settings:', error);
      alert('Không thể lưu Grok UI settings!');
    } finally {
      setSaving(false);
    }
  }, [anonymous, profileDir, profileName, requestDelayMs, timeoutMs]);

  const handleReset = useCallback(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleCreateProfile = useCallback(async () => {
    try {
      setCreatingProfile(true);
      setCreateProfileError(null);
      const result = await window.electronAPI.grokUi.createProfile({
        profileDir: profileDir.trim() || null,
        profileName: profileName.trim() || null,
        anonymous,
      });
      if (!result.success || !result.data) {
        setCreateProfileError(result.error || 'Không thể tạo profile.');
        return;
      }
      setProfileDir(result.data.profileDir);
      setProfileName(result.data.profileName);
      alert(`Đã tạo profile: ${result.data.profilePath}`);
    } catch (error) {
      setCreateProfileError(String(error));
    } finally {
      setCreatingProfile(false);
    }
  }, [anonymous, profileDir, profileName]);

  const handleHealthCheck = useCallback(async () => {
    try {
      setHealthLoading(true);
      setHealthError(null);
      const result = await window.electronAPI.grokUi.getHealth();
      if (!result.success || !result.data) {
        setHealthSnapshot(null);
        setHealthError(result.error || 'Không thể kiểm tra Grok UI.');
        return;
      }
      setHealthSnapshot(result.data);
    } catch (error) {
      setHealthSnapshot(null);
      setHealthError(String(error));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const formattedCheckedAt = useMemo(() => {
    if (!healthSnapshot?.checkedAt) return '';
    return new Date(healthSnapshot.checkedAt).toLocaleString();
  }, [healthSnapshot?.checkedAt]);

  const grokModuleLabel = healthSnapshot
    ? (healthSnapshot.modules?.grok3api ? 'OK' : 'MISS')
    : '-';
  const driverModuleLabel = healthSnapshot
    ? (healthSnapshot.modules?.undetected_chromedriver ? 'OK' : 'MISS')
    : '-';
  const pythonStatus = healthSnapshot ? (healthSnapshot.pythonOk ? 'OK' : 'FAIL') : '---';
  const moduleStatus = healthSnapshot ? (healthSnapshot.modulesOk ? 'OK' : 'FAIL') : '---';

  return (
    <div className={sharedStyles.detailContainer}>
      <div className={sharedStyles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.headerInfo}>
          <div className={sharedStyles.detailTitle}>Grok UI</div>
          <div className={styles.headerSubtitle}>
            Dùng Grok3API UI mode với profile trình duyệt tuỳ chọn.
          </div>
        </div>
      </div>

      <div className={sharedStyles.detailContent}>
        <div className={sharedStyles.section}>
          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Profile Directory</span>
              <span className={sharedStyles.labelDesc}>
                Thư mục profile Chrome/Edge dùng cho Grok UI. Để trống sẽ dùng mặc định trong userData.
              </span>
            </div>
            <div className={sharedStyles.flexRow}>
              <Input
                value={profileDir}
                onChange={(e) => setProfileDir(e.target.value)}
                placeholder="Ví dụ: D:\\NauChaoHeo\\grok3_profile"
                disabled={loading || anonymous}
              />
              <Button onClick={handleBrowseProfileDir} disabled={loading || anonymous}>
                <FolderOpen size={16} />
                Browse
              </Button>
            </div>
          </div>

          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Profile Name</span>
              <span className={sharedStyles.labelDesc}>Tên profile Chrome/Edge (ví dụ: Default).</span>
            </div>
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Default"
              disabled={loading || anonymous}
            />
          </div>

          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Create Profile</span>
              <span className={sharedStyles.labelDesc}>
                Tạo thư mục profile tại profileDir/profileName nếu chưa có.
              </span>
              {createProfileError && <div className={styles.errorText}>{createProfileError}</div>}
            </div>
            <Button
              onClick={handleCreateProfile}
              variant="secondary"
              disabled={loading || anonymous || creatingProfile}
            >
              {creatingProfile ? 'Đang tạo...' : 'Tạo profile'}
            </Button>
          </div>

          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Anonymous Mode</span>
              <span className={sharedStyles.labelDesc}>Mở Grok UI ở chế độ ẩn danh (không dùng profile).</span>
            </div>
            <Checkbox
              label="Bật ẩn danh"
              checked={anonymous}
              onChange={setAnonymous}
              disabled={loading}
            />
          </div>
        </div>

        <div className={sharedStyles.section}>
          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Timeout (ms)</span>
              <span className={sharedStyles.labelDesc}>Thời gian chờ tối đa cho 1 batch Grok UI.</span>
            </div>
            <Input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              min={10_000}
              max={300_000}
              variant="small"
              disabled={loading}
            />
          </div>

          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Request Delay (ms)</span>
              <span className={sharedStyles.labelDesc}>
                Khoảng chờ giữa mỗi request sau khi đã nhận + lưu kết quả (ACK). Khuyến nghị ≥ 5000ms.
                {isDelayLow && (
                  <span className={styles.warningText}> Giá trị quá thấp, dễ bị submit locked.</span>
                )}
              </span>
            </div>
            <Input
              type="number"
              value={requestDelayMs}
              onChange={(e) => setRequestDelayMs(Number(e.target.value))}
              min={0}
              max={30_000}
              variant="small"
              disabled={loading}
            />
          </div>
        </div>

        <div className={sharedStyles.section}>
          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Health Check</span>
              <span className={sharedStyles.labelDesc}>
                Kiểm tra Python + module Grok3API trước khi chạy Step 3.
              </span>
            </div>
            <Button onClick={handleHealthCheck} variant="primary" disabled={healthLoading}>
              <Activity size={16} />
              {healthLoading ? 'Đang kiểm tra...' : 'Health Check'}
            </Button>
          </div>
          <div className={styles.healthGrid}>
            <div className={styles.healthCard}>
              <div className={styles.healthLabel}>Python</div>
              <div
                className={`${styles.statusPill} ${
                  pythonStatus === 'OK' ? styles.statusOk : pythonStatus === 'FAIL' ? styles.statusError : styles.statusUnknown
                }`}
              >
                {pythonStatus}
              </div>
              <div className={styles.metaText}>
                Version: <span className={styles.mono}>{healthSnapshot?.pythonVersion || '-'}</span>
              </div>
              <div className={styles.metaText}>
                Runtime: <span className={styles.mono}>{healthSnapshot?.runtimeMode || '-'}</span>
              </div>
            </div>
            <div className={styles.healthCard}>
              <div className={styles.healthLabel}>Modules</div>
              <div
                className={`${styles.statusPill} ${
                  moduleStatus === 'OK' ? styles.statusOk : moduleStatus === 'FAIL' ? styles.statusError : styles.statusUnknown
                }`}
              >
                {moduleStatus}
              </div>
              <div className={styles.metaText}>
                grok3api: <span className={styles.mono}>{grokModuleLabel}</span>
              </div>
              <div className={styles.metaText}>
                undetected_chromedriver:{' '}
                <span className={styles.mono}>{driverModuleLabel}</span>
              </div>
            </div>
            <div className={styles.healthCard}>
              <div className={styles.healthLabel}>Detail</div>
              <div className={styles.metaText}>
                Checked: <span className={styles.mono}>{formattedCheckedAt || '-'}</span>
              </div>
              <div className={styles.metaText}>
                Python path: <span className={styles.mono}>{healthSnapshot?.pythonPath || '-'}</span>
              </div>
              {healthError && <div className={styles.errorText}>{healthError}</div>}
              {healthSnapshot?.error && !healthError && (
                <div className={styles.errorText}>{healthSnapshot.error}</div>
              )}
            </div>
          </div>
        </div>

        <div className={sharedStyles.saveBar}>
          <Button onClick={handleReset} variant="secondary" disabled={saving}>
            <RotateCcw size={16} />
            Đặt lại mặc định
          </Button>
          <Button onClick={handleSave} variant="primary" disabled={saving}>
            <Save size={16} />
            {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
          </Button>
        </div>
      </div>
    </div>
  );
}
