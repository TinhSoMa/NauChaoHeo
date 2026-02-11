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
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [stats, setStats] = useState<ProxyStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
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
              <span className={styles.labelText}>Sử dụng Proxy</span>
              <span className={styles.labelDesc}>Bật/tắt sử dụng proxy toàn cục cho ứng dụng</span>
            </div>
            <button
              onClick={() => handleToggleUseProxy(!useProxy)}
              className={`${styles.toggle} ${useProxy ? styles.toggleActive : ''}`}
            >
              <div className={`${styles.toggleKnob} ${useProxy ? styles.toggleKnobActive : ''}`} />
            </button>
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
                Paste danh sách proxy từ Webshare (mỗi dòng: ip,port,username,password,country,city)
              </p>
              <textarea
                className={styles.select}
                style={{ width: '100%', height: '120px', resize: 'none', marginBottom: '12px' }}
                placeholder={`142.111.48.253,7030,qfdakzos,7fvhf24fe3ud,US,Los Angeles
23.95.150.145,6114,qfdakzos,7fvhf24fe3ud,US,Buffalo`}
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
              />
              <div className={styles.flexRow}>
                <Button onClick={handleBulkImport} variant="primary">
                  <Upload size={16} />
                  Import ({bulkImportText.trim().split('\n').filter(l => l.trim()).length} proxies)
                </Button>
                <Button onClick={() => { setShowBulkImport(false); setBulkImportText(''); }} variant="secondary">
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
