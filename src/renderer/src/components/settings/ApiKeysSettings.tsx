/**
 * ApiKeysSettings - Quản lý API Keys
 */

import { useState, useCallback, useEffect } from 'react';
import { RotateCcw, Upload, Download, RefreshCw, AlertCircle, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, Edit3, Trash2, Save, X, Plus } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';
import { useMemo } from 'react';

const API_WORKER_MIN = 1;
const API_WORKER_MAX = 10;
const API_DELAY_MIN_SEC = 0;
const API_DELAY_MAX_SEC = 30;

type AccountFilter = 'all' | 'active' | 'disabled';
type ProjectFilter = 'all' | 'available' | 'disabled';

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

export function ApiKeysSettings() {
  const [apiAccounts, setApiAccounts] = useState<ApiAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [pendingAccountIds, setPendingAccountIds] = useState<Set<string>>(new Set());
  const [pendingProjectKeys, setPendingProjectKeys] = useState<Set<string>>(new Set());
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
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

  // Text import state
  const [showImportText, setShowImportText] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<{ email: string; keys: string[] }[] | null>(null);

  // Add account state
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [addAccountEmail, setAddAccountEmail] = useState('');
  const [addAccountKeys, setAddAccountKeys] = useState('');

  // Rotation state
  const [rotationState, setRotationState] = useState<{ currentAccountIndex: number; currentProjectIndex: number; totalRequestsSent: number; rotationRound: number; lastDailyReset: string | null } | null>(null);

  // Load rotation state
  const loadRotationState = useCallback(async () => {
    try {
      const res = await window.electronAPI.gemini.getRotationState();
      if (res.success && res.data) {
        setRotationState(res.data);
      }
    } catch (err) {
      // silent
    }
  }, []);

  // Load API keys info
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
      await loadRotationState();
    } catch (err) {
      console.error('[ApiKeysSettings] Loi load API keys:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApiKeysInfo();
  }, [loadApiKeysInfo]);

  useEffect(() => {
    const handler = () => loadApiKeysInfo();
    const unsubscribe = window.electronAPI.gemini.onGeminiKeysReloaded(handler);
    return unsubscribe;
  }, [loadApiKeysInfo]);

  // Auto-refresh rotation state every 3s
  useEffect(() => {
    const interval = setInterval(() => {
      loadRotationState();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadRotationState]);

  const startEditProject = (accountId: string, projectIndex: number, name: string, notes: string) => {
    setEditingProject({ accountId, projectIndex, name, notes });
  };

  const cancelEditProject = () => setEditingProject(null);

  const saveEditProject = async () => {
    if (!editingProject) return;
    const trimmed = editingProject.name.trim();
    if (!trimmed) {
      alert('Tên project không được để trống.');
      return;
    }
    try {
      const res = await window.electronAPI.gemini.updateProject(editingProject.accountId, editingProject.projectIndex, {
        projectName: trimmed,
        notes: editingProject.notes,
      });
      if (res.success) {
        cancelEditProject();
      } else {
        alert(res.error || 'Không thể cập nhật project.');
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi update project:', err);
      alert('Không thể cập nhật project.');
    }
  };

  const confirmDeleteProject = async (accountId: string, projectIndex: number) => {
    const ok = confirm('Bạn có chắc muốn xóa project này? Hành động này không thể hoàn tác.');
    if (!ok) return;
    try {
      const res = await window.electronAPI.gemini.removeProject(accountId, projectIndex);
      if (!res.success) {
        alert(res.error || 'Không thể xóa project.');
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi xoa project:', err);
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
    if (!name || !key) {
      alert('Tên project và API key không được để trống.');
      return;
    }
    try {
      const res = await window.electronAPI.gemini.addProject(addingProjectAccountId, {
        projectName: name,
        apiKey: key,
        notes: newProjectNotes.trim(),
      });
      if (res.success) {
        cancelAddProject();
      } else {
        alert(res.error || 'Không thể thêm project.');
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi them project:', err);
      alert('Không thể thêm project.');
    }
  };

  // Import JSON handler
  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const res = await window.electronAPI.gemini.importKeys(text);
      if (res.success) {
        alert(`✅ Import thành công ${res.data?.count} keys!`);
        loadApiKeysInfo();
      } else {
        alert(`❌ Lỗi import: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi doc file:', err);
      alert('❌ Không thể đọc file JSON');
    }
    e.target.value = '';
  };

  // Export JSON handler
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
        alert('✅ Đã export keys thành công!');
      } else {
        alert(`❌ Lỗi export: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi export JSON:', err);
      alert('❌ Không thể export file JSON');
    }
  };

  // Parse text format and show preview
  const parseImportText = (text: string) => {
    setImportText(text);
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (lines.length === 0) {
      setImportPreview(null);
      return;
    }
    const preview: { email: string; keys: string[] }[] = [];
    let currentEmail = '';
    let currentKeys: string[] = [];

    for (const line of lines) {
      if (line.includes('@') && !line.startsWith('AIza') && !line.startsWith('sk-')) {
        if (currentEmail && currentKeys.length > 0) {
          preview.push({ email: currentEmail, keys: [...currentKeys] });
        }
        currentEmail = line;
        currentKeys = [];
      } else {
        if (!currentEmail) currentEmail = 'default@account';
        currentKeys.push(line);
      }
    }
    if (currentEmail && currentKeys.length > 0) {
      preview.push({ email: currentEmail, keys: [...currentKeys] });
    }
    setImportPreview(preview.length > 0 ? preview : null);
  };

  const handleImportText = async () => {
    if (!importText.trim()) {
      alert('Vui lòng nhập dữ liệu API keys.');
      return;
    }
    try {
      const res = await window.electronAPI.gemini.importKeysFromText(importText);
      if (res.success) {
        alert(`✅ Import text thành công ${res.data?.count} keys!`);
        setShowImportText(false);
        setImportText('');
        setImportPreview(null);
        loadApiKeysInfo();
      } else {
        alert(`❌ Lỗi import: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi import text:', err);
      alert('❌ Không thể import text');
    }
  };

  // Submit add account
  const handleAddAccount = async () => {
    const email = addAccountEmail.trim();
    const keysText = addAccountKeys.trim();
    if (!email || !keysText) {
      alert('Vui lòng nhập email và ít nhất 1 API key.');
      return;
    }
    const keyLines = keysText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (keyLines.length === 0) {
      alert('Không tìm thấy API key hợp lệ.');
      return;
    }
    try {
      const projects = keyLines.map((k, i) => ({
        projectName: `Key-${i + 1}`,
        apiKey: k,
      }));
      const res = await window.electronAPI.gemini.addAccount(email, projects);
      if (res.success) {
        alert(`✅ Đã thêm account ${email} với ${keyLines.length} keys!`);
        setShowAddAccount(false);
        setAddAccountEmail('');
        setAddAccountKeys('');
        loadApiKeysInfo();
      } else {
        alert(`❌ Lỗi: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi add account:', err);
      alert('❌ Không thể thêm account');
    }
  };

  // Reset all key status
  const handleResetAllKeyStatus = async () => {
    if (!confirm('⚠️ Bạn có chắc muốn reset trạng thái tất cả API keys?\n\nĐiều này sẽ:\n- Reset lại tất cả counters\n- Xóa các lỗi đã ghi nhận\n- Đặt lại trạng thái về "Available"')) {
      return;
    }
    try {
      const res = await window.electronAPI.gemini.resetAllStatus();
      if (res.success) {
        alert('✅ Đã reset trạng thái tất cả keys thành công!');
        loadApiKeysInfo();
      } else {
        alert(`❌ Lỗi: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi reset status:', err);
      alert('❌ Không thể reset trạng thái keys');
    }
  };

  // Toggle error message visibility
  const toggleErrorMessage = (projectKey: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
      }
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
      if (!result.success) {
        alert(result.error || 'Không thể cập nhật trạng thái account.');
        return;
      }
      await loadApiKeysInfo();
    } catch (error) {
      console.error('[ApiKeysSettings] Toggle account error:', error);
      alert('Không thể cập nhật trạng thái account.');
    } finally {
      markAccountPending(accountId, false);
    }
  };

  const handleToggleProjectStatus = async (account: ApiAccountItem, project: ApiProjectItem) => {
    const projectKey = `${account.accountId}:${project.projectIndex}`;
    const shouldDisable = project.status !== 'disabled';
    try {
      markProjectPending(projectKey, true);
      const result = shouldDisable
        ? await window.electronAPI.gemini.disableProject(account.accountId, project.projectIndex)
        : await window.electronAPI.gemini.enableProject(account.accountId, project.projectIndex);
      if (!result.success) {
        alert(result.error || 'Không thể cập nhật trạng thái API key.');
        return;
      }
      await loadApiKeysInfo();
    } catch (error) {
      console.error('[ApiKeysSettings] Toggle project error:', error);
      alert('Không thể cập nhật trạng thái API key.');
    } finally {
      markProjectPending(projectKey, false);
    }
  };

  const handleSaveApiWorkerCount = async () => {
    const trimmed = apiWorkerInput.trim();
    if (!/^\d+$/.test(trimmed)) {
      alert(`Số worker API phải là số nguyên từ ${API_WORKER_MIN}-${API_WORKER_MAX}.`);
      return;
    }
    const nextValue = Number(trimmed);
    if (!Number.isFinite(nextValue) || nextValue < API_WORKER_MIN || nextValue > API_WORKER_MAX) {
      alert(`Số worker API phải nằm trong ${API_WORKER_MIN}-${API_WORKER_MAX}.`);
      return;
    }
    try {
      setIsSavingApiWorker(true);
      const result = await window.electronAPI.appSettings.update({ apiWorkerCount: nextValue } as any);
      if (result.success) {
        setSavedApiWorkerCount(nextValue);
        setApiWorkerInput(String(nextValue));
      } else {
        alert('Lỗi cập nhật số worker API.');
      }
    } catch (error) {
      console.error('[ApiKeysSettings] Error updating apiWorkerCount:', error);
      alert('Lỗi cập nhật số worker API.');
    } finally {
      setIsSavingApiWorker(false);
    }
  };

  const handleSaveApiDelay = async () => {
    const trimmed = apiDelayInput.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      alert(`Delay phải là số từ ${API_DELAY_MIN_SEC}-${API_DELAY_MAX_SEC} giây.`);
      return;
    }
    const nextSec = Number(trimmed);
    if (!Number.isFinite(nextSec) || nextSec < API_DELAY_MIN_SEC || nextSec > API_DELAY_MAX_SEC) {
      alert(`Delay phải nằm trong ${API_DELAY_MIN_SEC}-${API_DELAY_MAX_SEC} giây.`);
      return;
    }
    try {
      setIsSavingApiDelay(true);
      const nextMs = Math.floor(nextSec * 1000);
      const result = await window.electronAPI.appSettings.update({ apiRequestDelayMs: nextMs } as any);
      if (result.success) {
        setSavedApiDelaySec(nextSec);
        setApiDelayInput(String(nextSec));
      } else {
        alert('Lỗi cập nhật delay API.');
      }
    } catch (error) {
      console.error('[ApiKeysSettings] Error updating apiRequestDelayMs:', error);
      alert('Lỗi cập nhật delay API.');
    } finally {
      setIsSavingApiDelay(false);
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return 'Chưa dùng';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} giờ trước`;
    return `${Math.floor(diffMins / 1440)} ngày trước`;
  };

  // Get status config
  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string; label: string; icon: any }> = {
      'available': { bg: '#10b98120', text: '#10b981', label: 'Sẵn sàng', icon: CheckCircle },
      'rate_limited': { bg: '#f59e0b20', text: '#f59e0b', label: 'Giới hạn tốc độ', icon: Clock },
      'exhausted': { bg: '#6366f120', text: '#6366f1', label: 'Hết quota', icon: XCircle },
      'error': { bg: '#ef444420', text: '#ef4444', label: 'Lỗi', icon: AlertCircle },
      'disabled': { bg: '#64748b30', text: '#64748b', label: 'Đã tắt', icon: XCircle },
    };
    return configs[status] || configs['available'];
  };

  const getAccountStatusConfig = (status: string) => {
    if (status === 'disabled') {
      return { bg: '#64748b30', text: '#64748b', label: 'Account tắt' };
    }
    return { bg: '#10b98120', text: '#10b981', label: 'Account bật' };
  };

  const filteredAccounts = useMemo(() => {
    return apiAccounts
      .filter((acc) => {
        if (accountFilter === 'all') return true;
        return accountFilter === 'active'
          ? acc.accountStatus !== 'disabled'
          : acc.accountStatus === 'disabled';
      })
      .map((acc) => {
        const projects = acc.projects.filter((project) => {
          if (projectFilter === 'all') return true;
          return projectFilter === 'disabled'
            ? project.status === 'disabled'
            : project.status !== 'disabled';
        });
        return { ...acc, projects };
      })
      .filter((acc) => acc.projects.length > 0 || projectFilter === 'all');
  }, [accountFilter, apiAccounts, projectFilter]);

  useEffect(() => {
    if (filteredAccounts.length === 0) {
      setSelectedAccountId(null);
      return;
    }
    if (!selectedAccountId || !filteredAccounts.some((acc) => acc.accountId === selectedAccountId)) {
      setSelectedAccountId(filteredAccounts[0].accountId);
    }
  }, [filteredAccounts, selectedAccountId]);

  const selectedAccount = useMemo(
    () => filteredAccounts.find((acc) => acc.accountId === selectedAccountId) || null,
    [filteredAccounts, selectedAccountId]
  );

  // Calculate stats
  const totalProjects = apiAccounts.reduce((sum, acc) => sum + acc.projects.length, 0);
  const availableProjects = apiAccounts.reduce((sum, acc) => 
    sum + acc.projects.filter((p) => p.status !== 'disabled').length, 0
  );
  const disabledProjects = apiAccounts.reduce((sum, acc) =>
    sum + acc.projects.filter((p) => p.status === 'disabled').length, 0
  );
  const totalSuccess = apiAccounts.reduce((sum, acc) => 
    sum + acc.projects.reduce((s, p) => s + (p.successCount || 0), 0), 0
  );
  const totalErrors = apiAccounts.reduce((sum, acc) => 
    sum + acc.projects.reduce((s, p) => s + (p.errorCount || 0), 0), 0
  );

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitle}>Quản lý API Keys</div>
        <div className={styles.apiHeaderFilters}>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value as AccountFilter)}
            className={styles.select}
          >
            <option value="all">Tất cả account</option>
            <option value="active">Account bật</option>
            <option value="disabled">Account tắt</option>
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value as ProjectFilter)}
            className={styles.select}
          >
            <option value="all">Tất cả key</option>
            <option value="available">Key đang bật</option>
            <option value="disabled">Key đã tắt</option>
          </select>
        </div>
        <div className={styles.apiHeaderActions}>
          <input
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            id="import-json-input"
            onChange={handleImportJson}
          />
          <input
            type="file"
            accept=".txt,.csv"
            style={{ display: 'none' }}
            id="import-text-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) { file.text().then((text) => { parseImportText(text); setShowImportText(true); }); }
              e.target.value = '';
            }}
          />
          <Button
            onClick={() => document.getElementById('import-json-input')?.click()}
            variant="secondary"
            className={styles.apiActionButton}
          >
            <Upload size={16} /> Import JSON
          </Button>
          <Button
            onClick={() => setShowImportText(true)}
            variant="secondary"
            className={styles.apiActionButton}
          >
            <Upload size={16} /> Import Text
          </Button>
          <Button
            onClick={handleExportJson}
            variant="secondary"
            className={styles.apiActionButton}
          >
            <Download size={16} /> Export
          </Button>
          <Button
            onClick={handleResetAllKeyStatus}
            variant="danger"
            className={`${styles.apiActionButton} ${styles.apiActionDanger}`}
          >
            <RefreshCw size={16} /> Reset
          </Button>
        </div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.apiKpiRow}>
          <div className={styles.apiKpiCard}>
            <div className={styles.apiKpiLabel}>Tổng tài khoản</div>
            <div className={styles.apiKpiValue}>{apiAccounts.length}</div>
          </div>
          <div className={styles.apiKpiCard}>
            <div className={styles.apiKpiLabel}>Keys đang bật</div>
            <div className={styles.apiKpiValue}>{availableProjects}/{totalProjects}</div>
          </div>
          <div className={styles.apiKpiCard}>
            <div className={styles.apiKpiLabel}>Keys đã tắt</div>
            <div className={styles.apiKpiValue}>{disabledProjects}</div>
          </div>
          <div className={styles.apiKpiCard}>
            <div className={styles.apiKpiLabel}>Tổng thành công</div>
            <div className={styles.apiKpiValue}>{totalSuccess.toLocaleString()}</div>
          </div>
          <div className={styles.apiKpiCard}>
            <div className={styles.apiKpiLabel}>Tổng lỗi</div>
            <div className={styles.apiKpiValue}>{totalErrors.toLocaleString()}</div>
          </div>
          {rotationState && (() => {
            const activeAccount = apiAccounts[rotationState.currentAccountIndex];
            const activeProject = activeAccount?.projects[rotationState.currentProjectIndex];
            const accountName = activeAccount?.email || `acc_${String(rotationState.currentAccountIndex + 1).padStart(2, '0')}`;
            const projectName = activeProject?.projectName || `P${rotationState.currentProjectIndex + 1}`;
            return (
              <div className={styles.apiKpiCard} style={{ borderColor: '#f59e0b' }}>
                <div className={styles.apiKpiLabel} style={{ color: '#f59e0b' }}>Đang dùng</div>
                <div className={styles.apiKpiValue} style={{ fontSize: '0.85rem', lineHeight: 1.3 }}>
                  {accountName}
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    {projectName} · {rotationState.totalRequestsSent.toLocaleString()} req
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        <div className={styles.apiGrid}>
          <div className={styles.apiSidebar}>
            <div className={styles.apiPanel}>
              <div className={styles.apiPanelHeader}>API Runtime</div>
              <div className={styles.apiPanelBody}>
                <div className={styles.apiFieldRow}>
                  <div>
                    <div className={styles.apiFieldLabel}>Số worker API</div>
                    <div className={styles.apiFieldDesc}>Áp dụng cho dịch truyện và caption Step 3</div>
                  </div>
                  <div className={styles.apiFieldAction}>
                    <input
                      type="number"
                      min={API_WORKER_MIN}
                      max={API_WORKER_MAX}
                      value={apiWorkerInput}
                      onChange={(e) => setApiWorkerInput(e.target.value)}
                      className={styles.input}
                      style={{ width: 110 }}
                    />
                    <Button
                      onClick={handleSaveApiWorkerCount}
                      variant="primary"
                      disabled={isSavingApiWorker || Number(apiWorkerInput) === savedApiWorkerCount}
                    >
                      Lưu
                    </Button>
                  </div>
                </div>
                <div className={styles.apiFieldRow}>
                  <div>
                    <div className={styles.apiFieldLabel}>Delay giữa request</div>
                    <div className={styles.apiFieldDesc}>Giây (0 - 30)</div>
                  </div>
                  <div className={styles.apiFieldAction}>
                    <input
                      type="number"
                      min={API_DELAY_MIN_SEC}
                      max={API_DELAY_MAX_SEC}
                      step="0.1"
                      value={apiDelayInput}
                      onChange={(e) => setApiDelayInput(e.target.value)}
                      className={styles.input}
                      style={{ width: 110 }}
                    />
                    <Button
                      onClick={handleSaveApiDelay}
                      variant="primary"
                      disabled={isSavingApiDelay || Number(apiDelayInput) === savedApiDelaySec}
                    >
                      Lưu
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className={`${styles.apiPanel} ${styles.apiListPanel}`}>
              <div className={styles.apiPanelHeader}>
                Danh sách account
                <Button variant="secondary" onClick={() => { setAddAccountEmail(''); setAddAccountKeys(''); setShowAddAccount(true); }} style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 'var(--font-size-xs)' }}>
                  <Plus size={14} /> Thêm
                </Button>
              </div>
              <div className={styles.apiList}>
                {loading ? (
                  <div className={styles.apiEmpty}>Đang tải dữ liệu...</div>
                ) : filteredAccounts.length === 0 ? (
                  <div className={styles.apiEmpty}>Không có dữ liệu phù hợp bộ lọc</div>
                ) : (
                  filteredAccounts.map((acc) => {
                    const statusCfg = getAccountStatusConfig(acc.accountStatus)
                    const isActive = acc.accountId === selectedAccountId
                    const isRotating = rotationState && apiAccounts.indexOf(acc) === rotationState.currentAccountIndex
                    return (
                      <button
                        key={acc.accountId}
                        className={`${styles.apiAccountItem} ${isActive ? styles.apiAccountItemActive : ''} ${isRotating ? styles.apiAccountItemRotating : ''}`}
                        onClick={() => setSelectedAccountId(acc.accountId)}
                      >
                        <div className={styles.apiAccountMain}>
                          <div className={styles.apiAccountName}>{acc.email} {isRotating && <span style={{ fontSize: '0.65rem', color: '#f59e0b', marginLeft: 4 }}>●</span>}</div>
                          <div className={styles.apiAccountMeta}>{acc.projects.length} projects</div>
                        </div>
                        <span
                          className={styles.apiBadge}
                          style={{ background: statusCfg.bg, color: statusCfg.text }}
                        >
                          {statusCfg.label}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          <div className={styles.apiDetail}>
            {selectedAccount ? (
              <div className={styles.apiPanel}>
                <div className={styles.apiDetailHeader}>
                  <div>
                    <div className={styles.apiDetailTitle}>{selectedAccount.email}</div>
                    <div className={styles.apiDetailSubtitle}>{selectedAccount.accountId}</div>
                  </div>
                  <div className={styles.apiDetailActions}>
                    <span
                      className={styles.apiBadge}
                      style={{
                        background: getAccountStatusConfig(selectedAccount.accountStatus).bg,
                        color: getAccountStatusConfig(selectedAccount.accountStatus).text,
                      }}
                    >
                      {getAccountStatusConfig(selectedAccount.accountStatus).label}
                    </span>
                    <Button
                      variant={selectedAccount.accountStatus === 'disabled' ? 'primary' : 'secondary'}
                      onClick={() => handleToggleAccountStatus(selectedAccount)}
                      disabled={pendingAccountIds.has(selectedAccount.accountId)}
                    >
                      {pendingAccountIds.has(selectedAccount.accountId)
                        ? 'Đang cập nhật...'
                        : (selectedAccount.accountStatus === 'disabled' ? 'Bật account' : 'Tắt account')}
                    </Button>
                  </div>
                </div>

                <div className={styles.apiDetailBody}>
                  {selectedAccount.projects.map((p) => {
                    const statusConfig = getStatusConfig(p.status)
                    const StatusIcon = statusConfig.icon
                    const projectKey = `${selectedAccount.accountId}:${p.projectIndex}`
                    const isErrorExpanded = expandedErrors.has(projectKey)
                    const hasError = Boolean(p.lastErrorMessage) && p.errorCount > 0

                    return (
                      <div key={projectKey} className={styles.apiProjectItem}>
                        <div className={styles.apiProjectRow}>
                          <div className={styles.apiProjectMain}>
                            <span
                              className={styles.apiStatusBadge}
                              style={{ background: statusConfig.bg, color: statusConfig.text }}
                            >
                              <StatusIcon size={11} /> {statusConfig.label}
                            </span>
                            <span className={styles.apiProjectName}>{p.projectName}</span>
                            {rotationState && selectedAccount.accountId === apiAccounts[rotationState.currentAccountIndex]?.accountId && p.projectIndex === rotationState.currentProjectIndex && (
                              <span style={{ fontSize: '0.6rem', background: '#f59e0b22', color: '#f59e0b', padding: '1px 6px', borderRadius: 8, marginLeft: 6 }}>current</span>
                            )}
                          </div>
                          <div className={styles.apiProjectActions}>
                            <Button
                              variant={p.status === 'disabled' ? 'primary' : 'secondary'}
                              onClick={() => handleToggleProjectStatus(selectedAccount, p)}
                              disabled={pendingProjectKeys.has(projectKey) || pendingAccountIds.has(selectedAccount.accountId)}
                            >
                              {pendingProjectKeys.has(projectKey)
                                ? 'Đang cập nhật...'
                                : (p.status === 'disabled' ? 'Bật key' : 'Tắt key')}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => startEditProject(selectedAccount.accountId, p.projectIndex, p.projectName, (p as any).notes || '')}
                            >
                              <Edit3 size={14} />
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => confirmDeleteProject(selectedAccount.accountId, p.projectIndex)}
                              disabled={pendingProjectKeys.has(projectKey) || pendingAccountIds.has(selectedAccount.accountId)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>

                        <div className={styles.apiProjectMeta}>
                          <span className={styles.apiKeyText}>{p.apiKey}</span>
                          <span className={styles.apiTimeText}>{formatTimestamp(p.lastUsedTimestamp)}</span>
                          <span className={styles.apiStatChip} style={{ color: p.successCount > 0 ? '#10b981' : 'var(--color-text-muted)' }}>
                            OK {p.successCount || 0}
                          </span>
                          <span className={styles.apiStatChip} style={{ color: p.errorCount > 0 ? '#ef4444' : 'var(--color-text-muted)' }}>
                            Err {p.errorCount || 0}
                          </span>
                          {p.totalRequestsToday > 0 && (
                            <span className={styles.apiStatChip}>
                              Today {p.totalRequestsToday}
                            </span>
                          )}
                        </div>

                        {hasError && (
                          <div className={styles.apiErrorBlock}>
                            <button
                              onClick={() => toggleErrorMessage(projectKey)}
                              className={styles.apiErrorToggle}
                            >
                              {isErrorExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              {isErrorExpanded ? 'Ẩn lỗi' : 'Xem lỗi'}
                            </button>
                            {isErrorExpanded && (
                              <div className={styles.apiErrorMessage}>
                                {p.lastErrorMessage}
                              </div>
                            )}
                          </div>
                        )}

                        {editingProject && editingProject.accountId === selectedAccount.accountId && editingProject.projectIndex === p.projectIndex && (
                          <div className={styles.apiEditForm}>
                            <input
                              className={styles.input}
                              value={editingProject.name}
                              onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                              placeholder="Tên project"
                              maxLength={60}
                            />
                            <textarea
                              className={styles.textarea}
                              value={editingProject.notes}
                              onChange={(e) => setEditingProject({ ...editingProject, notes: e.target.value })}
                              placeholder="Ghi chú chức năng (tối đa 200 ký tự)"
                              maxLength={200}
                              rows={3}
                            />
                            <div className={styles.apiEditActions}>
                              <Button variant="primary" onClick={saveEditProject} disabled={!editingProject.name.trim()}>
                                <Save size={14} /> Lưu
                              </Button>
                              <Button variant="secondary" onClick={cancelEditProject}>
                                <X size={14} /> Hủy
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {selectedAccount && addingProjectAccountId === selectedAccount.accountId && (
                    <div className={styles.apiEditForm}>
                      <input
                        className={styles.input}
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="Tên project mới"
                        maxLength={60}
                      />
                      <input
                        className={styles.input}
                        value={newProjectKey}
                        onChange={(e) => setNewProjectKey(e.target.value)}
                        placeholder="API key"
                        maxLength={80}
                      />
                      <textarea
                        className={styles.textarea}
                        value={newProjectNotes}
                        onChange={(e) => setNewProjectNotes(e.target.value)}
                        placeholder="Ghi chú chức năng (tối đa 200 ký tự)"
                        maxLength={200}
                        rows={3}
                      />
                      <div className={styles.apiEditActions}>
                        <Button variant="primary" onClick={saveAddProject} disabled={!newProjectName.trim() || !newProjectKey.trim()}>
                          <Save size={14} /> Thêm
                        </Button>
                        <Button variant="secondary" onClick={cancelAddProject}>
                          <X size={14} /> Hủy
                        </Button>
                      </div>
                    </div>
                  )}

                  {!addingProjectAccountId && selectedAccount && (
                    <div className={styles.apiAddProjectRow}>
                      <Button variant="secondary" onClick={() => startAddProject(selectedAccount.accountId)}>
                        <Plus size={14} /> Thêm project
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className={styles.apiEmptyState}>
                Chọn một account để xem chi tiết API keys.
              </div>
            )}
          </div>
        </div>

        <div className={styles.saveBar}>
          <Button onClick={() => loadApiKeysInfo()} variant="secondary" disabled={loading}>
            <RotateCcw size={16} />
            Làm mới
          </Button>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Import Text Modal */}
      {showImportText && (
        <div className={styles.modalOverlay} onClick={() => setShowImportText(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Import API Keys từ Text</div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
              Paste dữ liệu keys theo format: dòng email, theo sau là các dòng API key.
              Có thể tải file .txt hoặc .csv.
            </p>
            <textarea
              className={styles.modalTextarea}
              value={importText}
              onChange={(e) => parseImportText(e.target.value)}
              placeholder={`email1@gmail.com\nAIzaSy...key1\nAIzaSy...key2\n\nemail2@gmail.com\nAIzaSy...key3`}
            />
            <div>
              <Button
                variant="secondary"
                onClick={() => document.getElementById('import-text-file-input')?.click()}
              >
                <Upload size={14} /> Tải file
              </Button>
            </div>
            {importPreview && (
              <div className={styles.modalPreview}>
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                  Xem trước ({importPreview.reduce((s, p) => s + p.keys.length, 0)} keys)
                </div>
                {importPreview.map((item, i) => (
                  <div key={i} className={styles.modalPreviewRow}>
                    <span className={styles.modalPreviewEmail}>{item.email}</span>
                    <span className={styles.modalPreviewKeys}>
                      {item.keys.length} key{item.keys.length > 1 ? 's' : ''}:{' '}
                      {item.keys.map((k) => k.substring(0, 8) + '...').join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.modalActions}>
              <Button variant="secondary" onClick={() => { setShowImportText(false); setImportText(''); setImportPreview(null); }}>
                <X size={14} /> Hủy
              </Button>
              <Button variant="primary" onClick={handleImportText} disabled={!importPreview}>
                <Upload size={14} /> Import
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <div className={styles.modalOverlay} onClick={() => setShowAddAccount(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Thêm Account mới</div>
            <input
              className={styles.input}
              value={addAccountEmail}
              onChange={(e) => setAddAccountEmail(e.target.value)}
              placeholder="Email account (vd: myaccount@gmail.com)"
              style={{ width: '100%' }}
            />
            <textarea
              className={styles.modalTextarea}
              value={addAccountKeys}
              onChange={(e) => setAddAccountKeys(e.target.value)}
              placeholder={`Mỗi dòng 1 API key:\nAIzaSy...key1\nAIzaSy...key2\nAIzaSy...key3`}
              style={{ minHeight: 120 }}
            />
            <div className={styles.modalActions}>
              <Button variant="secondary" onClick={() => setShowAddAccount(false)}>
                <X size={14} /> Hủy
              </Button>
              <Button variant="primary" onClick={handleAddAccount} disabled={!addAccountEmail.trim() || !addAccountKeys.trim()}>
                <Plus size={14} /> Thêm
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
