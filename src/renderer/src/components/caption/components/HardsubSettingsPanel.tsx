import { ReactNode } from 'react';
import styles from '../CaptionTranslator.module.css';
import { HardsubTimingMetrics } from '../CaptionTypes';

interface HardsubSettingsPanelProps {
  visible: boolean;
  renderSummary: {
    renderMode: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
    renderResolution: 'original' | '1080p' | '720p' | '540p' | '360p';
    renderContainer: 'mp4' | 'mov';
    thumbnailDurationSec: number;
    thumbnailFrameTimeSec: number | null;
  };
  metrics: HardsubTimingMetrics;
  audioPreview: {
    status: 'idle' | 'mixing' | 'ready' | 'error';
    progressText: string;
    dataUri: string;
    meta?: {
      folderName: string;
      startSec: number;
      endSec: number;
      markerSec: number;
      outputPath: string;
    } | null;
    disabled?: boolean;
    onTest: () => void;
    onStop: () => void;
  };
  thumbnailListPanel?: ReactNode;
}

export function HardsubSettingsPanel(props: HardsubSettingsPanelProps) {
  const { visible, audioPreview, thumbnailListPanel } = props;
  const formatSeconds = (value: number) => (Number.isFinite(value) ? `${value.toFixed(2)}s` : '--');
  const audioStatusLabel = audioPreview.status === 'mixing'
    ? 'Mixing'
    : audioPreview.status === 'ready'
      ? 'Ready'
      : audioPreview.status === 'error'
        ? 'Error'
        : 'Idle';
  const audioStatusClass = audioPreview.status === 'mixing'
    ? styles.step7AudioStatusMixing
    : audioPreview.status === 'ready'
      ? styles.step7AudioStatusReady
      : audioPreview.status === 'error'
        ? styles.step7AudioStatusError
        : styles.step7AudioStatusIdle;

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.step7Panel}>
      <div className={styles.step7AudioCard}>
        <div className={styles.step7AudioActions}>
          <span className={`${styles.step7AudioStatusBadge} ${audioStatusClass}`}>{audioStatusLabel}</span>
          {audioPreview.progressText && (
            <span className={styles.audioPreviewProgressText}>{audioPreview.progressText}</span>
          )}
        </div>

        {audioPreview.dataUri && audioPreview.status === 'ready' && (
          <div className={styles.audioPreviewBox}>
            <div className={styles.audioPreviewPlayerWrap}>
              <audio className={styles.audioPreviewPlayer} controls src={audioPreview.dataUri} />
              {audioPreview.meta && (
                <div className={styles.audioPreviewProgressText}>
                  {audioPreview.meta.folderName} | {formatSeconds(audioPreview.meta.startSec)} - {formatSeconds(audioPreview.meta.endSec)} | marker {formatSeconds(audioPreview.meta.markerSec)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {thumbnailListPanel && (
        <div className={styles.step7ThumbnailWrap}>
          {thumbnailListPanel}
        </div>
      )}
    </div>
  );
}
