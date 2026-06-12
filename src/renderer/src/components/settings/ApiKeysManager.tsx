import { useState, useCallback, useEffect, useMemo } from 'react';
import { ArrowLeft, RotateCcw, Upload, Download, RefreshCw, AlertCircle, CheckCircle, XCircle, Clock, ChevronRight, Plus, Edit3, Trash2, Save, FileText } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './ApiKeysManager.module.css';

const API_WORKER_MIN = 1;
const API_WORKER_MAX = 10;
const API_DELAY_MIN_SEC = 0;
const API_DELAY_MAX_SEC = 30;

interface ApiKeysManagerProps {
  onBack: () => void;
}

type StatusTabFilter = 'all' | 'available' | 'rate_limited' | 'exhausted' | 'error' | 'disabled';

function getWorstAccountStatus(account: ApiAccountItem): string {
  if (account.accountStatus === 'disabled') return 'disabled';
  const order = ['error', 'exhausted', 'rate_limited', 'available'] as const;
  for (const status of order) {
    if (account.projects.some((p) => p.status === status)) return status;
  }
  return 'available';
}

function getStatusCounts(projects: ApiProjectItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of projects) {
    counts[p.status] = (counts[p.status] || 0) + 1;
  }
  return counts;
}

const WORST_PASCAL: Record<string, string> = {
  error: 'Error',
  exhausted: 'Exhausted',
  rate_limited: 'RateLimited',
  available: 'Available',
  disabled: 'Disabled',
};

const STATUS_TABS: { key: StatusTabFilter; label: string; color: string }[] = [
  { key: 'all', label: 'Tất cả', color: '' },
  { key: 'available', label: 'Sẵn sàng', color: '#10b981' },
  { key: 'rate_limited', label: 'Rate limit', color: '#f59e0b' },
  { key: 'exhausted', label: 'Hết quota', color: '#6366f1' },
  { key: 'error', label: 'Lỗi', color: '#ef4444' },
  { key: 'disabled', label: 'Đã tắt', color: '#64748b' },
];

interface ApiProjectItem {
  projectIndex: number;
  projectName: string;
  status: string;
  apiKey: string;
  totalRequestsToday: number;
  successCount: number;
  errorCount: number;
  lastUsedTimestamp: string | null;
  lastErrorMessage: string | null;
}

interface ApiAccountItem {
  email: string;
  accountId: string;
  accountStatus: string;
  projects: ApiProjectItem[];
}

