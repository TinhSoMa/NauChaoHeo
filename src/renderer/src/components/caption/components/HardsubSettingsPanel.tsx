import { ReactNode } from 'react';
import { Settings } from 'lucide-react';
import styles from '../CaptionTranslator.module.css';
import { Input } from '../../common/Input';
import { RadioButton } from '../../common/RadioButton';
import { SubtitlePreview } from '../SubtitlePreview';
import { HardsubTimingMetrics, SubtitleEntry } from '../CaptionTypes';

interface HardsubSettingsPanelProps {
  visible: boolean;
  settings: any;
  availableFonts: string[];
  metrics: HardsubTimingMetrics;
  entries: SubtitleEntry[];
  firstVideoPath: string | null;
  thumbnailListPanel?: ReactNode;
  thumbnailPreviewText: string;
  onThumbnailTextChange?: (text: string) => void;
  thumbnailTextReadOnly: boolean;
  thumbnailTextHelper?: string;
  onSubtitlePositionChange: (pos: { x: number; y: number } | null) => void;
  onThumbnailFrameTimeChange: (timeSec: number | null) => void;
  onSelectLogo: () => Promise<void>;
  onRemoveLogo: () => void;
}

export function HardsubSettingsPanel(props: HardsubSettingsPanelProps) {
  if (!props.visible) {
    return null;
  }

  const { settings, metrics } = props;

  return (
    <div className={styles.section} style={{ marginTop: '20px' }}>
      <div className={styles.sectionTitle}>
        <Settings size={16} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />
        6. Cấu hình Subtitle Video (Step 7)
      </div>

      <div className={styles.grid2} style={{ marginBottom: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <span className={styles.label}>Loại Video Output</span>
          <div style={{ display: 'flex', gap: '20px', marginTop: 8 }}>
            <RadioButton
              label="Sửa đè (Hardsub) lên Video Gốc"
              checked={settings.renderMode === 'hardsub'}
              onChange={() => settings.setRenderMode('hardsub')}
              name="renderMode"
            />
            <RadioButton
              label="Hardsub 9:16 (Blur nền)"
              checked={settings.renderMode === 'hardsub_portrait_9_16'}
              onChange={() => settings.setRenderMode('hardsub_portrait_9_16')}
              name="renderMode"
            />
            <RadioButton
              label="Tạo Video Nền Đen rời (Import CapCut)"
              checked={settings.renderMode === 'black_bg'}
              onChange={() => settings.setRenderMode('black_bg')}
              name="renderMode"
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            Cấu hình layer/position của chế độ 16:9 và 9:16 được lưu độc lập.
          </div>
        </div>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup}>
          <span className={styles.label}>Font Subtitle</span>
          <select
            className={styles.select}
            value={settings.style?.fontName || 'ZYVNA Fairy'}
            onChange={e => settings.setStyle((s: any) => ({ ...s, fontName: e.target.value }))}
          >
            {props.availableFonts.map(font => (
              <option key={font} value={font}>{font}</option>
            ))}
          </select>
        </div>
        <div className={styles.inputGroup}>
          <span className={styles.label}>Font Thumbnail</span>
          <select
            className={styles.select}
            value={settings.thumbnailFontName || 'BrightwallPersonal'}
            onChange={e => settings.setThumbnailFontName(e.target.value)}
          >
            {props.availableFonts.map(font => (
              <option key={`thumb-${font}`} value={font}>{font}</option>
            ))}
          </select>
        </div>
      </div>

      {settings.renderMode === 'hardsub_portrait_9_16' && (
        <div className={styles.grid2} style={{ marginBottom: 12 }}>
          <div className={styles.inputGroup} style={{ gridColumn: '1 / span 2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={styles.label}>Crop ngang video chính (%)</span>
              <span style={{ fontSize: '12px', fontWeight: 'bold' }}>
                {Math.round(settings.portraitForegroundCropPercent ?? settings.foregroundCropPercent ?? 0)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={settings.portraitForegroundCropPercent ?? settings.foregroundCropPercent ?? 0}
              onChange={(e) => settings.setPortraitForegroundCropPercent?.(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer', marginTop: '6px' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              0% = fit toàn video, 20% = cắt tổng 20% ngang (10% mỗi bên). Không crop chiều cao.
            </div>
          </div>
        </div>
      )}

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup}>
          <span className={styles.label}>
            Font Size (px)
            {settings.renderMode === 'black_bg' && (
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block', marginTop: 2 }}>
                Tự tính = 90% chiều cao strip
              </span>
            )}
          </span>
          <Input
            type="number"
            value={settings.style?.fontSize}
            onChange={e => settings.setStyle((s: any) => ({ ...s, fontSize: Number(e.target.value) }))}
            min={20}
            max={200}
            disabled={settings.renderMode === 'black_bg'}
          />
        </div>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup} style={{ gridColumn: '1 / span 2' }}>
          <span className={styles.label}>Tốc độ Video tự thích ứng (Auto-Fit)</span>
          <div style={{ padding: '12px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', width: '120px' }}>Tăng tốc Audio:</span>
              <Input
                type="number"
                value={settings.renderAudioSpeed}
                onChange={e => settings.setRenderAudioSpeed(Number(e.target.value))}
                min={0.5}
                max={5}
                step={0.1}
                style={{ width: '80px' }}
              />
              <span style={{ fontSize: '12px', fontWeight: 'bold' }}>x</span>
            </div>

            {metrics.isMultiFolder && (
              <div style={{ fontSize: '11px', color: 'var(--color-accent, #4a9eff)', marginBottom: '2px' }}>
                📁 {metrics.videoName ?? metrics.displayPath.split(/[/\\]/).pop()}
                {metrics.isEstimated && <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>(~ước tính từ video)</span>}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px', fontSize: '12px' }}>
              <div>
                <div style={{ color: 'var(--text-secondary)' }}>🎤 Thời lượng Audio mới:</div>
                <div style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>
                  {metrics.formatDuration(metrics.audioExpectedDuration)}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  (Gốc: {metrics.formatDuration(metrics.baseAudioDuration)})
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)' }}>🎬 Tốc độ Video cần thiết:</div>
                <div style={{ fontWeight: 'bold', color: metrics.autoVideoSpeed > 1 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                  {metrics.autoVideoSpeed.toFixed(2)}x
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  Mốc video chuẩn (gốc): {metrics.formatDuration(metrics.videoMarkerSec)}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  {metrics.isMultiFolder
                    ? `Mốc sync: ${metrics.formatDuration(metrics.videoSubBaseDuration)}`
                    : `(Để khớp vỏn vẹn ${metrics.formatDuration(metrics.audioExpectedDuration)})`}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={styles.label}>Âm lượng Video gốc (%)</span>
            <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{settings.videoVolume}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <input
              type="range"
              value={settings.videoVolume}
              onChange={e => settings.setVideoVolume(Number(e.target.value))}
              min={0}
              max={200}
              step={10}
              style={{ flex: 1, cursor: 'pointer' }}
            />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Gắn liền với hình ảnh</div>
        </div>
        <div className={styles.inputGroup}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={styles.label}>Âm lượng Audio TTS (%)</span>
            <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{settings.audioVolume}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <input
              type="range"
              value={settings.audioVolume}
              onChange={e => settings.setAudioVolume(Number(e.target.value))}
              min={0}
              max={200}
              step={10}
              style={{ flex: 1, cursor: 'pointer' }}
            />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Âm thanh giọng đọc</div>
        </div>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup}>
          <span className={styles.label}>Màu Chữ</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 6, position: 'relative' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: settings.style?.fontColor || '#FFFF00',
                border: '2px solid rgba(255,255,255,0.2)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                flexShrink: 0,
              }}
            />
            <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 13 }}>
              {(settings.style?.fontColor || '#FFFF00').toUpperCase()}
            </span>
            <input
              type="color"
              value={settings.style?.fontColor || '#FFFF00'}
              onChange={e => settings.setStyle((s: any) => ({ ...s, fontColor: e.target.value }))}
              style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer', top: 0, left: 0 }}
            />
          </label>
        </div>
        <div className={styles.inputGroup}>
          <span className={styles.label}>Hardware Acceleration</span>
          <div style={{ marginTop: 8 }}>
            <select
              className={styles.select}
              value={settings.hardwareAcceleration}
              onChange={(e) => settings.setHardwareAcceleration(e.target.value as any)}
            >
              <option value="none">CPU (libx264)</option>
              <option value="qsv">Intel QuickSync (QSV)</option>
            </select>
          </div>
        </div>
      </div>

      {props.thumbnailListPanel}

      {(settings.renderMode === 'hardsub' || settings.renderMode === 'hardsub_portrait_9_16') && settings.inputType === 'draft' && (
        <SubtitlePreview
          videoPath={props.firstVideoPath}
          style={settings.style}
          entries={props.entries}
          blackoutTop={settings.blackoutTop}
          renderMode={settings.renderMode}
          renderResolution={settings.renderResolution}
          logoPath={settings.logoPath}
          logoPosition={settings.logoPosition}
          logoScale={settings.logoScale}
          portraitForegroundCropPercent={settings.portraitForegroundCropPercent ?? settings.foregroundCropPercent ?? 0}
          thumbnailFontName={settings.thumbnailFontName}
          onPositionChange={props.onSubtitlePositionChange}
          onBlackoutChange={settings.setBlackoutTop}
          onRenderResolutionChange={settings.setRenderResolution}
          onLogoPositionChange={(pos) => settings.setLogoPosition(pos || undefined)}
          onLogoScaleChange={(scale) => settings.setLogoScale(scale)}
          thumbnailText={props.thumbnailPreviewText}
          onThumbnailTextChange={props.onThumbnailTextChange}
          thumbnailTextReadOnly={props.thumbnailTextReadOnly}
          thumbnailTextHelper={props.thumbnailTextHelper}
          onFrameTimeChange={props.onThumbnailFrameTimeChange}
          onSelectLogo={props.onSelectLogo}
          onRemoveLogo={props.onRemoveLogo}
        />
      )}
    </div>
  );
}
