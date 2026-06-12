import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Save, RotateCcw, FolderOpen, Plus, Trash2, RefreshCcw } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Checkbox } from '../common/Checkbox';
import sharedStyles from './Settings.module.css';
import styles from './GrokUiSettings.module.css';
import type { SettingsDetailProps } from './types';
import type {
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
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());

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

  const toggleProfileExpand = useCallback((id: string) => {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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

  return (
    <div className={sharedStyles.detailContainer}>
      <div className={sharedStyles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.headerInfo}>
          <div className={sharedStyles.detailTitle}>Grok UI</div>
          <div className={styles.headerSubtitle}>
            Grok3API UI mode — quản lý profile trình duyệt & runtime.
          </div>
        </div>
      </div>

      <div className={sharedStyles.detailContent}>
        <div className={styles.grokLayout}>
          <div className={styles.leftPane}>
            <div className={`${sharedStyles.section} ${styles.sectionCompact}`}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Profiles</div>
                  <div className={styles.sectionDesc}>
                    Quản lý profile Grok UI. Rate limit sẽ tự chuyển sang profile tiếp theo.
                  </div>
                </div>
                <div className={styles.sectionActions}>
                  <Button onClick={handleResetStatuses} variant="secondary" disabled={loading}>
                    <RefreshCcw size={16} />
                    Reset
                  </Button>
                  <Button onClick={handleAddProfile} variant="primary" disabled={loading}>
                    <Plus size={16} />
                    Thêm
                  </Button>
                </div>
              </div>

              <div className={styles.profileGridScroll}>
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
                  const isExpanded = expandedProfiles.has(profile.id);
                  return (
                    <div key={profile.id} className={styles.profileRow}>
                      <div className={styles.profileSummary}>
                        <div className={styles.profileSummaryMain}>
                          <span className={styles.profileIndex}>#{index + 1}</span>
                          <div className={styles.profileRowTitle}>
                            {profile.profileName || `Profile ${index + 1}`}
                          </div>
                          <div className={`${styles.statusPill} ${statusClass}`}>
                            {statusLabel}
                          </div>
                        </div>
                        <div className={styles.profileSummaryMeta}>
                          <span className={styles.profileMetaChip}>
                            {profile.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          <span className={styles.profileMetaChip}>
                            {profile.anonymous ? 'Ẩn danh' : 'Thông thường'}
                          </span>
                          <span className={styles.profileMetaPath} title={profile.profileDir || DEFAULT_PROFILE_DIR}>
                            {profile.profileDir || DEFAULT_PROFILE_DIR}
                          </span>
                        </div>
                      </div>
                      <div className={styles.profileSummaryActions}>
                        <Button
                          onClick={() => toggleProfileExpand(profile.id)}
                          variant="secondary"
                        >
                          {isExpanded ? 'Thu gọn' : 'Xem chi tiết'}
                        </Button>
                      </div>

                      {isExpanded && (
                        <div className={styles.profileDetails}>
                          <div className={styles.profileDetailRow}>
                            <span className={styles.profileDetailLabel}>Tên profile</span>
                            <Input
                              value={profile.profileName}
                              onChange={(e) => setProfiles((prev) => prev.map((item) => (
                                item.id === profile.id ? { ...item, profileName: e.target.value } : item
                              )))}
                              placeholder={DEFAULT_PROFILE_NAME}
                              disabled={loading || profile.anonymous}
                            />
                          </div>
                          <div className={styles.profileDetailRow}>
                            <span className={styles.profileDetailLabel}>Thư mục profile</span>
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
                          <div className={styles.profileDetailActions}>
                            <Checkbox
                              label="Enabled"
                              checked={profile.enabled}
                              onChange={(checked) => handleToggleProfileEnabled(profile.id, checked)}
                              disabled={loading}
                            />
                            <Checkbox
                              label="Ẩn danh"
                              checked={profile.anonymous}
                              onChange={(checked) => setProfiles((prev) => prev.map((item) => (
                                item.id === profile.id ? { ...item, anonymous: checked } : item
                              )))}
                              disabled={loading}
                            />
                            <Button
                              onClick={() => handleCreateProfile(profile)}
                              variant="secondary"
                              disabled={loading || profile.anonymous || creatingProfile}
                            >
                              {creatingProfile ? 'Đang tạo...' : 'Tạo profile'}
                            </Button>
                            <Button
                              onClick={() => handleRemoveProfile(profile.id)}
                              variant="secondary"
                              disabled={loading}
                            >
                              <Trash2 size={16} />
                              Xóa
                            </Button>
                          </div>
                          {createProfileError && <div className={styles.errorText}>{createProfileError}</div>}
                          {status?.lastError && (
                            <div className={styles.profileError}>
                              {status.lastError}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.rightPane}>
            <div className={`${sharedStyles.section} ${styles.sectionCompact}`}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Runtime</div>
                  <div className={styles.sectionDesc}>Timeout & delay cho Grok UI.</div>
                </div>
              </div>
              <div className={styles.inlineSettings}>
                <div className={styles.settingCard}>
                  <div className={styles.settingLabel}>Timeout (giây)</div>
                  <div className={styles.settingDesc}>Thời gian chờ tối đa cho 1 batch.</div>
                  <div className={styles.settingInputRow}>
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
                </div>
                <div className={styles.settingCard}>
                  <div className={styles.settingLabel}>Request Delay (giây)</div>
                  <div className={styles.settingDesc}>
                    Khoảng chờ giữa mỗi request (ACK). Khuyến nghị ≥ 5s.
                    {isDelayLow && (
                      <span className={styles.warningText}> Giá trị quá thấp.</span>
                    )}
                  </div>
                  <div className={styles.settingInputRow}>
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
              </div>
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
