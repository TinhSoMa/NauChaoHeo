import { useState, useCallback } from 'react';
import { Step, ProcessStatus, SubtitleEntry, TranslationProgress, TTSProgress } from '../CaptionTypes';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';

// Helper function to validate steps
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

interface UseCaptionProcessingProps {
  entries: SubtitleEntry[];
  setEntries: (entries: SubtitleEntry[]) => void;
  filePath: string;
  inputType: 'srt' | 'draft';
  captionFolder: string | null;
  settings: {
    geminiModel: string;
    splitByLines: boolean;
    linesPerFile: number;
    numberOfParts: number;
    voice: string;
    rate: string;
    volume: string;
    srtSpeed: number;
    audioDir: string;
    setAudioDir: (dir: string) => void;
  };
  enabledSteps: Set<Step>;
  setEnabledSteps: React.Dispatch<React.SetStateAction<Set<Step>>>;
}

export function useCaptionProcessing({
  entries,
  setEntries,
  filePath,
  inputType,
  captionFolder,
  settings,
  enabledSteps,
  setEnabledSteps,
}: UseCaptionProcessingProps) {
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [status, setStatus] = useState<ProcessStatus>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, message: 'Sẵn sàng.' });
  
  // State for intermediate data
  const [audioFiles, setAudioFiles] = useState<Array<{ path: string; startMs: number }>>([]);

  // ========== AUTO SAVE/LOAD VÀO PROJECT ==========
  useProjectFeatureState<{
    audioFiles?: Array<{ path: string; startMs: number }>;
  }>({
    feature: 'caption',
    fileName: 'caption-processing.json',
    serialize: () => ({
      audioFiles,
    }),
    deserialize: (saved) => {
      if (saved.audioFiles) setAudioFiles(saved.audioFiles);
    },
    deps: [audioFiles],
  });

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
  }, [setEnabledSteps]);

  const handleStop = useCallback(() => {
    setStatus('idle');
    setProgress(p => ({ ...p, message: 'Đã dừng.' }));
  }, []);

  const handleStart = useCallback(async () => {
    const steps = Array.from(enabledSteps).sort() as Step[];
    
    // Validate steps
    const validation = validateSteps(steps);
    if (!validation.valid) {
      setProgress({ ...progress, message: validation.error || 'Lỗi validation!' });
      return;
    }

    setStatus('running');

    // Listen for progress
    // @ts-ignore
    window.electronAPI.caption.onTranslateProgress((p: TranslationProgress) => {
      setProgress({ current: p.current, total: p.total, message: p.message });
    });
    // @ts-ignore
    window.electronAPI.tts.onProgress((p: TTSProgress) => {
      setProgress({ current: p.current, total: p.total, message: p.message });
    });

    // Temp variables for the process
    let currentAudioFiles: Array<{ path: string; startMs: number }> = [];
    let currentOutputDir = '';

    try {
      for (const step of steps) {
        setCurrentStep(step);
        
        // ========== STEP 1: INPUT ==========
        if (step === 1) {
          if (entries.length === 0 && filePath) {
            // @ts-ignore
            const parseResult = inputType === 'srt'
              // @ts-ignore
              ? await window.electronAPI.caption.parseSrt(filePath)
              // @ts-ignore
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
          
          const textOutputDir = captionFolder 
            ? `${captionFolder}/text` 
            : filePath.replace(/[^/\\]+$/, 'auto/text');
          
          const splitValue = settings.splitByLines ? settings.linesPerFile : settings.numberOfParts;
          // @ts-ignore
          const result = await window.electronAPI.caption.split({
            entries,
            splitByLines: settings.splitByLines,
            value: splitValue,
            outputDir: textOutputDir,
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
          
          // @ts-ignore
          const result = await window.electronAPI.caption.translate({
            entries,
            targetLanguage: 'Vietnamese',
            model: settings.geminiModel,
            linesPerBatch: 50,
          });

          if (result.success && result.data) {
            setEntries(result.data.entries);
            const srtOutputPath = captionFolder 
              ? `${captionFolder}/srt/${Date.now()}_translated.srt`
              : filePath.replace(/\.(srt|json)$/i, '_translated.srt');
            // @ts-ignore
            await window.electronAPI.caption.exportSrt(result.data.entries, srtOutputPath);
            setProgress({ current: result.data.translatedLines, total: result.data.totalLines, message: `Bước 3: Đã dịch ${result.data.translatedLines} dòng` });
          } else {
            throw new Error(result.error);
          }
        }
        
        // ========== STEP 4: TTS ==========
        if (step === 4) {
          currentOutputDir = captionFolder 
            ? `${captionFolder}/audio` 
            : filePath.replace(/[^/\\]+$/, 'audio_output');
          settings.setAudioDir(currentOutputDir);
          setProgress({ current: 0, total: entries.length, message: 'Bước 4: Đang tạo audio...' });
          
          // @ts-ignore
          const result = await window.electronAPI.tts.generate(entries, {
            voice: settings.voice,
            rate: settings.rate,
            volume: settings.volume,
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
          
          // @ts-ignore
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
          const outputDir = currentOutputDir || settings.audioDir;
          const mergedPath = `${outputDir}/merged_audio.wav`;
          setProgress({ current: 0, total: 1, message: 'Bước 6: Đang ghép audio...' });
          
          // @ts-ignore
          const result = await window.electronAPI.tts.mergeAudio(filesToMerge, mergedPath, settings.srtSpeed);

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
  }, [
    enabledSteps, entries, filePath, inputType, captionFolder,
    settings, audioFiles, progress
  ]);

  return {
    enabledSteps,
    toggleStep,
    handleStart,
    handleStop,
    status,
    progress,
    currentStep,
  };
}