export function ApiKeysManager({ onBack }: ApiKeysManagerProps) {
  const [apiAccounts, setApiAccounts] = useState<ApiAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [pendingAccountIds, setPendingAccountIds] = useState<Set<string>>(new Set());
  const [pendingProjectKeys, setPendingProjectKeys] = useState<Set<string>>(new Set());
  const [statusTabFilter, setStatusTabFilter] = useState<StatusTabFilter>('all');
  const [apiWorkerInput, setApiWorkerInput] = useState('1');
  const [savedApiWorkerCount, setSavedApiWorkerCount] = useState(1);
  const [isSavingApiWorker, setIsSavingApiWorker] = useState(false);
  const [apiDelayInput, setApiDelayInput] = useState('0.5');
  const [savedApiDelaySec, setSavedApiDelaySec] = useState(0.5);
  const [isSavingApiDelay, setIsSavingApiDelay] = useState(false);
  const [editingProject, setEditingProject] = useState<{ accountId: string; projectIndex: number; name: string; notes: string } | null>(null);
  const [addingProjectAccountId, setAddingProjectAccountId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectKey, setNewProjectKey] = useState('');
  const [newProjectNotes, setNewProjectNotes] = useState('');
  const [showImportText, setShowImportText] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<{ email: string; keys: string[] }[] | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [addAccountEmail, setAddAccountEmail] = useState('');
  const [addAccountKeys, setAddAccountKeys] = useState('');

  const loadApiKeysInfo = useCallback(async () => {
    try {
      setLoading(true);
      const accountsRes = await window.electronAPI.gemini.getAllKeysWithStatus();
      if (accountsRes.success && accountsRes.data) {
        setApiAccounts(accountsRes.data as ApiAccountItem[]);
      }
      const settingsRes = await window.electronAPI.appSettings.getAll();
      if (settingsRes.success && settingsRes.data) {
        const appSettings = settingsRes.data as unknown as {
          apiWorkerCount?: number;
          apiRequestDelayMs?: number;
        };
        const raw = Number(appSettings.apiWorkerCount);
        const normalized = Number.isFinite(raw) ? Math.min(API_WORKER_MAX, Math.max(API_WORKER_MIN, Math.floor(raw))) : API_WORKER_MIN;
        setApiWorkerInput(String(normalized));
        setSavedApiWorkerCount(normalized);
        const rawDelayMs = Number(appSettings.apiRequestDelayMs);
        const normalizedDelayMs = Number.isFinite(rawDelayMs)
          ? Math.min(API_DELAY_MAX_SEC * 1000, Math.max(API_DELAY_MIN_SEC * 1000, Math.floor(rawDelayMs)))
          : 500;
        const delaySec = Math.max(API_DELAY_MIN_SEC, Math.min(API_DELAY_MAX_SEC, normalizedDelayMs / 1000));
        setApiDelayInput(String(delaySec));
        setSavedApiDelaySec(delaySec);
      }
    } catch (err) {
      console.error('[ApiKeysManager] Loi load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadApiKeysInfo(); }, [loadApiKeysInfo]);
  useEffect(() => {
    const unsub = window.electronAPI.gemini.onGeminiKeysReloaded(() => loadApiKeysInfo());
    return unsub;
  }, [loadApiKeysInfo]);

  const toggleAccountExpand = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  // Auto-expand first account on load
  useEffect(() => {
    if (apiAccounts.length > 0 && expandedAccounts.size === 0) {
      setExpandedAccounts(new Set([apiAccounts[0].accountId]));
    }
  }, [apiAccounts]);

  const startEditProject = (accountId: string, projectIndex: number, name: string, notes: string) => {
    setEditingProject({ accountId, projectIndex, name, notes });
  };

  const cancelEditProject = () => setEditingProject(null);

  const saveEditProject = async () => {
    if (!editingProject) return;
    const trimmed = editingProject.name.trim();
    if (!trimmed) { alert('Tên project không được để trống.'); return; }
    try {
      const res = await window.electronAPI.gemini.updateProject(editingProject.accountId, editingProject.projectIndex, {
        projectName: trimmed,
        notes: editingProject.notes,
      });
      if (res.success) cancelEditProject();
      else alert(res.error || 'Không thể cập nhật.');
    } catch (err) {
      console.error('[ApiKeysManager] Loi update:', err);
      alert('Không thể cập nhật project.');
    }
  };

  const confirmDeleteProject = async (accountId: string, projectIndex: number) => {
    if (!confirm('Xóa project này?')) return;
    try {
      const res = await window.electronAPI.gemini.removeProject(accountId, projectIndex);
      if (!res.success) alert(res.error || 'Không thể xóa.');
    } catch (err) {
      console.error('[ApiKeysManager] Loi xoa:', err);
      alert('Không thể xóa project.');
    }
  };

  const startAddProject = (accountId: string) => {
    setAddingProjectAccountId(accountId);
    setNewProjectName('');
    setNewProjectKey('');
    setNewProjectNotes('');
  };

  const cancelAddProject = () => {
    setAddingProjectAccountId(null);
    setNewProjectName('');
    setNewProjectKey('');
    setNewProjectNotes('');
  };

  const saveAddProject = async () => {
    if (!addingProjectAccountId) return;
    const name = newProjectName.trim();
    const key = newProjectKey.trim();
    if (!name || !key) { alert('Tên và API key không được để trống.'); return; }
    try {
      const res = await window.electronAPI.gemini.addProject(addingProjectAccountId, {
        projectName: name,
        apiKey: key,
        notes: newProjectNotes.trim(),
      });
      if (res.success) cancelAddProject();
      else alert(res.error || 'Không thể thêm.');
    } catch (err) {
      console.error('[ApiKeysManager] Loi them:', err);
      alert('Không thể thêm project.');
    }
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await window.electronAPI.gemini.importKeys(text);
      if (res.success) { alert(`✅ Import ${res.data?.count} keys!`); loadApiKeysInfo(); }
      else alert(`❌ ${res.error}`);
    } catch (err) {
      console.error('[ApiKeysManager] Loi doc file:', err);
      alert('Không thể đọc file');
    }
    e.target.value = '';
  };

  const handleExportJson = async () => {
    try {
      const res = await window.electronAPI.gemini.exportKeys();
      if (res.success && res.data) {
        const blob = new Blob([res.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gemini_keys_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('✅ Export thành công!');
      } else alert(`❌ ${res.error}`);
    } catch (err) {
      console.error('[ApiKeysManager] Loi export:', err);
      alert('Không thể export');
    }
  };

  const parseImportText = (text: string) => {
    setImportText(text);
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (lines.length === 0) { setImportPreview(null); return; }
    const preview: { email: string; keys: string[] }[] = [];
    let currentEmail = '';
    let currentKeys: string[] = [];
    for (const line of lines) {
      if (line.includes('@') && !line.startsWith('AIza') && !line.startsWith('sk-')) {
        if (currentEmail && currentKeys.length > 0) preview.push({ email: currentEmail, keys: [...currentKeys] });
        currentEmail = line;
        currentKeys = [];
      } else {
        if (!currentEmail) currentEmail = 'default@account';
        currentKeys.push(line);
      }
    }
    if (currentEmail && currentKeys.length > 0) preview.push({ email: currentEmail, keys: [...currentKeys] });
    setImportPreview(preview.length > 0 ? preview : null);
  };

  const handleImportText = async () => {
    if (!importText.trim()) { alert('Vui lòng nhập dữ liệu.'); return; }
    try {
      const res = await window.electronAPI.gemini.importKeysFromText(importText);
      if (res.success) {
        alert(`✅ Import ${res.data?.count} keys!`);
        setShowImportText(false);
        setImportText('');
        setImportPreview(null);
        loadApiKeysInfo();
      } else alert(`❌ ${res.error}`);
    } catch (err) {
      console.error('[ApiKeysManager] Loi import text:', err);
      alert('Không thể import text');
    }
  };

  const handleAddAccount = async () => {
    const email = addAccountEmail.trim();
    const keysText = addAccountKeys.trim();
    if (!email || !keysText) { alert('Nhập email và ít nhất 1 key.'); return; }
    const keyLines = keysText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (keyLines.length === 0) { alert('Không có key hợp lệ.'); return; }
    try {
      const projects = keyLines.map((k, i) => ({ projectName: `Key-${i + 1}`, apiKey: k }));
      const res = await window.electronAPI.gemini.addAccount(email, projects);
      if (res.success) {
        alert(`✅ Đã thêm ${email} với ${keyLines.length} keys!`);
        setShowAddAccount(false);
        setAddAccountEmail('');
        setAddAccountKeys('');
        loadApiKeysInfo();
      } else alert(`❌ ${res.error}`);
    } catch (err) {
      console.error('[ApiKeysManager] Loi add account:', err);
      alert('Không thể thêm account');
    }
  };

  const handleResetAllKeyStatus = async () => {
    if (!confirm('Reset trạng thái tất cả keys?')) return;
    try {
      const res = await window.electronAPI.gemini.resetAllStatus();
      if (res.success) { alert('✅ Reset thành công!'); loadApiKeysInfo(); }
      else alert(`❌ ${res.error}`);
    } catch (err) {
      console.error('[ApiKeysManager] Loi reset:', err);
      alert('Không thể reset');
    }
  };

  const handleSaveApiWorkerCount = async () => {
    const trimmed = apiWorkerInput.trim();
    if (!/^\d+$/.test(trimmed)) { alert(`Số từ ${API_WORKER_MIN}-${API_WORKER_MAX}.`); return; }
    const nextValue = Number(trimmed);
    if (!Number.isFinite(nextValue) || nextValue < API_WORKER_MIN || nextValue > API_WORKER_MAX) { alert(`Số từ ${API_WORKER_MIN}-${API_WORKER_MAX}.`); return; }
    try {
      setIsSavingApiWorker(true);
      const result = await window.electronAPI.appSettings.update({ apiWorkerCount: nextValue } as any);
      if (result.success) { setSavedApiWorkerCount(nextValue); setApiWorkerInput(String(nextValue)); }
      else alert('Lỗi cập nhật.');
    } catch (error) {
      console.error('[ApiKeysManager] Error updating apiWorkerCount:', error);
      alert('Lỗi cập nhật.');
    } finally { setIsSavingApiWorker(false); }
  };

  const handleSaveApiDelay = async () => {
    const trimmed = apiDelayInput.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) { alert(`Delay từ ${API_DELAY_MIN_SEC}-${API_DELAY_MAX_SEC}s.`); return; }
    const nextSec = Number(trimmed);
    if (!Number.isFinite(nextSec) || nextSec < API_DELAY_MIN_SEC || nextSec > API_DELAY_MAX_SEC) { alert(`Delay từ ${API_DELAY_MIN_SEC}-${API_DELAY_MAX_SEC}s.`); return; }
    try {
      setIsSavingApiDelay(true);
      const nextMs = Math.floor(nextSec * 1000);
      const result = await window.electronAPI.appSettings.update({ apiRequestDelayMs: nextMs } as any);
      if (result.success) { setSavedApiDelaySec(nextSec); setApiDelayInput(String(nextSec)); }
      else alert('Lỗi cập nhật.');
    } catch (error) {
      console.error('[ApiKeysManager] Error updating apiRequestDelayMs:', error);
      alert('Lỗi cập nhật.');
    } finally { setIsSavingApiDelay(false); }
  };

  const toggleErrorMessage = (projectKey: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(projectKey)) next.delete(projectKey);
      else next.add(projectKey);
      return next;
    });
  };

  const markAccountPending = (accountId: string, pending: boolean) => {
    setPendingAccountIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  };

  const markProjectPending = (projectKey: string, pending: boolean) => {
    setPendingProjectKeys((prev) => {
      const next = new Set(prev);
      if (pending) next.add(projectKey);
      else next.delete(projectKey);
      return next;
    });
  };

  const handleToggleAccountStatus = async (account: ApiAccountItem) => {
    const accountId = account.accountId;
    const shouldDisable = account.accountStatus !== 'disabled';
    try {
      markAccountPending(accountId, true);
      const result = shouldDisable
        ? await window.electronAPI.gemini.disableAccount(accountId)
        : await window.electronAPI.gemini.enableAccount(accountId);
      if (!result.success) { alert(result.error || 'Lỗi'); return; }
      await loadApiKeysInfo();
    } catch (error) {
      console.error('[ApiKeysManager] Toggle account:', error);
      alert('Lỗi cập nhật.');
    } finally { markAccountPending(accountId, false); }
  };

  const handleToggleProjectStatus = async (account: ApiAccountItem, project: ApiProjectItem) => {
    const projectKey = `${account.accountId}:${project.projectIndex}`;
    const shouldDisable = project.status !== 'disabled';
    try {
      markProjectPending(projectKey, true);
      const result = shouldDisable
        ? await window.electronAPI.gemini.disableProject(account.accountId, project.projectIndex)
        : await window.electronAPI.gemini.enableProject(account.accountId, project.projectIndex);
      if (!result.success) { alert(result.error || 'Lỗi'); return; }
      await loadApiKeysInfo();
    } catch (error) {
      console.error('[ApiKeysManager] Toggle project:', error);
      alert('Lỗi cập nhật.');
    } finally { markProjectPending(projectKey, false); }
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins}ph trước`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h trước`;
    return `${Math.floor(diffMins / 1440)}d trước`;
  };

  const getStatusStyle = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      available: { bg: '#10b98118', text: '#10b981', label: 'Sẵn sàng' },
      rate_limited: { bg: '#f59e0b18', text: '#f59e0b', label: 'Rate limit' },
      exhausted: { bg: '#6366f118', text: '#6366f1', label: 'Hết quota' },
      error: { bg: '#ef444418', text: '#ef4444', label: 'Lỗi' },
      disabled: { bg: '#64748b30', text: '#64748b', label: 'Đã tắt' },
    };
    return map[status] || map.available;
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: apiAccounts.length };
    for (const acc of apiAccounts) {
      const worst = getWorstAccountStatus(acc);
      counts[worst] = (counts[worst] || 0) + 1;
    }
    return counts;
  }, [apiAccounts]);

  const filteredAccounts = useMemo(() => {
    return apiAccounts.filter((acc) => {
      if (statusTabFilter === 'all') return true;
      return getWorstAccountStatus(acc) === statusTabFilter;
    });
  }, [statusTabFilter, apiAccounts]);

  const totalProjects = apiAccounts.reduce((sum, acc) => sum + acc.projects.length, 0);
  const availableProjects = apiAccounts.reduce((sum, acc) => sum + acc.projects.filter((p) => p.status !== 'disabled').length, 0);
  const disabledProjects = apiAccounts.reduce((sum, acc) => sum + acc.projects.filter((p) => p.status === 'disabled').length, 0);
  const totalSuccess = apiAccounts.reduce((sum, acc) => sum + acc.projects.reduce((s, p) => s + (p.successCount || 0), 0), 0);
  const totalErrors = apiAccounts.reduce((sum, acc) => sum + acc.projects.reduce((s, p) => s + (p.errorCount || 0), 0), 0);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>Quản lý API Keys</span>
        <div className={styles.headerFilters}>
          <span className={styles.headerFilterLabel}>Lọc:</span>
          <div className={styles.statusTabs}>
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                className={`${styles.statusTab} ${statusTabFilter === tab.key ? styles.statusTabActive : ''}`}
                style={statusTabFilter === tab.key && tab.color ? { borderColor: tab.color, color: tab.color } : undefined}
                onClick={() => setStatusTabFilter(tab.key)}
              >
                {tab.color && <span className={styles.statusTabDot} style={{ background: tab.color }} />}
                {tab.label}
                <span className={styles.statusTabCount}>{statusCounts[tab.key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.headerActions}>
          <input type="file" accept=".json" style={{ display: 'none' }} id="import-json-input" onChange={handleImportJson} />
          <input type="file" accept=".txt,.csv" style={{ display: 'none' }} id="import-text-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) { file.text().then((text) => { parseImportText(text); setShowImportText(true); }); }
              e.target.value = '';
            }}
          />
          <button className={styles.actionBtn} onClick={() => document.getElementById('import-json-input')?.click()}>
            <Upload size={14} /> Import JSON
          </button>
          <button className={styles.actionBtn} onClick={() => setShowImportText(true)}>
            <FileText size={14} /> Import Text
          </button>
          <button className={styles.actionBtn} onClick={handleExportJson}>
            <Download size={14} /> Export
          </button>
          <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleResetAllKeyStatus}>
            <RefreshCw size={14} /> Reset
          </button>
        </div>
      </div>

      {/* KPI Bar */}
      <div className={styles.kpiBar}>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Tài khoản</span>
          <span className={styles.kpiValue}>{apiAccounts.length}</span>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Keys bật</span>
          <span className={styles.kpiValue}>{availableProjects}/{totalProjects}</span>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Keys tắt</span>
          <span className={styles.kpiValue}>{disabledProjects}</span>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Thành công</span>
          <span className={styles.kpiValue}>{totalSuccess.toLocaleString()}</span>
        </div>
        <div className={styles.kpiItem}>
          <span className={styles.kpiLabel}>Lỗi</span>
          <span className={styles.kpiValue}>{totalErrors.toLocaleString()}</span>
        </div>
      </div>

      {/* Runtime Config */}
      <div style={{ padding: '0 24px', flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', gap: 16, padding: '10px 0', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>Worker API:</span>
            <input type="number" min={API_WORKER_MIN} max={API_WORKER_MAX} value={apiWorkerInput}
              onChange={(e) => setApiWorkerInput(e.target.value)}
              style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: 13, outline: 'none' }}
            />
            <button className={styles.smallBtn} onClick={handleSaveApiWorkerCount}
              disabled={isSavingApiWorker || Number(apiWorkerInput) === savedApiWorkerCount}>
              Lưu
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>Delay request:</span>
            <input type="number" min={API_DELAY_MIN_SEC} max={API_DELAY_MAX_SEC} step="0.1" value={apiDelayInput}
              onChange={(e) => setApiDelayInput(e.target.value)}
              style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', fontSize: 13, outline: 'none' }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>giây</span>
            <button className={styles.smallBtn} onClick={handleSaveApiDelay}
              disabled={isSavingApiDelay || Number(apiDelayInput) === savedApiDelaySec}>
              Lưu
            </button>
          </div>
        </div>
      </div>

      {/* Body: Account List */}
      <div className={styles.body}>
        {loading && filteredAccounts.length === 0 ? (
          <div className={styles.loadingText}>Đang tải...</div>
        ) : filteredAccounts.length === 0 ? (
          <div className={styles.emptyState}>
            <KeyIcon className={styles.emptyIcon} />
            <span>Chưa có API keys. Thêm account mới hoặc import file.</span>
          </div>
        ) : (
          filteredAccounts.map((acc) => {
            const isExpanded = expandedAccounts.has(acc.accountId);
            const isPending = pendingAccountIds.has(acc.accountId);
            return (
              <div key={acc.accountId} className={`${styles.accountCard} ${styles[`cardWorst${WORST_PASCAL[getWorstAccountStatus(acc)] || ''}`] || ''}`}>
                <div className={`${styles.accountHeader} ${styles[`headerBg${WORST_PASCAL[getWorstAccountStatus(acc)] || ''}`] || ''}`} onClick={() => toggleAccountExpand(acc.accountId)}>
                  <div className={`${styles.accountStatusDot} ${styles[`accountStatusDot${WORST_PASCAL[getWorstAccountStatus(acc)] || ''}`] || ''}`} />
                  <span className={`${styles.accountEmail} ${styles[`emailWorst${WORST_PASCAL[getWorstAccountStatus(acc)] || ''}`] || ''}`}>{acc.email}</span>
                  <div className={styles.accSummary}>
                    {Object.entries(getStatusCounts(acc.projects)).map(([status, count]) => {
                      const chipMap: Record<string, string> = { available: 'Ok', rate_limited: 'Rl', exhausted: 'Ex', error: 'Err', disabled: 'Dis' };
                      const clsMap: Record<string, string> = { available: 'accSummaryChipOk', rate_limited: 'accSummaryChipRl', exhausted: 'accSummaryChipEx', error: 'accSummaryChipErr', disabled: 'accSummaryChipDis' };
                      return (
                        <span key={status} className={`${styles.accSummaryChip} ${styles[clsMap[status]] || ''}`}>
                          {chipMap[status] || status} {count}
                        </span>
                      );
                    })}
                  </div>
                  <span className={styles.accountKeyCount}>{acc.projects.length} key{acc.projects.length !== 1 ? 's' : ''}</span>
                  <ChevronRight size={16} className={`${styles.accountExpandIcon} ${isExpanded ? styles.accountExpandIconOpen : ''}`} />
                  <div className={styles.accountActions} onClick={(e) => e.stopPropagation()}>
                    <button className={`${styles.smallBtn} ${acc.accountStatus === 'disabled' ? styles.smallBtnSuccess : ''}`}
                      onClick={() => handleToggleAccountStatus(acc)} disabled={isPending}>
                      {isPending ? '...' : (acc.accountStatus === 'disabled' ? 'Bật' : 'Tắt')}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className={styles.accountBody}>
                    {acc.projects.map((p) => {
                      const statusStyle = getStatusStyle(p.status);
                      const projectKey = `${acc.accountId}:${p.projectIndex}`;
                      const isErrorExpanded = expandedErrors.has(projectKey);
                      const hasError = Boolean(p.lastErrorMessage) && p.errorCount > 0;
                      const isPendingProj = pendingProjectKeys.has(projectKey);

                      return (
                        <div key={projectKey}>
                          <div className={`${styles.projectRow} ${styles[`projBorder${WORST_PASCAL[p.status] || ''}`] || ''}`}>
                            <div className={styles.projectMain}>
                              <span className={styles.projectBadge} style={{ background: statusStyle.bg, color: statusStyle.text }}>
                                {statusStyle.label}
                              </span>
                              <span className={styles.projectName}>{p.projectName}</span>
                              {p.errorCount > 0 && (
                                <span className={styles.errorCountBadge}>!{p.errorCount}</span>
                              )}
                              <span className={styles.projectKey}>{p.apiKey}</span>
                            </div>
                            <div className={styles.projectStats}>
                              <span className={`${styles.statChip} ${styles.statChipOk}`}>OK {p.successCount || 0}</span>
                              <span className={`${styles.statChip} ${p.errorCount > 0 ? styles.statChipErr : ''}`}>Err {p.errorCount || 0}</span>
                              {p.totalRequestsToday > 0 && <span className={styles.statChip}>Hnay {p.totalRequestsToday}</span>}
                              {p.lastUsedTimestamp && <span className={styles.projectTime}>{formatTimestamp(p.lastUsedTimestamp)}</span>}
                            </div>
                            <div className={styles.projectActions}>
                              <button className={`${styles.smallBtn} ${p.status === 'disabled' ? styles.smallBtnSuccess : ''}`}
                                onClick={() => handleToggleProjectStatus(acc, p)} disabled={isPendingProj}>
                                {isPendingProj ? '...' : (p.status === 'disabled' ? 'Bật' : 'Tắt')}
                              </button>
                              <button className={styles.iconBtn} title="Sửa"
                                onClick={() => startEditProject(acc.accountId, p.projectIndex, p.projectName, (p as any).notes || '')}>
                                <Edit3 size={13} />
                              </button>
                              <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} title="Xoá"
                                onClick={() => confirmDeleteProject(acc.accountId, p.projectIndex)}
                                disabled={isPendingProj}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                          {hasError && (
                            <div className={styles.errorBlock}>
                              <button className={styles.errorToggle} onClick={() => toggleErrorMessage(projectKey)}>
                                {isErrorExpanded ? '▼' : '▶'} {isErrorExpanded ? 'Ẩn lỗi' : 'Xem lỗi'}
                              </button>
                              {isErrorExpanded && <div className={styles.errorMessage}>{p.lastErrorMessage}</div>}
                            </div>
                          )}

                          {editingProject && editingProject.accountId === acc.accountId && editingProject.projectIndex === p.projectIndex && (
                            <div className={styles.inlineForm}>
                              <div className={styles.inlineFormRow}>
                                <input className={styles.inlineFormInput} value={editingProject.name}
                                  onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                                  placeholder="Tên project" maxLength={60} />
                              </div>
                              <textarea className={styles.inlineFormTextarea} value={editingProject.notes}
                                onChange={(e) => setEditingProject({ ...editingProject, notes: e.target.value })}
                                placeholder="Ghi chú" maxLength={200} rows={2} />
                              <div className={styles.inlineFormActions}>
                                <button className={styles.smallBtn} onClick={cancelEditProject}>Hủy</button>
                                <button className={`${styles.smallBtn} ${styles.smallBtnSuccess}`} onClick={saveEditProject} disabled={!editingProject.name.trim()}>
                                  <Save size={12} /> Lưu
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {addingProjectAccountId === acc.accountId ? (
                      <div className={styles.inlineForm}>
                        <div className={styles.inlineFormRow}>
                          <input className={styles.inlineFormInput} value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)} placeholder="Tên project" maxLength={60} />
                          <input className={styles.inlineFormInput} value={newProjectKey}
                            onChange={(e) => setNewProjectKey(e.target.value)} placeholder="API key" maxLength={80} />
                        </div>
                        <textarea className={styles.inlineFormTextarea} value={newProjectNotes}
                          onChange={(e) => setNewProjectNotes(e.target.value)} placeholder="Ghi chú" maxLength={200} rows={2} />
                        <div className={styles.inlineFormActions}>
                          <button className={styles.smallBtn} onClick={cancelAddProject}>Hủy</button>
                          <button className={`${styles.smallBtn} ${styles.smallBtnSuccess}`} onClick={saveAddProject}
                            disabled={!newProjectName.trim() || !newProjectKey.trim()}>
                            <Save size={12} /> Thêm
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.addRow}>
                        <button className={styles.addMainBtn} onClick={() => startAddProject(acc.accountId)}>
                          <Plus size={14} /> Thêm key
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className={styles.addRow}>
          <button className={styles.addMainBtn} onClick={() => { setAddAccountEmail(''); setAddAccountKeys(''); setShowAddAccount(true); }}>
            <Plus size={16} /> Thêm account mới
          </button>
        </div>
      </div>

      {/* Floating back button */}
      <div className={styles.floatingBack}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
      </div>

      {/* Import Text Modal */}
      {showImportText && (
        <div className={styles.modalOverlay} onClick={() => setShowImportText(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Import API Keys từ Text</div>
            <p className={styles.modalDesc}>
              Paste dữ liệu: dòng email, theo sau là các dòng API key.
            </p>
            <textarea className={styles.modalTextarea} value={importText}
              onChange={(e) => parseImportText(e.target.value)}
              placeholder={`email1@gmail.com\nAIzaSy...key1\nAIzaSy...key2\n\nemail2@gmail.com\nAIzaSy...key3`} />
            <div>
              <button className={styles.actionBtn} onClick={() => document.getElementById('import-text-file-input')?.click()}>
                <Upload size={14} /> Tải file
              </button>
            </div>
            {importPreview && (
              <div className={styles.modalPreview}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                  Xem trước ({importPreview.reduce((s, p) => s + p.keys.length, 0)} keys)
                </div>
                {importPreview.map((item, i) => (
                  <div key={i} className={styles.modalPreviewRow}>
                    <span className={styles.modalPreviewEmail}>{item.email}</span>
                    <span className={styles.modalPreviewKeys}>
                      {item.keys.length} key{item.keys.length > 1 ? 's' : ''}: {item.keys.map((k) => k.substring(0, 8) + '...').join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.modalActions}>
              <button className={styles.actionBtn} onClick={() => { setShowImportText(false); setImportText(''); setImportPreview(null); }}>
                Hủy
              </button>
              <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleImportText} disabled={!importPreview}>
                <Upload size={14} /> Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <div className={styles.modalOverlay} onClick={() => setShowAddAccount(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Thêm Account mới</div>
            <input className={styles.inlineFormInput} value={addAccountEmail}
              onChange={(e) => setAddAccountEmail(e.target.value)}
              placeholder="Email account (vd: myaccount@gmail.com)"
              style={{ width: '100%' }} />
            <textarea className={styles.modalTextarea} value={addAccountKeys}
              onChange={(e) => setAddAccountKeys(e.target.value)}
              placeholder={`Mỗi dòng 1 API key:\nAIzaSy...key1\nAIzaSy...key2`}
              style={{ minHeight: 120 }} />
            <div className={styles.modalActions}>
              <button className={styles.actionBtn} onClick={() => setShowAddAccount(false)}>Hủy</button>
              <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleAddAccount}
                disabled={!addAccountEmail.trim() || !addAccountKeys.trim()}>
                <Plus size={14} /> Thêm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}
