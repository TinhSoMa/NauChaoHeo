import React, { useMemo, useState } from 'react';
import styles from './CutVideo.module.css';
import { AudioExtractor } from './AudioExtractor';
import { VideoSplitter } from './VideoSplitter';
import { VideoMerger } from './VideoMerger';
import { VideoAudioMixer } from './VideoAudioMixer';
import { Link2, Music2, Scissors, ListMusic } from 'lucide-react';

type CutVideoTab = 'audio' | 'split' | 'merge' | 'musicMix';

interface TabConfig {
  id: CutVideoTab;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}

export const CutVideo: React.FC = () => {
  const [activeTab, setActiveTab] = useState<CutVideoTab>('audio');

  const tabs = useMemo<TabConfig[]>(
    () => [
      {
        id: 'audio',
        label: 'Tách Audio',
        subtitle: 'Xuất audio từ nhiều folder',
        icon: <Music2 size={16} />,
      },
      {
        id: 'split',
        label: 'Cắt Video',
        subtitle: 'Chia video thành nhiều đoạn',
        icon: <Scissors size={16} />,
      },
      {
        id: 'merge',
        label: 'Nối Video',
        subtitle: 'Ghép video render theo thứ tự',
        icon: <Link2 size={16} />,
      },
      {
        id: 'musicMix',
        label: 'Ghép Nhạc',
        subtitle: 'Trộn playlist nhạc vào 1 video',
        icon: <ListMusic size={16} />,
      },
    ],
    []
  );

  return (
    <div className={styles.container}>
      <div className={styles.workspaceHeader}>
        <h1 className={styles.workspaceTitle}>Cut Video</h1>
        <p className={styles.workspaceSubtitle}>Chọn đúng chức năng bạn cần để thao tác nhanh hơn.</p>
      </div>

      <div className={styles.tabBar} role="tablist" aria-label="CutVideo features">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`cutvideo-tabpanel-${tab.id}`}
              id={`cutvideo-tab-${tab.id}`}
              className={`${styles.tabButton} ${isActive ? styles.tabButtonActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className={styles.tabIcon}>{tab.icon}</span>
              <span className={styles.tabText}>
                <span className={styles.tabLabel}>{tab.label}</span>
                <span className={styles.tabSubLabel}>{tab.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.workspaceBody}>
        <div
          role="tabpanel"
          id="cutvideo-tabpanel-audio"
          aria-labelledby="cutvideo-tab-audio"
          hidden={activeTab !== 'audio'}
          className={styles.tabPanel}
        >
          {activeTab === 'audio' && <AudioExtractor />}
        </div>
        <div
          role="tabpanel"
          id="cutvideo-tabpanel-split"
          aria-labelledby="cutvideo-tab-split"
          hidden={activeTab !== 'split'}
          className={styles.tabPanel}
        >
          {activeTab === 'split' && <VideoSplitter />}
        </div>
        <div
          role="tabpanel"
          id="cutvideo-tabpanel-merge"
          aria-labelledby="cutvideo-tab-merge"
          hidden={activeTab !== 'merge'}
          className={styles.tabPanel}
        >
          {activeTab === 'merge' && <VideoMerger />}
        </div>
        <div
          role="tabpanel"
          id="cutvideo-tabpanel-musicMix"
          aria-labelledby="cutvideo-tab-musicMix"
          hidden={activeTab !== 'musicMix'}
          className={styles.tabPanel}
        >
          {activeTab === 'musicMix' && <VideoAudioMixer />}
        </div>
      </div>
    </div>
  );
};
