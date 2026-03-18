import { useState, useEffect } from 'react';
import { ProxyConfig, ProxyStats } from '@shared/types/proxy';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { ArrowLeft, Plus, Trash2, TestTube, Check, X, Download, Upload, RotateCcw, FileText } from 'lucide-react';
import styles from './Settings.module.css';

interface ProxySettingsProps {
  onBack: () => void;
}

export function ProxySettings({ onBack }: ProxySettingsProps) {
  type ScopeKey = 'caption' | 'story' | 'chat' | 'tts' | 'other';
  type RotatingForm = {
    protocol: 'http' | 'socks5';
    host: string;
    port: string;
    username: string;
    password: string;
  };
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [stats, setStats] = useState<ProxyStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [proxyScopes, setProxyScopes] = useState({
    caption: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'any' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
    story: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'any' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
    chat: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'any' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
    tts: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'socks5' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
    other: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'any' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
  });
  const emptyRotatingForm: RotatingForm = {
    protocol: 'http',
    host: '',
    port: '80',
    username: '',
    password: '',
  };
  const [rotatingForms, setRotatingForms] = useState<Record<ScopeKey, RotatingForm>>({
    caption: { ...emptyRotatingForm },
    story: { ...emptyRotatingForm },
    chat: { ...emptyRotatingForm },
    tts: { ...emptyRotatingForm, protocol: 'socks5' },
    other: { ...emptyRotatingForm },
  });
  const [testingRotatingScopes, setTestingRotatingScopes] = useState<Set<string>>(new Set());
  const [webshareApiKey, setWebshareApiKey] = useState('');
  const [webshareProxyType, setWebshareProxyType] = useState<'http' | 'socks5' | 'both'>('socks5');
  const [savingWebshareKey, setSavingWebshareKey] = useState(false);
  const [syncingWebshare, setSyncingWebshare] = useState(false);
  
  // Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportType, setBulkImportType] = useState<'http' | 'socks5'>('socks5');
  const [formData, setFormData] = useState({
    host: '',
    port: 8080,
    username: '',
    password: '',
    type: 'http' as 'http' | 'https' | 'socks5',
    enabled: true,
    platform: '',
    country: '',
    city: '',
  });

  // Load proxies, stats và useProxy setting
  useEffect(() => {
    loadProxies();
    loadStats();
    loadProxySetting();
  }, []);

  const loadProxies = async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.proxy.getAll();
      if (result.success && result.data) {
        setProxies(result.data);
      }
    } catch (error) {
      console.error('Lỗi load proxies:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const result = await window.electronAPI.proxy.getStats();
      if (result.success && result.data) {
        setStats(result.data);
      }
    } catch (error) {
      console.error('Lỗi load stats:', error);
    }
  };

  const buildScopesFromLegacy = (data?: any) => {
    const isEnabled = data?.useProxy !== false;
    const mode = isEnabled ? (data?.proxyMode || 'direct-list') : 'off';
    const rotatingEndpoint = typeof data?.rotatingProxyEndpoint === 'string' ? data.rotatingProxyEndpoint : '';
    return {
      caption: { mode, typePreference: 'any' as const, rotatingEndpoint },
      story: { mode, typePreference: 'any' as const, rotatingEndpoint },
      chat: { mode, typePreference: 'any' as const, rotatingEndpoint },
      tts: { mode, typePreference: 'socks5' as const, rotatingEndpoint },
      other: { mode, typePreference: 'any' as const, rotatingEndpoint },
    };
  };

  const normalizeProxyScopesFromSettings = (data?: any) => {
    const legacyEndpoint = typeof data?.rotatingProxyEndpoint === 'string' ? data.rotatingProxyEndpoint : '';
    const baseScopes = data?.proxyScopes || buildScopesFromLegacy(data);
    const keys = ['caption', 'story', 'chat', 'tts', 'other'] as const;
    const next = {} as typeof proxyScopes;
    for (const key of keys) {
      const scope = baseScopes[key] || buildScopesFromLegacy(data)[key];
      const hasEndpoint = scope && Object.prototype.hasOwnProperty.call(scope, 'rotatingEndpoint');
      const rotatingEndpoint = hasEndpoint
        ? (typeof scope?.rotatingEndpoint === 'string' ? scope.rotatingEndpoint : '')
        : legacyEndpoint;
      next[key] = { ...scope, rotatingEndpoint };
    }
    return next;
  };

  const parseEndpointToForm = (endpoint: string, fallback: RotatingForm): RotatingForm => {
    const trimmed = endpoint.trim();
    if (!trimmed) return { ...fallback };
    try {
      const parsed = new URL(trimmed.includes('://') ? trimmed : `${fallback.protocol}://${trimmed}`);
      const protocol = parsed.protocol.startsWith('socks5') ? 'socks5' : 'http';
      const portValue = parsed.port || fallback.port || (protocol === 'socks5' ? '1080' : '80');
      return {
        protocol,
        host: parsed.hostname || fallback.host,
        port: portValue,
        username: parsed.username ? decodeURIComponent(parsed.username) : '',
        password: parsed.password ? decodeURIComponent(parsed.password) : '',
      };
    } catch {
      return { ...fallback };
    }
  };

  const buildEndpointFromForm = (form: RotatingForm): string => {
    const host = form.host.trim();
    const port = form.port.trim();
    if (!host || !port) return '';
    const authUser = form.username.trim();
    const authPass = form.password.trim();
    const auth = authUser ? `${encodeURIComponent(authUser)}:${encodeURIComponent(authPass)}@` : '';
    return `${form.protocol}://${auth}${host}:${port}`;
  };

  const updateRotatingForm = (scope: ScopeKey, patch: Partial<RotatingForm>) => {
    setRotatingForms(prev => ({
      ...prev,
      [scope]: {
        ...prev[scope],
        ...patch,
      },
    }));
  };

  const loadProxySetting = async () => {
    try {
      const result = await window.electronAPI.appSettings.getAll();
      if (result.success && result.data) {
        const scopes = normalizeProxyScopesFromSettings(result.data);
        setProxyScopes(scopes);
        await loadWebshareApiKey(result.data.webshareApiKey || '');
        await loadRotatingConfigs(result.data);
      }
    } catch (error) {
      console.error('Lỗi load proxy setting:', error);
    }
  };

  const loadWebshareApiKey = async (legacyKey: string) => {
    try {
      const result = await window.electronAPI.proxy.getWebshareApiKey();
      if (result.success && result.data?.apiKey) {
        setWebshareApiKey(result.data.apiKey);
        return;
      }
      if (legacyKey) {
        const saveResult = await window.electronAPI.proxy.saveWebshareApiKey({ apiKey: legacyKey });
        if (saveResult.success) {
          setWebshareApiKey(saveResult.data?.apiKey || legacyKey);
        } else {
          setWebshareApiKey(legacyKey);
        }
      } else {
        setWebshareApiKey('');
      }
    } catch (error) {
      console.error('Lỗi load Webshare API key:', error);
      setWebshareApiKey(legacyKey || '');
    }
  };

  const loadRotatingConfigs = async (settingsData?: any) => {
    try {
      const result = await window.electronAPI.proxy.getRotatingConfigs();
      const configs = result.success && result.data ? result.data : [];
      const configMap = new Map(configs.map(config => [config.scope, config]));
      const keys: ScopeKey[] = ['caption', 'story', 'chat', 'tts', 'other'];
      setRotatingForms(prev => {
        const next = { ...prev };
        for (const key of keys) {
          const stored = configMap.get(key);
          if (stored) {
            next[key] = {
              protocol: stored.protocol,
              host: stored.host || '',
              port: stored.port ? String(stored.port) : prev[key].port,
              username: stored.username || '',
              password: stored.password || '',
            };
            continue;
          }
          const scopedEndpoint = settingsData?.proxyScopes?.[key]?.rotatingEndpoint;
          const legacyEndpoint = settingsData?.rotatingProxyEndpoint;
          const endpoint = typeof scopedEndpoint === 'string' && scopedEndpoint.trim()
            ? scopedEndpoint
            : (typeof legacyEndpoint === 'string' ? legacyEndpoint : '');
          next[key] = parseEndpointToForm(endpoint || '', prev[key]);
        }
        return next;
      });
    } catch (error) {
      console.error('Lỗi load rotating configs:', error);
    }
  };

  const updateProxyScopes = async (nextScopes: typeof proxyScopes) => {
    try {
      const result = await window.electronAPI.appSettings.update({ proxyScopes: nextScopes });
      if (result.success) {
        setProxyScopes(nextScopes);
      } else {
        alert(`Lỗi cập nhật proxy scopes: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi cập nhật proxy scopes:', error);
      alert('Lỗi cập nhật proxy scopes!');
    }
  };

  const handleSaveRotatingEndpoint = async (scope: ScopeKey) => {
    const form = rotatingForms[scope];
    const host = form.host.trim();
    const port = Number(form.port);
    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
      alert('Vui lòng nhập Domain và Port hợp lệ!');
      return;
    }
    const endpoint = buildEndpointFromForm(form);
    if (!endpoint) {
      alert('Rotating Endpoint không hợp lệ!');
      return;
    }

    try {
      const saveResult = await window.electronAPI.proxy.saveRotatingConfig({
        scope,
        host,
        port,
        username: form.username.trim() || undefined,
        password: form.password.trim() || undefined,
        protocol: form.protocol,
      });
      if (!saveResult.success) {
        alert(`❌ Lỗi lưu rotating config: ${saveResult.error}`);
        return;
      }

      const nextScopes = {
        ...proxyScopes,
        [scope]: {
          ...proxyScopes[scope],
          rotatingEndpoint: endpoint,
        },
      };
      const result = await window.electronAPI.appSettings.update({ proxyScopes: nextScopes });
      if (result.success) {
        setProxyScopes(nextScopes);
        alert('✅ Đã lưu Rotating Endpoint');
      } else {
        alert(`❌ Lỗi lưu endpoint: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi lưu rotating endpoint:', error);
      alert('Lỗi lưu rotating endpoint!');
    }
  };

  const handleTestRotatingEndpoint = async (scope: ScopeKey) => {
    const endpoint = buildEndpointFromForm(rotatingForms[scope]);
    if (!endpoint) {
      alert('Vui lòng nhập Rotating Endpoint để test!');
      return;
    }

    try {
      setTestingRotatingScopes(prev => new Set(prev).add(scope));
      const result = await window.electronAPI.proxy.testRotatingEndpoint(endpoint);
      if (result.success) {
        alert(`✅ Test endpoint thành công!\n\nLatency: ${result.latency}ms`);
      } else {
        alert(`❌ Test endpoint thất bại!\n\nLỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi test rotating endpoint:', error);
      alert('Lỗi test rotating endpoint!');
    } finally {
      setTestingRotatingScopes(prev => {
        const next = new Set(prev);
        next.delete(scope);
        return next;
      });
    }
  };

  const handleAddProxy = async () => {
    try {
      if (!formData.host || !formData.port) {
        alert('Vui lòng nhập Host và Port!');
        return;
      }

      const result = await window.electronAPI.proxy.add(formData);
      if (result.success) {
        setShowAddForm(false);
        setFormData({
          host: '',
          port: 8080,
          username: '',
          password: '',
          type: 'http',
          enabled: true,
          platform: '',
          country: '',
          city: '',
        });
        loadProxies();
        loadStats();
      } else {
        alert(`Lỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi add proxy:', error);
      alert('Lỗi thêm proxy!');
    }
  };

  const handleRemoveProxy = async (id: string) => {
    if (!confirm('Bạn có chắc muốn xóa proxy này?')) return;

    try {
      const result = await window.electronAPI.proxy.remove(id);
      if (result.success) {
        loadProxies();
        loadStats();
      } else {
        alert(`Lỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi remove proxy:', error);
      alert('Lỗi xóa proxy!');
    }
  };

  const handleToggleProxy = async (id: string, currentEnabled: boolean) => {
    try {
      const result = await window.electronAPI.proxy.update(id, { enabled: !currentEnabled });
      if (result.success) {
        loadProxies();
      } else {
        alert(`Lỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi toggle proxy:', error);
    }
  };

  const handleTestProxy = async (id: string) => {
    try {
      setTestingIds(prev => new Set(prev).add(id));
      
      const result = await window.electronAPI.proxy.test(id);
      
      if (result.success) {
        alert(`✅ Test thành công!\n\nLatency: ${result.latency}ms`);
        loadStats(); // Refresh stats after test
      } else {
        alert(`❌ Test thất bại!\n\nLỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi test proxy:', error);
      alert('Lỗi test proxy!');
    } finally {
      setTestingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleImport = async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const text = await file.text();
        const result = await window.electronAPI.proxy.import(text);
        
        if (result.success) {
          alert(`✅ Import thành công!\n\nĐã thêm: ${result.added}\nĐã bỏ qua (duplicate): ${result.skipped}`);
          loadProxies();
          loadStats();
        } else {
          alert(`❌ Import thất bại!\n\nLỗi: ${result.error}`);
        }
      };
      input.click();
    } catch (error) {
      console.error('Lỗi import:', error);
      alert('Lỗi import proxies!');
    }
  };

  const handleExport = async () => {
    try {
      const result = await window.electronAPI.proxy.export();
      if (result.success && result.data) {
        // Download as JSON file
        const blob = new Blob([result.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proxies_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert(`Lỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi export:', error);
      alert('Lỗi export proxies!');
    }
  };

  const handleResetAll = async () => {
    if (!confirm('Bạn có chắc muốn reset tất cả proxies?\n\nĐiều này sẽ:\n- Reset failed count về 0\n- Re-enable tất cả proxies')) return;

    try {
      const result = await window.electronAPI.proxy.reset();
      if (result.success) {
        alert('✅ Đã reset tất cả proxies thành công!');
        loadProxies();
        loadStats();
      } else {
        alert(`❌ Lỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi reset:', error);
      alert('Lỗi reset proxies!');
    }
  };

  const handleCheckAll = async () => {
    if (proxies.length === 0) return;
    try {
      setCheckingAll(true);
      const result = await window.electronAPI.proxy.checkAll();
      if (result.success) {
        alert(`✅ Đã kiểm tra ${result.checked} proxy\n\nOK: ${result.passed}\nFAIL: ${result.failed}`);
        loadProxies();
        loadStats();
      } else {
        alert(`❌ Lỗi kiểm tra proxy: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi check all proxies:', error);
      alert('Lỗi kiểm tra proxy!');
    } finally {
      setCheckingAll(false);
    }
  };

  const getProxyStats = (proxyId: string): ProxyStats | undefined => {
    return stats.find(s => s.id === proxyId);
  };

  // Handle Webshare bulk import
  const handleBulkImport = async () => {
    try {
      if (!bulkImportText.trim()) {
        alert('Vui lòng nhập danh sách proxy!');
        return;
      }

      // Call IPC để parse và add proxies
      const result = await window.electronAPI.invoke('proxy:bulkImportWebshare', {
        text: bulkImportText,
        type: bulkImportType,
      }) as { success: boolean; added?: number; skipped?: number; error?: string };
      
      if (result.success) {
        alert(`✅ Import thành công!\n\nĐã thêm: ${result.added}\nĐã bỏ qua (duplicate): ${result.skipped}`);
        setShowBulkImport(false);
        setBulkImportText('');
        loadProxies();
        loadStats();
      } else {
        alert(`❌ Import thất bại!\n\nLỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi bulk import:', error);
      alert('Lỗi import proxies!');
    }
  };

  // Quick add Webshare free proxies
  const handleQuickAddWebshare = async () => {
    try {
      const result = await window.electronAPI.invoke('proxy:quickAddWebshare') as { success: boolean; added?: number; error?: string };
      
      if (result.success) {
        alert(`✅ Đã thêm ${result.added} Webshare proxies!\n\n(10 free proxies từ tài khoản qfdakzos)`);
        loadProxies();
        loadStats();
      } else {
        alert(`❌ Lỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi quick add:', error);
      alert('Lỗi thêm proxies!');
    }
  };

  const scopeRows = [
    { key: 'caption', label: 'Caption', desc: 'Step 3 dịch phụ đề' },
    { key: 'story', label: 'Story', desc: 'Dịch/tóm tắt truyện' },
    { key: 'chat', label: 'Chat', desc: 'Gemini Chat UI' },
    { key: 'tts', label: 'TTS', desc: 'Text-to-speech' },
    { key: 'other', label: 'Other', desc: 'Các request HTTP khác' },
  ] as const;

  const handleScopeChange = (
    scope: ScopeKey,
    patch: Partial<{ mode: 'off' | 'direct-list' | 'rotating-endpoint'; typePreference: 'any' | 'http' | 'https' | 'socks5' }>
  ) => {
    const next = {
      ...proxyScopes,
      [scope]: {
        ...proxyScopes[scope],
        ...patch,
      },
    };
    updateProxyScopes(next);
  };

  const handleSaveWebshareKey = async () => {
    const key = webshareApiKey.trim();
    if (!key) {
      alert('Vui lòng nhập Webshare API Key!');
      return;
    }
    try {
      setSavingWebshareKey(true);
      const saveResult = await window.electronAPI.proxy.saveWebshareApiKey({ apiKey: key });
      if (!saveResult.success) {
        alert(`❌ Lỗi lưu API key: ${saveResult.error}`);
        return;
      }
      await window.electronAPI.appSettings.update({ webshareApiKey: key });
      setWebshareApiKey(saveResult.data?.apiKey || key);
      alert('✅ Đã lưu Webshare API Key');
    } catch (error) {
      console.error('Lỗi lưu Webshare API key:', error);
      alert('Lỗi lưu Webshare API key!');
    } finally {
      setSavingWebshareKey(false);
    }
  };

  const handleSyncWebshare = async () => {
    const key = webshareApiKey.trim();
    if (!key) {
      alert('Vui lòng nhập Webshare API Key trước khi cập nhật.');
      return;
    }
    if (!confirm('Cập nhật Webshare sẽ xoá toàn bộ proxy Webshare cũ và thêm list mới. Tiếp tục?')) {
      return;
    }
    try {
      setSyncingWebshare(true);
      const result = await window.electronAPI.proxy.webshareSync({
        apiKey: key,
        typePreference: webshareProxyType,
      });
      if (result.success) {
        alert(`✅ Cập nhật Webshare thành công!\n\nRemoved: ${result.removed}\nAdded: ${result.added}\nSkipped: ${result.skipped}\nFetched: ${result.totalFetched}`);
        loadProxies();
        loadStats();
      } else {
        alert(`❌ Cập nhật Webshare thất bại!\n\nLỗi: ${result.error}`);
      }
    } catch (error) {
      console.error('Lỗi sync Webshare:', error);
      alert('Lỗi sync Webshare!');
    } finally {
      setSyncingWebshare(false);
    }
  };

  const handleScopeTypeChange = (
    scope: ScopeKey,
    value: 'any' | 'http' | 'https' | 'socks5'
  ) => {
    const scopeMode = proxyScopes[scope].mode;
    if (scopeMode === 'rotating-endpoint') {
      const nextProtocol = value === 'socks5' ? 'socks5' : 'http';
      updateRotatingForm(scope, { protocol: nextProtocol });
      return;
    }

    const next = {
      ...proxyScopes,
      [scope]: {
        ...proxyScopes[scope],
        typePreference: value,
      },
    };
    updateProxyScopes(next);
  };

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>Quản lý Proxy</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Proxy theo chức năng</span>
              <span className={styles.labelDesc}>Mỗi chức năng có mode/type riêng. Rotating endpoint theo từng scope.</span>
            </div>
          </div>
          <div style={{ padding: '0 24px 16px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {scopeRows.map((scope) => {
              const scopeMode = proxyScopes[scope.key].mode;
              const isDirectList = scopeMode === 'direct-list';
              const isOff = scopeMode === 'off';
              const rotatingType = rotatingForms[scope.key].protocol;
              const displayType = isDirectList ? proxyScopes[scope.key].typePreference : rotatingType;
              const typeOptions = isDirectList
                ? [
                  { value: 'any', label: 'Any' },
                  { value: 'http', label: 'HTTP' },
                  { value: 'https', label: 'HTTPS' },
                  { value: 'socks5', label: 'SOCKS5' },
                ]
                : [
                  { value: 'http', label: 'HTTP' },
                  { value: 'socks5', label: 'SOCKS5' },
                ];

              return (
              <div key={scope.key} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className={styles.flexRow} style={{ alignItems: 'center', gap: '12px' }}>
                  <div style={{ minWidth: '160px' }}>
                    <div style={{ fontWeight: 600 }}>{scope.label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{scope.desc}</div>
                  </div>
                  <Select
                    label="Mode"
                    value={scopeMode}
                    onChange={(e) => handleScopeChange(scope.key, { mode: e.target.value as 'off' | 'direct-list' | 'rotating-endpoint' })}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'direct-list', label: 'Direct List' },
                      { value: 'rotating-endpoint', label: 'Rotating Endpoint' },
                    ]}
                  />
                  <Select
                    label={isDirectList ? 'Proxy Type' : 'Rotating Protocol'}
                    value={displayType}
                    onChange={(e) => handleScopeTypeChange(scope.key, e.target.value as 'any' | 'http' | 'https' | 'socks5')}
                    disabled={isOff}
                    options={typeOptions}
                  />
                </div>
                {scopeMode === 'rotating-endpoint' && (
                  <div style={{ marginLeft: '172px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className={styles.flexRow} style={{ gap: '12px' }}>
                      <Input
                        label="Domain Name"
                        placeholder="p.webshare.io"
                        value={rotatingForms[scope.key].host}
                        onChange={(e) => updateRotatingForm(scope.key, { host: e.target.value })}
                      />
                      <Input
                        label="Proxy Port"
                        type="number"
                        placeholder="80"
                        value={rotatingForms[scope.key].port}
                        onChange={(e) => updateRotatingForm(scope.key, { port: e.target.value })}
                      />
                    </div>
                    <div className={styles.flexRow} style={{ gap: '12px' }}>
                      <Input
                        label="Proxy Username"
                        placeholder="qhnwfwys-rotate"
                        value={rotatingForms[scope.key].username}
                        onChange={(e) => updateRotatingForm(scope.key, { username: e.target.value })}
                      />
                      <Input
                        label="Proxy Password"
                        type="password"
                        placeholder="wzaljgyi9l6x"
                        value={rotatingForms[scope.key].password}
                        onChange={(e) => updateRotatingForm(scope.key, { password: e.target.value })}
                      />
                    </div>
                    <div className={styles.flexRow} style={{ gap: '12px' }}>
                      <Button onClick={() => handleSaveRotatingEndpoint(scope.key)} variant="primary">
                        Lưu Endpoint
                      </Button>
                      <Button
                        onClick={() => handleTestRotatingEndpoint(scope.key)}
                        variant="secondary"
                        disabled={testingRotatingScopes.has(scope.key)}
                      >
                        {testingRotatingScopes.has(scope.key) ? 'Đang test...' : 'Test Endpoint'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
            })}
            <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
              Rotating endpoint được cấu hình theo từng scope (không còn đồng bộ toàn cục).
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Webshare Sync</span>
              <span className={styles.labelDesc}>Lấy list proxy Webshare mới và thay thế proxies Webshare hiện tại.</span>
            </div>
          </div>
          <div style={{ padding: '0 24px 16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Input
              label="Webshare API Key"
              type="password"
              placeholder="Token APIKEY"
              value={webshareApiKey}
              onChange={(e) => setWebshareApiKey(e.target.value)}
            />
            <Select
              label="Webshare Proxy Type"
              value={webshareProxyType}
              onChange={(e) => setWebshareProxyType(e.target.value as 'http' | 'socks5' | 'both')}
              options={[
                { value: 'both', label: 'BOTH (HTTP + SOCKS5)' },
                { value: 'socks5', label: 'SOCKS5' },
                { value: 'http', label: 'HTTP' },
              ]}
            />
            <div className={styles.flexRow}>
              <Button onClick={handleSaveWebshareKey} variant="secondary" disabled={savingWebshareKey}>
                {savingWebshareKey ? 'Đang lưu...' : 'Lưu API Key'}
              </Button>
              <Button onClick={handleSyncWebshare} variant="primary" disabled={syncingWebshare}>
                {syncingWebshare ? 'Đang cập nhật...' : 'Cập nhật Webshare'}
              </Button>
            </div>
          </div>
        </div>

        {/* Add Proxy Form */}
        {showAddForm && (
          <div className={styles.section}>
            <div className={styles.row}>
              <div className={styles.label}>
                <span className={styles.labelText}>Thêm Proxy Mới</span>
              </div>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <div className={styles.flexRow}>
                <Input
                  label="Host/IP"
                  placeholder="123.45.67.89"
                  value={formData.host}
                  onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                />
                <Input
                  label="Port"
                  type="number"
                  placeholder="8080"
                  value={formData.port.toString()}
                  onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 8080 })}
                />
              </div>
              <div className={styles.flexRow}>
                <Input
                  label="Username (tùy chọn)"
                  placeholder="user123"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
                <Input
                  label="Password (tùy chọn)"
                  type="password"
                  placeholder="••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
              <div className={styles.flexRow}>
                <Select
                  label="Loại Proxy"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  options={[
                    { value: 'http', label: 'HTTP' },
                    { value: 'https', label: 'HTTPS' },
                    { value: 'socks5', label: 'SOCKS5' },
                  ]}
                />
                <label className={styles.flexRow}>
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  />
                  <span>Kích hoạt ngay</span>
                </label>
              </div>
              <div className={styles.flexRow}>
                <Button onClick={handleAddProxy} variant="primary">
                  <Plus size={16} />
                  Thêm
                </Button>
                <Button onClick={() => setShowAddForm(false)} variant="secondary">
                  Hủy
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Import Form */}
        {showBulkImport && (
          <div className={styles.section}>
            <div className={styles.row}>
              <div className={styles.label}>
                <span className={styles.labelText}>Bulk Import Webshare Proxies</span>
              </div>
              <Button onClick={handleQuickAddWebshare} variant="secondary">
                ⚡ Quick Add 10 Free Proxies
              </Button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                Paste danh sách proxy (mỗi dòng: ip,port,username,password,country,city). 
                Chọn loại mặc định bên dưới (HTTP/SOCKS5). Hỗ trợ prefix override: `socks5:ip:port:user:pass` hoặc `socks5://user:pass@ip:port`.
              </p>
              <div style={{ marginBottom: '12px', maxWidth: '280px' }}>
                <Select
                  label="Loại proxy mặc định"
                  value={bulkImportType}
                  onChange={(e) => setBulkImportType(e.target.value as 'http' | 'socks5')}
                  options={[
                    { value: 'socks5', label: 'SOCKS5 (Webshare Proxy)' },
                    { value: 'http', label: 'HTTP (Webshare Proxy)' },
                  ]}
                />
              </div>
              <textarea
                className={styles.select}
                style={{ width: '100%', height: '120px', resize: 'none', marginBottom: '12px' }}
                placeholder={`socks5:142.111.48.253:7030:qfdakzos:7fvhf24fe3ud
23.95.150.145,6114,qfdakzos,7fvhf24fe3ud,US,Buffalo`}
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
              />
              <div className={styles.flexRow}>
                <Button onClick={handleBulkImport} variant="primary">
                  <Upload size={16} />
                  Import ({bulkImportText.trim().split('\n').filter(l => l.trim()).length} proxies)
                </Button>
                <Button onClick={() => { setShowBulkImport(false); setBulkImportText(''); setBulkImportType('socks5'); }} variant="secondary">
                  Hủy
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Proxy List */}
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Danh sách Proxy ({proxies.length})</span>
            </div>
            <div className={styles.flexRow}>
              <Button onClick={() => setShowBulkImport(true)} variant="secondary">
                <FileText size={16} />
                Bulk Import (Webshare)
              </Button>
              <Button onClick={handleImport} variant="secondary">
                <Upload size={16} />
                Import JSON
              </Button>
              <Button onClick={handleResetAll} variant="secondary" disabled={proxies.length === 0}>
                <RotateCcw size={16} />
                Reset All
              </Button>
              <Button onClick={handleCheckAll} variant="secondary" disabled={proxies.length === 0 || checkingAll}>
                <TestTube size={16} />
                {checkingAll ? 'Đang kiểm tra...' : 'Kiểm tra Proxy'}
              </Button>
              <Button onClick={handleExport} variant="secondary" disabled={proxies.length === 0}>
                <Download size={16} />
                Export
              </Button>
              <Button onClick={() => setShowAddForm(true)} variant="primary">
                <Plus size={16} />
                Thêm Proxy
              </Button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              Đang tải...
            </div>
          ) : proxies.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              <p>Chưa có proxy nào.</p>
              <p style={{ fontSize: '14px', marginTop: '8px' }}>Nhấn "Thêm Proxy" để bắt đầu.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ backgroundColor: 'var(--color-surface)', fontSize: '12px', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <tr>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Trạng thái</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Host:Port</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Platform</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Location</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Loại</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Credentials</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center' }}>Success Rate</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center' }}>Thành công</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center' }}>Thất bại</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {proxies.map((proxy) => {
                    const proxyStats = getProxyStats(proxy.id);
                    const isTesting = testingIds.has(proxy.id);

                    return (
                      <tr key={proxy.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {proxy.enabled ? (
                              proxyStats?.isHealthy ? (
                                <Check size={16} style={{ color: 'green' }} />
                              ) : (
                                <X size={16} style={{ color: 'orange' }} />
                              )
                            ) : (
                              <X size={16} style={{ color: 'gray' }} />
                            )}
                            <span style={{ fontSize: '12px', color: proxy.enabled ? (proxyStats?.isHealthy ? 'green' : 'orange') : 'gray' }}>
                              {proxy.enabled ? (proxyStats?.isHealthy ? 'Sẵn sàng' : 'Lỗi') : 'Tắt'}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <code style={{ fontSize: '14px', color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>
                            {proxy.host}:{proxy.port}
                          </code>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {proxy.platform ? (
                            <span style={{ fontSize: '12px', padding: '4px 8px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '6px', color: '#3b82f6' }}>
                              {proxy.platform}
                            </span>
                          ) : (
                            <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                          {proxy.country || proxy.city ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {proxy.country && <span style={{ fontWeight: '500' }}>{proxy.country}</span>}
                              {proxy.city && <span style={{ color: 'var(--color-text-tertiary)' }}>{proxy.city}</span>}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: '12px', padding: '4px 8px', backgroundColor: 'var(--color-surface)', borderRadius: '6px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                            {proxy.type}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                          {proxy.username ? (
                            <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                              {proxy.username}:***
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Không có</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          {proxyStats ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                              <div style={{ width: '80px', height: '4px', backgroundColor: 'var(--color-surface)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    height: '100%',
                                    backgroundColor: proxyStats.successRate >= 80 ? 'green' : proxyStats.successRate >= 50 ? 'orange' : 'red',
                                    width: `${proxyStats.successRate}%`
                                  }}
                                />
                              </div>
                              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', width: '40px', textAlign: 'right' }}>
                                {proxyStats.successRate}%
                              </span>
                            </div>
                          ) : (
                            <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '14px', color: 'green', fontFamily: 'monospace' }}>
                          {proxyStats?.successCount || 0}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '14px', color: 'red', fontFamily: 'monospace' }}>
                          {proxyStats?.failedCount || 0}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                              onClick={() => handleToggleProxy(proxy.id, proxy.enabled)}
                              style={{ padding: '8px', borderRadius: '6px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: proxy.enabled ? 'green' : 'gray' }}
                              title={proxy.enabled ? 'Tắt' : 'Bật'}
                            >
                              <RotateCcw size={16} />
                            </button>
                            <button
                              onClick={() => handleTestProxy(proxy.id)}
                              disabled={isTesting}
                              style={{ padding: '8px', borderRadius: '6px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: 'blue', opacity: isTesting ? 0.5 : 1 }}
                              title="Test proxy"
                            >
                              <TestTube size={16} />
                            </button>
                            <button
                              onClick={() => handleRemoveProxy(proxy.id)}
                              style={{ padding: '8px', borderRadius: '6px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: 'red' }}
                              title="Xóa"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '16px' }}>
          <h4 style={{ fontWeight: '500', color: '#3b82f6', marginBottom: '8px' }}>ℹ️ Lưu ý</h4>
          <ul style={{ fontSize: '14px', color: 'var(--color-text-secondary)', listStyle: 'disc', listStylePosition: 'inside', margin: 0, paddingLeft: '16px' }}>
            <li>Proxy được rotation tự động theo round-robin khi gọi API</li>
            <li>Proxy bị tắt tự động sau 2 lỗi liên tiếp</li>
            <li>Nếu không còn proxy khả dụng, yêu cầu sẽ dừng lại</li>
            <li>Khuyến nghị sử dụng proxy trả phí để đảm bảo ổn định</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
