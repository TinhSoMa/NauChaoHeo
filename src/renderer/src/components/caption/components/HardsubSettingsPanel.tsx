import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronUp, Settings } from 'lucide-react';
import styles from '../CaptionTranslator.module.css';
import { Input } from '../../common/Input';
import { RadioButton } from '../../common/RadioButton';
import { HardsubTimingMetrics } from '../CaptionTypes';

interface HardsubSettingsPanelProps {
  visible: boolean;
  settings: any;
  availableFonts: string[];
  metrics: HardsubTimingMetrics;
  thumbnailListPanel?: ReactNode;
}

export function HardsubSettingsPanel(props: HardsubSettingsPanelProps) {
  const { visible, settings, metrics } = props;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <Settings size={16} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />
        B7 Render
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <span className={styles.label}>Mode</span>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            <RadioButton
              label="Hardsub"
              checked={settings.renderMode === 'hardsub'}
              onChange={() => settings.setRenderMode('hardsub')}
              name="renderMode"
            />
            <RadioButton
              label="9:16"
              checked={settings.renderMode === 'hardsub_portrait_9_16'}
              onChange={() => settings.setRenderMode('hardsub_portrait_9_16')}
              name="renderMode"
            />
            <RadioButton
              label="Nền đen"
              checked={settings.renderMode === 'black_bg'}
              onChange={() => settings.setRenderMode('black_bg')}
              name="renderMode"
            />
          </div>
        </div>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup}>
          <span className={styles.label}>Font Sub</span>
          <select
            className={styles.select}
            value={settings.style?.fontName || 'ZYVNA Fairy'}
            onChange={(e) => settings.setStyle((s: any) => ({ ...s, fontName: e.target.value }))}
          >
            {props.availableFonts.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inputGroup}>
          <span className={styles.label}>Font Thumb</span>
          <select
            className={styles.select}
            value={settings.thumbnailFontName || 'BrightwallPersonal'}
            onChange={(e) => settings.setThumbnailFontName(e.target.value)}
          >
            {props.availableFonts.map((font) => (
              <option key={`thumb-${font}`} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup}>
          <span className={styles.label}>Thumb Duration (s)</span>
          <Input
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            value={settings.thumbnailDurationSec ?? 0.5}
            onChange={(e) => settings.setThumbnailDurationSec?.(Number(e.target.value))}
          />
        </div>
      </div>

      {settings.renderMode === 'hardsub_portrait_9_16' && (
        <div className={styles.grid2} style={{ marginBottom: 12 }}>
          <div className={styles.inputGroup} style={{ gridColumn: '1 / span 2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={styles.label}>Crop ngang FG (%)</span>
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
          </div>
        </div>
      )}

      <div className={styles.grid2} style={{ marginBottom: 8 }}>
        <div className={styles.inputGroup} style={{ gridColumn: '1 / span 2' }}>
          <span className={styles.label}>Auto speed sync</span>
          <div
            style={{
              padding: 10,
              background: 'rgba(0,0,0,0.1)',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, width: 110 }}>Speed audio:</span>
              <Input
                type="number"
                value={settings.renderAudioSpeed}
                onChange={(e) => settings.setRenderAudioSpeed(Number(e.target.value))}
                min={0.5}
                max={5}
                step={0.1}
                style={{ width: 80 }}
              />
              <span style={{ fontSize: 12, fontWeight: 'bold' }}>x</span>
            </div>

            {metrics.isMultiFolder && (
              <div style={{ fontSize: 11, color: 'var(--color-accent, #4a9eff)' }}>
                {metrics.videoName ?? metrics.displayPath.split(/[/\\]/).pop()}
                {metrics.isEstimated && (
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>(ước tính)</span>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div>
                <div style={{ color: 'var(--text-secondary)' }}>Audio mới</div>
                <div style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>
                  {metrics.formatDuration(metrics.audioExpectedDuration)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  Gốc: {metrics.formatDuration(metrics.baseAudioDuration)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)' }}>Speed video</div>
                <div
                  style={{
                    fontWeight: 'bold',
                    color: metrics.autoVideoSpeed > 1 ? 'var(--color-warning)' : 'var(--color-success)',
                  }}
                >
                  {metrics.autoVideoSpeed.toFixed(2)}x
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  Marker: {metrics.formatDuration(metrics.videoMarkerSec)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.grid2} style={{ marginBottom: 12 }}>
        <div className={styles.inputGroup}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={styles.label}>Âm lượng video (%)</span>
            <span style={{ fontSize: 12, fontWeight: 'bold' }}>{settings.videoVolume}%</span>
          </div>
          <input
            type="range"
            value={settings.videoVolume}
            onChange={(e) => settings.setVideoVolume(Number(e.target.value))}
            min={0}
            max={200}
            step={10}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
            Giảm để video nhỏ tiếng hơn
          </div>
        </div>
        <div className={styles.inputGroup}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={styles.label}>Âm lượng TTS (%)</span>
            <span style={{ fontSize: 12, fontWeight: 'bold' }}>{settings.audioVolume}%</span>
          </div>
          <input
            type="range"
            value={settings.audioVolume}
            onChange={(e) => settings.setAudioVolume(Number(e.target.value))}
            min={0}
            max={200}
            step={10}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
            Tăng để audio lồng tiếng to hơn
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: advancedOpen ? 10 : 0 }}>
        <button
          type="button"
          className={styles.resetBtnLike}
          onClick={() => setAdvancedOpen((prev) => !prev)}
          title="Mở/đóng cấu hình nâng cao"
        >
          {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Nâng cao
        </button>
      </div>

      {advancedOpen && (
        <>
          <div className={styles.grid2} style={{ marginBottom: 12 }}>
            <div className={styles.inputGroup}>
              <span className={styles.label}>Font size</span>
              <Input
                type="number"
                value={settings.style?.fontSize}
                onChange={(e) => settings.setStyle((s: any) => ({ ...s, fontSize: Number(e.target.value) }))}
                min={20}
                max={200}
                disabled={settings.renderMode === 'black_bg'}
              />
            </div>
            <div className={styles.inputGroup}>
              <span className={styles.label}>Hardware</span>
              <select
                className={styles.select}
                value={settings.hardwareAcceleration}
                onChange={(e) => settings.setHardwareAcceleration(e.target.value as any)}
              >
                <option value="none">CPU</option>
                <option value="qsv">QSV</option>
              </select>
            </div>
          </div>

          <div className={styles.grid2} style={{ marginBottom: 12 }}>
            <div className={styles.inputGroup}>
              <span className={styles.label}>Màu chữ</span>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  marginTop: 6,
                  position: 'relative',
                }}
              >
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
                  onChange={(e) => settings.setStyle((s: any) => ({ ...s, fontColor: e.target.value }))}
                  style={{
                    position: 'absolute',
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                  }}
                />
              </label>
            </div>
          </div>
        </>
      )}

      {props.thumbnailListPanel}
    </div>
  );
}
