import { useState, useCallback } from 'react';
import { Step, ProcessStatus, SubtitleEntry, TranslationProgress, TTSProgress } from '../CaptionTypes';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';

// Helper function to validate steps
function validateSteps(steps: Step[]): { valid: boolean; error?: string } {
  if (steps.length === 0) {
    return { valid: false, error: 'Hãy chọn ít nhất 1 bước!' };
  }
  
  return { valid: true };
}

interface UseCaptionProcessingProps {
  entries: SubtitleEntry[];
  setEntries: (entries: SubtitleEntry[]) => void;
  filePath: string;
  inputType: string;
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
    useGpu: boolean;
    style?: any;
    renderMode: 'hardsub' | 'black_bg';
    renderResolution: 'original' | '1080p' | '720p' | '540p' | '360p';
    subtitlePosition?: { x: number; y: number } | null;
    blackoutTop?: number | null;
    autoFitAudio: boolean;
    renderAudioSpeed?: number;
    videoVolume?: number;
    audioVolume?: number;
    logoPath?: string;
    logoPosition?: { x: number; y: number } | null;
    logoScale?: number;
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
    // @ts-ignore
    window.electronAPI.captionVideo?.onRenderProgress?.((p: any) => {
      setProgress({ current: Math.floor(p.percent || 0), total: 100, message: p.message || 'Đang render video...' });
    });

    const inputPaths = inputType === 'draft' && filePath ? filePath.split('; ') : [filePath];
    
