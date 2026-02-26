import { useState, useCallback, useRef } from 'react';
import { Step, ProcessStatus, SubtitleEntry, TranslationProgress, TTSProgress, ProcessingMode } from '../CaptionTypes';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';

type ProcessingAudioFile = {
  index: number;
  path: string;
  startMs: number;
  durationMs: number;
  success: boolean;
  error?: string;
};

type PartialProcessingAudioFile = Partial<ProcessingAudioFile> & {
  path?: string;
  startMs?: number;
};

function normalizeAudioFiles(files: PartialProcessingAudioFile[] = []): ProcessingAudioFile[] {
  const normalized: ProcessingAudioFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || typeof file.path !== 'string' || !file.path.trim()) continue;
    if (typeof file.startMs !== 'number' || Number.isNaN(file.startMs)) continue;

    normalized.push({
      index: typeof file.index === 'number' ? file.index : i + 1,
      path: file.path,
      startMs: file.startMs,
      durationMs: typeof file.durationMs === 'number' ? file.durationMs : 0,
      success: file.success !== false,
      error: typeof file.error === 'string' ? file.error : undefined,
    });
  }

  return normalized;
}

function msToSrtTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

function normalizeSpeedLabel(speed: number): string {
  const fixed = speed.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}

function buildScaledSubtitleEntries(entries: SubtitleEntry[], scale: number): SubtitleEntry[] {
  const safeScale = scale > 0 ? scale : 1.0;
  return entries.map((entry, idx) => {
    const scaledStartMs = Math.max(0, Math.round(entry.startMs * safeScale));
    const scaledEndMs = Math.max(scaledStartMs + 1, Math.round(entry.endMs * safeScale));
    return {
      ...entry,
      index: idx + 1,
      startMs: scaledStartMs,
      endMs: scaledEndMs,
      durationMs: scaledEndMs - scaledStartMs,
      startTime: msToSrtTime(scaledStartMs),
      endTime: msToSrtTime(scaledEndMs),
    };
  });
}

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
    hardwareAcceleration: 'none' | 'qsv';
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
    processingMode?: ProcessingMode;
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
  const [currentFolder, setCurrentFolder] = useState<{ index: number; total: number; name: string; path: string } | null>(null);
  
  // State for intermediate data
  const [audioFiles, setAudioFiles] = useState<ProcessingAudioFile[]>([]);

  // Ref cho abort flag — cho phép handleStop() dừng vòng lặp đang chạy
  const abortRef = useRef(false);

  // ========== AUTO SAVE/LOAD VÀO PROJECT ==========
  useProjectFeatureState<{
    audioFiles?: PartialProcessingAudioFile[];
  }>({
    feature: 'caption',
    fileName: 'caption-processing.json',
    serialize: () => ({
      audioFiles,
    }),
    deserialize: (saved) => {
      if (saved.audioFiles) {
        setAudioFiles(normalizeAudioFiles(saved.audioFiles));
      }
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
    abortRef.current = true;
    setStatus('idle');
    setCurrentFolder(null);
    setCurrentStep(null);
    setProgress(p => ({ ...p, message: 'Đã dừng.' }));
  }, []);

  const handleStart = useCallback(async () => {
    const steps = Array.from(enabledSteps).sort() as Step[];
    const processingMode = settings.processingMode ?? 'folder-first';

    // Validate steps
    const validation = validateSteps(steps);
    if (!validation.valid) {
      setProgress({ current: 0, total: 0, message: validation.error || 'Lỗi validation!' });
      return;
    }

    abortRef.current = false;
    setStatus('running');

    // Listen for progress — đăng ký 1 lần với replace (ghi đè listener cũ)
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
    const totalFolders = inputPaths.length;
    const isMulti = totalFolders > 1;

    // Xóa audioFiles cũ khi chạy multi-folder để tránh dùng nhầm dữ liệu cũ
    if (isMulti) {
      setAudioFiles([]);
    }

    // ========== PER-FOLDER STATE MAP (dùng cho step-first mode) ==========
    // Key = folder path, Value = { entries, audioFiles, srtFileForVideo }
    type FolderCtx = {
      entries: SubtitleEntry[];
      audioFiles: ProcessingAudioFile[];
      srtFileForVideo: string;
      outputDir: string;
      name: string;
    };
    const folderCtxMap = new Map<string, FolderCtx>();
    for (const p of inputPaths) {
      folderCtxMap.set(p, {
        entries: (!isMulti && p === inputPaths[0]) ? [...entries] : [],
        audioFiles: (!isMulti && p === inputPaths[0]) ? [...audioFiles] : [],
        srtFileForVideo: '',
        outputDir: inputType === 'draft'
          ? `${p}/caption_output`
          : p.replace(/[^/\\]+$/, 'caption_output'),
        name: p.split(/[/\\]/).pop() || 'Unknown',
      });
    }

    // failedFolders: các folder đã có lỗi (step-first: bỏ qua bước tiếp theo của folder đó)
    const failedFolders = new Set<string>();

    // =========================================================
    // Helper: xử lý 1 step cho 1 folder
    // =========================================================
    const processStep = async (step: Step, currentPath: string, folderIdx: number): Promise<void> => {
      const ctx = folderCtxMap.get(currentPath)!;
      const { name: folderName, outputDir: processOutputDir } = ctx;
      let { entries: currentEntries, audioFiles: currentAudioFiles, srtFileForVideo } = ctx;

      const msgCtx = (base: string) => {
        if (!isMulti) return base;
        if (processingMode === 'step-first') {
          return `Bước ${step} [${folderIdx + 1}/${totalFolders}] ${folderName}: ${base}`;
        }
        return `[${folderIdx + 1}/${totalFolders}] ${folderName}: ${base}`;
      };

      setProgress({ current: 0, total: 100, message: msgCtx(`Bước ${step}: Bắt đầu...`) });

      // Tự động nạp dữ liệu (nếu người dùng skip Bước 1)
      if (currentEntries.length === 0 && step !== 1) {
        setProgress({ current: 0, total: 100, message: msgCtx('Đang tải dữ liệu cũ...') });
        const translatedSrtPath = `${processOutputDir}/srt/translated.srt`;
        try {
          // @ts-ignore
          const transResult = await window.electronAPI.caption.parseSrt(translatedSrtPath);
          if (transResult?.success && transResult?.data?.entries && transResult.data.entries.length > 0) {
            currentEntries = transResult.data.entries;
          }
        } catch (e) { /* ignore */ }

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
        if (!isMulti && currentEntries.length > 0) setEntries(currentEntries);
      }

      // Guard cho các bước cần có entries
      if (currentEntries.length === 0 && step !== 1 && step !== 7 && inputType !== 'srt') {
        throw new Error(`[${folderName}] Không có dữ liệu Subtitle! Vui lòng bắt đầu từ Bước 1.`);
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
        setProgress({ current: 1, total: 1, message: msgCtx('Bước 1: Đã load file input') });
      }

      // ========== STEP 2: SPLIT ==========
      if (step === 2) {
        setProgress({ current: 0, total: 1, message: msgCtx('Bước 2: Đang chia nhỏ text...') });
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
          setProgress({ current: 1, total: 1, message: msgCtx(`Bước 2: Đã tạo ${result.data.partsCount} phần`) });
        } else {
          throw new Error(`[${folderName}] Lỗi chia file: ${result.error}`);
        }
      }

      // ========== STEP 3: DỊCH ==========
      if (step === 3) {
        setProgress({ current: 0, total: currentEntries.length, message: msgCtx('Bước 3: Đang dịch...') });
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
          setProgress({ current: result.data.translatedLines, total: result.data.totalLines, message: msgCtx(`Bước 3: Đã dịch ${result.data.translatedLines} dòng`) });
        } else {
          throw new Error(`[${folderName}] Lỗi dịch: ${result.error}`);
        }
      }

      // ========== STEP 4: TTS ==========
      if (step === 4) {
        const audioDir = `${processOutputDir}/audio`;
        if (!isMulti) settings.setAudioDir(audioDir);
        setProgress({ current: 0, total: currentEntries.length, message: msgCtx('Bước 4: Đang tạo audio...') });
        // @ts-ignore
        const result = await window.electronAPI.tts.generate(currentEntries, {
          voice: settings.voice,
          rate: settings.rate,
          volume: settings.volume,
          outputDir: audioDir,
          outputFormat: 'wav',
        });
        if (result.success && result.data) {
          currentAudioFiles = normalizeAudioFiles(result.data.audioFiles as PartialProcessingAudioFile[]);
          if (!isMulti) setAudioFiles(currentAudioFiles);
          setProgress({ current: result.data.totalGenerated, total: currentEntries.length, message: msgCtx(`Bước 4: Đã tạo ${result.data.totalGenerated} audio`) });
        } else {
          throw new Error(`[${folderName}] Lỗi tạo audio: ${result.error}`);
        }
      }

      // ========== STEP 5: TRIM SILENCE ==========
      if (step === 5) {
        const filesToTrim = currentAudioFiles;
        if (filesToTrim.length > 0) {
          setProgress({ current: 0, total: filesToTrim.length, message: msgCtx('Bước 5: Đang cắt khoảng lặng...') });
          // @ts-ignore
          const result = await window.electronAPI.tts.trimSilence(filesToTrim.map(f => f.path));
          // @ts-ignore
          const resultEnd = await window.electronAPI.tts.trimSilenceEnd(filesToTrim.map(f => f.path));
          if (result.success && result.data && resultEnd.success && resultEnd.data) {
            setProgress({ current: resultEnd.data.trimmedCount, total: filesToTrim.length, message: msgCtx(`Bước 5: Đã trim ${resultEnd.data.trimmedCount} files`) });
          } else {
            throw new Error(`[${folderName}] Lỗi trim silence: ${result.error || resultEnd.error}`);
          }
        }
      }

      // ========== STEP 6: MERGE AUDIO ==========
      if (step === 6) {
        let filesToMerge = normalizeAudioFiles(currentAudioFiles);
        const audioDir = `${processOutputDir}/audio`;

        if (filesToMerge.length === 0) {
          setProgress({ current: 0, total: 1, message: msgCtx('Bước 6: Đang nạp lại danh sách audio từ thư mục...') });
          // @ts-ignore
          const hydrateResult = await window.electronAPI.tts.generate(currentEntries, {
            voice: settings.voice,
            rate: settings.rate,
            volume: settings.volume,
            outputDir: audioDir,
            outputFormat: 'wav',
          });
          if (hydrateResult.success && hydrateResult.data?.audioFiles) {
            currentAudioFiles = normalizeAudioFiles(hydrateResult.data.audioFiles as PartialProcessingAudioFile[]);
            filesToMerge = normalizeAudioFiles(currentAudioFiles);
            if (!isMulti) setAudioFiles(currentAudioFiles);
          }
        }

        if (filesToMerge.length === 0) {
          throw new Error(`[${folderName}] Không có audio hợp lệ để ghép trong ${audioDir}. Hãy chạy lại Bước 4.`);
        }

        if (settings.autoFitAudio) {
          setProgress({ current: 0, total: filesToMerge.length, message: msgCtx('Bước 6: Đang scale audio vừa thời lượng...') });
          const fitItems = filesToMerge
            .map(f => {
              const entryByIndex = currentEntries.find(e => e.index === f.index);
              const entryByStart = currentEntries.find(e => e.startMs === f.startMs);
              const allowedDurationMs = f.durationMs > 0
                ? f.durationMs
                : (entryByIndex?.durationMs || entryByStart?.durationMs || 0);
              return { path: f.path, durationMs: allowedDurationMs };
            })
            .filter(item => item.durationMs > 0);

          if (fitItems.length > 0) {
            // @ts-ignore
            const fitResult = await window.electronAPI.tts.fitAudio(fitItems);
            if (fitResult.success && fitResult.data) {
              const { scaledCount, pathMapping } = fitResult.data;
              setProgress({ current: scaledCount, total: fitItems.length, message: msgCtx(`Bước 6: Đã fit ${scaledCount}/${fitItems.length} files`) });
              for (const mapping of pathMapping) {
                const idx = filesToMerge.findIndex(f => f.path === mapping.originalPath);
                if (idx !== -1 && mapping.outputPath !== mapping.originalPath) {
                  filesToMerge[idx] = { ...filesToMerge[idx], path: mapping.outputPath, success: true };
                }
              }
            } else {
              console.warn(`[${folderName}] Cảnh báo fit audio: ${fitResult.error}`);
            }
          }
        }

        const mergedPath = `${processOutputDir}/merged_audio.wav`;
        setProgress({ current: 0, total: 1, message: msgCtx('Bước 6: Đang ghép audio...') });
        // @ts-ignore
        const result = await window.electronAPI.tts.mergeAudio(filesToMerge, mergedPath, settings.srtSpeed);
        if (result.success) {
          setProgress({ current: 1, total: 1, message: msgCtx('Bước 6: Đã ghép audio thành công') });
        } else {
          throw new Error(`[${folderName}] Lỗi ghép audio: ${result.error}`);
        }
      }

      // ========== STEP 7: RENDER VIDEO ==========
      if (step === 7) {
        setProgress({ current: 0, total: 100, message: msgCtx('Bước 7: Đang tìm video gốc tốt nhất...') });
        let finalVideoInputPath: string | undefined = undefined;
        const folderPathsToSearch = inputType === 'draft' ? [currentPath] : [currentPath.replace(/[^/\\]+$/, '')];
        // @ts-ignore
        const findBestRes = await window.electronAPI.captionVideo.findBestVideoInFolders(folderPathsToSearch);
        let stripWidth = 1080;
        let stripHeight = 1920;
        let targetDuration: number | undefined = undefined;

        if (findBestRes.success && findBestRes.data?.videoPath) {
          const foundVideo = findBestRes.data.videoPath;
          if (settings.renderMode === 'hardsub') {
            finalVideoInputPath = foundVideo;
            setProgress({ current: 5, total: 100, message: msgCtx(`Bước 7: Đã tìm thấy video ${foundVideo.split(/[/\\]/).pop()}`) });
          } else {
            setProgress({ current: 5, total: 100, message: msgCtx('Bước 7: Render nền đen (Chế độ màn hình)') });
          }
          try {
            // @ts-ignore
            const meta = await window.electronAPI.captionVideo.getVideoMetadata(foundVideo);
            if (meta && meta.success && meta.data) {
              stripWidth = meta.data.width;
              targetDuration = meta.data.duration;
              if (settings.renderMode === 'black_bg') {
                const realHeight = meta.data.actualHeight || 1080;
                stripHeight = Math.floor(realHeight / 10);
              } else {
                stripHeight = meta.data.actualHeight || meta.data.height;
              }
            }
          } catch (e) {
            console.warn('Không lấy được metadata video, dùng mặc định', e);
          }
        } else {
          if (settings.renderMode === 'black_bg') {
            setProgress({ current: 5, total: 100, message: msgCtx('Bước 7: Render nền đen (Chế độ màn hình)') });
          }
        }

        const srtScale = settings.srtSpeed > 0 ? settings.srtSpeed : 1.0;
        const scaleLabel = normalizeSpeedLabel(srtScale);
        const scaledSrtPath = `${processOutputDir}/srt/subtitle_${scaleLabel}x.srt`;

        if (currentEntries.length > 0) {
          const scaledEntries = buildScaledSubtitleEntries(currentEntries, srtScale);
          // @ts-ignore
          const scaledSrtResult = await window.electronAPI.caption.exportSrt(scaledEntries, scaledSrtPath);
          if (scaledSrtResult?.success) {
            srtFileForVideo = scaledSrtPath;
            console.log(`[CaptionProcessing] Dùng SRT scaled cho render: ${scaledSrtPath} (scale=${srtScale})`);
          }
        }

        if (!srtFileForVideo) {
          srtFileForVideo = inputType === 'srt' ? currentPath : `${processOutputDir}/srt/translated.srt`;
        }

        const finalVideoPath = `${processOutputDir}/final_video_${Date.now()}.mp4`;
        const timingContextPath = `${processOutputDir}/render_timing_context.json`;
        const step7AudioSpeed = settings.renderAudioSpeed && settings.renderAudioSpeed > 0
          ? settings.renderAudioSpeed : 1.0;

        try {
          // @ts-ignore
          await window.electronAPI.invoke('caption:saveJson', {
            filePath: timingContextPath,
            data: {
              generatedAt: new Date().toISOString(),
              step4SrtScale: srtScale,
              step7AudioSpeed,
              audioSpeedModel: 'step4_minus_step7_delta',
              srtPath: srtFileForVideo,
              audioPath: `${processOutputDir}/merged_audio.wav`,
            },
          });
        } catch (error) {
          console.warn(`[CaptionProcessing] Không thể lưu timing context JSON: ${timingContextPath}`, error);
        }

        setProgress({ current: 20, total: 100, message: msgCtx('Bước 7: Bắt đầu render video (có thể mất vài phút)...') });

        // @ts-ignore
        const renderRes = await window.electronAPI.captionVideo.renderVideo({
          srtPath: srtFileForVideo,
          outputPath: finalVideoPath,
          width: stripWidth,
          height: stripHeight,
          videoPath: finalVideoInputPath,
          targetDuration: settings.renderMode === 'hardsub' ? targetDuration : undefined,
          hardwareAcceleration: settings.hardwareAcceleration,
          style: settings.style,
          renderMode: settings.renderMode,
          renderResolution: settings.renderResolution,
          position: settings.subtitlePosition || undefined,
          blackoutTop: (settings.blackoutTop != null && settings.blackoutTop < 1)
            ? settings.blackoutTop : undefined,
          audioPath: `${processOutputDir}/merged_audio.wav`,
          audioSpeed: settings.renderAudioSpeed,
          step7AudioSpeedInput: step7AudioSpeed,
          srtTimeScale: srtScale,
          step4SrtScale: srtScale,
          timingContextPath,
          audioSpeedModel: 'step4_minus_step7_delta',
          ttsRate: settings.rate,
          videoVolume: settings.videoVolume,
          audioVolume: settings.audioVolume,
          logoPath: settings.logoPath,
          logoPosition: settings.logoPosition,
          logoScale: settings.logoScale,
        });

        if (renderRes.success) {
          setProgress({ current: 100, total: 100, message: msgCtx(`Bước 7: Đã render video thành công! (${renderRes.data?.duration?.toFixed(1)}s)`) });
        } else {
          throw new Error(`[${folderName}] Lỗi render video: ${renderRes.error}`);
        }
      }

      // Ghi lại state đã thay đổi vào ctx map
      ctx.entries = currentEntries;
      ctx.audioFiles = currentAudioFiles;
      ctx.srtFileForVideo = srtFileForVideo;
    };
    // =========================================================
    // END helper processStep
    // =========================================================

    try {
      if (processingMode === 'step-first' && isMulti) {
        // ===== STEP-FIRST MODE: vòng ngoài là step, vòng trong là folder =====
        for (const step of steps) {
          if (abortRef.current) break;
          setCurrentStep(step);
          setProgress({ current: 0, total: totalFolders, message: `Bước ${step}: Bắt đầu cho ${totalFolders} folder...` });

          for (let i = 0; i < inputPaths.length; i++) {
            if (abortRef.current) break;
            const currentPath = inputPaths[i];
            const ctx = folderCtxMap.get(currentPath)!;

            // Bỏ qua folder đã lỗi ở bước trước
            if (failedFolders.has(currentPath)) {
              setProgress({ current: i + 1, total: totalFolders, message: `Bước ${step} [${i + 1}/${totalFolders}] ⚠ Bỏ qua ${ctx.name} (đã lỗi trước đó)` });
              continue;
            }

            setCurrentFolder({ index: i + 1, total: totalFolders, name: ctx.name, path: currentPath });

            try {
              await processStep(step, currentPath, i);
              setProgress({ current: i + 1, total: totalFolders, message: `Bước ${step} [${i + 1}/${totalFolders}] ✓ ${ctx.name}` });
            } catch (err) {
              failedFolders.add(currentPath);
              console.error(`[Step-first] Bước ${step} lỗi tại ${ctx.name}:`, err);
              setProgress({ current: i + 1, total: totalFolders, message: `Bước ${step} [${i + 1}/${totalFolders}] ✗ ${ctx.name}: ${err}` });
            }
          }
        }

        // Tổng kết step-first
        const successCount = totalFolders - failedFolders.size;
        const failMsg = failedFolders.size > 0
          ? ` (${failedFolders.size} lỗi: ${Array.from(failedFolders).map(p => p.split(/[/\\]/).pop()).join(', ')})`
          : '';
        setStatus(failedFolders.size === totalFolders ? 'error' : 'success');
        setProgress({
          current: successCount,
          total: totalFolders,
          message: abortRef.current
            ? `Đã dừng. ${successCount}/${totalFolders} folder hoàn thành.`
            : `✓ Hoàn thành ${successCount}/${totalFolders} folder (Bước: ${steps.join(', ')})${failMsg}`,
        });

      } else {
        // ===== FOLDER-FIRST MODE (mặc định): vòng ngoài là folder, vòng trong là step =====
        for (let i = 0; i < inputPaths.length; i++) {
          if (abortRef.current) break;
          const currentPath = inputPaths[i];
          const ctx = folderCtxMap.get(currentPath)!;

          setCurrentFolder({ index: i + 1, total: totalFolders, name: ctx.name, path: currentPath });

          for (const step of steps) {
            if (abortRef.current) break;
            setCurrentStep(step);
            await processStep(step, currentPath, i);
          }

          if (isMulti) {
            setProgress({ current: i + 1, total: totalFolders, message: `[${i + 1}/${totalFolders}] ✓ Hoàn thành: ${ctx.name}` });
          }
        }

        setStatus('success');
        setProgress({
          current: totalFolders,
          total: totalFolders,
          message: abortRef.current
            ? `Đã dừng.`
            : isMulti
              ? `✓ Hoàn thành tất cả ${totalFolders} project! (Các bước: ${steps.join(', ')})`
              : `✓ Hoàn thành các bước: ${steps.join(', ')}`,
        });
      }
    } catch (err) {
      setStatus('error');
      setProgress(p => ({ ...p, message: `Lỗi: ${err}` }));
      console.error(err);
    }

    setCurrentStep(null);
    setCurrentFolder(null);
  }, [
    enabledSteps, entries, filePath, inputType, captionFolder,
    settings, audioFiles,
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
    currentFolder,
  };
}
