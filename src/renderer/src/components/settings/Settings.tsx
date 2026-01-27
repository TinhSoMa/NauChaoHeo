/**
 * Settings - Giao dien cai dat ung dung
 * Refactored to use sub-components
 */

import { useState, useCallback } from 'react';
import { 
  FolderOpen, 
  Languages, 
  Volume2, 
  Palette, 
  Key,
  MessageCircle,
  Network
} from 'lucide-react';
import styles from './Settings.module.css';
import { SettingsTab, SettingsMenuItem } from './types';

// Sub-components
import { SettingsOverview } from './SettingsOverview';
import { OutputSettings } from './OutputSettings';
import { TranslationSettings } from './TranslationSettings';
import { TtsSettings } from './TtsSettings';
import { AppSettings } from './AppSettings';
import { ApiKeysSettings } from './ApiKeysSettings';
import { GeminiChatSettings } from './GeminiChatSettings';
import { ProxySettings } from './ProxySettings';

// Menu items configuration
const menuItems: SettingsMenuItem[] = [
  { 
    id: 'output', 
    label: 'Thư mục Projects', 
    desc: 'Cấu hình thư mục lưu trữ tất cả dự án',
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
  { 
    id: 'geminichat', 
    label: 'Gemini Chat (Web)', 
    desc: 'Cấu hình kết nối Gemini qua giao diện web',
    icon: MessageCircle 
  },
  { 
    id: 'proxy', 
    label: 'Proxy Rotation', 
    desc: 'Quản lý proxy rotation để tránh rate limit',
    icon: Network 
  },
];

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview');

  const handleTabChange = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
  }, []);

  const handleBack = useCallback(() => {
    setActiveTab('overview');
  }, []);

  return (
    <div className={styles.container}>
      {/* Overview Mode - Grid menu */}
      {activeTab === 'overview' && (
        <SettingsOverview 
          menuItems={menuItems} 
          onTabChange={handleTabChange} 
        />
      )}

      {/* Detail Modes - Each tab has its own component */}
      {activeTab === 'output' && <OutputSettings onBack={handleBack} />}
      {activeTab === 'translation' && <TranslationSettings onBack={handleBack} />}
      {activeTab === 'tts' && <TtsSettings onBack={handleBack} />}
      {activeTab === 'app' && <AppSettings onBack={handleBack} />}
      {activeTab === 'apikeys' && <ApiKeysSettings onBack={handleBack} />}
      {activeTab === 'geminichat' && <GeminiChatSettings onBack={handleBack} />}
      {activeTab === 'proxy' && <ProxySettings onBack={handleBack} />}
    </div>
  );
}
