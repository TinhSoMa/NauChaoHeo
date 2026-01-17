/**
 * CaptionTranslator - Giao diện dịch caption tự động
 * Sử dụng CSS variables từ globals.css
 */

import { useState, useCallback } from 'react';

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

type Step = 1 | 2 | 3;
type ProcessStatus = 'idle' | 'running' | 'success' | 'error';

// ============================================
// CONSTANTS
// ============================================
const GEMINI_MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Nhanh)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Chất lượng)' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Dự phòng)' },
];

const VOICES = [
  { value: 'vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ)' },
  { value: 'vi-VN-NamMinhNeural', label: 'Nam Minh (Nam)' },
];

const RATE_OPTIONS = ['+0%', '+10%', '+20%', '+30%', '+40%', '+50%'];
const VOLUME_OPTIONS = ['+0%', '+10%', '+20%', '+30%'];

// ============================================
// STYLES - Sử dụng inline styles với CSS variables
// ============================================
const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  header: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: 'var(--color-primary)',
  },
  section: {
    padding: '16px',
    borderRadius: '12px',
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--color-border)',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--color-primary)',
    marginBottom: '12px',
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '8px',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    fontSize: '14px',
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '8px',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    fontSize: '14px',
    outline: 'none',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '8px',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-invert)',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
    cursor: 'pointer',
  },
  buttonSuccess: {
    flex: 1,
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: 'var(--color-success)',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
  },
  buttonDanger: {
    flex: 1,
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: 'var(--color-error)',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  label: {
    fontSize: '12px',
    color: 'var(--color-text-secondary)',
    marginBottom: '4px',
    display: 'block',
  },
  text: {
    color: 'var(--color-text-primary)',
  },
  textMuted: {
    color: 'var(--color-text-secondary)',
    fontSize: '14px',
  },
  progressBar: {
    height: '8px',
    borderRadius: '4px',
    backgroundColor: 'var(--color-surface)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s',
  },
  flexRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
  },
};

