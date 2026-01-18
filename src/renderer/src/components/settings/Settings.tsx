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
  ChevronRight
} from 'lucide-react';
import styles from './Settings.module.css';

type SettingsTab = 'overview' | 'output' | 'translation' | 'tts' | 'app';

// ============================================
// COMPONENT
// ============================================
export function Settings() {
  // UI State
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview');

  // State - Output Settings
  const [outputDir, setOutputDir] = useState('');
  const [autoOpenOutput, setAutoOpenOutput] = useState(true);
  
  // State - Translation Settings
  const [defaultModel, setDefaultModel] = useState('gemini-2.5-flash');
  const [batchSize, setBatchSize] = useState(50);
  const [retryCount, setRetryCount] = useState(3);
  
  // State - TTS Settings
  const [defaultVoice, setDefaultVoice] = useState('vi-VN-HoaiMyNeural');
  const [defaultRate, setDefaultRate] = useState('+30%');
  const [defaultVolume, setDefaultVolume] = useState('+30%');
  
  // State - App Settings
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('dark');
  const [language, setLanguage] = useState('vi');

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

  // Reset settings
  const handleReset = useCallback(() => {
    setOutputDir('');
    setAutoOpenOutput(true);
    setDefaultModel('gemini-2.5-flash');
    setBatchSize(50);
    setRetryCount(3);
    setDefaultVoice('vi-VN-HoaiMyNeural');
    setDefaultRate('+30%');
    setDefaultVolume('+30%');
    setTheme('dark');
    setLanguage('vi');
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
  ];

  // Helper to render Detail Wrapper
  const renderDetail = (title: string, content: React.ReactNode) => (
    <div className={styles.detailContainer}>
      <div className={styles.detailHeader}>
        <button 
          className={styles.backButton} 
          onClick={() => setActiveTab('overview')}
          title="Quay lại"
        >
          <ArrowLeft size={20} />
        </button>
        <div className={styles.detailTitle}>{title}</div>
      </div>
      <div className={styles.detailContent}>
        {content}
        
        <div className={styles.saveBar}>
          <button onClick={handleReset} className={styles.buttonSecondary}>
            <RotateCcw size={16} />
            Đặt lại mặc định
          </button>
          <button onClick={handleSave} className={styles.button}>
            <Save size={16} />
            Lưu cài đặt
          </button>
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
                  onClick={() => setActiveTab(item.id as SettingsTab)}
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
              <input
                type="text"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="Mặc định (Source folder)"
                className={styles.input}
              />
              <button onClick={handleBrowseOutput} className={styles.buttonSecondary}>
                Chọn
              </button>
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
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Batch Size</span>
              <span className={styles.labelDesc}>Số dòng caption xử lý trong một lần gọi API</span>
            </div>
            <input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              min={10}
              max={200}
              className={styles.inputSmall}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Retry Count</span>
              <span className={styles.labelDesc}>Số lần thử lại khi gặp lỗi API</span>
            </div>
            <input
              type="number"
              value={retryCount}
              onChange={(e) => setRetryCount(Number(e.target.value))}
              min={0}
              max={10}
              className={styles.inputSmall}
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
              <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ)</option>
              <option value="vi-VN-NamMinhNeural">Nam Minh (Nam)</option>
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
              {['+0%', '+10%', '+20%', '+30%', '+40%', '+50%'].map(r => (
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
              {['+0%', '+10%', '+20%', '+30%'].map(v => (
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
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
              className={styles.select}
            >
              <option value="light">Sáng</option>
              <option value="dark">Tối</option>
              <option value="system">Theo hệ thống</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.label}>
              <span className={styles.labelText}>Ngôn ngữ hiển thị</span>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={styles.select}
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
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
