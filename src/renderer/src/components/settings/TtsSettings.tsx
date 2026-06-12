import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Save, RotateCcw, Plus, Trash2, Star } from 'lucide-react';
import styles from './TtsSettings.module.css';
import {
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
} from '../../config/captionConfig';
import type { CapcutTtsVersionData } from '../../../../preload/capcutTtsSecretsApi';

interface TtsSettingsProps {
  onBack: () => void;
}

export function TtsSettings({ onBack }: TtsSettingsProps) {
  const [defaultVoice, setDefaultVoice] = useState(DEFAULT_VOICE);
  const [defaultRate, setDefaultRate] = useState(DEFAULT_RATE);
  const [defaultVolume, setDefaultVolume] = useState(DEFAULT_VOLUME);

  const [versions, setVersions] = useState<CapcutTtsVersionData[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [activeVersion, setActiveVersion] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVersionName, setNewVersionName] = useState('');
  const versionInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const [listRes, activeRes] = await Promise.all([
      window.electronAPI.capcutTtsSecrets.list(),
      window.electronAPI.capcutTtsSecrets.get(),
    ]);

    const list = listRes.data || [];
    setVersions(list);

    const av = activeRes.data;
    if (av) setActiveVersion(av.version);

    if (list.length > 0 && !selectedVersion) {
      setSelectedVersion(list[0].version);
      setToken(list[0].token ?? '');
    } else if (list.length > 0) {
      const match = list.find((v) => v.version === selectedVersion);
      if (match) setToken(match.token ?? '');
    }
  }, [selectedVersion]);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (showAddForm && versionInputRef.current) {
      versionInputRef.current.focus();
    }
  }, [showAddForm]);

  useEffect(() => {
    const v = versions.find((x) => x.version === selectedVersion);
    if (v) setToken(v.token ?? '');
  }, [selectedVersion, versions]);

  const handleVersionChange = useCallback((ver: string) => {
    setSelectedVersion(ver);
  }, []);

  const handleAddVersion = useCallback(() => {
    setNewVersionName('');
    setShowAddForm(true);
  }, []);

  const handleConfirmAddVersion = useCallback(async () => {
    const ver = newVersionName.trim();
    if (!ver) { alert('Vui lòng nhập tên phiên bản.'); return; }
    const label = ver;

    const res = await window.electronAPI.capcutTtsSecrets.save(ver, label, { token: '' });
    if (!res.success) { alert('Lỗi: ' + (res.error || '')); return; }

    const listRes = await window.electronAPI.capcutTtsSecrets.list();
    if (listRes.data) setVersions(listRes.data);
    setSelectedVersion(ver);
    setToken('');
    setShowAddForm(false);
  }, [newVersionName]);

  const handleDeleteVersion = useCallback(async () => {
    if (!selectedVersion) return;
    const v = versions.find((x) => x.version === selectedVersion);
    const label = v?.label || selectedVersion;
    if (!window.confirm(`Xoá phiên bản "${label}"?`)) return;

    if (selectedVersion === activeVersion) {
      alert('Không thể xoá phiên bản đang active. Hãy chuyển active sang phiên bản khác trước.');
      return;
    }

    const res = await window.electronAPI.capcutTtsSecrets.delete(selectedVersion);
    if (!res.success) { alert('Lỗi: ' + (res.error || '')); return; }
    if (!res.data?.deleted) {
      alert('Không thể xoá phiên bản đang active. Hãy chuyển active sang phiên bản khác trước.');
      return;
    }

    const listRes = await window.electronAPI.capcutTtsSecrets.list();
    if (listRes.data) {
      setVersions(listRes.data);
      if (listRes.data.length > 0) {
        setSelectedVersion(listRes.data[0].version);
      } else {
        setSelectedVersion('');
        setToken('');
      }
    }
  }, [selectedVersion, versions, activeVersion]);

  const handleSetActive = useCallback(async () => {
    if (!selectedVersion) return;
    const res = await window.electronAPI.capcutTtsSecrets.setActive(selectedVersion);
    if (res.success && res.data) {
      setActiveVersion(selectedVersion);
    } else {
      alert('Lỗi: ' + (res.error || ''));
    }
  }, [selectedVersion]);

  const handleSave = useCallback(async () => {
    if (!selectedVersion) return;
    setSaving(true);

    const v = versions.find((x) => x.version === selectedVersion);
    const label = v?.label || selectedVersion;

    const res = await window.electronAPI.capcutTtsSecrets.save(selectedVersion, label, {
      token: token || null,
    });

    if (!res.success) {
      alert('Lỗi khi lưu: ' + (res.error || ''));
    } else {
      alert('Đã lưu cài đặt TTS!');
      const listRes = await window.electronAPI.capcutTtsSecrets.list();
      if (listRes.data) setVersions(listRes.data);
    }
    setSaving(false);
  }, [selectedVersion, versions, token]);

  const handleResetVoice = useCallback(() => {
    setDefaultVoice(DEFAULT_VOICE);
    setDefaultRate(DEFAULT_RATE);
    setDefaultVolume(DEFAULT_VOLUME);
  }, []);

  const selectedIsActive = selectedVersion === activeVersion;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>Voice & TTS</div>
      </div>

      <button className={styles.fixedBackBtn} onClick={onBack} title="Quay lại">
        <ArrowLeft size={20} />
      </button>
      <div className={styles.content}>
        <div className={styles.basicCard}>
          <div className={styles.cardTitle}>Cài đặt giọng đọc</div>
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Giọng đọc</span>
            <select
              value={defaultVoice}
              onChange={(e) => setDefaultVoice(e.target.value)}
              className={styles.fieldInput}
            >
              {VOICES.map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Tốc độ (Rate)</span>
            <select
              value={defaultRate}
              onChange={(e) => setDefaultRate(e.target.value)}
              className={styles.fieldInput}
            >
              {RATE_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Âm lượng</span>
            <select
              value={defaultVolume}
              onChange={(e) => setDefaultVolume(e.target.value)}
              className={styles.fieldInput}
            >
              {VOLUME_OPTIONS.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.versionCard}>
          <div className={styles.cardTitle}>Cấu hình CapCut TTS</div>
          <div className={styles.versionRow}>
            <span className={styles.fieldLabel}>Phiên bản</span>
            <select
              value={selectedVersion}
              onChange={(e) => handleVersionChange(e.target.value)}
              className={styles.versionSelect}
            >
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.label || v.version} {v.version === activeVersion ? '(đang dùng)' : ''}
                </option>
              ))}
            </select>
            <div className={styles.versionActions}>
              <button className={styles.btnIcon} onClick={handleAddVersion} title="Thêm phiên bản">
                <Plus size={16} />
              </button>
              <button className={styles.btnIcon} onClick={handleDeleteVersion} title="Xoá phiên bản">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {selectedVersion && (
            <div className={styles.activeRow}>
              {selectedIsActive ? (
                <span className={styles.activeBadge}>★ Đang dùng</span>
              ) : (
                <button className={styles.btnSecondary} onClick={handleSetActive}>
                  <Star size={14} />
                  Đặt làm mặc định
                </button>
              )}
            </div>
          )}
          {showAddForm && (
            <div className={styles.addForm}>
              <input
                ref={versionInputRef}
                className={styles.fieldInput}
                placeholder="Tên phiên bản (vd: 2.0.0)"
                value={newVersionName}
                onChange={(e) => setNewVersionName(e.target.value)}
              />
              <div className={styles.addFormActions}>
                <button className={styles.btnPrimary} onClick={handleConfirmAddVersion}>
                  Tạo
                </button>
                <button className={styles.btnSecondary} onClick={() => setShowAddForm(false)}>
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </div>

        {selectedVersion && (
          <div className={styles.configCard}>
            <div className={styles.cardTitle}>Token phiên bản</div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>token</span>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className={styles.fieldTextInput}
                placeholder="token riêng"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={styles.btnSecondary} onClick={handleResetVoice}>
              <RotateCcw size={16} />
              Đặt lại mặc định
            </button>
            <button
              className={styles.btnPrimary}
              onClick={handleSave}
              disabled={saving || !selectedVersion}
            >
              <Save size={16} />
              {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
