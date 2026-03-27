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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
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
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
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
          <Button
            onClick={() => document.getElementById('import-json-input')?.click()}
            variant="secondary"
            className={styles.apiActionButton}
          >
            <Upload size={16} /> Import
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
              <div className={styles.apiPanelHeader}>Danh sách account</div>
              <div className={styles.apiList}>
                {loading ? (
                  <div className={styles.apiEmpty}>Đang tải dữ liệu...</div>
                ) : filteredAccounts.length === 0 ? (
                  <div className={styles.apiEmpty}>Không có dữ liệu phù hợp bộ lọc</div>
                ) : (
                  filteredAccounts.map((acc) => {
                    const statusCfg = getAccountStatusConfig(acc.accountStatus)
                    const isActive = acc.accountId === selectedAccountId
                    return (
                      <button
                        key={acc.accountId}
                        className={`${styles.apiAccountItem} ${isActive ? styles.apiAccountItemActive : ''}`}
                        onClick={() => setSelectedAccountId(acc.accountId)}
                      >
                        <div className={styles.apiAccountMain}>
                          <div className={styles.apiAccountName}>{acc.email}</div>
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
                      </div>
                    )
                  })}
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
    </div>
  );
}
