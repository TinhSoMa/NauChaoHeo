/**
 * GeminiChatSettings - Cấu hình kết nối Gemini qua giao diện web
 * Hỗ trợ nhiều tài khoản theo chế độ cookie-only
 */

import { useState, useCallback, useEffect, type KeyboardEvent, type MouseEvent } from 'react';
import {
  Cookie,
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';
import {
  formatLogMetadata,
  getTokenStats,
  type GeminiChatConfig,
  type GeminiChatListTab,
  type GeminiChatSettingsProps,
  type LiveTokenStats,
  type ProxyInfo,
  type TokenStats
} from './GeminiChatSettings.shared';
import { GeminiChatAccountsPanel } from './GeminiChatAccountsPanel';
import { GeminiChatWebApiOpsPanel } from './GeminiChatWebApiOpsPanel';
import { GeminiChatWebApiLogsPanel } from './GeminiChatWebApiLogsPanel';

const MIN_SEND_INTERVAL_SECONDS = 5;
const MAX_SEND_INTERVAL_SECONDS = 120;
const DEFAULT_SEND_INTERVAL_SECONDS = 20;

export function GeminiChatSettings({ onBack }: GeminiChatSettingsProps) {
  // Mode: 'list' | 'edit' | 'create'
  const [mode, setMode] = useState<'list' | 'edit' | 'create'>('list');
  const [configs, setConfigs] = useState<GeminiChatConfig[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [proxies, setProxies] = useState<ProxyInfo[]>([]);
  const [tokenStats, setTokenStats] = useState<TokenStats>({
    distinctActiveCount: 0,
    activeCount: 0,
    duplicateIds: new Set()
  });
  const [liveStats, setLiveStats] = useState<LiveTokenStats | null>(null);
  const [listTab, setListTab] = useState<GeminiChatListTab>('accounts');
  const [webApiHealth, setWebApiHealth] = useState<GeminiWebApiHealthSnapshot | null>(null);
  const [webApiOps, setWebApiOps] = useState<GeminiWebApiOpsSnapshot | null>(null);
  const [webApiLogs, setWebApiLogs] = useState<GeminiWebApiLogEntry[]>([]);
  const [webApiLoading, setWebApiLoading] = useState<boolean>(false);
  const [webApiError, setWebApiError] = useState<string>('');
  const [logTypeFilter, setLogTypeFilter] = useState<string>('');
  const [logAccountFilter, setLogAccountFilter] = useState<string>('');
  const [logTextFilter, setLogTextFilter] = useState<string>('');
  const [createChatOnWeb, setCreateChatOnWeb] = useState<boolean>(false);
  const [useStoredContextOnFirstSend, setUseStoredContextOnFirstSend] = useState<boolean>(false);
  const [minSendIntervalSecInput, setMinSendIntervalSecInput] = useState<string>(String(DEFAULT_SEND_INTERVAL_SECONDS));
  const [savedMinSendIntervalSec, setSavedMinSendIntervalSec] = useState<number>(DEFAULT_SEND_INTERVAL_SECONDS);
  const [isSavingMinSendInterval, setIsSavingMinSendInterval] = useState<boolean>(false);

  // Editing State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    cookie: string;
    isActive: boolean;
  }>({
    name: '',
    cookie: '',
    isActive: true
  });

  const editingConfig = editingId ? configs.find(c => c.id === editingId) : null;

  // Load configs
  const loadConfigs = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.electronAPI.geminiChat.getAll();
      if (result.success && result.data) {
        setConfigs(result.data);
        setTokenStats(getTokenStats(result.data));
      } else {
        setErrorMessage(result.error || 'Không thể tải danh sách cấu hình');
      }
    } catch (error) {
      console.error('Error loading configs:', error);
      setErrorMessage(String(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const loadWebApiHealth = useCallback(async () => {
    try {
      setWebApiLoading(true);
      const result = await window.electronAPI.geminiWebApi.getHealth();
      if (result.success && result.data) {
        setWebApiHealth(result.data);
        setWebApiError('');
      } else {
        setWebApiError(result.error || 'Không thể kiểm tra Gemini WebAPI.');
      }
    } catch (error) {
      setWebApiError(String(error));
    } finally {
      setWebApiLoading(false);
    }
  }, []);

  const loadWebApiOps = useCallback(async () => {
    try {
      const result = await window.electronAPI.geminiWebApi.getAccountStatuses();
      if (result.success && result.data) {
        setWebApiOps(result.data);
        setWebApiError('');
      } else if (result.error) {
        setWebApiError(result.error);
      }
    } catch (error) {
      setWebApiError(String(error));
    }
  }, []);

  const loadWebApiLogs = useCallback(async () => {
    try {
      const result = await window.electronAPI.geminiWebApi.getLogs(300);
      if (result.success && result.data) {
        setWebApiLogs(result.data);
        setWebApiError('');
      } else if (result.error) {
        setWebApiError(result.error);
      }
    } catch (error) {
      setWebApiError(String(error));
    }
  }, []);

  useEffect(() => {
    const loadProxies = async () => {
      try {
        const result = await window.electronAPI.proxy.getAll();
        if (result.success && result.data) {
          setProxies(result.data);
        }
      } catch (error) {
        console.error('Error loading proxies:', error);
      }
    };

    loadProxies();
  }, []);

  // Poll live token stats every 3 seconds in list mode
  useEffect(() => {
    if (mode !== 'list') return;
    
    const fetchStats = async () => {
      try {
        const result = await window.electronAPI.geminiChat.getTokenStats();
        if (result.success && result.data) {
          setLiveStats(result.data);
        }
      } catch (error) {
        // silent
      }
    };
    
    fetchStats(); // initial
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'list') return;

    void loadWebApiOps();
    if (listTab !== 'accounts') {
      void loadWebApiHealth();
    }
    if (listTab === 'logs') {
      void loadWebApiLogs();
    }

    const interval = setInterval(() => {
      void loadWebApiOps();
      if (listTab === 'logs') {
        void loadWebApiLogs();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [listTab, loadWebApiHealth, loadWebApiLogs, loadWebApiOps, mode]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.appSettings.getAll();
        if (result.success && result.data) {
          setCreateChatOnWeb(!!result.data.createChatOnWeb);
          setUseStoredContextOnFirstSend(!!result.data.useStoredContextOnFirstSend);
          const rawIntervalMs = Number(result.data.geminiMinSendIntervalMs);
          const normalizedIntervalMs = Number.isFinite(rawIntervalMs)
            ? Math.max(MIN_SEND_INTERVAL_SECONDS * 1000, Math.min(MAX_SEND_INTERVAL_SECONDS * 1000, Math.floor(rawIntervalMs)))
            : DEFAULT_SEND_INTERVAL_SECONDS * 1000;
          const intervalSec = Math.round(normalizedIntervalMs / 1000);
          setMinSendIntervalSecInput(String(intervalSec));
          setSavedMinSendIntervalSec(intervalSec);
        }
      } catch (error) {
        console.error('Error loading app settings:', error);
      }
    };

    loadSettings();
  }, []);

  const handleToggleCreateChatOnWeb = async () => {
    const nextValue = !createChatOnWeb;
    try {
      const result = await window.electronAPI.appSettings.update({ createChatOnWeb: nextValue });
      if (result.success) {
        setCreateChatOnWeb(nextValue);
      } else {
        alert('Lỗi cập nhật cài đặt tạo hộp thoại chat');
      }
    } catch (error) {
      console.error('Error updating app settings:', error);
      alert('Lỗi cập nhật cài đặt tạo hộp thoại chat');
    }
  };

  const handleToggleStoredContextOnFirstSend = async () => {
    const nextValue = !useStoredContextOnFirstSend;
    try {
      const result = await window.electronAPI.appSettings.update({ useStoredContextOnFirstSend: nextValue });
      if (result.success) {
        setUseStoredContextOnFirstSend(nextValue);
      } else {
        alert('Lỗi cập nhật cài đặt ngữ cảnh lần đầu');
      }
    } catch (error) {
      console.error('Error updating app settings:', error);
      alert('Lỗi cập nhật cài đặt ngữ cảnh lần đầu');
    }
  };

  const getProxyLabel = useCallback((proxyId?: string) => {
    if (!proxyId) return 'Tự động';
    const proxy = proxies.find(p => p.id === proxyId);
    if (!proxy) return 'Không tìm thấy';
    return `${proxy.host}:${proxy.port}`;
  }, [proxies]);

  // Handle Edit/Create actions
  const handleCreate = () => {
    setMode('create');
    setEditingId(null);
    setFormData({
      name: `Account ${configs.length + 1}`,
      cookie: '',
      isActive: true
    });
  };

  const handleSaveMinSendInterval = async () => {
    const trimmed = minSendIntervalSecInput.trim();
    if (!/^\d+$/.test(trimmed)) {
      alert(`Khoảng gửi tối thiểu phải là số nguyên từ ${MIN_SEND_INTERVAL_SECONDS}-${MAX_SEND_INTERVAL_SECONDS} giây.`);
      return;
    }

    const nextSec = Number(trimmed);
    if (!Number.isFinite(nextSec) || nextSec < MIN_SEND_INTERVAL_SECONDS || nextSec > MAX_SEND_INTERVAL_SECONDS) {
      alert(`Khoảng gửi tối thiểu phải nằm trong ${MIN_SEND_INTERVAL_SECONDS}-${MAX_SEND_INTERVAL_SECONDS} giây.`);
      return;
    }

    const nextMs = Math.floor(nextSec * 1000);
    try {
      setIsSavingMinSendInterval(true);
      const result = await window.electronAPI.appSettings.update({ geminiMinSendIntervalMs: nextMs });
      if (result.success) {
        setSavedMinSendIntervalSec(nextSec);
        setMinSendIntervalSecInput(String(nextSec));
      } else {
        alert('Lỗi cập nhật khoảng gửi tối thiểu');
      }
    } catch (error) {
      console.error('Error updating min send interval:', error);
      alert('Lỗi cập nhật khoảng gửi tối thiểu');
    } finally {
      setIsSavingMinSendInterval(false);
    }
  };

  const handleMinSendIntervalKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    void handleSaveMinSendInterval();
  };

  const handleEdit = (config: GeminiChatConfig) => {
    setMode('edit');
    setEditingId(config.id);
    setFormData({
      name: config.name,
      cookie: config.cookie,
      isActive: config.isActive
    });
  };

  const handleDelete = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    if (confirm('Bạn có chắc muốn xóa cấu hình này?')) {
      try {
        const result = await window.electronAPI.geminiChat.delete(id);
        if (result.success) {
          loadConfigs();
        } else {
          alert('Lỗi xóa: ' + result.error);
        }
      } catch (error) {
        alert('Lỗi: ' + error);
      }
    }
  };

  const handleToggleActive = async (config: GeminiChatConfig, e: MouseEvent) => {
    e.stopPropagation();
    try {
      const result = await window.electronAPI.geminiChat.update(config.id, { isActive: !config.isActive });
      if (result.success) {
        loadConfigs();
      }
    } catch (error) {
      console.error('Error toggling active:', error);
    }
  };

  const handleToggleError = async (config: GeminiChatConfig, e: MouseEvent) => {
    e.stopPropagation();
    try {
      const currentIsError = config.isError || false;
      const result = await window.electronAPI.geminiChat.update(config.id, { isError: !currentIsError });
      
      if (result.success) {
        // Refresh both stats and list to update UI
        loadConfigs();
        const statsResult = await window.electronAPI.geminiChat.getTokenStats();
        if (statsResult.success && statsResult.data) {
          setLiveStats(statsResult.data);
        }
      }
    } catch (error) {
      console.error('Error toggling error status:', error);
    }
  };

  const handleClearError = async (configId: string, e: MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.geminiChat.clearConfigError(configId);
      // Refresh stats immediately
      const result = await window.electronAPI.geminiChat.getTokenStats();
      if (result.success && result.data) {
        setLiveStats(result.data);
      }
    } catch (error) {
      console.error('Error clearing config error:', error);
    }
  };

  const handleRefreshWebApiSection = async () => {
    await Promise.all([loadWebApiHealth(), loadWebApiOps(), loadWebApiLogs()]);
  };

  const handleClearWebApiLogs = async () => {
    try {
      const result = await window.electronAPI.geminiWebApi.clearLogs();
      if (!result.success) {
        setWebApiError(result.error || 'Không thể xóa log WebAPI.');
        return;
      }
      setWebApiLogs([]);
    } catch (error) {
      setWebApiError(String(error));
    }
  };


  const extractSecureCookieTokens = useCallback((cookie: string): { secure1psid: string; secure1psidts: string } | null => {
    const normalized = (cookie || '').replace(/\^/g, '').trim();
    if (!normalized) {
      return null;
    }
    const secure1psid = normalized.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || '';
    const secure1psidts = normalized.match(/__Secure-1PSIDTS=([^;\s]+)/)?.[1] || '';
    if (!secure1psid || !secure1psidts) {
      return null;
    }
    return { secure1psid, secure1psidts };
  }, []);


  const handleSave = async () => {
    if (!formData.cookie.trim()) {
        alert('Vui lòng nhập Cookie.');
        return;
    }
    if (!extractSecureCookieTokens(formData.cookie)) {
        alert('Cookie phải chứa đủ __Secure-1PSID và __Secure-1PSIDTS.');
        return;
    }

    setIsLoading(true);
    try {
        const payload = { ...formData };
        // Clean strings
        payload.cookie = payload.cookie.replace(/\^/g, '').trim();

        const duplicateCheck = await window.electronAPI.geminiChat.checkDuplicateToken({
          cookie: payload.cookie,
          excludeId: mode === 'edit' ? editingId || undefined : undefined
        });

        if (!duplicateCheck.success) {
          alert(`Lỗi kiểm tra token trùng: ${duplicateCheck.error || 'Không rõ lỗi'}`);
          return;
        }

        if (duplicateCheck.data?.isDuplicate) {
          const duplicateName = duplicateCheck.data.duplicate?.name || 'tài khoản khác';
          alert(`Phát hiện trùng cookie secure!\n\nTài khoản "${duplicateName}" đã có cùng __Secure-1PSID/__Secure-1PSIDTS.`);
          return;
        }

        let result;
        if (mode === 'create') {
            result = await window.electronAPI.geminiChat.create(payload);
        } else {
            result = await window.electronAPI.geminiChat.update(editingId!, payload);
        }

        if (result.success) {
            setMode('list');
            loadConfigs();
        } else {
            alert('Lỗi lưu: ' + result.error);
        }
    } catch (e) {
        alert('Lỗi: ' + e);
    } finally {
        setIsLoading(false);
    }
  };

  const filteredWebApiLogs = webApiLogs.filter((entry) => {
    if (logTypeFilter && !entry.type.toLowerCase().includes(logTypeFilter.toLowerCase())) {
      return false;
    }
    if (logAccountFilter) {
      const haystack = `${entry.accountName || ''} ${entry.accountConfigId || ''}`.toLowerCase();
      if (!haystack.includes(logAccountFilter.toLowerCase())) {
        return false;
      }
    }
    if (logTextFilter) {
      const haystack = `${entry.message} ${entry.error || ''} ${formatLogMetadata(entry.metadata)}`.toLowerCase();
      if (!haystack.includes(logTextFilter.toLowerCase())) {
        return false;
      }
    }
    return true;
  });


  // --- RENDER LIST VIEW ---
  if (mode === 'list') {
    return (
      <div className={styles.detailContainer}>
        <div className={styles.detailHeader}>
          <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại"><ArrowLeft size={20} /></Button>
          <div className="flex-1">
             <div className={styles.detailTitle}>Gemini Chat (Web)</div>
             <div className="text-xs text-(--color-text-secondary) mt-1">
               Token active khác nhau: {tokenStats.distinctActiveCount}/{tokenStats.activeCount}
               {tokenStats.duplicateIds.size > 0 && (
                 <span className="ml-2 text-red-600">Trùng token: {tokenStats.duplicateIds.size}</span>
               )}
               {liveStats && (
                 <span className="ml-3">
                   <span style={{ color: '#22c55e' }}>✓ {liveStats.ready}</span>
                   <span className="mx-1" style={{ color: '#f59e0b' }}>⊛ {liveStats.busy}</span>
                 </span>
               )}
               {webApiOps && (
                 <span className="ml-3">
                   <span style={{ color: '#16a34a' }}>cookie OK {webApiOps.summary.refreshSuccessCount}</span>
                   <span className="mx-2" style={{ color: '#dc2626' }}>fail {webApiOps.summary.refreshFailCount}</span>
                 </span>
               )}
             </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1">
              <span className="text-xs text-(--color-text-secondary)">Khoảng gửi tối thiểu</span>
              <Input
                type="number"
                min={MIN_SEND_INTERVAL_SECONDS}
                max={MAX_SEND_INTERVAL_SECONDS}
                value={minSendIntervalSecInput}
                onChange={(e) => setMinSendIntervalSecInput(e.target.value)}
                onKeyDown={handleMinSendIntervalKeyDown}
                className="w-16 text-center"
                variant="small"
              />
              <span className="text-xs text-(--color-text-secondary)">s</span>
              <button
                onClick={() => void handleSaveMinSendInterval()}
                disabled={isSavingMinSendInterval || Number(minSendIntervalSecInput) === savedMinSendIntervalSec}
                className="text-xs px-2 py-1 rounded border border-(--color-border) text-(--color-text-secondary) hover:border-(--color-primary) disabled:opacity-50 disabled:cursor-not-allowed"
                title="Lưu khoảng gửi tối thiểu"
              >
                {isSavingMinSendInterval ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
            <button
              onClick={handleToggleStoredContextOnFirstSend}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${useStoredContextOnFirstSend ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
              title="Bật/tắt dùng ngữ cảnh cũ ở lần gửi đầu"
            >
              {useStoredContextOnFirstSend ? 'Context cũ: ON' : 'Context cũ: OFF'}
            </button>
            <button
              onClick={handleToggleCreateChatOnWeb}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${createChatOnWeb ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
              title="Bật/tắt tạo hộp thoại chat trên web"
            >
              {createChatOnWeb ? 'Chat Web: ON' : 'Chat Web: OFF'}
            </button>
            <Button onClick={handleCreate} variant="primary"><Plus size={16} className="mr-2" /> Thêm mới</Button>
          </div>
        </div>

        <div className={styles.detailContent}>
           {(errorMessage || webApiError) && (
             <div className="p-4 bg-red-100 text-red-700 rounded-lg">
               {errorMessage || webApiError}
             </div>
           )}

           <div className="flex items-center gap-2 border-b border-(--color-border) pb-4">
             {([
               ['accounts', 'Accounts'],
               ['webapi', 'WebAPI Ops'],
               ['logs', 'Logs']
             ] as Array<[GeminiChatListTab, string]>).map(([tabKey, label]) => (
               <button
                 key={tabKey}
                 onClick={() => setListTab(tabKey)}
                 className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                   listTab === tabKey
                     ? 'bg-(--color-primary) text-white border-(--color-primary)'
                     : 'bg-(--color-card) text-(--color-text-secondary) border-(--color-border) hover:border-(--color-primary)'
                 }`}
               >
                 {label}
               </button>
             ))}
             <div className="ml-auto flex items-center gap-2">
               <Button variant="secondary" onClick={handleRefreshWebApiSection} disabled={webApiLoading}>
                 <RefreshCw size={16} className={webApiLoading ? 'animate-spin' : ''} />
                 Refresh WebAPI
               </Button>
               {listTab === 'logs' && (
                 <Button variant="danger" onClick={handleClearWebApiLogs}>
                   <Trash2 size={16} />
                   Xóa log
                 </Button>
               )}
             </div>
           </div>

           {listTab === 'accounts' && (
             <GeminiChatAccountsPanel
               configs={configs}
               isLoading={isLoading}
               tokenStats={tokenStats}
               liveStats={liveStats}
               webApiOps={webApiOps}
               getProxyLabel={getProxyLabel}
               onEdit={handleEdit}
               onDelete={handleDelete}
               onToggleActive={handleToggleActive}
               onToggleError={handleToggleError}
               onClearError={handleClearError}
             />
           )}

           {listTab === 'webapi' && (
             <GeminiChatWebApiOpsPanel
               webApiHealth={webApiHealth}
               webApiOps={webApiOps}
               webApiLoading={webApiLoading}
               onRefreshHealth={loadWebApiHealth}
             />
           )}

           {listTab === 'logs' && (
             <GeminiChatWebApiLogsPanel
               logs={filteredWebApiLogs}
               logTypeFilter={logTypeFilter}
               logAccountFilter={logAccountFilter}
               logTextFilter={logTextFilter}
               onLogTypeFilterChange={setLogTypeFilter}
               onLogAccountFilterChange={setLogAccountFilter}
               onLogTextFilterChange={setLogTextFilter}
             />
           )}
        </div>
      </div>
    );
  }

  // --- RENDER EDIT/CREATE VIEW ---
  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={() => setMode('list')} title="Quay lại"><ArrowLeft size={20} /></Button>
        <div className={styles.detailTitle}>{mode === 'create' ? 'Thêm tài khoản mới' : 'Chỉnh sửa tài khoản'}</div>
      </div>
      
      <div className={styles.detailContent}>
        {/* Name & Active */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={styles.section}>
                <div className={styles.row}>
                    <div className={styles.label}>
                       <span className={styles.labelText}>Tên cấu hình</span>
                    </div>
                    <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="VD: Chrome Windows, Account 1..." />
                </div>
            </div>
             <div className={`${styles.section} flex items-center p-4 gap-4`}>
                <span className="font-medium">Sử dụng token</span>
                <button 
                    onClick={() => setFormData({...formData, isActive: !formData.isActive})}
                    className={`relative w-11 h-6 rounded-full transition-colors ${formData.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                    <div className={`absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform ${formData.isActive ? 'translate-x-5' : ''}`} />
                </button>
                <span className="text-sm text-gray-500">{formData.isActive ? 'Token sẽ được dùng khi gửi' : 'Token sẽ bị bỏ qua'}</span>
            </div>
        </div>

        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Proxy đang dùng</span>
              <span className={styles.labelDesc}>Hiển thị proxy đang gắn với token</span>
            </div>
            <div className="text-sm text-(--color-text-secondary)">
              {getProxyLabel(mode === 'edit' ? editingConfig?.proxyId : undefined)}
            </div>
          </div>
        </div>

        {/* Core Auth Fields */}
        <div className={styles.section}>
          <div className="p-4 border-b font-medium bg-(--color-surface)">Thông tin xác thực Cookie (Bắt buộc)</div>
          
          <div className={styles.row} style={{display:'block'}}>
             <div className="mb-1 font-medium text-sm flex items-center gap-2"><Cookie size={14} /> Cookie</div>
             <textarea 
                value={formData.cookie}
                onChange={e => setFormData({...formData, cookie: e.target.value})}
                rows={2}
                className="w-full p-2 rounded border bg-(--bg-secondary) font-mono text-xs"
                placeholder="__Secure-1PSID=...; __Secure-1PSIDTS=..."
             />
             <div className="mt-1 text-xs text-gray-500">
               Hệ thống sẽ tự tách và lưu __Secure-1PSID + __Secure-1PSIDTS từ Cookie.
             </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className={styles.saveBar}>
          <Button variant="secondary" onClick={() => setMode('list')} disabled={isLoading}>
            Hủy
          </Button>
          <Button onClick={handleSave} variant="primary" disabled={isLoading}>
            <Save size={16} className="mr-2" />
            {isLoading ? 'Đang lưu...' : (mode === 'create' ? 'Tạo mới' : 'Cập nhật')}
          </Button>
        </div>

      </div>
    </div>
  );
}
