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
  Network,
  FileText,
  ListOrdered,
  Terminal,
  Bot,
  Power,
  Globe,
  Cpu
} from 'lucide-react';
import styles from './Settings.module.css';
import { SettingsTab, SettingsMenuItem } from './types';

// Sub-components
import { SettingsOverview } from './SettingsOverview';
import { OutputSettings } from './OutputSettings';
import { TranslationSettings } from './TranslationSettings';
import { TtsSettings } from './TtsSettings';
import { AppSettings } from './AppSettings';
import { ApiKeysManager } from './ApiKeysManager';
import { GeminiChatSettings } from './GeminiChatSettings';
import { GrokUiSettings } from './GrokUiSettings';
import { ProxySettings } from './ProxySettings';
import { PromptSettings } from './PromptSettings.tsx';
import { QueueMonitorSettings } from './QueueMonitorSettings';
import { DebugLogsSettings } from './DebugLogsSettings';
import { AutoShutdownSettings } from './AutoShutdownSettings';
import { OpenRouterDetail } from './OpenRouterDetail';
import { CliAgentScanPanel } from './CliAgentScanPanel';
import { BackButton } from './BackButton';

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
    id: 'prompts', 
    label: 'Prompt Templates', 
    desc: 'Quản lý theo language, group, family và version',
    icon: FileText 
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
    id: 'grokUi', 
    label: 'Grok UI', 
    desc: 'Cấu hình Grok3API (UI mode) và profile trình duyệt',
    icon: Bot 
  },
  { 
    id: 'proxy', 
    label: 'Proxy Rotation', 
    desc: 'Quản lý proxy rotation để tránh rate limit',
    icon: Network 
  },
  {
    id: 'queueMonitor',
    label: 'Queue Monitor',
    desc: 'Quan sát hàng đợi, tài nguyên và luồng xử lý realtime',
    icon: ListOrdered
  },
  {
    id: 'debugLogs',
    label: 'Debug Logs',
    desc: 'Theo dõi log runtime (main + renderer) theo thời gian thực',
    icon: Terminal
  },
  {
    id: 'autoShutdown',
    label: 'Shutdown',
    desc: 'Tự động tắt máy sau khi pipeline chạy xong hoặc lỗi',
    icon: Power
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    desc: 'Quản lý API keys, models và cấu hình OpenRouter',
    icon: Globe
  },
  {
    id: 'cliAgentScan',
    label: 'CLI Agents',
    desc: 'Quét và hiển thị các CLI coding agent đã cài đặt',
    icon: Cpu
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
      {activeTab !== 'overview' && <BackButton onClick={handleBack} />}
      {activeTab === 'output' && <OutputSettings />}
      {activeTab === 'translation' && <TranslationSettings />}
      {activeTab === 'prompts' && <PromptSettings />}
      {activeTab === 'tts' && <TtsSettings />}
      {activeTab === 'app' && <AppSettings />}
      {activeTab === 'apikeys' && <ApiKeysManager />}
      {activeTab === 'geminichat' && <GeminiChatSettings />}
      {activeTab === 'grokUi' && <GrokUiSettings />}
      {activeTab === 'proxy' && <ProxySettings />}
      {activeTab === 'queueMonitor' && <QueueMonitorSettings />}
      {activeTab === 'debugLogs' && <DebugLogsSettings />}
      {activeTab === 'autoShutdown' && <AutoShutdownSettings />}
      {activeTab === 'openrouter' && <OpenRouterDetail />}
      {activeTab === 'cliAgentScan' && <CliAgentScanPanel />}
    </div>
  );
}
