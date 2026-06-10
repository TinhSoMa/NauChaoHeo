import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Save, RotateCcw, Plus, Trash2, Star, Undo2 } from 'lucide-react';
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

interface CapcutForm {
  appKey: string;
  token: string;
  wsUrl: string;
  userAgent: string;
  xSsDp: string;
  extraHeaders: string;
}

const EMPTY_FORM: CapcutForm = {
  appKey: '',
  token: '',
  wsUrl: '',
  userAgent: '',
  xSsDp: '',
  extraHeaders: '',
};

const DEFAULT_150: CapcutForm = {
  appKey: '',
  token: '',
  wsUrl: 'wss://wss-global.zijieapi.com/ws',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  xSsDp: '',
  extraHeaders: '',
};

function toForm(v: CapcutTtsVersionData): CapcutForm {
  return {
    appKey: v.appKey ?? '',
    token: v.token ?? '',
    wsUrl: v.wsUrl || '',
    userAgent: v.userAgent || '',
    xSsDp: v.xSsDp ?? '',
    extraHeaders: v.extraHeaders ? JSON.stringify(v.extraHeaders, null, 2) : '',
  };
}

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
  const [form, setForm] = useState<CapcutForm>(EMPTY_FORM);
  const [showSecrets, setShowSecrets] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVersionName, setNewVersionName] = useState('');
  const prevSelectedVersion = useRef(selectedVersion);
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
      setForm(toForm(list[0]));
    } else if (list.length > 0) {
      const match = list.find((v) => v.version === selectedVersion);
      if (match) setForm(toForm(match));
    }
  }, [selectedVersion]);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (selectedVersion !== prevSelectedVersion.current) {
      prevSelectedVersion.current = selectedVersion;
      const v = versions.find((x) => x.version === selectedVersion);
      if (v) setForm(toForm(v));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion]);

  useEffect(() => {
    if (showAddForm && versionInputRef.current) {
      versionInputRef.current.focus();
    }
  }, [showAddForm]);

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

    const template = versions.find((v) => v.version === activeVersion);
    const payload = template
      ? {
          appKey: '',
          token: '',
          wsUrl: template.wsUrl,
          userAgent: template.userAgent,
          xSsDp: '',
          extraHeaders: null as Record<string, string> | null,
        }
      : {
          appKey: '',
          token: '',
          wsUrl: DEFAULT_150.wsUrl,
          userAgent: DEFAULT_150.userAgent,
          xSsDp: '',
          extraHeaders: null as Record<string, string> | null,
        };

    const res = await window.electronAPI.capcutTtsSecrets.save(ver, label, payload);
    if (!res.success) { alert('Lỗi: ' + (res.error || '')); return; }

    const listRes = await window.electronAPI.capcutTtsSecrets.list();
    if (listRes.data) setVersions(listRes.data);
    setSelectedVersion(ver);
    setForm({
      appKey: payload.appKey ?? '',
      token: payload.token ?? '',
      wsUrl: payload.wsUrl || '',
      userAgent: payload.userAgent || '',
      xSsDp: payload.xSsDp ?? '',
      extraHeaders: '',
    });
    setShowAddForm(false);
  }, [newVersionName, versions, activeVersion]);

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
        setForm(EMPTY_FORM);
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

  const handleResetDefaults = useCallback(async () => {
    if (!selectedVersion) return;
    if (!window.confirm(`Reset tất cả fields của "${selectedVersion}" về giá trị mặc định của phiên bản 1.5.0?`)) return;

    const v150 = versions.find((x) => x.version === '1.5.0');
    if (!v150) { alert('Không tìm thấy phiên bản 1.5.0 (mặc định).'); return; }

    setForm(toForm(v150));
  }, [selectedVersion, versions]);

  const handleSave = useCallback(async () => {
    if (!selectedVersion) return;
    setSaving(true);

    let extraHeaders: Record<string, string> | null = null;
    const h = form.extraHeaders.trim();
    if (h) {
      try {
        extraHeaders = JSON.parse(h);
        if (typeof extraHeaders !== 'object' || extraHeaders === null || Array.isArray(extraHeaders)) {
          alert('extraHeaders phải là object JSON.');
          setSaving(false); return;
        }
      } catch {
        alert('extraHeaders không đúng định dạng JSON.');
        setSaving(false); return;
      }
    }

    const v = versions.find((x) => x.version === selectedVersion);
    const label = v?.label || selectedVersion;

    const res = await window.electronAPI.capcutTtsSecrets.save(selectedVersion, label, {
      appKey: form.appKey || null,
      token: form.token || null,
      wsUrl: form.wsUrl || undefined,
      userAgent: form.userAgent || undefined,
      xSsDp: form.xSsDp || null,
      extraHeaders,
    });

    if (!res.success) {
      alert('Lỗi khi lưu: ' + (res.error || ''));
    } else {
      alert('Đã lưu cài đặt TTS!');
      const listRes = await window.electronAPI.capcutTtsSecrets.list();
      if (listRes.data) setVersions(listRes.data);
    }
    setSaving(false);
  }, [selectedVersion, versions, form]);

  const handleResetVoice = useCallback(() => {
    setDefaultVoice(DEFAULT_VOICE);
    setDefaultRate(DEFAULT_RATE);
    setDefaultVolume(DEFAULT_VOLUME);
  }, []);

  const selectedIsActive = selectedVersion === activeVersion;
  const isDefault150 = selectedVersion === '1.5.0';

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
            <div className={styles.cardTitle}>Thông số phiên bản</div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>appKey</span>
              <input
                type={showSecrets ? 'text' : 'password'}
                value={form.appKey}
                onChange={(e) => setForm((p) => ({ ...p, appKey: e.target.value }))}
                className={styles.fieldTextInput}
                placeholder="appKey riêng"
              />
            </div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>token</span>
              <input
                type={showSecrets ? 'text' : 'password'}
                value={form.token}
                onChange={(e) => setForm((p) => ({ ...p, token: e.target.value }))}
                className={styles.fieldTextInput}
                placeholder="token riêng"
              />
            </div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>wsUrl</span>
              <input
                type="text"
                value={form.wsUrl}
                onChange={(e) => setForm((p) => ({ ...p, wsUrl: e.target.value }))}
                className={styles.fieldTextInput}
                placeholder="wss://..."
              />
            </div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>userAgent</span>
              <input
                type="text"
                value={form.userAgent}
                onChange={(e) => setForm((p) => ({ ...p, userAgent: e.target.value }))}
                className={styles.fieldTextInput}
                placeholder="User-Agent"
              />
            </div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>xSsDp</span>
              <input
                type="text"
                value={form.xSsDp}
                onChange={(e) => setForm((p) => ({ ...p, xSsDp: e.target.value }))}
                className={styles.fieldTextInput}
                placeholder="X-SS-DP header"
              />
            </div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>extraHeaders</span>
              <textarea
                value={form.extraHeaders}
                onChange={(e) => setForm((p) => ({ ...p, extraHeaders: e.target.value }))}
                className={styles.fieldTextarea}
                placeholder='{"key": "value"}'
                rows={3}
              />
            </div>
            {!isDefault150 && (
              <div className={styles.resetRow}>
                <button className={styles.btnSecondary} onClick={handleResetDefaults}>
                  <Undo2 size={14} />
                  Reset về mặc định (1.5.0)
                </button>
              </div>
            )}
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={showSecrets}
                onChange={(e) => setShowSecrets(e.target.checked)}
              />
              Hiển thị giá trị bí mật
            </label>
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
