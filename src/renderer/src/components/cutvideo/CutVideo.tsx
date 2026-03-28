import React, { useMemo, useState } from 'react';
import styles from './CutVideo.module.css';
import { AudioExtractor } from './AudioExtractor';
import { VideoSplitter } from './VideoSplitter';
import { VideoMerger } from './VideoMerger';
import { VideoAudioMixer } from './VideoAudioMixer';
import { CapcutProjectCreator } from './CapcutProjectCreator';
import { Link2, Music2, Scissors, ListMusic, Clapperboard } from 'lucide-react';

type CutVideoTab = 'audio' | 'split' | 'merge' | 'musicMix' | 'capcut';

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
        id: 'capcut',
        label: 'CapCut Draft',
        subtitle: 'Tạo hàng loạt project từ folder video',
        icon: <Clapperboard size={16} />,
        chip: 'Draft',
      },
    ],
    []
  );

  const activeConfig = activeTab ? tabs.find((t) => t.id === activeTab) : null;

  return (
    <div className={styles.container}>
      {/* <div className={styles.workspaceHeader}>
        <h1 className={styles.workspaceTitle}>Cut Video</h1>
        <p className={styles.workspaceSubtitle}>Chọn đúng chức năng bạn cần để thao tác nhanh hơn.</p>
      </div> */}

      <div className={styles.overviewGrid} role="list" aria-label="CutVideo tools">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="listitem"
            className={styles.overviewCard}
            onClick={() => setActiveTab(tab.id)}
          >
            <div className={styles.overviewIcon}>{tab.icon}</div>
            <div className={styles.overviewBody}>
              <div className={styles.overviewTitleRow}>
                <span className={styles.overviewTitle}>{tab.label}</span>
                {tab.chip && <span className={styles.overviewChip}>{tab.chip}</span>}
              </div>
              <div className={styles.overviewDesc}>{tab.subtitle}</div>
            </div>
          </button>
        ))}
      </div>

      {activeConfig && (
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
          </div>
        </section>
      )}
    </div>
  );
};
