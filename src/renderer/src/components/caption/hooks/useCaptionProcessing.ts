import { useState, useCallback, useRef } from 'react';
import { Step, ProcessStatus, SubtitleEntry, TranslationProgress, TTSProgress, ProcessingMode, StepDependencyIssue } from '../CaptionTypes';
import { CaptionSessionV1, CaptionStepNumber, CaptionProjectSettingsValues } from '@shared/types/caption';
import { getCaptionSessionPathFromOutputDir, nowIso } from '@shared/utils/captionSession';
import {
  buildEntriesFingerprint,
  buildObjectFingerprint,
  canRunStep,
  compactEntries,
  getSessionPathForInputPath,
  makeStepError,
  makeStepRunning,
  makeStepSuccess,
  markFollowingStepsStale,
  readCaptionSession,
  resolveStepInputsFromSession,
  syncSessionWithProjectSettings,
  toStepKey,
  updateCaptionSession,
} from './captionSessionStore';

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
  projectId?: string | null;
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
    renderMode: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
    renderResolution: 'original' | '1080p' | '720p' | '540p' | '360p';
    subtitlePosition?: { x: number; y: number } | null;
    blackoutTop?: number | null;
    autoFitAudio: boolean;
    audioSpeed?: number;
    renderAudioSpeed?: number;
    videoVolume?: number;
    audioVolume?: number;
    logoPath?: string;
    logoPosition?: { x: number; y: number } | null;
    logoScale?: number;
    portraitForegroundCropPercent?: number;
    processingMode?: ProcessingMode;
    translateMethod?: 'api' | 'impit';
    thumbnailFrameTimeSec?: number | null;
    thumbnailText?: string;
    thumbnailFontName?: string;
    thumbnailTextsByOrder?: string[];
    layoutProfiles?: CaptionProjectSettingsValues['layoutProfiles'];
    settingsRevision?: number;
    settingsUpdatedAt?: string;
  };
  enabledSteps: Set<Step>;
  setEnabledSteps: React.Dispatch<React.SetStateAction<Set<Step>>>;
}

