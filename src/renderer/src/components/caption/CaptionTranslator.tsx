import styles from './CaptionTranslator.module.css';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { RadioButton } from '../common/RadioButton';
import { Checkbox } from '../common/Checkbox';
import { useProjectContext } from '../../context/ProjectContext';
import {
  GEMINI_MODELS,
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  STEP_LABELS,
  LINES_PER_FILE_OPTIONS,
} from '../../config/captionConfig';
import { Step } from './CaptionTypes';
import { useCaptionSettings } from './hooks/useCaptionSettings';
import { useCaptionFileManagement } from './hooks/useCaptionFileManagement';
import { useCaptionProcessing } from './hooks/useCaptionProcessing';

export function CaptionTranslator() {
  // Project output paths
  const { paths } = useProjectContext();
  const captionFolder = paths?.caption ?? null;

  // 1. Settings Hook
  const settings = useCaptionSettings();

  // 2. File Management Hook
  const fileManager = useCaptionFileManagement({
    inputType: settings.inputType,
  });

  // 3. Processing Hook
  const processing = useCaptionProcessing({
    entries: fileManager.entries,
    setEntries: fileManager.setEntries,
    filePath: fileManager.filePath,
    inputType: settings.inputType,
    captionFolder,
    settings,
    enabledSteps: settings.enabledSteps,
    setEnabledSteps: settings.setEnabledSteps,
  });

  const getProgressColor = () => {
    if (processing.status === 'error') return 'var(--color-error)';
    if (processing.status === 'success') return 'var(--color-success)';
    return 'var(--color-primary)';
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <h1 className={styles.header}>Dịch Caption Tự Động</h1>

      {/* Cột trái: Input, Model, TTS */}
      <div className={styles.leftColumn}>
        {/* Section 1: File Input */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>1. Chọn file đầu vào</div>
          
            <div className={styles.fileTypeSelection}>
            <RadioButton
              label="File SRT"
              checked={settings.inputType === 'srt'}
              onChange={() => settings.setInputType('srt')}
              name="inputType"
            />
            <RadioButton
              label="Draft JSON (CapCut)"
              description="Dịch trực tiếp từ CapCut"
              checked={settings.inputType === 'draft'}
              onChange={() => settings.setInputType('draft')}
              name="inputType"
            />
          </div>

          <div className={styles.flexRow}>
            <Input
              value={fileManager.filePath}
              onChange={(e) => fileManager.setFilePath(e.target.value)}
              placeholder={settings.inputType === 'srt' ? 'Đường dẫn file .srt' : 'Đường dẫn file draft_content.json'}
            />
            <Button onClick={fileManager.handleBrowseFile}>
              Browse
            </Button>
          </div>
          {fileManager.entries.length > 0 && (
            <p className={styles.textMuted} style={{ marginTop: '8px' }}>Đã load: {fileManager.entries.length} dòng</p>
          )}
        </div>

        {/* Section 3: Gemini Model */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>3. Cấu hình Gemini Model</div>
          <select
            value={settings.geminiModel}
            onChange={(e) => settings.setGeminiModel(e.target.value)}
            className={styles.select}
          >
            {GEMINI_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Section 4: TTS Config */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>4. Cấu hình Giọng đọc (TTS)</div>
          <div className={styles.grid2}>
            <div>
              <label className={styles.label}>Giọng đọc</label>
              <select value={settings.voice} onChange={(e) => settings.setVoice(e.target.value)} className={styles.select}>
                {VOICES.map(v => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label}>Tốc độ SRT</label>
            <Input
              type="number"
              value={settings.srtSpeed}
              onChange={(e) => settings.setSrtSpeed(Number(e.target.value))}
              min={1}
              max={2}
              step={0.1}
            />
            </div>
          </div>
          <div className={styles.grid2} style={{ marginTop: '12px' }}>
            <div>
              <label className={styles.label}>Tốc độ đọc</label>
              <select value={settings.rate} onChange={(e) => settings.setRate(e.target.value)} className={styles.select}>
                {RATE_OPTIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label}>Âm lượng</label>
              <select value={settings.volume} onChange={(e) => settings.setVolume(e.target.value)} className={styles.select}>
                {VOLUME_OPTIONS.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Cột phải: Split, Controls */}
      <div className={styles.rightColumn}>
        {/* Section 2: Split Config */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>2. Cấu hình chia nhỏ Text</div>
          <div className={styles.splitConfig}>

            <RadioButton
              label="Dòng/file"
              checked={settings.splitByLines}
              onChange={() => settings.setSplitByLines(true)}
              name="splitConfig"
            >
              <select 
                value={settings.linesPerFile} 
                onChange={(e) => settings.setLinesPerFile(Number(e.target.value))}
                className={`${styles.select} ${styles.selectSmall} ${!settings.splitByLines ? styles.disabled : ''}`}
                disabled={!settings.splitByLines}
                onClick={(e) => e.stopPropagation()}
                style={{ marginTop: '8px' }}
              >
                {LINES_PER_FILE_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </RadioButton>

            <RadioButton
              label="Số phần"
              checked={!settings.splitByLines}
              onChange={() => settings.setSplitByLines(false)}
              name="splitConfig"
            >
              <Input
                type="number"
                value={settings.numberOfParts}
                onChange={(e) => settings.setNumberOfParts(Number(e.target.value))}
                min={2}
                max={20}
                variant="small"
                disabled={settings.splitByLines}
                onClick={(e) => e.stopPropagation()}
                containerClassName={settings.splitByLines ? styles.disabled : ''}
                style={{ marginTop: '8px' }}
              />
            </RadioButton>
          </div>
        </div>

        {/* Section 5: Controls */}
        <div className={styles.section} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className={styles.sectionTitle}>5. Điều khiển & Tiến độ</div>
          
          {/* Step Checkboxes */}
          <div className={styles.stepCheckboxes}>
            {([1, 2, 3, 4, 5, 6] as Step[]).map(step => (
              <Checkbox
                key={step}
                label={STEP_LABELS[step - 1]}
                checked={processing.enabledSteps.has(step)}
                onChange={() => processing.toggleStep(step)}
                highlight={processing.currentStep === step}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className={styles.buttonsRow}>
            <Button
              onClick={processing.handleStart}
              disabled={processing.status === 'running'}
              variant="success"
              fullWidth
            >
              ▶ START
            </Button>
            <Button
              onClick={processing.handleStop}
              disabled={processing.status !== 'running'}
              variant="danger"
              fullWidth
            >
              ⏹ STOP
            </Button>
          </div>

          {/* Progress */}
          <div className={styles.progressSection} style={{ marginTop: 'auto', paddingTop: '16px' }}>
            <div className={styles.progressHeader}>
              <span className={styles.textMuted}>{processing.progress.message}</span>
              {processing.progress.total > 0 && <span className={styles.textMuted}>{processing.progress.current}/{processing.progress.total}</span>}
            </div>
            {processing.progress.total > 0 && (
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${(processing.progress.current / processing.progress.total) * 100}%`,
                    backgroundColor: getProgressColor(),
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
