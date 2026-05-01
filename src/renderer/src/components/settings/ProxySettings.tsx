import { useState, useEffect, useMemo, Fragment } from 'react';
import { ProxyConfig, ProxyStats } from '@shared/types/proxy';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { ArrowLeft, Plus, Trash2, TestTube, Check, X, Download, Upload, RotateCcw, FileText } from 'lucide-react';
import sharedStyles from './Settings.module.css';
import styles from './ProxySettings.module.css';

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
  const [activeTab, setActiveTab] = useState<'list' | 'scopes' | 'sources'>('list');
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<'any' | 'http' | 'https' | 'socks5'>('any');
  const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled' | 'healthy' | 'error'>('all');
  const [expandedProxyIds, setExpandedProxyIds] = useState<Set<string>>(new Set());
  const [openAccordion, setOpenAccordion] = useState<'webshare' | 'add' | 'bulk' | null>('webshare');
  const [proxyScopes, setProxyScopes] = useState({
    caption: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'any' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
    story: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'any' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
    chat: { mode: 'direct-list' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'any' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
    tts: { mode: 'off' as 'off' | 'direct-list' | 'rotating-endpoint', typePreference: 'socks5' as 'any' | 'http' | 'https' | 'socks5', rotatingEndpoint: '' },
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
      tts: { mode: 'off' as const, typePreference: 'socks5' as const, rotatingEndpoint },
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

  const toggleProxyDetail = (proxyId: string) => {
    setExpandedProxyIds((prev) => {
      const next = new Set(prev);
      if (next.has(proxyId)) next.delete(proxyId);
      else next.add(proxyId);
      return next;
    });
  };

  const openSourcesTab = (section: 'webshare' | 'add' | 'bulk') => {
    setActiveTab('sources');
    setOpenAccordion(section);
  };

  const toggleAccordion = (section: 'webshare' | 'add' | 'bulk') => {
    setOpenAccordion((prev) => (prev === section ? null : section));
  };

  const filteredProxies = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return proxies.filter((proxy) => {
      const proxyStats = stats.find((s) => s.id === proxy.id);
      const matchesQuery = !query || [
        proxy.host,
        proxy.port?.toString?.() ?? '',
        proxy.country,
        proxy.city,
        proxy.platform,
        proxy.username,
      ].some((value) => String(value || '').toLowerCase().includes(query));

      const matchesType = filterType === 'any' ? true : proxy.type === filterType;

      const matchesStatus = (() => {
        switch (filterStatus) {
          case 'enabled':
            return proxy.enabled;
          case 'disabled':
            return !proxy.enabled;
          case 'healthy':
            return proxy.enabled && Boolean(proxyStats?.isHealthy);
          case 'error':
            return proxy.enabled && proxyStats?.isHealthy === false;
          default:
            return true;
        }
      })();

      return matchesQuery && matchesType && matchesStatus;
    });
  }, [filterStatus, filterType, proxies, searchText, stats]);

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
    <div className={sharedStyles.detailContainer}>
      <div className={sharedStyles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={sharedStyles.detailTitle}>Quản lý Proxy</div>
      </div>
      
      <div className={`${sharedStyles.detailContent} ${styles.proxyContent}`}>
        <div className={styles.tabBar}>
          {[
            { key: 'list', label: 'Danh sách' },
            { key: 'scopes', label: 'Proxy theo chức năng' },
            { key: 'sources', label: 'Nguồn & Import' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'list' && (
          <div className={styles.tabSection}>
            <div className={styles.toolbar}>
              <div className={styles.toolbarGroup}>
                <Input
                  placeholder="Tìm host, platform, country..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  variant="small"
                  className={styles.searchInput}
                />
                <Select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as typeof filterType)}
                  variant="small"
                  containerClassName={styles.filterSelect}
                  options={[
                    { value: 'any', label: 'All Types' },
                    { value: 'http', label: 'HTTP' },
                    { value: 'https', label: 'HTTPS' },
                    { value: 'socks5', label: 'SOCKS5' },
                  ]}
                />
                <Select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                  variant="small"
                  containerClassName={styles.filterSelect}
                  options={[
                    { value: 'all', label: 'All Status' },
                    { value: 'enabled', label: 'Enabled' },
                    { value: 'disabled', label: 'Disabled' },
                    { value: 'healthy', label: 'Healthy' },
                    { value: 'error', label: 'Error' },
                  ]}
                />
              </div>
              <div className={styles.toolbarActions}>
                <Button onClick={handleCheckAll} variant="secondary" disabled={proxies.length === 0 || checkingAll}>
                  <TestTube size={16} />
                  {checkingAll ? 'Đang kiểm tra...' : 'Kiểm tra'}
                </Button>
                <Button onClick={handleImport} variant="secondary">
                  <Upload size={16} />
                  Import
                </Button>
                <Button onClick={handleExport} variant="secondary" disabled={proxies.length === 0}>
                  <Download size={16} />
                  Export
                </Button>
                <Button onClick={() => openSourcesTab('bulk')} variant="secondary">
                  <FileText size={16} />
                  Bulk Import
                </Button>
                <Button onClick={() => openSourcesTab('add')} variant="primary">
                  <Plus size={16} />
                  Thêm Proxy
                </Button>
              </div>
            </div>

            <div className={styles.tableWrapper}>
              {loading ? (
                <div className={styles.emptyState}>Đang tải...</div>
              ) : filteredProxies.length === 0 ? (
                <div className={styles.emptyState}>
                  <div>Không có proxy phù hợp.</div>
                  <span>Hãy thử đổi filter hoặc thêm proxy mới.</span>
                </div>
              ) : (
                <table className={styles.proxyTable}>
                  <thead>
                    <tr>
                      <th>Trạng thái</th>
                      <th>Host:Port</th>
                      <th>Loại</th>
                      <th>Location</th>
                      <th>Success</th>
                      <th className={styles.actionsCol}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProxies.map((proxy) => {
                      const proxyStats = getProxyStats(proxy.id);
                      const isTesting = testingIds.has(proxy.id);
                      const statusLabel = !proxy.enabled
                        ? 'Tắt'
                        : proxyStats?.isHealthy
                          ? 'Sẵn sàng'
                          : 'Lỗi';
                      const statusClass = !proxy.enabled
                        ? styles.statusOff
                        : proxyStats?.isHealthy
                          ? styles.statusOk
                          : styles.statusWarn;
                      const isExpanded = expandedProxyIds.has(proxy.id);
                      const successRate = proxyStats?.successRate ?? 0;

                      return (
                        <Fragment key={proxy.id}>
                          <tr className={styles.proxyRow}>
                            <td>
                              <div className={`${styles.statusBadge} ${statusClass}`}>
                                {proxy.enabled ? (proxyStats?.isHealthy ? <Check size={14} /> : <X size={14} />) : <X size={14} />}
                                <span>{statusLabel}</span>
                              </div>
                            </td>
                            <td>
                              <code className={styles.monoText}>{proxy.host}:{proxy.port}</code>
                            </td>
                            <td>
                              <span className={styles.typeBadge}>{proxy.type}</span>
                            </td>
                            <td className={styles.locationCell}>
                              {proxy.country || proxy.city ? (
                                <>
                                  <span className={styles.locationMain}>{proxy.country || '-'}</span>
                                  <span className={styles.locationSub}>{proxy.city || '-'}</span>
                                </>
                              ) : (
                                <span className={styles.muted}>-</span>
                              )}
                            </td>
                            <td>
                              {proxyStats ? (
                                <div className={styles.rateWrap}>
                                  <div className={styles.rateBar}>
                                    <span className={styles.rateFill} style={{ width: `${successRate}%` }} />
                                  </div>
                                  <span className={styles.rateText}>{successRate}%</span>
                                </div>
                              ) : (
                                <span className={styles.muted}>-</span>
                              )}
                            </td>
                            <td className={styles.actionsCol}>
                              <div className={styles.rowActions}>
                                <button
                                  type="button"
                                  onClick={() => handleToggleProxy(proxy.id, proxy.enabled)}
                                  className={styles.iconButton}
                                  title={proxy.enabled ? 'Tắt' : 'Bật'}
                                >
                                  <RotateCcw size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleTestProxy(proxy.id)}
                                  disabled={isTesting}
                                  className={styles.iconButton}
                                  title="Test proxy"
                                >
                                  <TestTube size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveProxy(proxy.id)}
                                  className={`${styles.iconButton} ${styles.iconDanger}`}
                                  title="Xóa"
                                >
                                  <Trash2 size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleProxyDetail(proxy.id)}
                                  className={styles.detailToggle}
                                >
                                  {isExpanded ? 'Thu gọn' : 'Chi tiết'}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className={styles.proxyDetailRow}>
                              <td colSpan={6}>
                                <div className={styles.proxyDetailGrid}>
                                  <div>
                                    <div className={styles.detailLabel}>Platform</div>
                                    <div className={styles.detailValue}>{proxy.platform || '-'}</div>
                                  </div>
                                  <div>
                                    <div className={styles.detailLabel}>Credentials</div>
                                    <div className={styles.detailValue}>
                                      {proxy.username ? `${proxy.username}:***` : 'Không có'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className={styles.detailLabel}>Thành công</div>
                                    <div className={styles.detailValue}>{proxyStats?.successCount ?? 0}</div>
                                  </div>
                                  <div>
                                    <div className={styles.detailLabel}>Thất bại</div>
                                    <div className={styles.detailValue}>{proxyStats?.failedCount ?? 0}</div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'scopes' && (
          <div className={styles.tabSection}>
            <div className={styles.scopeGrid}>
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
                  <div key={scope.key} className={styles.scopeCard}>
                    <div className={styles.scopeHeader}>
                      <div className={styles.scopeInfo}>
                        <div className={styles.scopeTitle}>{scope.label}</div>
                        <div className={styles.scopeDesc}>{scope.desc}</div>
                      </div>
                      <div className={styles.scopeControls}>
                        <Select
                          value={scopeMode}
                          onChange={(e) => handleScopeChange(scope.key, { mode: e.target.value as 'off' | 'direct-list' | 'rotating-endpoint' })}
                          options={[
                            { value: 'off', label: 'Off' },
                            { value: 'direct-list', label: 'Direct List' },
                            { value: 'rotating-endpoint', label: 'Rotating Endpoint' },
                          ]}
                          variant="small"
                        />
                        <Select
                          value={displayType}
                          onChange={(e) => handleScopeTypeChange(scope.key, e.target.value as 'any' | 'http' | 'https' | 'socks5')}
                          disabled={isOff}
                          options={typeOptions}
                          variant="small"
                        />
                      </div>
                    </div>
                    <div className={styles.scopeMeta}>
                      <span className={styles.scopeChip}>Mode: {scopeMode}</span>
                      <span className={styles.scopeChip}>Type: {displayType}</span>
                    </div>
                    {scopeMode === 'rotating-endpoint' && (
                      <div className={styles.scopeInline}>
                        <div className={styles.scopeInlineGrid}>
                          <Input
                            label="Domain"
                            placeholder="p.webshare.io"
                            value={rotatingForms[scope.key].host}
                            onChange={(e) => updateRotatingForm(scope.key, { host: e.target.value })}
                          />
                          <Input
                            label="Port"
                            type="number"
                            placeholder="80"
                            value={rotatingForms[scope.key].port}
                            onChange={(e) => updateRotatingForm(scope.key, { port: e.target.value })}
                          />
                          <Input
                            label="Username"
                            placeholder="qhnwfwys-rotate"
                            value={rotatingForms[scope.key].username}
                            onChange={(e) => updateRotatingForm(scope.key, { username: e.target.value })}
                          />
                          <Input
                            label="Password"
                            type="password"
                            placeholder="••••••"
                            value={rotatingForms[scope.key].password}
                            onChange={(e) => updateRotatingForm(scope.key, { password: e.target.value })}
                          />
                        </div>
                        <div className={styles.scopeInlineActions}>
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
            </div>
            <div className={styles.scopeHint}>
              Rotating endpoint được cấu hình theo từng scope (không còn đồng bộ toàn cục).
            </div>
          </div>
        )}

        {activeTab === 'sources' && (
          <div className={styles.tabSection}>
            <div className={styles.accordion}>
              <div className={styles.accordionItem}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion('webshare')}
                >
                  <span>Webshare Sync</span>
                  <span className={styles.accordionHint}>Đồng bộ danh sách proxy mới</span>
                </button>
                {openAccordion === 'webshare' && (
                  <div className={styles.accordionBody}>
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
                    <div className={styles.accordionActions}>
                      <Button onClick={handleSaveWebshareKey} variant="secondary" disabled={savingWebshareKey}>
                        {savingWebshareKey ? 'Đang lưu...' : 'Lưu API Key'}
                      </Button>
                      <Button onClick={handleSyncWebshare} variant="primary" disabled={syncingWebshare}>
                        {syncingWebshare ? 'Đang cập nhật...' : 'Cập nhật Webshare'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.accordionItem}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion('add')}
                >
                  <span>Thêm Proxy</span>
                  <span className={styles.accordionHint}>Nhập thủ công một proxy</span>
                </button>
                {openAccordion === 'add' && (
                  <div className={styles.accordionBody}>
                    <div className={styles.formGrid}>
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
                    <div className={styles.formRow}>
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
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={formData.enabled}
                          onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                        />
                        <span>Kích hoạt ngay</span>
                      </label>
                    </div>
                    <div className={styles.accordionActions}>
                      <Button onClick={handleAddProxy} variant="primary">
                        <Plus size={16} />
                        Thêm
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.accordionItem}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion('bulk')}
                >
                  <span>Bulk Import Webshare</span>
                  <span className={styles.accordionHint}>Dán danh sách proxy hàng loạt</span>
                </button>
                {openAccordion === 'bulk' && (
                  <div className={styles.accordionBody}>
                    <p className={styles.helpText}>
                      Paste danh sách proxy (mỗi dòng: ip,port,username,password,country,city).
                      Hỗ trợ prefix: socks5:ip:port:user:pass hoặc socks5://user:pass@ip:port.
                    </p>
                    <Select
                      label="Loại proxy mặc định"
                      value={bulkImportType}
                      onChange={(e) => setBulkImportType(e.target.value as 'http' | 'socks5')}
                      options={[
                        { value: 'socks5', label: 'SOCKS5 (Webshare Proxy)' },
                        { value: 'http', label: 'HTTP (Webshare Proxy)' },
                      ]}
                    />
                    <textarea
                      className={styles.bulkTextarea}
                      placeholder={`socks5:142.111.48.253:7030:qfdakzos:7fvhf24fe3ud
23.95.150.145,6114,qfdakzos,7fvhf24fe3ud,US,Buffalo`}
                      value={bulkImportText}
                      onChange={(e) => setBulkImportText(e.target.value)}
                    />
                    <div className={styles.accordionActions}>
                      <Button onClick={handleQuickAddWebshare} variant="secondary">
                        ⚡ Quick Add 10 Free Proxies
                      </Button>
                      <Button onClick={handleBulkImport} variant="primary">
                        <Upload size={16} />
                        Import ({bulkImportText.trim().split('\n').filter(l => l.trim()).length} proxies)
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.noteBox}>
              <h4>ℹ️ Lưu ý</h4>
              <ul>
                <li>Proxy được rotation tự động theo round‑robin khi gọi API</li>
                <li>Proxy bị tắt tự động sau 2 lỗi liên tiếp</li>
                <li>Nếu không còn proxy khả dụng, yêu cầu sẽ dừng lại</li>
                <li>Khuyến nghị sử dụng proxy trả phí để đảm bảo ổn định</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