function entriesToSrtText(entries: SubtitleEntry[]): string {
  if (!entries.length) {
    return '';
  }
  const blocks = entries.map((entry, idx) => {
    const startTime = entry.startTime || msToSrtTime(entry.startMs);
    const endTime = entry.endTime || msToSrtTime(entry.endMs);
    const text = (entry.translatedText ?? entry.text ?? '').replace(/\r\n/g, '\n').trimEnd();
    return `${idx + 1}\n${startTime} --> ${endTime}\n${text}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

function resolveProcessOutputDir(inputType: string, currentPath: string): string {
  return inputType === 'draft'
    ? `${currentPath}/caption_output`
    : currentPath.replace(/[^/\\]+$/, 'caption_output');
}

export function useCaptionProcessing({
  projectId,
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
  const [stepDependencyIssues, setStepDependencyIssues] = useState<StepDependencyIssue[]>([]);
  
  // State for intermediate data
  const [audioFiles, setAudioFiles] = useState<ProcessingAudioFile[]>([]);

  // Ref cho abort flag — cho phép handleStop() dừng vòng lặp đang chạy
  const abortRef = useRef(false);

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
    setStepDependencyIssues([]);
    const runLockedSettings = {
      ...settings,
      style: settings.style ? { ...settings.style } : settings.style,
      subtitlePosition: settings.subtitlePosition ? { ...settings.subtitlePosition } : settings.subtitlePosition,
      logoPosition: settings.logoPosition ? { ...settings.logoPosition } : settings.logoPosition,
      thumbnailTextsByOrder: settings.thumbnailTextsByOrder ? [...settings.thumbnailTextsByOrder] : [],
      thumbnailText: settings.thumbnailText || '',
    };
    const cfg = runLockedSettings;
    const processingMode = cfg.processingMode ?? 'folder-first';

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

    const inputPaths = filePath
      ? (inputType === 'draft' ? filePath.split('; ') : [filePath])
      : [];
    const totalFolders = inputPaths.length;
    if (totalFolders === 0) {
      setStatus('error');
      setProgress({ current: 0, total: 0, message: 'Chưa có input để xử lý.' });
      return;
    }
    const isMulti = totalFolders > 1;
    const step7Enabled = steps.includes(7);
    const thumbnailEnabled = cfg.thumbnailFrameTimeSec !== null && cfg.thumbnailFrameTimeSec !== undefined;

    // Xóa audioFiles cũ khi chạy multi-folder để tránh dùng nhầm dữ liệu cũ
    if (isMulti) {
      setAudioFiles([]);
    }

    if (isMulti && step7Enabled && thumbnailEnabled) {
      const thumbnailTextsByOrder = cfg.thumbnailTextsByOrder || [];
      const missingFolders: string[] = [];

      for (let i = 0; i < inputPaths.length; i++) {
        const folderName = inputPaths[i].split(/[/\\]/).pop() || `Folder ${i + 1}`;
        const text = (thumbnailTextsByOrder[i] || '').trim();
        if (!text) {
          missingFolders.push(`[${i + 1}] ${folderName}`);
        }
      }

      if (thumbnailTextsByOrder.length !== totalFolders || missingFolders.length > 0) {
        const mismatchMsg = thumbnailTextsByOrder.length !== totalFolders
          ? `Số lượng text (${thumbnailTextsByOrder.length}) không khớp số folder (${totalFolders}).`
          : '';
        const missingMsg = missingFolders.length > 0
          ? `Thiếu text cho: ${missingFolders.join(', ')}.`
          : '';
        const finalMessage = `Lỗi cấu hình thumbnail multi-folder. ${mismatchMsg} ${missingMsg}`.trim();
        setStatus('error');
        setCurrentStep(null);
        setCurrentFolder(null);
        setProgress({ current: 0, total: totalFolders, message: finalMessage });
        return;
      }
    }

    const preflightIssues: StepDependencyIssue[] = [];
    for (const currentPath of inputPaths) {
      const folderName = currentPath.split(/[/\\]/).pop() || 'Unknown';
      const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
      const sessionFallback = {
        projectId,
        inputType: inputType as 'srt' | 'draft',
        sourcePath: currentPath,
        folderPath: inputType === 'draft' ? currentPath : currentPath.replace(/[^/\\]+$/, ''),
      };
      const session = await readCaptionSession(sessionPath, sessionFallback);
      for (const step of steps) {
        const plannedEnabled = steps.filter((s) => s <= step) as CaptionStepNumber[];
        const guard = canRunStep(session, step as CaptionStepNumber, plannedEnabled);
        if (!guard.ok) {
          preflightIssues.push({
            step,
            folderPath: currentPath,
            folderName,
            code: guard.code || `STEP${step}_BLOCKED`,
            reason: guard.reason || 'Thiếu dữ liệu phụ thuộc trong caption_session.json.',
            missingDeps: guard.missingDeps as Step[],
          });
        }
      }
    }

    if (preflightIssues.length > 0) {
      const topIssue = preflightIssues[0];
      const details = preflightIssues
        .slice(0, 5)
        .map((issue) => `[${issue.folderName}] Step ${issue.step}: ${issue.reason}`)
        .join(' | ');
      setStepDependencyIssues(preflightIssues);
      setStatus('error');
      setCurrentStep(null);
      setCurrentFolder(null);
      setProgress({
        current: 0,
        total: totalFolders,
        message: `Preflight fail: ${topIssue.reason} (${details})`,
      });
      return;
    }
    setStepDependencyIssues([]);

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
        entries: [],
        audioFiles: [],
        srtFileForVideo: '',
        outputDir: resolveProcessOutputDir(inputType, p),
        name: p.split(/[/\\]/).pop() || 'Unknown',
      });
    }

    // failedFolders: các folder đã có lỗi (step-first: bỏ qua bước tiếp theo của folder đó)
    const failedFolders = new Set<string>();

    const buildSettingsSnapshot = (folderIdx: number): Record<string, unknown> => ({
      step2Split: {
        splitByLines: cfg.splitByLines,
        linesPerFile: cfg.linesPerFile,
        numberOfParts: cfg.numberOfParts,
      },
      step3Translate: {
        geminiModel: cfg.geminiModel,
        translateMethod: cfg.translateMethod || 'api',
      },
      step4Tts: {
        voice: cfg.voice,
        rate: cfg.rate,
        volume: cfg.volume,
        srtSpeed: cfg.srtSpeed,
        autoFitAudio: cfg.autoFitAudio,
      },
      step7Render: {
        renderMode: cfg.renderMode,
        renderResolution: cfg.renderResolution,
        hardwareAcceleration: cfg.hardwareAcceleration,
        renderAudioSpeed: cfg.renderAudioSpeed,
        videoVolume: cfg.videoVolume,
        audioVolume: cfg.audioVolume,
        style: cfg.style,
        thumbnailFrameTimeSec: cfg.thumbnailFrameTimeSec,
        thumbnailText: isMulti
          ? (cfg.thumbnailTextsByOrder?.[folderIdx] || '').trim()
          : (cfg.thumbnailText || '').trim(),
        thumbnailFontName: cfg.thumbnailFontName,
        portraitForegroundCropPercent: cfg.portraitForegroundCropPercent,
        logoPath: cfg.logoPath,
        logoPosition: cfg.logoPosition,
        logoScale: cfg.logoScale,
      },
      settingsRevision: cfg.settingsRevision,
      settingsUpdatedAt: cfg.settingsUpdatedAt,
      enabledSteps: steps,
      processingMode,
    });

    const projectSettingsForRun: CaptionProjectSettingsValues = {
      inputType: inputType as 'srt' | 'draft',
      geminiModel: cfg.geminiModel,
      translateMethod: cfg.translateMethod,
      voice: cfg.voice,
      rate: cfg.rate,
      volume: cfg.volume,
      srtSpeed: cfg.srtSpeed,
      splitByLines: cfg.splitByLines,
      linesPerFile: cfg.linesPerFile,
      numberOfParts: cfg.numberOfParts,
      enabledSteps: steps,
      audioDir: cfg.audioDir,
      autoFitAudio: cfg.autoFitAudio,
      hardwareAcceleration: cfg.hardwareAcceleration,
      style: cfg.style,
      renderMode: cfg.renderMode,
      renderResolution: cfg.renderResolution,
      blackoutTop: cfg.blackoutTop,
      audioSpeed: cfg.audioSpeed,
      renderAudioSpeed: cfg.renderAudioSpeed,
      videoVolume: cfg.videoVolume,
      audioVolume: cfg.audioVolume,
      thumbnailFontName: cfg.thumbnailFontName,
      subtitlePosition: cfg.subtitlePosition,
      thumbnailFrameTimeSec: cfg.thumbnailFrameTimeSec,
      layoutProfiles: cfg.layoutProfiles,
      portraitForegroundCropPercent: cfg.portraitForegroundCropPercent,
      processingMode: cfg.processingMode,
    };

    const updateSessionForStep = async (
      currentPath: string,
      step: Step,
      folderIdx: number,
      updater: (session: CaptionSessionV1) => CaptionSessionV1
    ) => {
      const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
      const folderPath = inputType === 'draft' ? currentPath : currentPath.replace(/[^/\\]+$/, '');
      await updateCaptionSession(
        sessionPath,
        (session) => updater({
          ...session,
          updatedAt: nowIso(),
          projectContext: {
            ...session.projectContext,
            projectId: projectId || null,
            inputType: inputType as 'srt' | 'draft',
            sourcePath: currentPath,
            folderPath,
          },
          runtime: {
            ...session.runtime,
            enabledSteps: steps,
            processingMode,
            currentStep: step,
            progress,
          },
          settings: {
            ...session.settings,
            ...buildSettingsSnapshot(folderIdx),
          },
        }),
        {
          projectId,
          inputType: inputType as 'srt' | 'draft',
          sourcePath: currentPath,
          folderPath,
        }
      );
    };

    // =========================================================
    // Helper: xử lý 1 step cho 1 folder
    // =========================================================
    const processStep = async (step: Step, currentPath: string, folderIdx: number): Promise<void> => {
      const ctx = folderCtxMap.get(currentPath)!;
      const { name: folderName, outputDir: processOutputDir } = ctx;
      let { entries: currentEntries, audioFiles: currentAudioFiles, srtFileForVideo } = ctx;
      const stepKey = toStepKey(step);

      const msgCtx = (base: string) => {
        if (!isMulti) return base;
        if (processingMode === 'step-first') {
          return `Bước ${step} [${folderIdx + 1}/${totalFolders}] ${folderName}: ${base}`;
        }
        return `[${folderIdx + 1}/${totalFolders}] ${folderName}: ${base}`;
      };

      try {
        const sessionPath = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        const sessionFallback = {
          projectId,
          inputType: inputType as 'srt' | 'draft',
          sourcePath: currentPath,
          folderPath: inputType === 'draft' ? currentPath : currentPath.replace(/[^/\\]+$/, ''),
        };
        const sessionBeforeStep = await readCaptionSession(sessionPath, sessionFallback);
        const guard = canRunStep(sessionBeforeStep, step as CaptionStepNumber);
        if (!guard.ok) {
          throw new Error(`[${folderName}] ${guard.reason || `Chưa chạy các bước phụ thuộc cho Step ${step}.`} (${guard.code || 'STEP_BLOCKED'})`);
        }
        if (step === 6 && steps.includes(5) && sessionBeforeStep.steps.step5?.status !== 'success') {
          throw new Error(`[${folderName}] Step 6 yêu cầu Step 5 đã hoàn thành trong session khi bạn bật Step 5.`);
        }

        const stepInputs = resolveStepInputsFromSession(sessionBeforeStep, step as CaptionStepNumber);
        if (step !== 1) {
          if (step === 2 || step === 3) {
            currentEntries = compactEntries(stepInputs.extractedEntries);
          } else if (step === 4 || step === 6 || step === 7) {
            currentEntries = compactEntries(stepInputs.translatedEntries);
          }
          if (step >= 4 && step <= 6) {
            currentAudioFiles = normalizeAudioFiles(stepInputs.ttsAudioFiles as PartialProcessingAudioFile[]);
          }
          if (step === 7) {
            srtFileForVideo = stepInputs.scaledSrtPath || stepInputs.translatedSrtPath || '';
          }
          if (!isMulti && currentEntries.length > 0) {
            setEntries(currentEntries);
          }
        }

        let currentDataSource = 'session';
        if (step === 2 || step === 3) currentDataSource = 'session_extracted_entries';
        if (step === 4) currentDataSource = 'session_translated_entries';
        if (step === 5 || step === 6) currentDataSource = 'session_tts_audio_files';
        if (step === 7) currentDataSource = 'session_translated_entries+session_merged_audio';

        setProgress({ current: 0, total: 100, message: msgCtx(`Bước ${step}: Bắt đầu...`) });
        await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
          ...session,
          runtime: {
            ...session.runtime,
            currentDataSource,
            lastGuardError: undefined,
          },
          steps: {
            ...session.steps,
            [stepKey]: makeStepRunning(session.steps[stepKey], buildSettingsSnapshot(folderIdx)),
          },
        }));

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
        await updateSessionForStep(currentPath, step, folderIdx, (session) => {
          const extractedEntries = compactEntries(currentEntries);
          const outputFingerprint = buildEntriesFingerprint(extractedEntries);
          const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
          let nextSession: CaptionSessionV1 = {
            ...session,
            data: {
              ...session.data,
              extractedEntries,
            },
            steps: {
              ...session.steps,
              [stepKey]: {
                ...makeStepSuccess(session.steps[stepKey], {
                  totalEntries: currentEntries.length,
                }),
                outputFingerprint,
                inputFingerprint: buildObjectFingerprint({
                  currentPath,
                  inputType,
                }),
                dependsOn: [],
              },
            },
          };
          if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
            nextSession = markFollowingStepsStale(
              nextSession,
              step,
              'STEP1_OUTPUT_CHANGED',
              steps as CaptionStepNumber[]
            );
          }
          return nextSession;
        });
      }

      // ========== STEP 2: SPLIT ==========
      if (step === 2) {
        if (currentEntries.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu Step 1 trong caption_session.json. Hãy chạy Step 1 trước.`);
        }
        setProgress({ current: 0, total: 1, message: msgCtx('Bước 2: Đang chia nhỏ text...') });
        const textOutputDir = `${processOutputDir}/text`;
        const splitValue = cfg.splitByLines ? cfg.linesPerFile : cfg.numberOfParts;
        // @ts-ignore
        const result = await window.electronAPI.caption.split({
          entries: currentEntries,
          splitByLines: cfg.splitByLines,
          value: splitValue,
          outputDir: textOutputDir,
        });
        if (result.success && result.data) {
          const splitData = result.data;
          setProgress({ current: 1, total: 1, message: msgCtx(`Bước 2: Đã tạo ${splitData.partsCount} phần`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
            ...session,
            steps: {
              ...session.steps,
              [stepKey]: {
                ...makeStepSuccess(session.steps[stepKey], {
                  partsCount: splitData.partsCount,
                  files: splitData.files,
                }),
                inputFingerprint: buildEntriesFingerprint((session.data.extractedEntries || []) as SubtitleEntry[]),
                outputFingerprint: buildObjectFingerprint({
                  partsCount: splitData.partsCount,
                  files: splitData.files,
                }),
                dependsOn: [1],
              },
            },
          }));
        } else {
          throw new Error(`[${folderName}] Lỗi chia file: ${result.error}`);
        }
      }

      // ========== STEP 3: DỊCH ==========
      if (step === 3) {
        if (currentEntries.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu Step 1 trong caption_session.json. Hãy chạy Step 1 trước.`);
        }
        setProgress({ current: 0, total: currentEntries.length, message: msgCtx('Bước 3: Đang dịch...') });
        // @ts-ignore
        const result = await window.electronAPI.caption.translate({
          entries: currentEntries,
          targetLanguage: 'Vietnamese',
          model: cfg.geminiModel,
          linesPerBatch: 50,
          translateMethod: cfg.translateMethod,
        });
        if (result.success && result.data) {
          const translateData = result.data;
          currentEntries = translateData.entries;
          if (!isMulti) setEntries(currentEntries);
          srtFileForVideo = `${processOutputDir}/srt/translated.srt`;
          const translatedSrtContent = entriesToSrtText(currentEntries);
          // @ts-ignore
          await window.electronAPI.caption.exportSrt(currentEntries, srtFileForVideo);
          setProgress({ current: translateData.translatedLines, total: translateData.totalLines, message: msgCtx(`Bước 3: Đã dịch ${translateData.translatedLines} dòng`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const translatedEntries = compactEntries(currentEntries);
            const inputFingerprint = buildEntriesFingerprint((session.data.extractedEntries || []) as SubtitleEntry[]);
            const outputFingerprint = buildEntriesFingerprint(translatedEntries);
            const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                translatedEntries,
                translatedSrtContent,
              },
              artifacts: {
                ...session.artifacts,
                translatedSrtPath: srtFileForVideo,
              },
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    totalLines: translateData.totalLines,
                    translatedLines: translateData.translatedLines,
                    failedLines: translateData.failedLines,
                  }),
                  inputFingerprint,
                  outputFingerprint,
                  dependsOn: [1],
                },
              },
            };
            if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
              nextSession = markFollowingStepsStale(
                nextSession,
                step,
                'STEP3_OUTPUT_CHANGED',
                steps as CaptionStepNumber[]
              );
            }
            return nextSession;
          });
        } else {
          throw new Error(`[${folderName}] Lỗi dịch: ${result.error}`);
        }
      }

      // ========== STEP 4: TTS ==========
      if (step === 4) {
        if (currentEntries.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu dịch trong caption_session.json. Hãy chạy Step 3 trước.`);
        }
        const audioDir = `${processOutputDir}/audio`;
        if (!isMulti) cfg.setAudioDir(audioDir);
        setProgress({ current: 0, total: currentEntries.length, message: msgCtx('Bước 4: Đang tạo audio...') });
        // @ts-ignore
        const result = await window.electronAPI.tts.generate(currentEntries, {
          voice: cfg.voice,
          rate: cfg.rate,
          volume: cfg.volume,
          outputDir: audioDir,
          outputFormat: 'wav',
        });
        if (result.success && result.data) {
          const ttsData = result.data;
          currentAudioFiles = normalizeAudioFiles(ttsData.audioFiles as PartialProcessingAudioFile[]);
          if (!isMulti) setAudioFiles(currentAudioFiles);
          setProgress({ current: ttsData.totalGenerated, total: currentEntries.length, message: msgCtx(`Bước 4: Đã tạo ${ttsData.totalGenerated} audio`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const outputFingerprint = buildObjectFingerprint(
              currentAudioFiles.map((file) => ({
                index: file.index,
                path: file.path,
                startMs: file.startMs,
                durationMs: file.durationMs,
              }))
            );
            const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                ttsAudioFiles: currentAudioFiles,
              },
              artifacts: {
                ...session.artifacts,
                audioDir,
              },
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    totalGenerated: ttsData.totalGenerated,
                    totalFailed: ttsData.totalFailed,
                  }),
                  inputFingerprint: buildEntriesFingerprint((session.data.translatedEntries || []) as SubtitleEntry[]),
                  outputFingerprint,
                  dependsOn: [3],
                },
              },
            };
            if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
              nextSession = markFollowingStepsStale(
                nextSession,
                step,
                'STEP4_OUTPUT_CHANGED',
                steps as CaptionStepNumber[]
              );
            }
            return nextSession;
          });
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
            await updateSessionForStep(currentPath, step, folderIdx, (session) => {
              const inputFingerprint = buildObjectFingerprint(
                filesToTrim.map((file) => ({
                  path: file.path,
                  startMs: file.startMs,
                  durationMs: file.durationMs,
                }))
              );
              const outputFingerprint = buildObjectFingerprint({
                trimmedMiddle: result.data,
                trimmedEnd: resultEnd.data,
              });
              const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
              let nextSession: CaptionSessionV1 = {
                ...session,
                data: {
                  ...session.data,
                  trimResults: {
                    trimmedMiddle: result.data,
                    trimmedEnd: resultEnd.data,
                  },
                },
                steps: {
                  ...session.steps,
                  [stepKey]: {
                    ...makeStepSuccess(session.steps[stepKey], {
                      totalFiles: filesToTrim.length,
                      trimmedCount: resultEnd.data.trimmedCount,
                    }),
                    inputFingerprint,
                    outputFingerprint,
                    dependsOn: [4],
                  },
                },
              };
              if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
                nextSession = markFollowingStepsStale(
                  nextSession,
                  step,
                  'STEP5_OUTPUT_CHANGED',
                  steps as CaptionStepNumber[]
                );
              }
              return nextSession;
            });
          } else {
            throw new Error(`[${folderName}] Lỗi trim silence: ${result.error || resultEnd.error}`);
          }
        } else {
          await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
            ...session,
            steps: {
              ...session.steps,
              [stepKey]: {
                ...makeStepSuccess(session.steps[stepKey], {
                  totalFiles: 0,
                  skipped: true,
                }),
                inputFingerprint: buildObjectFingerprint([]),
                outputFingerprint: buildObjectFingerprint({ skipped: true }),
                dependsOn: [4],
              },
            },
          }));
        }
      }

      // ========== STEP 6: MERGE AUDIO ==========
      if (step === 6) {
        let filesToMerge = normalizeAudioFiles(currentAudioFiles);

        if (filesToMerge.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu audio từ Step 4 trong caption_session.json. Hãy chạy Step 4 trước.`);
        }

        if (cfg.autoFitAudio) {
          if (currentEntries.length === 0) {
            throw new Error(`[${folderName}] Thiếu dữ liệu subtitle dịch trong session để fit audio. Hãy chạy Step 3 trước.`);
          }
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
        const result = await window.electronAPI.tts.mergeAudio(filesToMerge, mergedPath, cfg.srtSpeed);
        if (result.success) {
          setProgress({ current: 1, total: 1, message: msgCtx('Bước 6: Đã ghép audio thành công') });
          const mergeResultPayload: Record<string, unknown> = result.data
            ? {
                success: !!result.data.success,
                outputPath: result.data.outputPath,
                error: result.data.error,
              }
            : { success: true, outputPath: mergedPath };
          await updateSessionForStep(currentPath, step, folderIdx, (session) => {
            const outputFingerprint = buildObjectFingerprint({
              mergedPath,
              filesCount: filesToMerge.length,
              srtSpeed: cfg.srtSpeed,
            });
            const prevOutputFingerprint = session.steps[stepKey]?.outputFingerprint;
            let nextSession: CaptionSessionV1 = {
              ...session,
              data: {
                ...session.data,
                mergeResult: mergeResultPayload,
              },
              artifacts: {
                ...session.artifacts,
                mergedAudioPath: mergedPath,
              },
              timing: {
                ...session.timing,
                step4SrtScale: cfg.srtSpeed > 0 ? cfg.srtSpeed : 1.0,
              },
              steps: {
                ...session.steps,
                [stepKey]: {
                  ...makeStepSuccess(session.steps[stepKey], {
                    mergedPath,
                    filesCount: filesToMerge.length,
                  }),
                  inputFingerprint: buildObjectFingerprint(filesToMerge.map((file) => ({
                    path: file.path,
                    startMs: file.startMs,
                    durationMs: file.durationMs,
                  }))),
                  outputFingerprint,
                  dependsOn: steps.includes(5) ? [4, 5] : [4],
                },
              },
            };
            if (prevOutputFingerprint && prevOutputFingerprint !== outputFingerprint) {
              nextSession = markFollowingStepsStale(
                nextSession,
                step,
                'STEP6_OUTPUT_CHANGED',
                steps as CaptionStepNumber[]
              );
            }
            return nextSession;
          });
        } else {
          throw new Error(`[${folderName}] Lỗi ghép audio: ${result.error}`);
        }
      }

      // ========== STEP 7: RENDER VIDEO ==========
      if (step === 7) {
        const sessionPathForStep7 = getSessionPathForInputPath(inputType as 'srt' | 'draft', currentPath);
        const sessionFallback = {
          projectId,
          inputType: inputType as 'srt' | 'draft',
          sourcePath: currentPath,
          folderPath: inputType === 'draft' ? currentPath : currentPath.replace(/[^/\\]+$/, ''),
        };
        const sessionBeforeRender = await readCaptionSession(sessionPathForStep7, sessionFallback);
        const targetRevision = cfg.settingsRevision && cfg.settingsRevision > 0 ? cfg.settingsRevision : 0;
        const currentRevision = sessionBeforeRender.effectiveSettingsRevision || 0;
        if (targetRevision > 0 && currentRevision < targetRevision) {
          await syncSessionWithProjectSettings(
            sessionPathForStep7,
            {
              projectSettings: projectSettingsForRun,
              revision: targetRevision,
              updatedAt: cfg.settingsUpdatedAt || nowIso(),
              source: 'project_default',
            },
            sessionFallback
          );
        }

        const sessionForRender = await readCaptionSession(sessionPathForStep7, sessionFallback);
        const step7Inputs = resolveStepInputsFromSession(sessionForRender, 7);
        const translatedEntriesForRender = compactEntries(step7Inputs.translatedEntries);
        const mergedAudioPathForRender = step7Inputs.mergedAudioPath;
        if (translatedEntriesForRender.length === 0) {
          throw new Error(`[${folderName}] Chưa có dữ liệu dịch trong caption_session.json. Hãy chạy Step 3 trước.`);
        }
        if (!mergedAudioPathForRender) {
          throw new Error(`[${folderName}] Chưa có merged audio trong caption_session.json. Hãy chạy Step 6 trước.`);
        }
        currentEntries = translatedEntriesForRender;
        if (!isMulti) {
          setEntries(translatedEntriesForRender);
        }

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
          if (cfg.renderMode === 'hardsub' || cfg.renderMode === 'hardsub_portrait_9_16') {
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
              if (cfg.renderMode === 'black_bg') {
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
          if (cfg.renderMode === 'black_bg') {
            setProgress({ current: 5, total: 100, message: msgCtx('Bước 7: Render nền đen (Chế độ màn hình)') });
          }
        }

        const srtScale = cfg.srtSpeed > 0 ? cfg.srtSpeed : 1.0;
        const scaleLabel = normalizeSpeedLabel(srtScale);
        const scaledSrtPath = `${processOutputDir}/srt/subtitle_${scaleLabel}x.srt`;

        const scaledEntries = buildScaledSubtitleEntries(translatedEntriesForRender, srtScale);
        // @ts-ignore
        const scaledSrtResult = await window.electronAPI.caption.exportSrt(scaledEntries, scaledSrtPath);
        if (scaledSrtResult?.success) {
          srtFileForVideo = scaledSrtPath;
          console.log(`[CaptionProcessing] Dùng SRT scaled cho render: ${scaledSrtPath} (scale=${srtScale}, source=session_translated_entries)`);
        } else {
          throw new Error(`[${folderName}] Không thể tạo SRT scaled từ dữ liệu dịch trong session.`);
        }

        const finalVideoPath = `${processOutputDir}/final_video_${Date.now()}.mp4`;
        const timingContextPath = getCaptionSessionPathFromOutputDir(processOutputDir);
        const step7AudioSpeed = cfg.renderAudioSpeed && cfg.renderAudioSpeed > 0
          ? cfg.renderAudioSpeed : 1.0;
        await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
          ...session,
          artifacts: {
            ...session.artifacts,
            translatedSrtPath: session.artifacts.translatedSrtPath,
            scaledSrtPath: srtFileForVideo,
            mergedAudioPath: mergedAudioPathForRender,
          },
          timing: {
            ...session.timing,
            step4SrtScale: srtScale,
            step7AudioSpeed,
            audioSpeedModel: 'step4_minus_step7_delta',
          },
        }));

        setProgress({ current: 20, total: 100, message: msgCtx('Bước 7: Bắt đầu render video (có thể mất vài phút)...') });

        const thumbnailTextForRender = isMulti
          ? (cfg.thumbnailTextsByOrder?.[folderIdx] || '').trim()
          : (cfg.thumbnailText || '').trim();
        console.log(
          `[CaptionProcessing][Step7][Thumbnail] folderIdx=${folderIdx + 1}/${totalFolders}, folder=${folderName}, text="${thumbnailTextForRender}"`
        );

        // @ts-ignore
        const renderRes = await window.electronAPI.captionVideo.renderVideo({
          srtPath: srtFileForVideo,
          outputPath: finalVideoPath,
          width: stripWidth,
          height: stripHeight,
          videoPath: finalVideoInputPath,
          targetDuration: (cfg.renderMode === 'hardsub' || cfg.renderMode === 'hardsub_portrait_9_16')
            ? targetDuration
            : undefined,
          hardwareAcceleration: cfg.hardwareAcceleration,
          style: cfg.style,
          renderMode: cfg.renderMode,
          renderResolution: cfg.renderResolution,
          position: cfg.subtitlePosition || undefined,
          blackoutTop: (cfg.blackoutTop != null && cfg.blackoutTop < 1)
            ? cfg.blackoutTop : undefined,
          audioPath: mergedAudioPathForRender,
          audioSpeed: cfg.renderAudioSpeed,
          step7AudioSpeedInput: step7AudioSpeed,
          srtTimeScale: srtScale,
          step4SrtScale: srtScale,
          timingContextPath,
          audioSpeedModel: 'step4_minus_step7_delta',
          ttsRate: cfg.rate,
          videoVolume: cfg.videoVolume,
          audioVolume: cfg.audioVolume,
          logoPath: cfg.logoPath,
          logoPosition: cfg.logoPosition,
          logoScale: cfg.logoScale,
          portraitForegroundCropPercent: cfg.portraitForegroundCropPercent,
          thumbnailEnabled,
          thumbnailTimeSec: cfg.thumbnailFrameTimeSec ?? undefined,
          thumbnailText: thumbnailTextForRender,
          thumbnailFontName: cfg.thumbnailFontName,
          step7SubtitleSource: 'session_translated_entries',
          step7AudioSource: 'session_merged_audio',
        });

        if (renderRes.success) {
          const renderedPath = renderRes.data?.outputPath || finalVideoPath;
          const timingPayload = renderRes.data?.timingPayload && typeof renderRes.data.timingPayload === 'object'
            ? renderRes.data.timingPayload as Record<string, unknown>
            : undefined;
          let timingFromRender: Record<string, unknown> = {};
          if (timingPayload) {
            const parsed = timingPayload as Record<string, any>;
            const afterScale = (parsed.afterScale && typeof parsed.afterScale === 'object')
              ? parsed.afterScale as Record<string, unknown>
              : {};
            timingFromRender = {
              step4SrtScale: typeof afterScale.step4SrtScale === 'number' ? afterScale.step4SrtScale : undefined,
              step7AudioSpeed: typeof afterScale.step7AudioSpeedInput === 'number' ? afterScale.step7AudioSpeedInput : undefined,
              audioEffectiveSpeed: typeof afterScale.audioEffectiveSpeed === 'number' ? afterScale.audioEffectiveSpeed : undefined,
              videoSubBaseDuration: typeof afterScale.videoWithSubtitleDurationAfterStep4ScaleSec === 'number'
                ? afterScale.videoWithSubtitleDurationAfterStep4ScaleSec
                : undefined,
              videoSpeedMultiplier: typeof afterScale.videoSpeedNeeded === 'number' ? afterScale.videoSpeedNeeded : undefined,
              videoMarkerSec: typeof afterScale.videoMarkerSec === 'number' ? afterScale.videoMarkerSec : undefined,
            };
            console.log(`[CaptionProcessing][Step7] Đã nhận timing payload từ backend cho ${folderName}.`);
          } else {
            console.warn(`[CaptionProcessing][Step7] Backend không trả timing payload cho ${folderName}.`);
          }
          setProgress({ current: 100, total: 100, message: msgCtx(`Bước 7: Đã render video thành công! (${renderRes.data?.duration?.toFixed(1)}s)`) });
          await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
            ...session,
            data: {
              ...session.data,
              renderResult: {
                success: true,
                outputPath: renderedPath,
                duration: renderRes.data?.duration || 0,
                renderAt: nowIso(),
              },
              renderTimingPayload: timingPayload,
              step7SubtitleSource: 'session_translated_entries',
              step7AudioSource: 'session_merged_audio',
            },
            artifacts: {
              ...session.artifacts,
              finalVideoPath: renderedPath,
            },
            timing: {
              ...session.timing,
              ...timingFromRender,
            },
            steps: {
              ...session.steps,
              [stepKey]: {
                ...makeStepSuccess(session.steps[stepKey], {
                  duration: renderRes.data?.duration || 0,
                  outputPath: renderedPath,
                }),
                inputFingerprint: buildObjectFingerprint({
                  translatedEntries: translatedEntriesForRender.map((entry) => ({
                    index: entry.index,
                    startMs: entry.startMs,
                    endMs: entry.endMs,
                    translatedText: entry.translatedText,
                    text: entry.text,
                  })),
                  mergedAudioPath: mergedAudioPathForRender,
                  srtScale,
                }),
                outputFingerprint: buildObjectFingerprint({
                  outputPath: renderedPath,
                  duration: renderRes.data?.duration || 0,
                }),
                dependsOn: [3, 6],
              },
            },
          }));
          console.log(`[CaptionProcessing][Step7] Đã lưu timing payload vào caption_session.json cho ${folderName}.`);
        } else {
          throw new Error(`[${folderName}] Lỗi render video: ${renderRes.error}`);
        }
      }

        // Ghi lại state đã thay đổi vào ctx map
        ctx.entries = currentEntries;
        ctx.audioFiles = currentAudioFiles;
        ctx.srtFileForVideo = srtFileForVideo;
      } catch (error) {
        await updateSessionForStep(currentPath, step, folderIdx, (session) => ({
          ...session,
          steps: {
            ...session.steps,
            [stepKey]: makeStepError(session.steps[stepKey], String(error)),
          },
          runtime: {
            ...session.runtime,
            lastMessage: String(error),
            lastGuardError: String(error),
          },
        }));
        throw error;
      }
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
        setStepDependencyIssues([]);
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
        setStepDependencyIssues([]);
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
    projectId, enabledSteps, entries, filePath, inputType, captionFolder,
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
    stepDependencyIssues,
  };
}
