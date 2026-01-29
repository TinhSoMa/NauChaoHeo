/**
 * GeminiChatSettings - Cấu hình kết nối Gemini qua giao diện web
 * Hỗ trợ nhiều tài khoản và cấu hình trình duyệt (Browser Profile)
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Cookie,
  Globe,
  Hash,
  Shield,
  Sparkles,
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  Check,
  X,
  Monitor,
  Laptop,
  Clipboard
} from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import styles from './Settings.module.css';

// Type definitions matching backend DTOs
interface GeminiChatConfig {
  id: string;
  name: string;
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  proxyId?: string;
  convId: string;
  respId: string;
  candId: string;
  reqId?: string;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

interface GeminiChatSettingsProps {
  onBack: () => void;
}

interface TokenStats {
  distinctActiveCount: number;
  activeCount: number;
  duplicateIds: Set<string>;
}

interface ProxyInfo {
  id: string;
  host: string;
  port: number;
}

// Default constants
const DEFAULT_UA = "";
const DEFAULT_LANG = "vi,fr-FR;q=0.9,fr;q=0.8,en-US;q=0.7,en;q=0.6,zh-CN;q=0.5,zh;q=0.4";

// Browser Presets (matching geminiChatService.ts BROWSER_PROFILES)
const BROWSER_PRESETS = [
  {
    label: "Chrome / Windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "Windows",
    acceptLanguage: "vi,en-US;q=0.9,en;q=0.8"
  },
  {
    label: "Edge / Windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
    platform: "Windows",
    acceptLanguage: "vi,en-US;q=0.9,en;q=0.8"
  },
  {
    label: "Chrome / macOS",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "macOS",
    acceptLanguage: "vi,en-US;q=0.9,en;q=0.8"
  },
  {
    label: "Firefox / Windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
    platform: "Windows",
    acceptLanguage: "vi,en-US;q=0.9,en;q=0.8"
  },
  {
    label: "Tùy chỉnh / Custom",
    userAgent: "",
    platform: "Windows",
    acceptLanguage: DEFAULT_LANG
  }
];

// Token key is now based on atToken to support multiple accounts sharing the same cookie (1PSID)
const buildTokenKey = (_cookie: string, atToken: string): string => {
  return (atToken || '').trim();
};

const getTokenStats = (configs: GeminiChatConfig[]): TokenStats => {
  const seen = new Map<string, string>();
  const duplicateIds = new Set<string>();
  const activeConfigs = configs.filter(c => c.isActive);

  for (const config of activeConfigs) {
    const key = buildTokenKey(config.cookie || '', config.atToken || '');
    if (seen.has(key)) {
      duplicateIds.add(config.id);
      const firstId = seen.get(key);
      if (firstId) duplicateIds.add(firstId);
    } else {
      seen.set(key, config.id);
    }
  }

  return {
    distinctActiveCount: seen.size,
    activeCount: activeConfigs.length,
    duplicateIds
  };
};

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
  const [createChatOnWeb, setCreateChatOnWeb] = useState<boolean>(false);
  const [useStoredContextOnFirstSend, setUseStoredContextOnFirstSend] = useState<boolean>(false);

  // Editing State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    cookie: string;
    blLabel: string;
    fSid: string;
    atToken: string;
    userAgent: string;
    acceptLanguage: string;
    platform: string;
    isActive: boolean;
  }>({
    name: '',
    cookie: '',
    blLabel: '',
    fSid: '',
    atToken: '',
    userAgent: DEFAULT_UA,
    acceptLanguage: DEFAULT_LANG,
    platform: 'Windows',
    isActive: true
  });
  
  // Auto-parse State
  const [rawInput, setRawInput] = useState<string>('');
  const [parseStatus, setParseStatus] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string>('4'); // Default to Custom
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

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.appSettings.getAll();
        if (result.success && result.data) {
          setCreateChatOnWeb(!!result.data.createChatOnWeb);
          setUseStoredContextOnFirstSend(!!result.data.useStoredContextOnFirstSend);
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
      blLabel: '',
      fSid: '',
      atToken: '',
      userAgent: DEFAULT_UA,
      acceptLanguage: DEFAULT_LANG,
      platform: 'Windows',
      isActive: true
    });
    setRawInput('');
    setParseStatus('');
  };

  const handleEdit = (config: GeminiChatConfig) => {
    setMode('edit');
    setEditingId(config.id);
    setFormData({
      name: config.name,
      cookie: config.cookie,
      blLabel: config.blLabel,
      fSid: config.fSid,
      atToken: config.atToken,
      userAgent: config.userAgent || DEFAULT_UA,
      acceptLanguage: config.acceptLanguage || DEFAULT_LANG,
      platform: config.platform || 'Windows',
      isActive: config.isActive
    });
    setRawInput('');
    setParseStatus('');
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
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

  const handleToggleActive = async (config: GeminiChatConfig, e: React.MouseEvent) => {
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


  // Auto-parse logic (reused from previous version)
  const handleAutoParse = useCallback(() => {
    if (!rawInput.trim()) {
      setParseStatus('Vui lòng dán dữ liệu vào ô trên trước');
      return;
    }

    let foundCount = 0;
    const text = rawInput;
    const newData = { ...formData };

    // Parse Cookie
    const curlCookieMatch = text.match(/-b\s+\^?"([^"]+)\^?"/);
    if (curlCookieMatch && curlCookieMatch[1]) {
      newData.cookie = curlCookieMatch[1].trim();
      foundCount++;
    } else {
      const cookieHeaderMatch = text.match(/Cookie:\s*(.+?)(?:\r?\n|$)/i);
      if (cookieHeaderMatch && cookieHeaderMatch[1]) {
        newData.cookie = cookieHeaderMatch[1].trim();
        foundCount++;
      } else {
        const securePsidMatch = text.match(/(__Secure-1PSID=[^;\s]+(?:;[^"]+)?)/);
        if (securePsidMatch && securePsidMatch[1]) {
          newData.cookie = securePsidMatch[1].trim();
          foundCount++;
        }
      }
    }

    // Parse BL, F_SID, AT_TOKEN
    const blMatch = text.match(/[?&]bl=([^&\s^"]+)/) || text.match(/bl=([^&\s^"]+)/);
    if (blMatch && blMatch[1]) {
        newData.blLabel = decodeURIComponent(blMatch[1].replace(/\^/g, ''));
        foundCount++;
    }

    const fsidMatch = text.match(/[?&]f\.sid=([^&\s^"]+)/) || text.match(/f\.sid=([^&\s^"]+)/);
    if (fsidMatch && fsidMatch[1]) {
        newData.fSid = fsidMatch[1].replace(/\^/g, '');
        foundCount++;
    }

    const atMatch = text.match(/[&?]at=([^&\s^"]+)/) || text.match(/at=([^&\s^"]+)/) || text.match(/"at":\s*"([^"]+)"/);
    if (atMatch && atMatch[1]) {
        try {
            let atValue = atMatch[1].replace(/\^/g, '');
            newData.atToken = decodeURIComponent(atValue);
        } catch {
            newData.atToken = atMatch[1].replace(/\^/g, '');
        }
        foundCount++;
    }

    // Try parsing UA
    const uaMatch = text.match(/User-Agent:\s*(.+?)(?:\r?\n|$)/i) || text.match(/-A\s+"([^"]+)"/);
    if (uaMatch && uaMatch[1]) {
        newData.userAgent = uaMatch[1].trim();
        foundCount++;
    }

    setFormData(newData);
    
    if (foundCount > 0) {
      setParseStatus(`Đã tìm thấy ${foundCount} trường thông tin.`);
    } else {
      setParseStatus('Không tìm thấy dữ liệu hợp lệ.');
    }
  }, [rawInput, formData]);

  const handlePresetChange = (index: string) => {
    setSelectedPreset(index);
    const preset = BROWSER_PRESETS[parseInt(index)];
    if (preset) {
      setFormData({
        ...formData,
        userAgent: preset.userAgent,
        platform: preset.platform,
        acceptLanguage: preset.acceptLanguage
      });
    }
  };


  const handleSave = async () => {
    if (!formData.cookie || !formData.blLabel || !formData.fSid || !formData.atToken) {
        alert('Vui lòng nhập đầy đủ 4 trường bắt buộc: Cookie, BL Label, F.SID, AT Token');
        return;
    }

    setIsLoading(true);
    try {
        const payload = { ...formData };
        // Clean strings
        payload.cookie = payload.cookie.replace(/\^/g, '').trim();
        payload.blLabel = payload.blLabel.replace(/\^/g, '').trim();
        payload.fSid = payload.fSid.replace(/\^/g, '').trim();
        payload.atToken = payload.atToken.replace(/\^/g, '').trim();

        const duplicateCheck = await window.electronAPI.geminiChat.checkDuplicateToken({
          cookie: payload.cookie,
          atToken: payload.atToken,
          excludeId: mode === 'edit' ? editingId || undefined : undefined
        });

        if (!duplicateCheck.success) {
          alert(`Lỗi kiểm tra token trùng: ${duplicateCheck.error || 'Không rõ lỗi'}`);
          return;
        }

        if (duplicateCheck.data?.isDuplicate) {
          const duplicateName = duplicateCheck.data.duplicate?.name || 'tài khoản khác';
          alert(`Phát hiện trùng lặp!\n\nThông tin "AT Token" bạn nhập đã tồn tại trong cấu hình: "${duplicateName}".\n\nHệ thống hiện tại chỉ dùng AT Token để phân biệt tài khoản. Vui lòng kiểm tra lại.`);
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


  // --- RENDER LIST VIEW ---
  if (mode === 'list') {
    return (
      <div className={styles.detailContainer}>
        <div className={styles.detailHeader}>
          <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại"><ArrowLeft size={20} /></Button>
          <div className="flex-1">
             <div className={styles.detailTitle}>Danh sách Tài khoản (Proxy)</div>
             <div className="text-xs text-(--color-text-secondary) mt-1">
               Token active khác nhau: {tokenStats.distinctActiveCount}/{tokenStats.activeCount}
               {tokenStats.duplicateIds.size > 0 && (
                 <span className="ml-2 text-red-600">Trùng token: {tokenStats.duplicateIds.size}</span>
               )}
             </div>
          </div>
          <div className="flex items-center gap-3">
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
           {errorMessage && <div className="p-4 bg-red-100 text-red-700 rounded-lg">{errorMessage}</div>}
           
           <div className="grid grid-cols-1 gap-4">
             {configs.map(config => (
               <div key={config.id} className="bg-(--color-card) border border-(--color-border) rounded-xl p-4 flex items-center gap-4 hover:border-(--color-primary) transition-colors cursor-pointer group" onClick={() => handleEdit(config)}>
                 <div className={`w-10 h-10 rounded-full flex items-center justify-center ${config.isActive ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {config.isActive ? <Check size={20} /> : <X size={20} />}
                 </div>
                 
                 <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg">{config.name}</span>
                        {config.id === 'legacy' ? <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Legacy</span> : null}
                        {tokenStats.duplicateIds.has(config.id) && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Trùng token</span>
                        )}
                    </div>
                    <div className="text-sm text-(--color-text-secondary) flex gap-4 mt-1">
                      <span className="flex items-center gap-1"><Monitor size={12}/> {config.platform || 'Unknown'}</span>
                      <span className="opacity-80">Proxy: {getProxyLabel(config.proxyId)}</span>
                      <span className="truncate max-w-50 opacity-70">{config.cookie.substring(0, 30)}...</span>
                    </div>
                 </div>

                 <div className="flex items-center gap-2">
                    <button 
                        onClick={(e) => handleToggleActive(config, e)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${config.isActive ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                    >
                        {config.isActive ? 'Đang dùng' : 'Đang tắt'}
                    </button>
                    
                    <Button variant="danger" iconOnly onClick={(e) => handleDelete(config.id, e)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 size={16} />
                    </Button>
                 </div>
               </div>
             ))}

             {configs.length === 0 && !isLoading && (
                 <div className="text-center py-20 text-gray-400">
                     Chưa có tài khoản nào. Nhấn "Thêm mới" để cấu hình.
                 </div>
             )}
           </div>
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

        {/* Auto Parse */}
        <div className={styles.section}>
             <div className={styles.row} style={{ display: 'block' }}>
                <div className={styles.label} style={{ marginBottom: 8 }}>
                  <span className={styles.labelText} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Clipboard size={18} /> Tự động phân tích
                  </span>
                  <span className={styles.labelDesc}>Dán headers/curl từ DevTools để tự động điền các trường bên dưới</span>
                </div>
                <textarea 
                    value={rawInput}
                    onChange={e => setRawInput(e.target.value)}
                    rows={3}
                    className="w-full p-3 rounded-lg border bg-(--bg-secondary) font-mono text-xs"
                    placeholder="Paste curl or raw headers here..."
                />
                <div className="flex gap-4 items-center mt-2">
                    <Button onClick={handleAutoParse} variant="primary" className="h-8 text-xs"><Sparkles size={14} className="mr-1"/> Phân tích</Button>
                    {parseStatus && <span className="text-xs text-green-600">{parseStatus}</span>}
                </div>
             </div>
        </div>

        {/* Core Auth Fields */}
        <div className={styles.section}>
          <div className="p-4 border-b font-medium bg-(--color-surface)">Thông tin xác thực (Bắt buộc)</div>
          
          <div className={styles.row} style={{display:'block'}}>
             <div className="mb-1 font-medium text-sm flex items-center gap-2"><Cookie size={14} /> Cookie</div>
             <textarea 
                value={formData.cookie}
                onChange={e => setFormData({...formData, cookie: e.target.value})}
                rows={2}
                className="w-full p-2 rounded border bg-(--bg-secondary) font-mono text-xs"
                placeholder="__Secure-1PSID=...; __Secure-3PSID=..."
             />
          </div>

           <div className={styles.row}>
             <div className="flex flex-col">
                <span className="font-medium text-sm flex items-center gap-2"><Globe size={14} /> BL_LABEL</span>
                <span className="text-xs text-gray-500">Từ URL parameter bl=...</span>
             </div>
             <Input value={formData.blLabel} onChange={e => setFormData({...formData, blLabel: e.target.value})} containerClassName="w-1/2" />
          </div>

          <div className={styles.row}>
             <div className="flex flex-col">
                <span className="font-medium text-sm flex items-center gap-2"><Hash size={14} /> F_SID</span>
                <span className="text-xs text-gray-500">Từ URL parameter f.sid=...</span>
             </div>
             <Input value={formData.fSid} onChange={e => setFormData({...formData, fSid: e.target.value})} containerClassName="w-1/2" />
          </div>

          <div className={styles.row}>
              <div className="flex flex-col">
                <span className="font-medium text-sm flex items-center gap-2"><Shield size={14} /> AT_TOKEN</span>
                <span className="text-xs text-gray-500">Từ Body parameter at=...</span>
             </div>
             <Input value={formData.atToken} onChange={e => setFormData({...formData, atToken: e.target.value})} containerClassName="w-1/2" />
          </div>
        </div>

        {/* Browser Profile */}
        <div className={styles.section}>
           <div className="p-4 border-b font-medium bg-(--color-surface) flex items-center gap-2">
              <Laptop size={16} /> Hồ sơ trình duyệt (Browser Profile)
           </div>

           {/* Preset Selection */}
           <div className={styles.row}>
             <div className="flex flex-col gap-1">
                <span className="font-medium text-sm flex items-center gap-2">
                  <Sparkles size={14} /> Chọn preset trình duyệt
                </span>
                <span className="text-xs text-gray-500">Chọn preset sẽ tự động điền thông tin bên dưới</span>
             </div>
             <select 
                value={selectedPreset}
                onChange={e => handlePresetChange(e.target.value)}
                className={styles.select}
             >
                {BROWSER_PRESETS.map((preset, idx) => (
                  <option key={idx} value={idx}>{preset.label}</option>
                ))}
             </select>
           </div>

           <div className={styles.row}>
             <div className="flex flex-col gap-1">
                <span className="font-medium text-sm">Platform / OS</span>
                <span className="text-xs text-gray-500">Hệ điều hành giả lập</span>
             </div>
             <select 
                value={formData.platform}
                onChange={e => setFormData({...formData, platform: e.target.value})}
                className={styles.select}
             >
                <option value="Windows">Windows</option>
                <option value="macOS">macOS</option>
                <option value="Linux">Linux</option>
                <option value="Android">Android</option>
                <option value="iOS">iOS</option>
             </select>
           </div>

           <div className={styles.row} style={{display:'block'}}>
             <div className="mb-2 font-medium text-sm">User Agent</div>
             <textarea 
                value={formData.userAgent}
                onChange={e => setFormData({...formData, userAgent: e.target.value})}
                rows={2}
                className="w-full p-2 rounded border bg-(--bg-secondary) font-mono text-xs"
             />
           </div>

           <div className={styles.row} style={{display:'block'}}>
             <div className="mb-2 font-medium text-sm">Accept-Language</div>
             <Input value={formData.acceptLanguage} onChange={e => setFormData({...formData, acceptLanguage: e.target.value})} />
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
