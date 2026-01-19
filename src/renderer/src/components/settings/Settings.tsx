/**
 * Settings - Giao diện cài đặt ứng dụng
 */

import { useState, useCallback } from 'react';
import { 
  FolderOpen, 
  Languages, 
  Volume2, 
  Palette, 
  Save, 
  RotateCcw,
  ArrowLeft,
  ChevronRight,
  Key,
  Upload,
  Download,
  RefreshCw
} from 'lucide-react';
import { EmbeddedAccount } from '@shared/types/gemini';
import styles from './Settings.module.css';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import {
  GEMINI_MODELS,
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETRY_COUNT,
} from '../../config/captionConfig';

// ============================================
// APP CONFIG (Theme & Language - không liên quan caption)
// ============================================

type ThemeMode = 'light' | 'dark' | 'system';
type AppLanguage = 'vi' | 'en';

const THEME_OPTIONS = [
  { value: 'light' as ThemeMode, label: 'Sáng' },
  { value: 'dark' as ThemeMode, label: 'Tối' },
  { value: 'system' as ThemeMode, label: 'Theo hệ thống' },
];

const LANGUAGE_OPTIONS = [
  { value: 'vi' as AppLanguage, label: 'Tiếng Việt' },
  { value: 'en' as AppLanguage, label: 'English' },
];

const DEFAULT_THEME: ThemeMode = 'dark';
const DEFAULT_APP_LANGUAGE: AppLanguage = 'vi';
const DEFAULT_AUTO_OPEN_OUTPUT = true;

type SettingsTab = 'overview' | 'output' | 'translation' | 'tts' | 'app' | 'apikeys';

