import { ReactNode } from 'react';
import { Settings } from 'lucide-react';
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
  const { visible, renderSummary, metrics, audioPreview } = props;
  const isPreviewMixing = audioPreview.status === 'mixing';
  const canPreviewAudio = !audioPreview.disabled && visible;
  const formatSeconds = (value: number) => (Number.isFinite(value) ? `${value.toFixed(2)}s` : '--');

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <Settings size={16} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />
        B7 Utility
      </div>

      <div className={styles.step7Group}>
        <div className={styles.step7GroupTitle}>Runtime summary</div>
        <div className={styles.step7GroupBody}>
          <div className={`${styles.inputGroup} ${styles.step7Row}`}>
            <span className={styles.label}>Render</span>
            <div className={styles.textMuted} style={{ fontSize: 12 }}>
              {renderSummary.renderMode} / {renderSummary.renderResolution} / {renderSummary.renderContainer.toUpperCase()}
            </div>
          </div>
          <div className={`${styles.inputGroup} ${styles.step7Row}`}>
            <span className={styles.label}>Thumbnail</span>
            <div className={styles.textMuted} style={{ fontSize: 12 }}>
              {renderSummary.thumbnailDurationSec.toFixed(2)}s @ {renderSummary.thumbnailFrameTimeSec ?? 0}s
            </div>
          </div>
          <div className={`${styles.inputGroup} ${styles.step7Row}`}>
            <span className={styles.label}>Video marker</span>
            <div className={styles.textMuted} style={{ fontSize: 12 }}>
              {metrics.formatDuration(metrics.videoMarkerSec)}
            </div>
          </div>
          <div className={`${styles.inputGroup} ${styles.step7Row}`}>
            <span className={styles.label}>Auto speed</span>
            <div className={styles.textMuted} style={{ fontSize: 12 }}>
              {metrics.autoVideoSpeed.toFixed(2)}x
            </div>
          </div>
        </div>
      </div>

      <div className={styles.step7Divider} />

      <div className={styles.step7Group}>
        <div className={styles.step7GroupTitle}>Audio Preview</div>
        <div className={styles.step7GroupBody}>
          <div className={`${styles.step7FullRow} ${styles.inputGroup}`}>
            <div className={styles.audioPreviewBox}>
              <div className={styles.audioPreviewActions}>
                <button
                  type="button"
                  className={styles.resetBtnLike}
                  onClick={isPreviewMixing ? audioPreview.onStop : audioPreview.onTest}
                  disabled={!canPreviewAudio}
                >
                  {isPreviewMixing ? '⏹ Dừng test' : '🎧 Test mix 20s'}
                </button>
                {audioPreview.progressText && (
                  <span className={styles.audioPreviewProgressText}>{audioPreview.progressText}</span>
                )}
              </div>
              {audioPreview.dataUri && audioPreview.status === 'ready' && (
                <div className={styles.audioPreviewPlayerWrap}>
                  <audio className={styles.audioPreviewPlayer} controls autoPlay src={audioPreview.dataUri} />
                  {audioPreview.meta && (
                    <div className={styles.audioPreviewMeta}>
                      <span>{audioPreview.meta.folderName}</span>
                      <span>
                        {formatSeconds(audioPreview.meta.startSec)} - {formatSeconds(audioPreview.meta.endSec)}
                      </span>
                      <span>marker {formatSeconds(audioPreview.meta.markerSec)}</span>
                      <span className={styles.audioPreviewPath} title={audioPreview.meta.outputPath}>
                        {audioPreview.meta.outputPath}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {props.thumbnailListPanel}
    </div>
  );
}
