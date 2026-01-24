/**
 * ApiKeysSettings - Quan ly API Keys
 */

import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Save, RotateCcw, Upload, Download, RefreshCw } from 'lucide-react';
import { Button } from '../common/Button';
import styles from './Settings.module.css';
import { EmbeddedAccount } from '@shared/types/gemini';

interface ApiKeysSettingsProps {
  onBack: () => void;
}

export function ApiKeysSettings({ onBack }: ApiKeysSettingsProps) {
  const [apiAccounts, setApiAccounts] = useState<EmbeddedAccount[]>([]);
  const [keysLocation, setKeysLocation] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Load API keys info
  const loadApiKeysInfo = useCallback(async () => {
    try {
      setLoading(true);
      const accountsRes = await window.electronAPI.gemini.getAllKeysWithStatus();
      if (accountsRes.success && accountsRes.data) {
        setApiAccounts(accountsRes.data);
      }
      
      const locRes = await window.electronAPI.gemini.getKeysLocation();
      if (locRes.success && locRes.data) {
        setKeysLocation(locRes.data);
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
        alert(`Import thành công ${res.data?.count} keys!`);
        loadApiKeysInfo();
      } else {
        alert(`Lỗi import: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi doc file:', err);
      alert('Không thể đọc file JSON');
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
        a.download = 'gemini_keys_export.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert(`Lỗi export: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi export JSON:', err);
      alert('Không thể export file JSON');
    }
  };

  // Reset all key status
  const handleResetAllKeyStatus = async () => {
    if (!confirm('Bạn có chắc muốn reset trạng thái tất cả API keys không?')) {
      return;
    }
    try {
      const res = await window.electronAPI.gemini.resetAllStatus();
      if (res.success) {
        alert('Đã reset trạng thái tất cả keys thành công!');
        loadApiKeysInfo();
      } else {
        alert(`Lỗi: ${res.error}`);
      }
    } catch (err) {
      console.error('[ApiKeysSettings] Loi reset status:', err);
      alert('Không thể reset trạng thái keys');
    }
  };

  return (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button variant="secondary" iconOnly onClick={onBack} title="Quay lại">
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>API Keys</div>
      </div>
      
      <div className={styles.detailContent}>
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Quản lý Keys</span>
              <span className={styles.labelDesc}>
                File lưu trữ: {keysLocation || 'Chưa xác định'}
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
                <Upload size={16} /> Import JSON
              </Button>
              <Button onClick={handleExportJson} variant="secondary">
                <Download size={16} /> Export JSON
              </Button>
              <Button onClick={handleResetAllKeyStatus} variant="danger">
                <RefreshCw size={16} /> Reset Status
              </Button>
            </div>
          </div>

          <div className={styles.divider} style={{ margin: '20px 0', borderTop: '1px solid var(--border-color)' }} />

          <div className={styles.row} style={{ display: 'block' }}>
            <div className={styles.label} style={{ marginBottom: 12 }}>
              <span className={styles.labelText}>Danh sách tài khoản ({apiAccounts.length})</span>
            </div>
            
            <div className={styles.accountList} style={{ 
              background: 'var(--bg-secondary)', 
              borderRadius: 8, 
              padding: 12,
              maxHeight: 400,
              overflowY: 'auto'
            }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>Đang tải...</div>
              ) : apiAccounts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
                  Chưa có API key nào. Hãy import file JSON.
                </div>
              ) : (
                apiAccounts.map((acc, index) => (
                  <div key={index} style={{ 
                    marginBottom: 12, 
                    padding: 10, 
                    background: 'var(--bg-primary)', 
                    borderRadius: 6,
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{acc.email}</div>
                    <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                      {acc.projects.length} Projects:
                    </div>
                    <div style={{ paddingLeft: 12, marginTop: 4 }}>
                      {acc.projects.map((p: any, pIndex: number) => {
                        const statusColors: Record<string, { bg: string; text: string; label: string }> = {
                          'available': { bg: '#10b98120', text: '#10b981', label: 'OK' },
                          'rate_limited': { bg: '#f59e0b20', text: '#f59e0b', label: 'Rate Limited' },
                          'exhausted': { bg: '#6366f120', text: '#6366f1', label: 'Exhausted' },
                          'error': { bg: '#ef444420', text: '#ef4444', label: 'Lỗi' },
                        };
                        const statusStyle = statusColors[p.status] || statusColors['available'];
                        
                        return (
                          <div key={pIndex} style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: '0.85em', 
                            fontFamily: 'monospace',
                            marginBottom: 4,
                            padding: '4px 8px',
                            borderRadius: 4,
                            background: 'var(--bg-secondary)',
                          }}>
                            <span style={{
                              fontSize: '0.75em',
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: statusStyle.bg,
                              color: statusStyle.text,
                              fontWeight: 600,
                              minWidth: 70,
                              textAlign: 'center',
                            }}>
                              {statusStyle.label}
                            </span>
                            <span style={{ color: 'var(--text-primary)', flex: 1 }}>
                              {p.projectName}
                            </span>
                            {p.totalRequestsToday > 0 && (
                              <span style={{ 
                                fontSize: '0.75em',
                                color: 'var(--text-tertiary)',
                              }}>
                                {p.totalRequestsToday} reqs
                              </span>
                            )}
                            <span style={{ color: 'var(--text-tertiary)' }}>
                              {p.apiKey}
                            </span>
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

        <div className={styles.saveBar}>
          <Button onClick={() => loadApiKeysInfo()} variant="secondary">
            <RotateCcw size={16} />
            Làm mới
          </Button>
          <Button onClick={() => alert('API Keys được quản lý qua Import/Export')} variant="primary">
            <Save size={16} />
            Lưu cài đặt
          </Button>
        </div>
      </div>
    </div>
  );
}
