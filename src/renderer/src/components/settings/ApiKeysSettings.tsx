/**
 * ApiKeysSettings - Quản lý API Keys
 */

import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, RotateCcw, Upload, Download, RefreshCw, AlertCircle, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight } from 'lucide-react';
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
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

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
    };
    return configs[status] || configs['available'];
  };

  // Calculate stats
  const totalProjects = apiAccounts.reduce((sum, acc) => sum + acc.projects.length, 0);
  const availableProjects = apiAccounts.reduce((sum, acc) => 
    sum + acc.projects.filter((p: any) => p.status === 'available').length, 0
  );
  const totalSuccess = apiAccounts.reduce((sum, acc) => 
    sum + acc.projects.reduce((s: number, p: any) => s + (p.successCount || 0), 0), 0
  );
  const totalErrors = apiAccounts.reduce((sum, acc) => 
    sum + acc.projects.reduce((s: number, p: any) => s + (p.errorCount || 0), 0), 0
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

          {/* Stats Summary */}
          {!loading && apiAccounts.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
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
                  Keys sẵn sàng
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
              ) : apiAccounts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                  <AlertCircle size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                  <div style={{ marginBottom: 4 }}>Chưa có API key nào</div>
                  <div style={{ fontSize: '0.85em' }}>Nhấn "Import" để thêm keys từ file JSON</div>
                </div>
              ) : (
                apiAccounts.map((acc, index) => (
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
                    }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9em' }}>{acc.email}</div>
                      <div style={{ 
                        fontSize: '0.75em',
                        color: 'var(--text-secondary)',
                        background: 'var(--bg-secondary)',
                        padding: '2px 8px',
                        borderRadius: 4,
                      }}>
                        {acc.projects.length} projects
                      </div>
                    </div>
                    
                    {/* Projects List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {acc.projects.map((p: any, pIndex: number) => {
                        const statusConfig = getStatusConfig(p.status);
                        const StatusIcon = statusConfig.icon;
                        const projectKey = `${acc.email}-${pIndex}`;
                        const isErrorExpanded = expandedErrors.has(projectKey);
                        const hasError = p.lastErrorMessage && p.errorCount > 0;
                        
                        return (
                          <div key={pIndex} style={{ 
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
                              
                              {/* Stats Badges */}
                              <div style={{ display: 'flex', gap: 4, fontSize: '0.85em' }}>
                                <span style={{ 
                                  background: p.successCount > 0 ? '#10b98110' : 'var(--bg-primary)',
                                  color: p.successCount > 0 ? '#10b981' : 'var(--text-tertiary)',
                                  padding: '2px 5px',
                                  borderRadius: 3,
                                  fontFamily: 'monospace',
                                  fontWeight: 600,
                                  minWidth: 28,
                                  textAlign: 'center',
                                }}>
                                  ✓{p.successCount || 0}
                                </span>
                                <span style={{ 
                                  background: p.errorCount > 0 ? '#ef444410' : 'var(--bg-primary)',
                                  color: p.errorCount > 0 ? '#ef4444' : 'var(--text-tertiary)',
                                  padding: '2px 5px',
                                  borderRadius: 3,
                                  fontFamily: 'monospace',
                                  fontWeight: 600,
                                  minWidth: 28,
                                  textAlign: 'center',
                                }}>
                                  ✗{p.errorCount || 0}
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
                                  {p.totalRequestsToday}
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
