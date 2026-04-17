import React, { useMemo, useState } from 'react';
import styles from './CutVideo.module.css';
import { AudioExtractor } from './AudioExtractor';
import { VideoSplitter } from './VideoSplitter';
import { VideoMerger } from './VideoMerger';
import { VideoAudioMixer } from './VideoAudioMixer';
import { VideoAudioReplacer } from './VideoAudioReplacer';
import { CapcutProjectCreator } from './CapcutProjectCreator';
import { CapcutAutoFolderWorkflow } from './CapcutAutoFolderWorkflow';
import { Link2, Music2, Scissors, ListMusic, Clapperboard, Replace } from 'lucide-react';

type CutVideoTab = 'audio' | 'split' | 'merge' | 'musicMix' | 'audioReplace' | 'capcut' | 'capcutAuto';

interface TabConfig {
  id: CutVideoTab;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  chip?: string;
}

export const CutVideo: React.FC = () => {
  const [activeTab, setActiveTab] = useState<CutVideoTab | null>(null);

  const tabs = useMemo<TabConfig[]>(
    () => [
      {
        id: 'audio',
        label: 'Tách Audio',
        subtitle: 'Xuất audio từ nhiều folder',
        icon: <Music2 size={16} />,
        chip: 'Batch',
      },
      {
        id: 'split',
        label: 'Cắt Video',
        subtitle: 'Chia video thành nhiều đoạn',
        icon: <Scissors size={16} />,
        chip: 'Timeline',
      },
      {
        id: 'merge',
        label: 'Nối Video',
        subtitle: 'Ghép video render theo thứ tự',
        icon: <Link2 size={16} />,
        chip: 'Render',
      },
      {
        id: 'musicMix',
        label: 'Ghép Nhạc',
        subtitle: 'Trộn playlist nhạc vào 1 video',
        icon: <ListMusic size={16} />,
        chip: 'Music',
      },
      {
        id: 'audioReplace',
        label: 'Ghép Audio Tương Ứng',
        subtitle: 'Batch nhiều cặp video + audio riêng',
        icon: <Replace size={16} />,
        chip: 'Batch',
      },
      {
        id: 'capcut',
        label: 'CapCut Draft',
        subtitle: 'Tạo hàng loạt project từ folder video',
        icon: <Clapperboard size={16} />,
        chip: 'Draft',
      },
      {
        id: 'capcutAuto',
        label: 'CapCut Auto',
        subtitle: 'Folder nguồn là project, tự tạo draft + gắn audio',
        icon: <Clapperboard size={16} />,
        chip: 'Auto',
      },
    ],
    []
  );

  const activeConfig = activeTab ? tabs.find((t) => t.id === activeTab) : null;

  if (activeTab === 'audioReplace') {
    return (
      <div className={styles.container}>
        <VideoAudioReplacer onBack={() => setActiveTab(null)} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.workspaceLayout}>
        <section className={styles.mainWorkspace}>
          {activeConfig ? (
            <section
              className={styles.detailPanel}
              role="region"
              aria-label={`CutVideo ${activeConfig.label}`}
            >
              <div className={styles.detailBody}>
                {activeTab === 'audio' && <AudioExtractor onBack={() => setActiveTab(null)} />}
                {activeTab === 'split' && <VideoSplitter onBack={() => setActiveTab(null)} />}
                {activeTab === 'merge' && <VideoMerger onBack={() => setActiveTab(null)} />}
                {activeTab === 'musicMix' && <VideoAudioMixer onBack={() => setActiveTab(null)} />}
                {activeTab === 'capcut' && <CapcutProjectCreator onBack={() => setActiveTab(null)} />}
                {activeTab === 'capcutAuto' && <CapcutAutoFolderWorkflow onBack={() => setActiveTab(null)} />}
              </div>
            </section>
          ) : (
            <section className={styles.emptyWorkspace}>
              <h2 className={styles.emptyWorkspaceTitle}>CutVideo Tools</h2>
              <p className={styles.emptyWorkspaceSubtitle}>
                Chọn chức năng ở cột bên phải để bắt đầu.
              </p>
            </section>
          )}
        </section>

        <aside className={styles.menuRail} aria-label="CutVideo menu">
          <div className={styles.menuRailTitle}>Menu</div>
          <div className={styles.menuList} role="list">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="listitem"
                  className={`${styles.menuButton} ${isActive ? styles.menuButtonActive : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <div className={styles.menuButtonTop}>
                    <span className={styles.overviewIcon}>{tab.icon}</span>
                    <span className={styles.menuLabel}>{tab.label}</span>
                    {tab.chip && <span className={styles.menuChip}>{tab.chip}</span>}
                  </div>
                  <div className={styles.menuSubtitle}>{tab.subtitle}</div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
};