// ============================================
// COMPONENT
// ============================================
export function Settings() {
  // UI State
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview');

  // State - Output Settings
  const [outputDir, setOutputDir] = useState('');
  const [autoOpenOutput, setAutoOpenOutput] = useState(DEFAULT_AUTO_OPEN_OUTPUT);
  
  // State - Translation Settings
  const [defaultModel, setDefaultModel] = useState(DEFAULT_GEMINI_MODEL);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [retryCount, setRetryCount] = useState(DEFAULT_RETRY_COUNT);
  
  // State - TTS Settings
  const [defaultVoice, setDefaultVoice] = useState(DEFAULT_VOICE);
  const [defaultRate, setDefaultRate] = useState(DEFAULT_RATE);
  const [defaultVolume, setDefaultVolume] = useState(DEFAULT_VOLUME);
  
  // State - App Settings
  const [theme, setTheme] = useState<ThemeMode>(DEFAULT_THEME);
  const [language, setLanguage] = useState<AppLanguage>(DEFAULT_APP_LANGUAGE);

  // State - API Keys
  const [apiAccounts, setApiAccounts] = useState<EmbeddedAccount[]>([]);
  const [keysLocation, setKeysLocation] = useState<string>('');
  const [keysLoading, setKeysLoading] = useState(false);

  // Browse output directory
  const handleBrowseOutput = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('dialog:openDirectory', {}) as {
        canceled: boolean;
        filePaths: string[];
      };
      if (!result.canceled && result.filePaths.length > 0) {
        setOutputDir(result.filePaths[0]);
      }
    } catch (err) {
      console.error('Lỗi chọn thư mục:', err);
    }
  }, []);

  // Save settings
  const handleSave = useCallback(() => {
    console.log('Saving settings...', {
      outputDir,
      autoOpenOutput,
      defaultModel,
      batchSize,
      retryCount,
      defaultVoice,
      defaultRate,
      defaultVolume,
      theme,
      language,
    });
    alert('Đã lưu cài đặt!');
  }, [outputDir, autoOpenOutput, defaultModel, batchSize, retryCount, defaultVoice, defaultRate, defaultVolume, theme, language]);

  // Load API keys info
  const loadApiKeysInfo = useCallback(async () => {
    try {
      setKeysLoading(true);
      // Sử dụng API mới có trạng thái chi tiết
      const accountsRes = await window.electronAPI.gemini.getAllKeysWithStatus();
      if (accountsRes.success && accountsRes.data) {
        setApiAccounts(accountsRes.data);
      }
      
      const locRes = await window.electronAPI.gemini.getKeysLocation();
      if (locRes.success && locRes.data) {
        setKeysLocation(locRes.data);
      }
    } catch (err) {
      console.error('Lỗi load API keys:', err);
    } finally {
      setKeysLoading(false);
    }
  }, []);

  // Effect to load keys when tab changes to apikeys
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (tab === 'apikeys') {
      loadApiKeysInfo();
    }
  };

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
      console.error('Lỗi đọc file:', err);
      alert('Không thể đọc file JSON');
    }
    // Reset input
    e.target.value = '';
  };

  // Export JSON handler
  const handleExportJson = async () => {
    try {
      const res = await window.electronAPI.gemini.exportKeys();
      if (res.success && res.data) {
        // Create blob and download link
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
      console.error('Lỗi export JSON:', err);
      alert('Không thể export file JSON');
    }
  };

  // Reset all key status
  const handleResetAllKeyStatus = async () => {
    if (!confirm('Bạn có chắc muốn reset trạng thái tất cả API keys không? Các keys bị lỗi hoặc rate limit sẽ được khôi phục về trạng thái available.')) {
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
      console.error('[Settings] Lỗi reset status:', err);
      alert('Không thể reset trạng thái keys');
    }
  };

  // Reset settings
  const handleReset = useCallback(() => {
    setOutputDir('');
    setAutoOpenOutput(DEFAULT_AUTO_OPEN_OUTPUT);
    setDefaultModel(DEFAULT_GEMINI_MODEL);
    setBatchSize(DEFAULT_BATCH_SIZE);
    setRetryCount(DEFAULT_RETRY_COUNT);
    setDefaultVoice(DEFAULT_VOICE);
    setDefaultRate(DEFAULT_RATE);
    setDefaultVolume(DEFAULT_VOLUME);
    setTheme(DEFAULT_THEME);
    setLanguage(DEFAULT_APP_LANGUAGE);
  }, []);

  const menuItems = [
    { 
      id: 'output', 
      label: 'Output & File', 
      desc: 'Quản lý thư mục lưu trữ và file đầu ra của ứng dụng',
      icon: FolderOpen 
    },
    { 
      id: 'translation', 
      label: 'Dịch thuật', 
      desc: 'Cấu hình mô hình Gemini và các tham số dịch',
      icon: Languages 
    },
    { 
      id: 'tts', 
      label: 'Voice & TTS', 
      desc: 'Tùy chỉnh giọng đọc, tốc độ và âm lượng',
      icon: Volume2 
    },
    { 
      id: 'app', 
      label: 'Giao diện', 
      desc: 'Chỉnh theme sáng/tối và ngôn ngữ hiển thị',
      icon: Palette 
    },
    { 
      id: 'apikeys', 
      label: 'API Keys', 
      desc: 'Quản lý danh sách Gemini API Keys',
      icon: Key 
    },
  ];

  // Helper to render Detail Wrapper
  const renderDetail = (title: string, content: React.ReactNode) => (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <Button 
          variant="secondary"
          iconOnly
          onClick={() => setActiveTab('overview')}
          title="Quay lại"
        >
          <ArrowLeft size={20} />
        </Button>
        <div className={styles.detailTitle}>{title}</div>
      </div>
      <div className={styles.detailContent}>
        {content}
        
        <div className={styles.saveBar}>
          <Button onClick={handleReset} variant="secondary">
            <RotateCcw size={16} />
            Đặt lại mặc định
          </Button>
          <Button onClick={handleSave} variant="primary">
            <Save size={16} />
            Lưu cài đặt
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={styles.container}>
      {/* Overview Mode */}
      {activeTab === 'overview' && (
        <div className={styles.overviewContainer}>
          <div className={styles.pageHeader}>
            <div className={styles.pageTitle}>Cài đặt</div>
            <div className={styles.pageDesc}>Quản lý tất cả cấu hình của ứng dụng tại đây</div>
          </div>
          
          <div className={styles.grid}>
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <div 
                  key={item.id} 
                  className={styles.card}
                  onClick={() => handleTabChange(item.id as SettingsTab)}
                >
                  <div className={styles.cardIcon}>
                    <Icon size={24} />
                  </div>
                  <div>
                    <div className={styles.cardTitle}>{item.label}</div>
                    <div className={styles.cardDesc}>{item.desc}</div>
                  </div>
                  <div style={{ marginTop: 'auto', alignSelf: 'flex-end', color: 'var(--color-text-tertiary)' }}>
                    <ChevronRight size={16} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail Modes */}
      {activeTab === 'output' && renderDetail('Output & File', (
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Thư mục lưu trữ</span>
              <span className={styles.labelDesc}>Mặc định sẽ lưu cùng thư mục với file gốc nếu bỏ trống</span>
            </div>
            <div className={styles.flexRow}>
              <Input
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="Ví dụ: D:\Subtitles\Output"
              />
              <Button onClick={handleBrowseOutput}>
                Browse
              </Button>
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Tự động mở thư mục</span>
              <span className={styles.labelDesc}>Mở thư mục chứa file sau khi xử lý xong</span>
            </div>
            <Toggle value={autoOpenOutput} onChange={setAutoOpenOutput} />
          </div>
        </div>
      ))}

      {activeTab === 'translation' && renderDetail('Dịch thuật', (
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>AI Model</span>
              <span className={styles.labelDesc}>Model được sử dụng để dịch nội dung</span>
            </div>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className={styles.select}
            >
              {GEMINI_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Batch Size</span>
              <span className={styles.labelDesc}>Số dòng caption xử lý trong một lần gọi API</span>
            </div>
            <Input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              min={10}
              max={200}
              variant="small"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Retry Count</span>
              <span className={styles.labelDesc}>Số lần thử lại khi gặp lỗi API</span>
            </div>
            <Input
              type="number"
              value={retryCount}
              onChange={(e) => setRetryCount(Number(e.target.value))}
              min={0}
              max={10}
              variant="small"
            />
          </div>
        </div>
      ))}

      {activeTab === 'tts' && renderDetail('Voice & TTS', (
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Giọng đọc mặc định</span>
            </div>
            <select
              value={defaultVoice}
              onChange={(e) => setDefaultVoice(e.target.value)}
              className={styles.select}
            >
              {VOICES.map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Tốc độ đọc (Rate)</span>
            </div>
            <select
              value={defaultRate}
              onChange={(e) => setDefaultRate(e.target.value)}
              className={styles.select}
            >
              {RATE_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Âm lượng (Volume)</span>
            </div>
            <select
              value={defaultVolume}
              onChange={(e) => setDefaultVolume(e.target.value)}
              className={styles.select}
            >
              {VOLUME_OPTIONS.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      ))}

      {activeTab === 'app' && renderDetail('Giao diện', (
        <div className={styles.section}>
          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Chế độ màu</span>
            </div>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeMode)}
              className={styles.select}
            >
              {THEME_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Ngôn ngữ hiển thị</span>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as AppLanguage)}
              className={styles.select}
            >
              {LANGUAGE_OPTIONS.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>
      ))}

      {activeTab === 'apikeys' && renderDetail('API Keys', (
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
              {keysLoading ? (
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
                        // Màu sắc theo trạng thái
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
                            {/* Status badge */}
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
                            
                            {/* Project name */}
                            <span style={{ color: 'var(--text-primary)', flex: 1 }}>
                              {p.projectName}
                            </span>
                            
                            {/* Request count */}
                            {p.totalRequestsToday > 0 && (
                              <span style={{ 
                                fontSize: '0.75em',
                                color: 'var(--text-tertiary)',
                              }}>
                                {p.totalRequestsToday} reqs
                              </span>
                            )}
                            
                            {/* API Key (masked) */}
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
      ))}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className={`${styles.toggle} ${value ? styles.toggleActive : ''}`}
      onClick={() => onChange(!value)}
    >
      <div className={`${styles.toggleKnob} ${value ? styles.toggleKnobActive : ''}`} />
    </div>
  );
}
