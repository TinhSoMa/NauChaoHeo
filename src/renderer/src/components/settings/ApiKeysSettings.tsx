/**
 * ApiKeysSettings - Quản lý API Keys
 */

import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, RotateCcw, Upload, Download, RefreshCw, AlertCircle, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';
import { useMemo } from 'react';

const API_WORKER_MIN = 1;
const API_WORKER_MAX = 10;
const API_DELAY_MIN_SEC = 0;
const API_DELAY_MAX_SEC = 30;

interface ApiKeysSettingsProps {
  onBack: () => void;
}

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

export function ApiKeysSettings({ onBack }: ApiKeysSettingsProps) {
  const [apiAccounts, setApiAccounts] = useState<ApiAccountItem[]>([]);
  const [keysLocation, setKeysLocation] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [pendingAccountIds, setPendingAccountIds] = useState<Set<string>>(new Set());
  const [pendingProjectKeys, setPendingProjectKeys] = useState<Set<string>>(new Set());
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [apiWorkerInput, setApiWorkerInput] = useState('1');
  const [savedApiWorkerCount, setSavedApiWorkerCount] = useState(1);
  const [isSavingApiWorker, setIsSavingApiWorker] = useState(false);
  const [apiDelayInput, setApiDelayInput] = useState('0.5');
  const [savedApiDelaySec, setSavedApiDelaySec] = useState(0.5);
  const [isSavingApiDelay, setIsSavingApiDelay] = useState(false);

  // Load API keys info
  const loadApiKeysInfo = useCallback(async () => {
    try {
      setLoading(true);
      const accountsRes = await window.electronAPI.gemini.getAllKeysWithStatus();
      if (accountsRes.success && accountsRes.data) {
        setApiAccounts(accountsRes.data as ApiAccountItem[]);
      }
      
      const locRes = await window.electronAPI.gemini.getKeysLocation();
      if (locRes.success && locRes.data) {
        setKeysLocation(locRes.data);
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
      console.error('[ApiKeysSettings] Loi load API keys:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApiKeysInfo();
  }, [loadApiKeysInfo]);

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
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Quản lý API Keys</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          {/* Header Controls */}
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Quản lý Keys</span>
              <span className={styles.labelDesc}>
                File: {keysLocation || 'Chưa xác định'}
              </span>
            </div>
            <div className={styles.flexRow}>
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                id="import-json-input"
                onChange={handleImportJson}
              />
              <Button 
                onClick={() => document.getElementById('import-json-input')?.click()}
                variant="secondary"
              >
                <Upload size={16} /> Import
              </Button>
              <Button onClick={handleExportJson} variant="secondary">
                <Download size={16} /> Export
              </Button>
              <Button onClick={handleResetAllKeyStatus} variant="danger">
                <RefreshCw size={16} /> Reset
              </Button>
            </div>
          </div>

          {/* API Worker Count */}
          <div className={styles.row} style={{ marginTop: 12 }}>
            <div className={styles.label}>
              <span className={styles.labelText}>Số worker API song song</span>
              <span className={styles.labelDesc}>
                Áp dụng cho dịch truyện và caption Step 3 (API)
              </span>
            </div>
            <div className={styles.flexRow}>
              <input
                type="number"
                min={API_WORKER_MIN}
                max={API_WORKER_MAX}
                value={apiWorkerInput}
                onChange={(e) => setApiWorkerInput(e.target.value)}
                className={styles.input}
                style={{ width: 120 }}
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

          {/* API Request Delay */}
          <div className={styles.row} style={{ marginTop: 12 }}>
            <div className={styles.label}>
              <span className={styles.labelText}>Delay giữa request API</span>
              <span className={styles.labelDesc}>
                Áp dụng cho dịch truyện và caption Step 3 (API)
              </span>
            </div>
            <div className={styles.flexRow}>
              <input
                type="number"
                min={API_DELAY_MIN_SEC}
                max={API_DELAY_MAX_SEC}
                step="0.1"
                value={apiDelayInput}
                onChange={(e) => setApiDelayInput(e.target.value)}
                className={styles.input}
                style={{ width: 120 }}
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

          {/* Stats Summary */}
          {!loading && apiAccounts.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 12,
              marginTop: 16,
              marginBottom: 16,
            }}>
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                padding: 12,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Tổng tài khoản
                </div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {apiAccounts.length}
                </div>
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                padding: 12,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Keys đang bật
                </div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: '#10b981' }}>
                  {availableProjects}/{totalProjects}
                </div>
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                padding: 12,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Keys đã tắt
                </div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: '#64748b' }}>
                  {disabledProjects}
                </div>
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                padding: 12,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Tổng thành công
                </div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: '#10b981' }}>
                  {totalSuccess.toLocaleString()}
                </div>
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                padding: 12,
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Tổng lỗi
                </div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: totalErrors > 0 ? '#ef4444' : 'var(--text-tertiary)' }}>
                  {totalErrors.toLocaleString()}
                </div>
              </div>
            </div>
          )}

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Bộ lọc hiển thị</span>
              <span className={styles.labelDesc}>Lọc nhanh theo account và trạng thái key</span>
            </div>
            <div className={styles.flexRow}>
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
          </div>

          <div className={styles.divider} style={{ margin: '16px 0', borderTop: '1px solid var(--border-color)' }} />

          {/* Accounts List */}
          <div className={styles.row} style={{ display: 'block' }}>
            <div className={styles.label} style={{ marginBottom: 12 }}>
              <span className={styles.labelText}>Danh sách tài khoản</span>
            </div>
            
            <div style={{ 
              background: 'var(--bg-secondary)', 
              borderRadius: 8, 
              padding: 8,
              maxHeight: 450,
              overflowY: 'auto'
            }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                  <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} />
                  <div style={{ marginTop: 8 }}>Đang tải...</div>
                </div>
              ) : filteredAccounts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                  <AlertCircle size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                  <div style={{ marginBottom: 4 }}>Không có dữ liệu phù hợp bộ lọc</div>
                  <div style={{ fontSize: '0.85em' }}>Thử đổi bộ lọc account/key ở trên</div>
                </div>
              ) : (
                filteredAccounts.map((acc, index) => (
                  <div key={index} style={{ 
                    marginBottom: 8, 
                    padding: 10, 
                    background: 'var(--bg-primary)', 
                    borderRadius: 6,
                    border: '1px solid var(--border-color)'
                  }}>
                    {/* Account Header */}
                    <div style={{ 
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                      gap: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {acc.email}
                        </div>
                        <div style={{
                          fontSize: '0.75em',
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: getAccountStatusConfig(acc.accountStatus).bg,
                          color: getAccountStatusConfig(acc.accountStatus).text,
                          fontWeight: 600,
                        }}>
                          {getAccountStatusConfig(acc.accountStatus).label}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ 
                          fontSize: '0.75em',
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-secondary)',
                          padding: '2px 8px',
                          borderRadius: 4,
                        }}>
                          {acc.projects.length} projects
                        </div>
                        <Button
                          variant={acc.accountStatus === 'disabled' ? 'primary' : 'secondary'}
                          onClick={() => handleToggleAccountStatus(acc)}
                          disabled={pendingAccountIds.has(acc.accountId)}
                        >
                          {pendingAccountIds.has(acc.accountId)
                            ? 'Đang cập nhật...'
                            : (acc.accountStatus === 'disabled' ? 'Bật account' : 'Tắt account')}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Projects List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {acc.projects.map((p) => {
                        const statusConfig = getStatusConfig(p.status);
                        const StatusIcon = statusConfig.icon;
                        const projectKey = `${acc.accountId}:${p.projectIndex}`;
                        const isErrorExpanded = expandedErrors.has(projectKey);
                        const hasError = Boolean(p.lastErrorMessage) && p.errorCount > 0;
                        
                        return (
                          <div key={projectKey} style={{ 
                            padding: '6px 8px',
                            borderRadius: 4,
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                          }}>
                            {/* Main Info Row */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: '0.8em',
                            }}>
                              {/* Status Badge */}
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: '0.85em',
                                padding: '2px 6px',
                                borderRadius: 3,
                                background: statusConfig.bg,
                                color: statusConfig.text,
                                fontWeight: 600,
                                minWidth: 95,
                              }}>
                                <StatusIcon size={11} />
                                <span>{statusConfig.label}</span>
                              </div>
                              
                              {/* Project Name */}
                              <span style={{ 
                                color: 'var(--text-primary)',
                                fontWeight: 500,
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {p.projectName}
                              </span>

                              <Button
                                variant={p.status === 'disabled' ? 'primary' : 'secondary'}
                                onClick={() => handleToggleProjectStatus(acc, p)}
                                disabled={pendingProjectKeys.has(projectKey) || pendingAccountIds.has(acc.accountId)}
                              >
                                {pendingProjectKeys.has(projectKey)
                                  ? 'Đang cập nhật...'
                                  : (p.status === 'disabled' ? 'Bật key' : 'Tắt key')}
                              </Button>
                              
                              {/* Stats Badges */}
                              <div style={{ display: 'flex', gap: 4, fontSize: '0.85em' }}>
                                <span style={{ 
                                  background: p.successCount > 0 ? '#10b98110' : 'var(--bg-primary)',
                                  color: p.successCount > 0 ? '#10b981' : 'var(--text-tertiary)',
                                  padding: '2px 5px',
                                  borderRadius: 3,
                                  fontFamily: 'monospace',
                                  fontWeight: 600,
                                  minWidth: 92,
                                  textAlign: 'center',
                                }}>
                                  Thành công: {p.successCount || 0}
                                </span>
                                <span style={{ 
                                  background: p.errorCount > 0 ? '#ef444410' : 'var(--bg-primary)',
                                  color: p.errorCount > 0 ? '#ef4444' : 'var(--text-tertiary)',
                                  padding: '2px 5px',
                                  borderRadius: 3,
                                  fontFamily: 'monospace',
                                  fontWeight: 600,
                                  minWidth: 56,
                                  textAlign: 'center',
                                }}>
                                  Lỗi: {p.errorCount || 0}
                                </span>
                              </div>
                              
                              {/* Today Count */}
                              {p.totalRequestsToday > 0 && (
                                <span style={{ 
                                  background: 'var(--bg-primary)',
                                  color: 'var(--text-secondary)',
                                  padding: '2px 6px',
                                  borderRadius: 3,
                                  fontSize: '0.85em',
                                  fontFamily: 'monospace',
                                  fontWeight: 600,
                                }}>
                                  Hôm nay: {p.totalRequestsToday}
                                </span>
                              )}
                            </div>
                            
                            {/* API Key & Timestamp Row */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                              fontSize: '0.7em',
                              color: 'var(--text-tertiary)',
                              fontFamily: 'monospace',
                              marginTop: 4,
                            }}>
                              <span style={{ 
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {p.apiKey}
                              </span>
                              <span style={{ 
                                background: 'var(--bg-primary)',
                                padding: '2px 5px',
                                borderRadius: 2,
                                whiteSpace: 'nowrap',
                              }}>
                                {formatTimestamp(p.lastUsedTimestamp)}
                              </span>
                            </div>
                            
                            {/* Error Message (Expandable) */}
                            {hasError && (
                              <div style={{ marginTop: 4 }}>
                                <button
                                  onClick={() => toggleErrorMessage(projectKey)}
                                  style={{
                                    width: '100%',
                                    textAlign: 'left',
                                    border: 'none',
                                    background: '#ef444408',
                                    color: '#ef4444',
                                    padding: '3px 6px',
                                    borderRadius: 3,
                                    fontSize: '0.7em',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    transition: 'all 0.2s',
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = '#ef444415'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = '#ef444408'}
                                >
                                  {isErrorExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                  <span style={{ flex: 1, fontWeight: 500 }}>
                                    {isErrorExpanded ? 'Ẩn lỗi' : 'Xem lỗi'}
                                  </span>
                                  <AlertCircle size={10} />
                                </button>
                                {isErrorExpanded && (
                                  <div style={{
                                    marginTop: 3,
                                    padding: 6,
                                    background: 'var(--bg-primary)',
                                    borderRadius: 3,
                                    fontSize: '0.65em',
                                    color: 'var(--text-secondary)',
                                    fontFamily: 'monospace',
                                    wordBreak: 'break-word',
                                    lineHeight: 1.4,
                                    border: '1px solid var(--border-color)',
                                  }}>
                                    {p.lastErrorMessage}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar */}
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
    </div>
  );
}