    try {
      for (let i = 0; i < inputPaths.length; i++) {
        const currentPath = inputPaths[i];
        const folderName = currentPath.split(/[/\\]/).pop() || 'Unknown';
        const isMulti = inputPaths.length > 1;

        // Reset state for this folder if processing multiple
        let currentEntries: SubtitleEntry[] = isMulti ? [] : entries;
        let currentAudioFiles: Array<{ path: string; startMs: number }> = isMulti ? [] : audioFiles;
        
        // Output directory is always inside the selected project folder
        const processOutputDir = inputType === 'draft'
          ? `${currentPath}/caption_output`
          : currentPath.replace(/[^/\\]+$/, 'caption_output');

        let srtFileForVideo = '';

        for (const step of steps) {
          setCurrentStep(step);
          
          if (isMulti) {
            setProgress({ current: 0, total: 100, message: `[${i + 1}/${inputPaths.length}] Đang xử lý: ${folderName}... (Bước ${step})` });
          }
          
          // ========== STEP 1: INPUT ==========
          if (step === 1) {
            if (currentEntries.length === 0 && currentPath) {
              const parseResult = inputType === 'srt'
                // @ts-ignore
                ? await window.electronAPI.caption.parseSrt(currentPath)
                // @ts-ignore
                : await window.electronAPI.caption.parseDraft(`${currentPath}/draft_content.json`);

              if (parseResult.success && parseResult.data) {
                currentEntries = parseResult.data.entries;
                if (!isMulti) setEntries(currentEntries);
              } else {
                throw new Error(`[${folderName}] Lỗi đọc file draft/srt: ${parseResult.error}`);
              }
            }
            if (!isMulti) setProgress({ current: 1, total: 1, message: 'Bước 1: Đã load file input' });
          }
          
          // Tự động nạp dữ liệu (nếu người dùng skip Bước 1)
          if (currentEntries.length === 0 && step !== 1) {
            if (isMulti) setProgress({ current: 0, total: 100, message: `[${i + 1}/${inputPaths.length}] Đang tải dữ liệu cũ...` });
            
            // 1. Ưu tiên nạp bản dịch (nếu đã chạy Step 3 trước đó)
            const translatedSrtPath = `${processOutputDir}/srt/translated.srt`;
            try {
              // @ts-ignore
              const transResult = await window.electronAPI.caption.parseSrt(translatedSrtPath);
              if (transResult && transResult.success && transResult.data && transResult.data.entries && transResult.data.entries.length > 0) {
                currentEntries = transResult.data.entries;
              }
            } catch (e) { /* ignore */ }
            
            // 2. Nếu chưa có bản dịch (có thể chỉ muốn chạy step 2 hoặc 3), nạp bản gốc
            if (currentEntries.length === 0) {
              try {
                const parseResult = inputType === 'srt'
                  // @ts-ignore
                  ? await window.electronAPI.caption.parseSrt(currentPath)
                  // @ts-ignore
                  : await window.electronAPI.caption.parseDraft(`${currentPath}/draft_content.json`);

                if (parseResult?.success && parseResult?.data) {
                  currentEntries = parseResult.data.entries;
                }
              } catch (e) { /* ignore */ }
            }

            if (!isMulti && currentEntries.length > 0) {
              setEntries(currentEntries);
            }
          }
          
          // Guard for subsequent steps (nếu vẫn không load được)
          if (currentEntries.length === 0 && step !== 1 && step !== 7 && inputType !== 'srt') {
            throw new Error(`[${folderName}] Không có dữ liệu Subtitle! Vui lòng bắt đầu từ Bước 1.`);
          }
          
          // ========== STEP 2: SPLIT ==========
          if (step === 2) {
            if (!isMulti) setProgress({ current: 0, total: 1, message: 'Bước 2: Đang chia nhỏ text...' });
            
            const textOutputDir = `${processOutputDir}/text`;
            const splitValue = settings.splitByLines ? settings.linesPerFile : settings.numberOfParts;
            
            // @ts-ignore
            const result = await window.electronAPI.caption.split({
              entries: currentEntries,
              splitByLines: settings.splitByLines,
              value: splitValue,
              outputDir: textOutputDir,
            });

            if (result.success && result.data) {
              if (!isMulti) setProgress({ current: 1, total: 1, message: `Bước 2: Đã tạo ${result.data.partsCount} phần` });
            } else {
              throw new Error(`[${folderName}] Lỗi chia file: ${result.error}`);
            }
          }
          
          // ========== STEP 3: DỊCH ==========
          if (step === 3) {
            if (!isMulti) setProgress({ current: 0, total: currentEntries.length, message: 'Bước 3: Đang dịch...' });
            
            // @ts-ignore
            const result = await window.electronAPI.caption.translate({
              entries: currentEntries,
              targetLanguage: 'Vietnamese',
              model: settings.geminiModel,
              linesPerBatch: 50,
            });

            if (result.success && result.data) {
              currentEntries = result.data.entries;
              if (!isMulti) setEntries(currentEntries);
              
              srtFileForVideo = `${processOutputDir}/srt/translated.srt`;
              
              // @ts-ignore
              await window.electronAPI.caption.exportSrt(currentEntries, srtFileForVideo);
              if (!isMulti) setProgress({ current: result.data.translatedLines, total: result.data.totalLines, message: `Bước 3: Đã dịch ${result.data.translatedLines} dòng` });
            } else {
              throw new Error(`[${folderName}] Lỗi dịch: ${result.error}`);
            }
          }
          
          // ========== STEP 4: TTS ==========
          if (step === 4) {
            const audioDir = `${processOutputDir}/audio`;
            if (!isMulti) settings.setAudioDir(audioDir);
            
            if (!isMulti) setProgress({ current: 0, total: currentEntries.length, message: 'Bước 4: Đang tạo audio...' });
            
            // @ts-ignore
            const result = await window.electronAPI.tts.generate(currentEntries, {
              voice: settings.voice,
              rate: settings.rate,
              volume: settings.volume,
              outputDir: audioDir,
              outputFormat: 'wav',
            });

            if (result.success && result.data) {
              currentAudioFiles = result.data.audioFiles;
              if (!isMulti) setAudioFiles(currentAudioFiles);
              if (!isMulti) setProgress({ current: result.data.totalGenerated, total: currentEntries.length, message: `Bước 4: Đã tạo ${result.data.totalGenerated} audio` });
            } else {
              throw new Error(`[${folderName}] Lỗi tạo audio: ${result.error}`);
            }
          }
          
          // ========== STEP 5: TRIM SILENCE ==========
          if (step === 5) {
            const filesToTrim = currentAudioFiles;
            if (filesToTrim.length === 0) continue;
            
            if (!isMulti) setProgress({ current: 0, total: filesToTrim.length, message: 'Bước 5: Đang cắt khoảng lặng...' });
            
            // @ts-ignore
            const result = await window.electronAPI.tts.trimSilence(filesToTrim.map(f => f.path));

            // @ts-ignore
            const resultEnd = await window.electronAPI.tts.trimSilenceEnd(filesToTrim.map(f => f.path));

            if (result.success && result.data && resultEnd.success && resultEnd.data) {
              if (!isMulti) setProgress({ current: resultEnd.data.trimmedCount, total: filesToTrim.length, message: `Bước 5: Đã trim ${resultEnd.data.trimmedCount} files` });
            } else {
              throw new Error(`[${folderName}] Lỗi trim silence: ${result.error || resultEnd.error}`);
            }
          }
          
          // ========== STEP 6: MERGE AUDIO ==========
          if (step === 6) {
            let filesToMerge = [...currentAudioFiles];
            if (filesToMerge.length === 0) continue;
            
            // Auto Fit Audio trước khi merge (scale audio vừa thời lượng cho phép)
            if (settings.autoFitAudio) {
              if (!isMulti) setProgress({ current: 0, total: filesToMerge.length, message: 'Bước 6: Đang scale audio vừa thời lượng...' });
              
              const fitItems = filesToMerge
                .map(f => {
                  const entry = currentEntries.find(e => e.startMs === f.startMs);
                  return { path: f.path, durationMs: entry?.durationMs || 0 };
                })
                .filter(item => item.durationMs > 0);

              if (fitItems.length > 0) {
                // @ts-ignore
                const fitResult = await window.electronAPI.tts.fitAudio(fitItems);

                if (fitResult.success && fitResult.data) {
                  const { scaledCount, pathMapping } = fitResult.data;
                  if (!isMulti) setProgress({ current: scaledCount, total: fitItems.length, message: `Bước 6: Đã fit ${scaledCount}/${fitItems.length} files` });
                  
                  // Thay đường dẫn file gốc bằng file đã scale (nếu có) cho merge
                  for (const mapping of pathMapping) {
                    const idx = filesToMerge.findIndex(f => f.path === mapping.originalPath);
                    if (idx !== -1 && mapping.outputPath !== mapping.originalPath) {
                      filesToMerge[idx] = { ...filesToMerge[idx], path: mapping.outputPath };
                    }
                  }
                } else {
                  console.warn(`[${folderName}] Cảnh báo fit audio: ${fitResult.error}`);
                }
              }
            }

            const mergedPath = `${processOutputDir}/merged_audio.wav`;
            if (!isMulti) setProgress({ current: 0, total: 1, message: 'Bước 6: Đang ghép audio...' });
            
            // @ts-ignore
            const result = await window.electronAPI.tts.mergeAudio(filesToMerge, mergedPath, settings.srtSpeed);

            if (result.success) {
              if (!isMulti) setProgress({ current: 1, total: 1, message: `Bước 6: Đã ghép audio thành công` });
            } else {
              throw new Error(`[${folderName}] Lỗi ghép audio: ${result.error}`);
            }
          }

          // ========== STEP 7: RENDER VIDEO ==========
          if (step === 7) {
            if (!isMulti) setProgress({ current: 0, total: 100, message: 'Bước 7: Đang tìm video gốc tốt nhất...' });

            let finalVideoInputPath: string | undefined = undefined;
            const folderPathsToSearch = inputType === 'draft' ? [currentPath] : [currentPath.replace(/[^/\\]+$/, '')];

            // @ts-ignore
            const findBestRes = await window.electronAPI.captionVideo.findBestVideoInFolders(folderPathsToSearch);
            
            let stripWidth = 1080; // Mặc định cho Tiktok/Shorts
            let stripHeight = 1920;
            let targetDuration: number | undefined = undefined;

            if (findBestRes.success && findBestRes.data?.videoPath) {
               const foundVideo = findBestRes.data.videoPath;
               
               if (settings.renderMode === 'hardsub') {
                  finalVideoInputPath = foundVideo;
                  console.log(`[CaptionProcessing] Tự động chọn video cho ${folderName}: ${finalVideoInputPath}`);
                  if (!isMulti) setProgress({ current: 5, total: 100, message: `Bước 7: Đã tìm thấy video ${foundVideo.split(/[/\\]/).pop()}` });
               } else {
                  console.log(`[CaptionProcessing] Tìm thấy video mẫu gốc để lấy độ phân giải nền đen: ${foundVideo}`);
                  if (!isMulti) setProgress({ current: 5, total: 100, message: `Bước 7: Render nền đen (Chế độ màn hình)` });
               }

               try {
                 // @ts-ignore
                 const meta = await window.electronAPI.captionVideo.getVideoMetadata(foundVideo);
                 if (meta && meta.success && meta.data) {
                    stripWidth = meta.data.width;
                    targetDuration = meta.data.duration;
                    
                    if (settings.renderMode === 'black_bg') {
                       // Chiều cao bằng 1/10 chiều cao video gốc (dùng actualHeight vì height bị hardcode 100)
                       const realHeight = meta.data.actualHeight || 1080;
                       stripHeight = Math.floor(realHeight / 10);
                    } else {
                       stripHeight = meta.data.actualHeight || meta.data.height;
                    }
                 }
               } catch (e) {
                 console.warn("Không lấy được metadata video, dùng mặc định", e);
               }
            } else {
               if (settings.renderMode === 'hardsub') {
                  console.log(`[CaptionProcessing] Không tìm thấy video gốc cho ${folderName}, sẽ tạo video nền đen.`);
               } else {
                  if (!isMulti) setProgress({ current: 5, total: 100, message: `Bước 7: Render nền đen (Chế độ màn hình)` });
               }
            }

            if (!srtFileForVideo) {
               srtFileForVideo = inputType === 'srt' ? currentPath : `${processOutputDir}/srt/translated.srt`;
            }
            
            const finalVideoPath = `${processOutputDir}/final_video_${Date.now()}.mp4`;

            if (!isMulti) setProgress({ current: 20, total: 100, message: 'Bước 7: Bắt đầu render video (có thể mất vài phút)...' });

            // @ts-ignore
            const renderRes = await window.electronAPI.captionVideo.renderVideo({
              srtPath: srtFileForVideo,
              outputPath: finalVideoPath,
              width: stripWidth,
              height: stripHeight,
              videoPath: finalVideoInputPath,
              // black_bg: dùng duration từ SRT (toàn bộ phụ đề), không giới hạn theo template video
              // hardsub: loop video template theo targetDuration cho đủ chiều dài
              targetDuration: settings.renderMode === 'hardsub' ? targetDuration : undefined,
              useGpu: settings.useGpu,
              style: settings.style,
              renderResolution: settings.renderResolution,
              position: settings.subtitlePosition || undefined,
              blackoutTop: (settings.blackoutTop != null && settings.blackoutTop < 1)
                ? settings.blackoutTop
                : undefined,
              audioPath: `${processOutputDir}/merged_audio.wav`,
              audioSpeed: settings.renderAudioSpeed,
              videoVolume: settings.videoVolume,
              audioVolume: settings.audioVolume,
              logoPath: settings.logoPath,
              logoPosition: settings.logoPosition,
              logoScale: settings.logoScale,
            });

            if (renderRes.success) {
              if (!isMulti) setProgress({ current: 100, total: 100, message: `Bước 7: Đã render video thành công! (${renderRes.data?.duration?.toFixed(1)}s)` });
            } else {
               throw new Error(`[${folderName}] Lỗi render video: ${renderRes.error}`);
            }
          }
        }
      }

      setStatus('success');
      setProgress(p => ({ ...p, message: `Hoàn thành các bước: ${steps.join(', ')} trên ${inputPaths.length} project!` }));
    } catch (err) {
      setStatus('error');
      setProgress(p => ({ ...p, message: `Lỗi: ${err}` }));
      console.error(err);
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
    audioFiles,
  };
}
