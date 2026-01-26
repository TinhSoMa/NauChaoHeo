import { useState, useEffect } from 'react';
import { ProxyConfig, ProxyStats } from '@shared/types/proxy';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Plus, Trash2, TestTube, Check, X, Download, Upload, RotateCcw, FileText } from 'lucide-react';

export function ProxySettings() {
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [stats, setStats] = useState<ProxyStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [useProxy, setUseProxy] = useState(true); // Global proxy toggle
  
  // Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
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

  const loadProxySetting = async () => {
    try {
      const result = await window.electronAPI.appSettings.getAll();
      if (result.success && result.data) {
        setUseProxy(result.data.useProxy);
      }
    } catch (error) {
      console.error('Lỗi load proxy setting:', error);
    }
  };

  const handleToggleUseProxy = async (enabled: boolean) => {
    try {
      const result = await window.electronAPI.appSettings.update({ useProxy: enabled });
      if (result.success) {
        setUseProxy(enabled);
        console.log(`[ProxySettings] Proxy ${enabled ? 'enabled' : 'disabled'} globally`);
      }
    } catch (error) {
      console.error('Lỗi toggle proxy:', error);
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
      const result = await window.electronAPI.invoke('proxy:bulkImportWebshare', bulkImportText) as { success: boolean; added?: number; skipped?: number; error?: string };
      
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

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-text-primary">Quản lý Proxy</h2>
          <p className="text-sm text-text-secondary mt-1">
            Cấu hình proxy rotation để tránh rate limit khi gọi API
          </p>
        </div>
        
        {/* Global Proxy Toggle */}
        <div className="flex items-center gap-4 bg-surface border border-border rounded-xl px-4 py-3 mr-4">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text-primary">Sử dụng Proxy</span>
            <span className="text-xs text-text-tertiary">
              {useProxy ? 'Đang bật' : 'Đang tắt'}
            </span>
          </div>
          <button
            onClick={() => handleToggleUseProxy(!useProxy)}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              useProxy ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <div
              className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                useProxy ? 'translate-x-7' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        
        <div className="flex gap-2">
          <Button onClick={() => setShowBulkImport(true)} variant="secondary" className="h-9 px-4">
            <FileText size={16} />
            Bulk Import (Webshare)
          </Button>
          <Button onClick={handleImport} variant="secondary" className="h-9 px-4">
            <Upload size={16} />
            Import JSON
          </Button>
          <Button onClick={handleResetAll} variant="secondary" className="h-9 px-4" disabled={proxies.length === 0}>
            <RotateCcw size={16} />
            Reset All
          </Button>
          <Button onClick={handleExport} variant="secondary" className="h-9 px-4" disabled={proxies.length === 0}>
            <Download size={16} />
            Export
          </Button>
          <Button onClick={() => setShowAddForm(true)} variant="primary" className="h-9 px-4">
            <Plus size={16} />
            Thêm Proxy
          </Button>
        </div>
      </div>

      {/* Add Proxy Form */}
      {showAddForm && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Thêm Proxy Mới</h3>
          <div className="grid grid-cols-2 gap-4">
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
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 h-10 px-3 bg-surface rounded border border-border cursor-pointer hover:bg-surface/80 transition-colors">
                <input
                  type="checkbox"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm text-text-primary">Kích hoạt ngay</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleAddProxy} variant="primary">
              <Plus size={16} />
              Thêm
            </Button>
            <Button onClick={() => setShowAddForm(false)} variant="secondary">
              Hủy
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Import Form (Webshare) */}
      {showBulkImport && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-text-primary">Bulk Import Webshare Proxies</h3>
            <Button onClick={handleQuickAddWebshare} variant="secondary" className="text-xs h-8 px-3">
              ⚡ Quick Add 10 Free Proxies
            </Button>
          </div>
          
          <p className="text-sm text-text-secondary mb-3">
            Paste danh sách proxy từ Webshare (mỗi dòng: <code className="text-xs bg-surface px-1 py-0.5 rounded">ip,port,username,password,country,city</code>)
          </p>
          
          <textarea
            className="w-full h-40 p-3 bg-surface border border-border rounded text-sm font-mono text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder={`142.111.48.253,7030,qfdakzos,7fvhf24fe3ud,US,Los Angeles
23.95.150.145,6114,qfdakzos,7fvhf24fe3ud,US,Buffalo
198.23.239.134,6540,qfdakzos,7fvhf24fe3ud,US,Buffalo
...`}
            value={bulkImportText}
            onChange={(e) => setBulkImportText(e.target.value)}
          />
          
          <div className="flex gap-2 mt-4">
            <Button onClick={handleBulkImport} variant="primary">
              <Upload size={16} />
              Import ({bulkImportText.trim().split('\n').filter(l => l.trim()).length} proxies)
            </Button>
            <Button onClick={() => { setShowBulkImport(false); setBulkImportText(''); }} variant="secondary">
              Hủy
            </Button>
          </div>
        </div>
      )}

      {/* Proxy List */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border bg-surface/50">
          <h3 className="font-semibold text-text-primary">
            Danh sách Proxy ({proxies.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-8 text-center text-text-secondary">
            Đang tải...
          </div>
        ) : proxies.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">
            <p>Chưa có proxy nào.</p>
            <p className="text-sm mt-2">Nhấn "Thêm Proxy" để bắt đầu.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface/30 text-xs text-text-secondary uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Trạng thái</th>
                  <th className="px-4 py-3 text-left">Host:Port</th>
                  <th className="px-4 py-3 text-left">Platform</th>
                  <th className="px-4 py-3 text-left">Location</th>
                  <th className="px-4 py-3 text-left">Loại</th>
                  <th className="px-4 py-3 text-left">Credentials</th>
                  <th className="px-4 py-3 text-center">Success Rate</th>
                  <th className="px-4 py-3 text-center">Thành công</th>
                  <th className="px-4 py-3 text-center">Thất bại</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proxies.map((proxy) => {
                  const proxyStats = getProxyStats(proxy.id);
                  const isTesting = testingIds.has(proxy.id);

                  return (
                    <tr key={proxy.id} className="hover:bg-surface/20 transition-colors">
                      {/* Status */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {proxy.enabled ? (
                            proxyStats?.isHealthy ? (
                              <Check size={16} className="text-green-500" />
                            ) : (
                              <X size={16} className="text-yellow-500" />
                            )
                          ) : (
                            <X size={16} className="text-gray-500" />
                          )}
                          <span className={`text-xs ${proxy.enabled ? (proxyStats?.isHealthy ? 'text-green-500' : 'text-yellow-500') : 'text-gray-500'}`}>
                            {proxy.enabled ? (proxyStats?.isHealthy ? 'Sẵn sàng' : 'Lỗi') : 'Tắt'}
                          </span>
                        </div>
                      </td>

                      {/* Host:Port */}
                      <td className="px-4 py-3">
                        <code className="text-sm text-text-primary font-mono">
                          {proxy.host}:{proxy.port}
                        </code>
                      </td>

                      {/* Platform */}
                      <td className="px-4 py-3">
                        {proxy.platform ? (
                          <span className="text-xs px-2 py-1 bg-blue-500/10 border border-blue-500/30 rounded text-blue-500">
                            {proxy.platform}
                          </span>
                        ) : (
                          <span className="text-xs text-text-tertiary italic">-</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="px-4 py-3 text-xs text-text-secondary">
                        {proxy.country || proxy.city ? (
                          <div className="flex flex-col gap-0.5">
                            {proxy.country && <span className="font-semibold">{proxy.country}</span>}
                            {proxy.city && <span className="text-text-tertiary">{proxy.city}</span>}
                          </div>
                        ) : (
                          <span className="text-text-tertiary italic">-</span>
                        )}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 bg-surface rounded text-text-secondary uppercase">
                          {proxy.type}
                        </span>
                      </td>

                      {/* Credentials */}
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {proxy.username ? (
                          <span className="font-mono text-xs">
                            {proxy.username}:***
                          </span>
                        ) : (
                          <span className="text-text-tertiary italic">Không có</span>
                        )}
                      </td>

                      {/* Success Rate */}
                      <td className="px-4 py-3 text-center">
                        {proxyStats ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-20 h-2 bg-surface rounded-full overflow-hidden">
                              <div
                                className={`h-full ${proxyStats.successRate >= 80 ? 'bg-green-500' : proxyStats.successRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                style={{ width: `${proxyStats.successRate}%` }}
                              />
                            </div>
                            <span className="text-xs text-text-secondary w-10 text-right">
                              {proxyStats.successRate}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary">-</span>
                        )}
                      </td>

                      {/* Success Count */}
                      <td className="px-4 py-3 text-center text-sm text-green-600 font-mono">
                        {proxyStats?.successCount || 0}
                      </td>

                      {/* Failed Count */}
                      <td className="px-4 py-3 text-center text-sm text-red-600 font-mono">
                        {proxyStats?.failedCount || 0}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggleProxy(proxy.id, proxy.enabled)}
                            className={`p-2 rounded hover:bg-surface transition-colors ${proxy.enabled ? 'text-green-500' : 'text-gray-500'}`}
                            title={proxy.enabled ? 'Tắt' : 'Bật'}
                          >
                            <RotateCcw size={16} />
                          </button>
                          <button
                            onClick={() => handleTestProxy(proxy.id)}
                            disabled={isTesting}
                            className="p-2 rounded hover:bg-surface transition-colors text-blue-500 disabled:opacity-50"
                            title="Test proxy"
                          >
                            <TestTube size={16} className={isTesting ? 'animate-pulse' : ''} />
                          </button>
                          <button
                            onClick={() => handleRemoveProxy(proxy.id)}
                            className="p-2 rounded hover:bg-surface transition-colors text-red-500"
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
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <h4 className="font-semibold text-blue-500 mb-2">ℹ️ Lưu ý</h4>
        <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
          <li>Proxy được rotation tự động theo round-robin khi gọi API</li>
          <li>Proxy bị tắt tự động sau 5 lỗi liên tiếp</li>
          <li>Nếu tất cả proxy đều thất bại, hệ thống sẽ fallback về direct connection</li>
          <li>Khuyến nghị sử dụng proxy trả phí để đảm bảo ổn định</li>
        </ul>
      </div>
    </div>
  );
}
