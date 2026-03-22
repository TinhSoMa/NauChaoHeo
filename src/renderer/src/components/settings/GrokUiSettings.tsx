import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Save, RotateCcw, Activity, FolderOpen, Plus, Trash2, RefreshCcw } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Checkbox } from '../common/Checkbox';
import sharedStyles from './Settings.module.css';
import styles from './GrokUiSettings.module.css';
import type { SettingsDetailProps } from './types';
import type {
  GrokUiHealthSnapshot,
  GrokUiProfileConfig,
  GrokUiProfileStatus,
  GrokUiProfileStatusEntry,
} from '../../../../shared/types/grokUi';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_SEC = Math.round(DEFAULT_TIMEOUT_MS / 1000);
const DEFAULT_DELAY_SEC = Math.round(DEFAULT_DELAY_MS / 1000);
const DEFAULT_PROFILE_NAME = 'Default';
const DEFAULT_PROFILE_DIR = 'C:\\Users\\congt\\AppData\\Roaming\\nauchaoheo\\grok3_profile';

type GrokUiProfileDraft = {
  id: string;
  profileDir: string;
  profileName: string;
  anonymous: boolean;
  enabled: boolean;
};

function createProfileId(seed = 'grok'): string {
  return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toProfileDraft(profile: Partial<GrokUiProfileConfig>): GrokUiProfileDraft {
  const enabled = profile.enabled === false
    || (typeof profile.enabled === 'string' && profile.enabled.trim().toLowerCase() === 'false')
    || (typeof profile.enabled === 'number' && profile.enabled === 0)
    ? false
    : true;
  return {
    id: typeof profile.id === 'string' && profile.id.trim().length > 0 ? profile.id.trim() : createProfileId(),
    profileDir: profile.profileDir ?? '',
    profileName: profile.profileName ?? DEFAULT_PROFILE_NAME,
    anonymous: profile.anonymous === true,
    enabled,
  };
}

export function GrokUiSettings({ onBack }: SettingsDetailProps) {
  const [profiles, setProfiles] = useState<GrokUiProfileDraft[]>([]);
  const [timeoutSec, setTimeoutSec] = useState(DEFAULT_TIMEOUT_SEC);
  const [requestDelaySec, setRequestDelaySec] = useState(DEFAULT_DELAY_SEC);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [createProfileError, setCreateProfileError] = useState<string | null>(null);
  const [profileStatuses, setProfileStatuses] = useState<Record<string, GrokUiProfileStatus>>({});

  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthSnapshot, setHealthSnapshot] = useState<GrokUiHealthSnapshot | null>(null);
  const isDelayLow = requestDelaySec > 0 && requestDelaySec < 3;

  const loadProfileStatuses = useCallback(async () => {
    try {
      const result = await window.electronAPI.grokUi.getProfileStatuses();
      if (!result.success || !result.data) {
        return;
      }
      const entries = result.data as GrokUiProfileStatusEntry[];
      const next: Record<string, GrokUiProfileStatus> = {};
      for (const entry of entries) {
        if (entry?.profile?.id && entry.status) {
          next[entry.profile.id] = entry.status;
        }
      }
      setProfileStatuses(next);
    } catch (error) {
      console.warn('[GrokUiSettings] Loi load profile status:', error);
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const result = await window.electronAPI.grokUi.getProfiles();
      if (result.success && result.data) {
        const items = result.data;
        setProfiles(items.map((profile) => toProfileDraft(profile)));
      }
    } catch (error) {
      console.warn('[GrokUiSettings] Loi load profiles:', error);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.appSettings.getAll();
      if (result.success && result.data) {
        const data = result.data;
        const loadedTimeoutMs = data.grokUiTimeoutMs ?? DEFAULT_TIMEOUT_MS;
        const loadedDelayMs = data.grokUiRequestDelayMs ?? DEFAULT_DELAY_MS;
        setTimeoutSec(Math.max(1, Math.round(loadedTimeoutMs / 1000)));
        setRequestDelaySec(Math.max(0, Math.round(loadedDelayMs / 1000)));
      }
    } catch (error) {
      console.error('[GrokUiSettings] Loi load settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadProfileStatuses();
    void loadProfiles();
  }, [loadProfileStatuses, loadProfiles, loadSettings]);

  const handleBrowseProfileDir = useCallback(async (index: number) => {
    try {
      const result = await window.electronAPI.invoke('dialog:openDirectory', {}) as {
        canceled: boolean;
        filePaths: string[];
      };
      if (!result.canceled && result.filePaths.length > 0) {
        setProfiles((prev) => prev.map((profile, idx) => (
          idx === index ? { ...profile, profileDir: result.filePaths[0] } : profile
        )));
      }
    } catch (error) {
      console.error('[GrokUiSettings] Loi chon thu muc profile:', error);
    }
  }, []);

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      const payloadProfiles = profiles.map((profile) => {
        const dirValue = typeof profile.profileDir === 'string' ? profile.profileDir.trim() : '';
        const nameValue = typeof profile.profileName === 'string' ? profile.profileName.trim() : '';
        return {
          id: profile.id,
          profileDir: profile.anonymous ? null : (dirValue || null),
          profileName: profile.anonymous ? null : (nameValue || null),
          anonymous: profile.anonymous,
          enabled: profile.enabled,
        };
      });
      const primaryProfile = payloadProfiles.find((profile) => profile.enabled) || payloadProfiles[0];
      const payload = {
        grokUiProfileDir: primaryProfile?.anonymous ? null : (primaryProfile?.profileDir ?? null),
        grokUiProfileName: primaryProfile?.anonymous ? null : (primaryProfile?.profileName ?? null),
        grokUiAnonymous: primaryProfile?.anonymous === true,
        grokUiTimeoutMs: Number.isFinite(timeoutSec)
          ? Math.max(10_000, Math.floor(timeoutSec * 1000))
          : DEFAULT_TIMEOUT_MS,
        grokUiRequestDelayMs: Number.isFinite(requestDelaySec)
          ? Math.max(0, Math.floor(requestDelaySec * 1000))
          : DEFAULT_DELAY_MS,
      };
      const saveProfilesResult = await window.electronAPI.grokUi.saveProfiles({ profiles: payloadProfiles });
      if (!saveProfilesResult.success) {
        alert(`Lỗi lưu Grok UI profiles: ${saveProfilesResult.error}`);
        return;
      }
      const result = await window.electronAPI.appSettings.update(payload);
      if (!result.success) {
        alert(`Lỗi lưu Grok UI settings: ${result.error}`);
        return;
      }
      alert('Đã lưu Grok UI settings!');
      void loadProfileStatuses();
    } catch (error) {
      console.error('[GrokUiSettings] Loi luu settings:', error);
      alert('Không thể lưu Grok UI settings!');
    } finally {
      setSaving(false);
    }
  }, [profiles, requestDelaySec, timeoutSec, loadProfileStatuses]);

  const handleReset = useCallback(() => {
    void loadSettings();
    void loadProfileStatuses();
  }, [loadProfileStatuses, loadSettings]);

  const handleCreateProfile = useCallback(async (profile: GrokUiProfileDraft) => {
    try {
      setCreatingProfile(true);
      setCreateProfileError(null);
      const trimmedDir = typeof profile.profileDir === 'string' ? profile.profileDir.trim() : '';
      const trimmedName = typeof profile.profileName === 'string' ? profile.profileName.trim() : '';
      const result = await window.electronAPI.grokUi.createProfile({
        id: profile.id,
        profileDir: trimmedDir.length > 0 ? trimmedDir : null,
        profileName: trimmedName.length > 0 ? trimmedName : null,
        anonymous: profile.anonymous,
      });
      if (!result.success || !result.data) {
        setCreateProfileError(result.error || 'Không thể tạo profile.');
        return;
      }
      const data = result.data;
      await loadProfiles();
      await loadProfileStatuses();
      alert(`Đã tạo profile: ${data.profilePath}`);
    } catch (error) {
      setCreateProfileError(String(error));
    } finally {
      setCreatingProfile(false);
    }
  }, [loadProfileStatuses, loadProfiles]);

  const handleAddProfile = useCallback(() => {
    setProfiles((prev) => ([
      ...prev,
      {
        id: createProfileId(),
        profileDir: '',
        profileName: DEFAULT_PROFILE_NAME,
        anonymous: false,
        enabled: true,
      },
    ]));
  }, []);

  const handleRemoveProfile = useCallback((id: string) => {
    setProfiles((prev) => prev.filter((profile) => profile.id !== id));
    void window.electronAPI.grokUi.deleteProfile({ id })
      .then(() => loadProfileStatuses())
      .catch((error) => console.warn('[GrokUiSettings] Loi xoa profile:', error));
  }, [loadProfileStatuses]);

  const handleToggleProfileEnabled = useCallback((id: string, enabled: boolean) => {
    setProfiles((prev) => prev.map((profile) => (
      profile.id === id ? { ...profile, enabled } : profile
    )));
    void window.electronAPI.grokUi.setProfileEnabled({ id, enabled })
      .then(() => loadProfileStatuses())
      .catch((error) => console.warn('[GrokUiSettings] Loi cap nhat enabled:', error));
  }, [loadProfileStatuses]);

  const handleResetStatuses = useCallback(async () => {
    try {
      const result = await window.electronAPI.grokUi.resetProfileStatuses();
      if (result.success) {
        void loadProfileStatuses();
      }
    } catch (error) {
      console.warn('[GrokUiSettings] Loi reset status:', error);
    }
  }, [loadProfileStatuses]);

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
          <div className={styles.profileToolbar}>
            <div>
              <div className={styles.profileTitle}>Profiles</div>
              <div className={sharedStyles.labelDesc}>
                Quản lý nhiều profile Grok UI. Rate limit sẽ tự chuyển sang profile tiếp theo.
              </div>
            </div>
            <div className={styles.profileToolbarActions}>
              <Button onClick={handleResetStatuses} variant="secondary" disabled={loading}>
                <RefreshCcw size={16} />
                Reset trạng thái
              </Button>
              <Button onClick={handleAddProfile} variant="primary" disabled={loading}>
                <Plus size={16} />
                Thêm profile
              </Button>
            </div>
          </div>

          <div className={styles.profileList}>
            {profiles.length === 0 && (
              <div className={styles.emptyProfiles}>Chưa có profile nào.</div>
            )}
            {profiles.map((profile, index) => {
              const status = profileStatuses[profile.id];
              const statusLabel = status?.state === 'rate_limited'
                ? 'Rate limited'
                : status?.state === 'error'
                  ? 'Error'
                  : 'OK';
              const statusClass = status?.state === 'rate_limited'
                ? styles.statusWarn
                : status?.state === 'error'
                  ? styles.statusError
                  : styles.statusOk;
              return (
                <div key={profile.id} className={styles.profileCard}>
                  <div className={styles.profileHeader}>
                    <div className={styles.profileHeaderLeft}>
                      <div className={styles.profileCardTitle}>Profile #{index + 1}</div>
                      <div className={`${styles.statusPill} ${statusClass}`}>
                        {statusLabel}
                      </div>
                    </div>
                    <div className={styles.profileHeaderRight}>
                      <Checkbox
                        label="Enabled"
                        checked={profile.enabled}
                        onChange={(checked) => handleToggleProfileEnabled(profile.id, checked)}
                        disabled={loading}
                      />
                      <Button
                        onClick={() => handleRemoveProfile(profile.id)}
                        variant="secondary"
                        disabled={loading}
                      >
                        <Trash2 size={16} />
                        Xóa
                      </Button>
                    </div>
                  </div>

                  <div className={styles.profileField}>
                    <span className={styles.profileLabel}>Profile Name</span>
                    <Input
                      value={profile.profileName}
                      onChange={(e) => setProfiles((prev) => prev.map((item) => (
                        item.id === profile.id ? { ...item, profileName: e.target.value } : item
                      )))}
                      placeholder={DEFAULT_PROFILE_NAME}
                      disabled={loading || profile.anonymous}
                    />
                  </div>

                  <div className={styles.profileField}>
                    <span className={styles.profileLabel}>Profile Directory</span>
                    <div className={styles.profileDirRow}>
                      <Input
                        value={profile.profileDir}
                        onChange={(e) => setProfiles((prev) => prev.map((item) => (
                          item.id === profile.id ? { ...item, profileDir: e.target.value } : item
                        )))}
                        placeholder={DEFAULT_PROFILE_DIR}
                        disabled={loading || profile.anonymous}
                      />
                      <Button
                        onClick={() => handleBrowseProfileDir(index)}
                        disabled={loading || profile.anonymous}
                      >
                        <FolderOpen size={16} />
                        Browse
                      </Button>
                    </div>
                  </div>

                  <div className={styles.profileField}>
                    <span className={styles.profileLabel}>Anonymous Mode</span>
                    <Checkbox
                      label="Bật ẩn danh"
                      checked={profile.anonymous}
                      onChange={(checked) => setProfiles((prev) => prev.map((item) => (
                        item.id === profile.id ? { ...item, anonymous: checked } : item
                      )))}
                      disabled={loading}
                    />
                  </div>

                  <div className={styles.profileActions}>
                    <Button
                      onClick={() => handleCreateProfile(profile)}
                      variant="secondary"
                      disabled={loading || profile.anonymous || creatingProfile}
                    >
                      {creatingProfile ? 'Đang tạo...' : 'Tạo profile'}
                    </Button>
                    {createProfileError && <div className={styles.errorText}>{createProfileError}</div>}
                  </div>
                  {status?.lastError && (
                    <div className={styles.profileError}>
                      {status.lastError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className={sharedStyles.section}>
          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Timeout (giây)</span>
              <span className={sharedStyles.labelDesc}>Thời gian chờ tối đa cho 1 batch Grok UI.</span>
            </div>
            <Input
              type="number"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Number(e.target.value))}
              min={10}
              max={300}
              variant="small"
              disabled={loading}
            />
          </div>

          <div className={sharedStyles.row}>
            <div className={sharedStyles.label}>
              <span className={sharedStyles.labelText}>Request Delay (giây)</span>
              <span className={sharedStyles.labelDesc}>
                Khoảng chờ giữa mỗi request sau khi đã nhận + lưu kết quả (ACK). Khuyến nghị ≥ 5s.
                {isDelayLow && (
                  <span className={styles.warningText}> Giá trị quá thấp, dễ bị submit locked.</span>
                )}
              </span>
            </div>
            <Input
              type="number"
              value={requestDelaySec}
              onChange={(e) => setRequestDelaySec(Number(e.target.value))}
              min={0}
              max={30}
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