// ============================================
// COMPONENT
// ============================================
export function CaptionTranslator() {
  // State - Config
  const [inputType, setInputType] = useState<'srt' | 'draft'>('srt');
  const [filePath, setFilePath] = useState('');
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);
  const [geminiModel, setGeminiModel] = useState(GEMINI_MODELS[0].value);
  const [voice, setVoice] = useState(VOICES[0].value);
  const [rate, setRate] = useState('+30%');
  const [volume, setVolume] = useState('+30%');
  const [srtSpeed, setSrtSpeed] = useState(1.0);
  
  // State - Steps (1: Input, 2: Dịch, 3: TTS)
  const [enabledSteps, setEnabledSteps] = useState<Set<Step>>(new Set([1, 2, 3]));
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
    const steps = Array.from(enabledSteps).sort();
    if (steps.length === 0) {
      setProgress({ ...progress, message: 'Hãy chọn ít nhất 1 bước!' });
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

    try {
      for (const step of steps) {
        setCurrentStep(step);
        
        if (step === 1) {
          if (entries.length === 0 && filePath) {
            const parseResult = inputType === 'srt'
              ? await window.electronAPI.caption.parseSrt(filePath)
              : await window.electronAPI.caption.parseDraft(filePath);
            if (parseResult.success && parseResult.data) {
              setEntries(parseResult.data.entries);
            }
          }
          setProgress({ current: 1, total: 1, message: 'Bước 1: Đã load file SRT' });
        }
        
        if (step === 2) {
          setProgress({ current: 0, total: entries.length, message: 'Bước 2: Đang dịch...' });
          
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
            setProgress({ current: result.data.translatedLines, total: result.data.totalLines, message: `Bước 2: Đã dịch ${result.data.translatedLines} dòng` });
          } else {
            throw new Error(result.error);
          }
        }
        
        if (step === 3) {
          const outputDir = filePath.replace(/[^/\\]+$/, 'audio_output');
          setProgress({ current: 0, total: entries.length, message: 'Bước 3: Đang tạo audio...' });
          
          const result = await window.electronAPI.tts.generate(entries, {
            voice,
            rate,
            volume,
            outputDir,
            outputFormat: 'wav',
          });

          if (result.success && result.data) {
            const mergedPath = `${outputDir}/merged_audio.wav`;
            await window.electronAPI.tts.mergeAudio(result.data.audioFiles, mergedPath, srtSpeed);
            setProgress({ current: result.data.totalGenerated, total: entries.length, message: `Bước 3: Đã tạo ${result.data.totalGenerated} audio` });
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
  }, [enabledSteps, entries, filePath, geminiModel, voice, rate, volume, srtSpeed]);

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
    <div style={styles.container}>
      {/* Header */}
      <h1 style={styles.header}>Dịch Caption Tự Động</h1>

      {/* Section 1: File Input */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>1. Chọn file đầu vào</div>
        
        {/* Radio buttons chọn loại file */}
        <div style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
          <label style={styles.checkbox}>
            <input
              type="radio"
              checked={inputType === 'srt'}
              onChange={() => setInputType('srt')}
            />
            <span style={styles.text}>File SRT</span>
          </label>
          <label style={styles.checkbox}>
            <input
              type="radio"
              checked={inputType === 'draft'}
              onChange={() => setInputType('draft')}
            />
            <span style={styles.text}>Draft JSON (CapCut)</span>
          </label>
        </div>

        {/* File input */}
        <div style={styles.flexRow}>
          <input
            type="text"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder={inputType === 'srt' ? 'Đường dẫn file .srt' : 'Đường dẫn file draft_content.json'}
            style={styles.input}
          />
          <button onClick={handleBrowseFile} style={styles.button}>
            Browse
          </button>
        </div>
        {entries.length > 0 && (
          <p style={{ ...styles.textMuted, marginTop: '8px' }}>Đã load: {entries.length} dòng</p>
        )}
      </div>

      {/* Section 2: Gemini Model */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>2. Cấu hình Gemini Model</div>
        <select
          value={geminiModel}
          onChange={(e) => setGeminiModel(e.target.value)}
          style={styles.select}
        >
          {GEMINI_MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Section 3: TTS Config */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>3. Cấu hình Giọng đọc (TTS)</div>
        <div style={styles.grid2}>
          <div>
            <label style={styles.label}>Giọng đọc</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} style={styles.select}>
              {VOICES.map(v => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.label}>Tốc độ SRT</label>
            <input
              type="number"
              value={srtSpeed}
              onChange={(e) => setSrtSpeed(Number(e.target.value))}
              min={1}
              max={2}
              step={0.1}
              style={styles.input}
            />
          </div>
        </div>
        <div style={{ ...styles.grid2, marginTop: '12px' }}>
          <div>
            <label style={styles.label}>Tốc độ đọc</label>
            <select value={rate} onChange={(e) => setRate(e.target.value)} style={styles.select}>
              {RATE_OPTIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.label}>Âm lượng</label>
            <select value={volume} onChange={(e) => setVolume(e.target.value)} style={styles.select}>
              {VOLUME_OPTIONS.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Section 4: Controls */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>4. Điều khiển & Tiến độ</div>
        
        {/* Step Checkboxes */}
        <div style={{ display: 'flex', gap: '24px', marginBottom: '16px' }}>
          {([1, 2, 3] as Step[]).map(step => (
            <label key={step} style={styles.checkbox}>
              <input
                type="checkbox"
                checked={enabledSteps.has(step)}
                onChange={() => toggleStep(step)}
              />
              <span style={{
                ...styles.text,
                color: currentStep === step ? 'var(--color-warning)' : 'var(--color-text-primary)',
                fontWeight: currentStep === step ? 600 : 400,
              }}>
                {['Input', 'Dịch', 'TTS'][step - 1]}
              </span>
            </label>
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleStart}
            disabled={status === 'running'}
            style={{
              ...styles.buttonSuccess,
              ...(status === 'running' ? styles.buttonDisabled : {}),
            }}
          >
            ▶ START
          </button>
          <button
            onClick={handleStop}
            disabled={status !== 'running'}
            style={{
              ...styles.buttonDanger,
              ...(status !== 'running' ? styles.buttonDisabled : {}),
            }}
          >
            ⏹ STOP
          </button>
        </div>

        {/* Progress */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={styles.textMuted}>{progress.message}</span>
            {progress.total > 0 && <span style={styles.textMuted}>{progress.current}/{progress.total}</span>}
          </div>
          {progress.total > 0 && (
            <div style={styles.progressBar}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${(progress.current / progress.total) * 100}%`,
                  backgroundColor: getProgressColor(),
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
