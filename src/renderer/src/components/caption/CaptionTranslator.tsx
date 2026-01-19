/**
 * CaptionTranslator - Giao diện dịch caption tự động
 * Sử dụng CSS Module và 6 bước xử lý
 */

import { useState, useCallback } from 'react';
import styles from './CaptionTranslator.module.css';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { RadioButton } from '../common/RadioButton';
import { Checkbox } from '../common/Checkbox';
import {
  GEMINI_MODELS,
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  STEP_LABELS,
  LINES_PER_FILE_OPTIONS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
  DEFAULT_SRT_SPEED,
  DEFAULT_SPLIT_BY_LINES,
  DEFAULT_LINES_PER_FILE,
  DEFAULT_NUMBER_OF_PARTS,
  DEFAULT_INPUT_TYPE,
} from '../../config/captionConfig';

// ============================================
// TYPES
// ============================================
interface SubtitleEntry {
  index: number;
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  text: string;
  translatedText?: string;
}

interface TranslationProgress {
  current: number;
  total: number;
  message: string;
}

interface TTSProgress {
  current: number;
  total: number;
  message: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type ProcessStatus = 'idle' | 'running' | 'success' | 'error';

// Hàm validate các bước (phải liên tiếp từ 1 nếu chọn nhiều bước)
function validateSteps(steps: Step[]): { valid: boolean; error?: string } {
  if (steps.length === 0) {
    return { valid: false, error: 'Hãy chọn ít nhất 1 bước!' };
  }
  
  if (steps.length > 1) {
    const sorted = [...steps].sort((a, b) => a - b);
    
    // Rule 1: Phải bắt đầu từ bước 1
    if (sorted[0] !== 1) {
      return { valid: false, error: 'Khi chọn nhiều bước, phải bắt đầu từ Bước 1!' };
    }
    
    // Rule 2: Các bước phải liên tiếp
    const isConsecutive = sorted.every((s, i) => 
      i === 0 || s === sorted[i - 1] + 1
    );
    
    if (!isConsecutive) {
      return { valid: false, error: 'Các bước phải liên tiếp (1→2→3→4→5→6)!' };
    }
  }
  
  return { valid: true };
}

// ============================================
// COMPONENT
// ============================================
export function CaptionTranslator() {
  // State - Config
  const [inputType, setInputType] = useState<'srt' | 'draft'>(DEFAULT_INPUT_TYPE);
  const [filePath, setFilePath] = useState('');
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [srtSpeed, setSrtSpeed] = useState(DEFAULT_SRT_SPEED);
  
  // State - Split Config
  const [splitByLines, setSplitByLines] = useState(DEFAULT_SPLIT_BY_LINES);
  const [linesPerFile, setLinesPerFile] = useState(DEFAULT_LINES_PER_FILE);
  const [numberOfParts, setNumberOfParts] = useState(DEFAULT_NUMBER_OF_PARTS);
  
  // State - Audio files (để dùng cho Trim và Merge)
  const [audioFiles, setAudioFiles] = useState<Array<{ path: string; startMs: number }>>([]);
  const [audioDir, setAudioDir] = useState('');
  
  // State - Steps (1: Input, 2: Split, 3: Dịch, 4: TTS, 5: Trim, 6: Merge)
  const [enabledSteps, setEnabledSteps] = useState<Set<Step>>(new Set([1, 2, 3, 4, 5, 6]));
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [status, setStatus] = useState<ProcessStatus>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, message: 'Sẵn sàng.' });

  // Toggle step enable
  const toggleStep = useCallback((step: Step) => {
    setEnabledSteps(prev => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  }, []);

  // Browse file (SRT hoặc Draft JSON)
  const handleBrowseFile = useCallback(async () => {
    try {
      const filters = inputType === 'srt' 
        ? [{ name: 'SRT Files', extensions: ['srt'] }]
        : [{ name: 'JSON Files', extensions: ['json'] }];

      const result = await window.electronAPI.invoke('dialog:openFile', { filters }) as { 
        canceled: boolean; 
        filePaths: string[] 
      };

      if (result?.canceled || !result?.filePaths?.length) return;

      const selectedPath = result.filePaths[0];
      setFilePath(selectedPath);

      // Parse tùy theo loại file
      const parseResult = inputType === 'srt'
        ? await window.electronAPI.caption.parseSrt(selectedPath)
        : await window.electronAPI.caption.parseDraft(selectedPath);

      if (parseResult.success && parseResult.data) {
        setEntries(parseResult.data.entries);
        setProgress({ 
          current: 0, 
          total: parseResult.data.totalEntries, 
          message: `Đã load ${parseResult.data.totalEntries} dòng từ ${inputType === 'srt' ? 'SRT' : 'Draft JSON'}` 
        });
      } else {
        setProgress({ current: 0, total: 0, message: `Lỗi: ${parseResult.error}` });
      }
    } catch (err) {
      setProgress({ current: 0, total: 0, message: `Lỗi: ${err}` });
    }
  }, [inputType]);

  // Run selected steps
  const handleStart = useCallback(async () => {
    const steps = Array.from(enabledSteps).sort() as Step[];
    
    // Validate các bước
    const validation = validateSteps(steps);
    if (!validation.valid) {
      setProgress({ ...progress, message: validation.error || 'Lỗi validation!' });
      return;
    }

    setStatus('running');

    // Listen for progress
    window.electronAPI.caption.onTranslateProgress((p: TranslationProgress) => {
      setProgress({ current: p.current, total: p.total, message: p.message });
    });
    window.electronAPI.tts.onProgress((p: TTSProgress) => {
      setProgress({ current: p.current, total: p.total, message: p.message });
    });

    // Biến lưu trữ audio files và output dir giữa các bước
    let currentAudioFiles: Array<{ path: string; startMs: number }> = [];
    let currentOutputDir = '';

    try {
      for (const step of steps) {
        setCurrentStep(step);
        
        // ========== STEP 1: INPUT ==========
        if (step === 1) {
          if (entries.length === 0 && filePath) {
            const parseResult = inputType === 'srt'
              ? await window.electronAPI.caption.parseSrt(filePath)
              : await window.electronAPI.caption.parseDraft(filePath);
            if (parseResult.success && parseResult.data) {
              setEntries(parseResult.data.entries);
            }
          }
          setProgress({ current: 1, total: 1, message: 'Bước 1: Đã load file input' });
        }
        
        // ========== STEP 2: SPLIT ==========
        if (step === 2) {
          setProgress({ current: 0, total: 1, message: 'Bước 2: Đang chia nhỏ text...' });
          
          const splitValue = splitByLines ? linesPerFile : numberOfParts;
          const result = await window.electronAPI.caption.split({
            entries,
            splitByLines,
            value: splitValue,
            outputDir: filePath.replace(/[^/\\]+$/, 'auto/text'),
          });

          if (result.success && result.data) {
            setProgress({ current: 1, total: 1, message: `Bước 2: Đã tạo ${result.data.partsCount} phần` });
          } else {
            throw new Error(result.error || 'Lỗi chia file');
          }
        }
        
        // ========== STEP 3: DỊCH ==========
        if (step === 3) {
          setProgress({ current: 0, total: entries.length, message: 'Bước 3: Đang dịch...' });
          
          const result = await window.electronAPI.caption.translate({
            entries,
            targetLanguage: 'Vietnamese',
            model: geminiModel,
            linesPerBatch: 50,
          });

          if (result.success && result.data) {
            setEntries(result.data.entries);
            const outputPath = filePath.replace(/\.(srt|json)$/i, '_translated.srt');
            await window.electronAPI.caption.exportSrt(result.data.entries, outputPath);
            setProgress({ current: result.data.translatedLines, total: result.data.totalLines, message: `Bước 3: Đã dịch ${result.data.translatedLines} dòng` });
          } else {
            throw new Error(result.error);
          }
        }
        
        // ========== STEP 4: TTS ==========
        if (step === 4) {
          currentOutputDir = filePath.replace(/[^/\\]+$/, 'audio_output');
          setAudioDir(currentOutputDir);
          setProgress({ current: 0, total: entries.length, message: 'Bước 4: Đang tạo audio...' });
          
          const result = await window.electronAPI.tts.generate(entries, {
            voice,
            rate,
            volume,
            outputDir: currentOutputDir,
            outputFormat: 'wav',
          });

          if (result.success && result.data) {
            currentAudioFiles = result.data.audioFiles;
            setAudioFiles(result.data.audioFiles);
            setProgress({ current: result.data.totalGenerated, total: entries.length, message: `Bước 4: Đã tạo ${result.data.totalGenerated} audio` });
          } else {
            throw new Error(result.error || 'Lỗi tạo audio');
          }
        }
        
        // ========== STEP 5: TRIM SILENCE ==========
        if (step === 5) {
          const filesToTrim = currentAudioFiles.length > 0 ? currentAudioFiles : audioFiles;
          setProgress({ current: 0, total: filesToTrim.length, message: 'Bước 5: Đang cắt khoảng lặng...' });
          
          const result = await window.electronAPI.tts.trimSilence(filesToTrim.map(f => f.path));

          if (result.success && result.data) {
            setProgress({ current: result.data.trimmedCount, total: filesToTrim.length, message: `Bước 5: Đã trim ${result.data.trimmedCount} files` });
          } else {
            throw new Error(result.error || 'Lỗi trim silence');
          }
        }
        
        // ========== STEP 6: MERGE AUDIO ==========
        if (step === 6) {
          const filesToMerge = currentAudioFiles.length > 0 ? currentAudioFiles : audioFiles;
          const outputDir = currentOutputDir || audioDir;
          const mergedPath = `${outputDir}/merged_audio.wav`;
          setProgress({ current: 0, total: 1, message: 'Bước 6: Đang ghép audio...' });
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await window.electronAPI.tts.mergeAudio(filesToMerge as any, mergedPath, srtSpeed);

          if (result.success) {
            setProgress({ current: 1, total: 1, message: `Bước 6: Đã ghép audio thành công` });
          } else {
            throw new Error(result.error || 'Lỗi ghép audio');
          }
        }
      }

      setStatus('success');
      setProgress(p => ({ ...p, message: `Hoàn thành các bước: ${steps.join(', ')}!` }));
    } catch (err) {
      setStatus('error');
      setProgress(p => ({ ...p, message: `Lỗi: ${err}` }));
    }

    setCurrentStep(null);
  }, [enabledSteps, entries, filePath, inputType, geminiModel, voice, rate, volume, srtSpeed, splitByLines, linesPerFile, numberOfParts, audioFiles, audioDir, progress]);

  const handleStop = useCallback(() => {
    setStatus('idle');
    setProgress(p => ({ ...p, message: 'Đã dừng.' }));
  }, []);

  const getProgressColor = () => {
    if (status === 'error') return 'var(--color-error)';
    if (status === 'success') return 'var(--color-success)';
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
              checked={inputType === 'srt'}
              onChange={() => setInputType('srt')}
              name="inputType"
            />
            <RadioButton
              label="Draft JSON (CapCut)"
              description="Dịch trực tiếp từ CapCut"
              checked={inputType === 'draft'}
              onChange={() => setInputType('draft')}
              name="inputType"
            />
          </div>

          <div className={styles.flexRow}>
            <Input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder={inputType === 'srt' ? 'Đường dẫn file .srt' : 'Đường dẫn file draft_content.json'}
            />
            <Button onClick={handleBrowseFile}>
              Browse
            </Button>
          </div>
          {entries.length > 0 && (
            <p className={styles.textMuted} style={{ marginTop: '8px' }}>Đã load: {entries.length} dòng</p>
          )}
        </div>

        {/* Section 3: Gemini Model */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>3. Cấu hình Gemini Model</div>
          <select
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value)}
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
              <select value={voice} onChange={(e) => setVoice(e.target.value)} className={styles.select}>
                {VOICES.map(v => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label}>Tốc độ SRT</label>
            <Input
              type="number"
              value={srtSpeed}
              onChange={(e) => setSrtSpeed(Number(e.target.value))}
              min={1}
              max={2}
              step={0.1}
            />
            </div>
          </div>
          <div className={styles.grid2} style={{ marginTop: '12px' }}>
            <div>
              <label className={styles.label}>Tốc độ đọc</label>
              <select value={rate} onChange={(e) => setRate(e.target.value)} className={styles.select}>
                {RATE_OPTIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.label}>Âm lượng</label>
              <select value={volume} onChange={(e) => setVolume(e.target.value)} className={styles.select}>
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
              checked={splitByLines}
              onChange={() => setSplitByLines(true)}
              name="splitConfig"
            >
              <select 
                value={linesPerFile} 
                onChange={(e) => setLinesPerFile(Number(e.target.value))}
                className={`${styles.select} ${styles.selectSmall} ${!splitByLines ? styles.disabled : ''}`}
                disabled={!splitByLines}
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
              checked={!splitByLines}
              onChange={() => setSplitByLines(false)}
              name="splitConfig"
            >
              <Input
                type="number"
                value={numberOfParts}
                onChange={(e) => setNumberOfParts(Number(e.target.value))}
                min={2}
                max={20}
                variant="small"
                disabled={splitByLines}
                onClick={(e) => e.stopPropagation()}
                containerClassName={splitByLines ? styles.disabled : ''}
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
                checked={enabledSteps.has(step)}
                onChange={() => toggleStep(step)}
                highlight={currentStep === step}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className={styles.buttonsRow}>
            <Button
              onClick={handleStart}
              disabled={status === 'running'}
              variant="success"
              fullWidth
            >
              ▶ START
            </Button>
            <Button
              onClick={handleStop}
              disabled={status !== 'running'}
              variant="danger"
              fullWidth
            >
              ⏹ STOP
            </Button>
          </div>

          {/* Progress */}
          <div className={styles.progressSection} style={{ marginTop: 'auto', paddingTop: '16px' }}>
            <div className={styles.progressHeader}>
              <span className={styles.textMuted}>{progress.message}</span>
              {progress.total > 0 && <span className={styles.textMuted}>{progress.current}/{progress.total}</span>}
            </div>
            {progress.total > 0 && (
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
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
