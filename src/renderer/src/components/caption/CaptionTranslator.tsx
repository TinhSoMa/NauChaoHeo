import { useState, useEffect, useMemo } from 'react';
import styles from './CaptionTranslator.module.css';
import { Button } from '../common/Button';
import folderIconUrl from '../../../../../resources/icons/folder.svg';
import videoIconUrl from '../../../../../resources/icons/video.svg';
import { Input } from '../common/Input';
import { RadioButton } from '../common/RadioButton';
import { Checkbox } from '../common/Checkbox';
import { useProjectContext } from '../../context/ProjectContext';
import {
  GEMINI_MODELS,
  VOICES,
  RATE_OPTIONS,
  VOLUME_OPTIONS,
  LINES_PER_FILE_OPTIONS,
} from '../../config/captionConfig';
import { CaptionStepPanelKey, HardsubTimingMetrics, Step, StepPanelState, SubtitleEntry } from './CaptionTypes';
import { useCaptionSettings } from './hooks/useCaptionSettings';
import { useCaptionFileManagement } from './hooks/useCaptionFileManagement';
import { useCaptionProcessing } from './hooks/useCaptionProcessing';
import { useHardsubSettings } from './hooks/useHardsubSettings';
import {
  getInputPaths,
  getSessionPathForInputPath,
  readCaptionSession,
  scheduleSessionSettingsRetry,
  syncSessionWithProjectSettings,
  updateCaptionSession,
} from './hooks/captionSessionStore';
import { HardsubSettingsPanel } from './components/HardsubSettingsPanel';
import { ThumbnailListPanel } from './components/ThumbnailListPanel';
import { SubtitlePreview } from './SubtitlePreview';
import { calculateHardsubTiming } from '@shared/utils/hardsubTiming';
import { ChevronDown, ChevronUp, Download, Eye, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { CaptionProjectSettingsValues } from '@shared/types/caption';

export function CaptionTranslator() {
  // Project output paths
  const { paths, projectId } = useProjectContext();
  const captionFolder = paths?.caption ?? null;

  // 1. Settings Hook
  const settings = useCaptionSettings();

  // 2. File Management Hook
  const fileManager = useCaptionFileManagement({
    inputType: settings.inputType,
  });

  const hardsubSettings = useHardsubSettings({
    inputType: settings.inputType,
    filePath: fileManager.filePath,
    folderVideos: fileManager.folderVideos,
    thumbnailEnabled: settings.thumbnailFrameTimeSec !== null && settings.thumbnailFrameTimeSec !== undefined,
  });

  const projectSettingsSnapshot = useMemo<CaptionProjectSettingsValues>(() => ({
    inputType: settings.inputType,
    geminiModel: settings.geminiModel,
    translateMethod: settings.translateMethod,
    voice: settings.voice,
    rate: settings.rate,
    volume: settings.volume,
    srtSpeed: settings.srtSpeed,
    splitByLines: settings.splitByLines,
    linesPerFile: settings.linesPerFile,
    numberOfParts: settings.numberOfParts,
    enabledSteps: Array.from(settings.enabledSteps.values()),
    audioDir: settings.audioDir,
    autoFitAudio: settings.autoFitAudio,
    hardwareAcceleration: settings.hardwareAcceleration,
    style: settings.style,
    renderMode: settings.renderMode,
    renderResolution: settings.renderResolution,
    blackoutTop: settings.blackoutTop,
    audioSpeed: settings.audioSpeed,
    renderAudioSpeed: settings.renderAudioSpeed,
    videoVolume: settings.videoVolume,
    audioVolume: settings.audioVolume,
    thumbnailFontName: settings.thumbnailFontName,
    thumbnailFontSize: settings.thumbnailFontSize,
    subtitlePosition: settings.subtitlePosition,
    thumbnailFrameTimeSec: settings.thumbnailFrameTimeSec,
    thumbnailDurationSec: settings.thumbnailDurationSec,
    portraitForegroundCropPercent: settings.portraitForegroundCropPercent,
    layoutProfiles: settings.layoutProfiles,
    processingMode: settings.processingMode,
  }), [
    settings.inputType,
    settings.geminiModel,
    settings.translateMethod,
    settings.voice,
    settings.rate,
    settings.volume,
    settings.srtSpeed,
    settings.splitByLines,
    settings.linesPerFile,
    settings.numberOfParts,
    settings.enabledSteps,
    settings.audioDir,
    settings.autoFitAudio,
    settings.hardwareAcceleration,
    settings.style,
    settings.renderMode,
    settings.renderResolution,
    settings.blackoutTop,
    settings.audioSpeed,
    settings.renderAudioSpeed,
    settings.videoVolume,
    settings.audioVolume,
    settings.thumbnailFontName,
    settings.thumbnailFontSize,
    settings.subtitlePosition,
    settings.thumbnailFrameTimeSec,
    settings.thumbnailDurationSec,
    settings.portraitForegroundCropPercent,
    settings.layoutProfiles,
    settings.processingMode,
  ]);

  // Chỉ hydrate field theo folder từ session: thumbnail text/list.
  useEffect(() => {
    const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
    if (!inputPaths.length) {
      return;
    }
    let cancelled = false;
    const hydrateFolderFields = async () => {
      if (inputPaths.length > 1) {
        const texts: string[] = [];
        for (const inputPath of inputPaths) {
          const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
          const session = await readCaptionSession(sessionPath, {
            projectId,
            inputType: settings.inputType,
            sourcePath: inputPath,
            folderPath: inputPath,
          });
          const step7 = (session.settings.step7Render || {}) as Record<string, unknown>;
          texts.push(typeof step7.thumbnailText === 'string' ? step7.thumbnailText : '');
        }
        if (!cancelled) {
          hardsubSettings.setThumbnailTextsByOrder(texts);
        }
        return;
      }

      const firstPath = inputPaths[0];
      const sessionPath = getSessionPathForInputPath(settings.inputType, firstPath);
      const session = await readCaptionSession(sessionPath, {
        projectId,
        inputType: settings.inputType,
        sourcePath: firstPath,
        folderPath: settings.inputType === 'draft' ? firstPath : firstPath.replace(/[^/\\]+$/, ''),
      });
      const step7 = (session.settings.step7Render || {}) as Record<string, unknown>;
      if (!cancelled) {
        hardsubSettings.setThumbnailText(typeof step7.thumbnailText === 'string' ? step7.thumbnailText : '');
      }
    };

    hydrateFolderFields().catch((error) => {
      console.warn('[CaptionTranslator] Không thể hydrate field theo folder từ session', error);
    });
    return () => {
      cancelled = true;
    };
  }, [fileManager.filePath, projectId, settings.inputType]);

  // Đồng bộ mirror settings revision từ project-default vào từng session folder.
  useEffect(() => {
    const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
    if (!inputPaths.length) return;

    const syncAll = async () => {
      for (const inputPath of inputPaths) {
        const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
        const fallback = {
          projectId,
          inputType: settings.inputType,
          sourcePath: inputPath,
          folderPath: settings.inputType === 'draft' ? inputPath : inputPath.replace(/[^/\\]+$/, ''),
        };
        try {
          await syncSessionWithProjectSettings(
            sessionPath,
            {
              projectSettings: projectSettingsSnapshot,
              revision: settings.settingsRevision,
              updatedAt: settings.settingsUpdatedAt,
              source: 'project_default',
            },
            fallback
          );
        } catch (error) {
          await updateCaptionSession(
            sessionPath,
            (session) => ({
              ...session,
              syncState: 'pending',
            }),
            fallback
          );
          scheduleSessionSettingsRetry(sessionPath, async () => {
            await syncSessionWithProjectSettings(
              sessionPath,
              {
                projectSettings: projectSettingsSnapshot,
                revision: settings.settingsRevision,
                updatedAt: settings.settingsUpdatedAt,
                source: 'project_default',
              },
              fallback
            );
          });
        }
      }
    };

    syncAll().catch((error) => {
      console.warn('[CaptionTranslator] Không thể sync revision settings vào session', error);
    });
  }, [
    fileManager.filePath,
    projectId,
    settings.inputType,
    settings.settingsRevision,
    settings.settingsUpdatedAt,
  ]);

  // Persist thumbnail text theo folder (không ghi vào project default).
  useEffect(() => {
    const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
    if (!inputPaths.length) return;
    const persistThumbnailText = async () => {
      if (inputPaths.length > 1) {
        for (let i = 0; i < inputPaths.length; i++) {
          const inputPath = inputPaths[i];
          const text = (hardsubSettings.thumbnailTextsByOrder[i] || '').trim();
          const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
          await updateCaptionSession(
            sessionPath,
            (session) => ({
              ...session,
              settings: {
                ...session.settings,
                step7Render: {
                  ...(session.settings.step7Render || {}),
                  thumbnailText: text,
                },
              },
            }),
            {
              projectId,
              inputType: settings.inputType,
              sourcePath: inputPath,
              folderPath: inputPath,
            }
          );
        }
        return;
      }

      const inputPath = inputPaths[0];
      const sessionPath = getSessionPathForInputPath(settings.inputType, inputPath);
      await updateCaptionSession(
        sessionPath,
        (session) => ({
          ...session,
          settings: {
            ...session.settings,
            step7Render: {
              ...(session.settings.step7Render || {}),
              thumbnailText: hardsubSettings.thumbnailText,
            },
          },
        }),
        {
          projectId,
          inputType: settings.inputType,
          sourcePath: inputPath,
          folderPath: settings.inputType === 'draft' ? inputPath : inputPath.replace(/[^/\\]+$/, ''),
        }
      );
    };
    persistThumbnailText().catch((error) => {
      console.warn('[CaptionTranslator] Không thể lưu thumbnail text theo folder', error);
    });
  }, [
    fileManager.filePath,
    projectId,
    settings.inputType,
    hardsubSettings.thumbnailText,
    hardsubSettings.thumbnailTextsByOrder,
  ]);

  // 4. Processing Hook
  const processing = useCaptionProcessing({
    projectId,
    entries: fileManager.entries,
    setEntries: fileManager.setEntries,
    filePath: fileManager.filePath,
    inputType: settings.inputType,
    captionFolder,
    settings: {
      ...settings,
      thumbnailText: hardsubSettings.thumbnailText,
      thumbnailTextsByOrder: hardsubSettings.thumbnailTextsByOrder,
    },
    enabledSteps: settings.enabledSteps,
    setEnabledSteps: settings.setEnabledSteps,
  });

  const audioFiles = processing.audioFiles;

  // --- Download prompt preview ---
  const handleDownloadPromptPreview = async () => {
    const entries = fileManager.entries;
    const linesPerBatch = 50;
    const batchTexts = entries.slice(0, linesPerBatch).map(e => e.text);
    const count = batchTexts.length;

    // Lấy custom prompt từ DB nếu có
    let customTemplate: string | undefined;
    let promptName = 'default';
    try {
      const settingsRes = await window.electronAPI.appSettings.getAll();
      const captionPromptId = settingsRes?.data?.captionPromptId;
      if (captionPromptId) {
        const promptRes: any = await window.electronAPI.invoke('prompt:getById', captionPromptId);
        if (promptRes?.content) {
          customTemplate = promptRes.content;
          promptName = promptRes.name || captionPromptId;
        }
      }
    } catch (e) {
      console.warn('[PromptPreview] Không tải được settings/prompt:', e);
    }

    let prompt: string;
    let responseFormat: 'pipe' | 'numbered';

    if (customTemplate) {
      const arrayText = JSON.stringify(batchTexts);
      const rawText = batchTexts.join('\n');
      prompt = customTemplate
        .replace(/"\{\{TEXT\}\}"/g, arrayText)   // "{{TEXT}}" → JSON array
        .replace(/\{\{TEXT\}\}/g, rawText)          // {{TEXT}} → plain fallback
        .replace(/\{\{COUNT\}\}/g, String(count))
        .replace(/\{\{FILE_NAME\}\}/g, 'subtitle');
      const isPipe = /response_format["']?\s*:\s*["']?\|/.test(customTemplate)
        || /"separator"\s*:\s*"\|"/.test(customTemplate)
        || /Format output.*\|/.test(customTemplate);
      responseFormat = isPipe ? 'pipe' : 'numbered';
    } else {
      // Default numbered format
      const numberedLines = batchTexts.map((t, i) => `[${i + 1}] ${t}`).join('\n');
      prompt = `Dịch các dòng subtitle sau sang tiếng Vietnamese.\nQuy tắc:\n1. Dịch tự nhiên, phù hợp ngữ cảnh\n2. Giữ nguyên số thứ tự [1], [2], ...\n3. Không thêm giải thích\n4. Mỗi dòng dịch tương ứng với dòng gốc\n\nNội dung cần dịch:\n${numberedLines}\n\nKết quả (chỉ trả về các dòng đã dịch, giữ nguyên format [số]):`;
      responseFormat = 'numbered';
    }

    const header = [
      `; === CAPTION PROMPT PREVIEW ===`,
      `; Prompt: ${customTemplate ? promptName : '(default built-in)'}`,
      `; Response format: ${responseFormat}`,
      `; Batch size: ${count} / ${entries.length} dòng (chỉ batch đầu tiên)`,
      `; ================================`,
      '',
    ].join('\n');

    const content = header + prompt;

    const saveRes = await (window.electronAPI as any).invoke('dialog:showSaveDialog', {
      title: 'Lưu preview prompt',
      defaultPath: 'caption_prompt_preview.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (!saveRes?.filePath) return;

    // Ghi file qua IPC
    await (window.electronAPI as any).invoke('fs:writeFile', { filePath: saveRes.filePath, content });
  };

  // 5. Available Fonts State
  const [availableFonts, setAvailableFonts] = useState<string[]>(['ZYVNA Fairy', 'Be Vietnam Pro', 'Roboto']);

  const [diskAudioDuration, setDiskAudioDuration] = useState<number | null>(null);
  const [diskSubtitleDuration, setDiskSubtitleDuration] = useState<number | null>(null);

  // Section 6 (Cấu hình) luôn dùng folder đầu tiên làm tham chiếu cấu hình.
  // Folder đang xử lý (processing.currentFolder) chỉ dùng cho progress badge ở Section 7.
  const firstFolderPath = hardsubSettings.firstFolderPath;
  const isMultiFolder = hardsubSettings.isMultiFolder;

  // Khi đang xử lý multi-folder, dùng path của folder đang xử lý để hiển thị thông số video chính xác.
  // Khi idle, hiển thị folder đầu tiên trong danh sách.
  const displayPath = processing.currentFolder?.path ?? firstFolderPath;
  const videoInfo = displayPath ? fileManager.folderVideos[displayPath] : null;
  const originalVideoDuration = videoInfo?.duration || 0;
  const livePreviewVideoPath = videoInfo?.fullPath || fileManager.firstVideoPath || null;

  const [sessionStepStatus, setSessionStepStatus] = useState<Partial<Record<Step, string>>>({});
  const [sessionStepSkipped, setSessionStepSkipped] = useState<Partial<Record<Step, boolean>>>({});
  const [sessionPreviewEntries, setSessionPreviewEntries] = useState<SubtitleEntry[]>([]);
  const [renderedPreviewVideoPath, setRenderedPreviewVideoPath] = useState<string | null>(null);
  const [previewSourceLabel, setPreviewSourceLabel] = useState<string>('live_video');
  const [previewMode, setPreviewMode] = useState<'render' | 'live'>('render');
  const [thumbnailPreviewFrameData, setThumbnailPreviewFrameData] = useState<string | null>(null);
  const [thumbnailPreviewSize, setThumbnailPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [thumbnailPreviewStatus, setThumbnailPreviewStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle');
  const [thumbnailPreviewMessage, setThumbnailPreviewMessage] = useState<string>('Chưa render thumbnail preview.');

  // Output dir cho folder đang display (theo dõi real-time trong multi-folder)
  const displayOutputDir = settings.inputType === 'srt'
    ? (displayPath ? displayPath.replace(/[^/\\]+$/, 'caption_output') : captionFolder)
    : (displayPath ? `${displayPath}/caption_output` : '');

  useEffect(() => {
    if (!fileManager.filePath) {
      setSessionStepStatus({});
      setSessionStepSkipped({});
      setSessionPreviewEntries(fileManager.entries);
      setRenderedPreviewVideoPath(null);
      setPreviewSourceLabel('live_video');
      return;
    }

    const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
    const activeInputPath = processing.currentFolder?.path ?? inputPaths[0];
    if (!activeInputPath) {
      return;
    }

    let cancelled = false;
    const hydratePreviewFromSession = async () => {
      try {
        const sessionPath = getSessionPathForInputPath(settings.inputType, activeInputPath);
        const session = await readCaptionSession(sessionPath, {
          projectId,
          inputType: settings.inputType,
          sourcePath: activeInputPath,
          folderPath: settings.inputType === 'draft'
            ? activeInputPath
            : activeInputPath.replace(/[^/\\]+$/, ''),
        });
        if (cancelled) return;

        const nextStepStatus: Partial<Record<Step, string>> = {
          1: session.steps.step1?.status,
          2: session.steps.step2?.status,
          3: session.steps.step3?.status,
          4: session.steps.step4?.status,
          5: session.steps.step5?.status,
          6: session.steps.step6?.status,
          7: session.steps.step7?.status,
        };
        const isSkipped = (stepState: unknown): boolean => {
          const record = (stepState && typeof stepState === 'object')
            ? (stepState as Record<string, unknown>)
            : {};
          const metrics = (record.metrics && typeof record.metrics === 'object')
            ? (record.metrics as Record<string, unknown>)
            : {};
          return record.status === 'success'
            && (metrics.skipped === true || metrics.skipBy === 'session_contract');
        };
        const nextStepSkipped: Partial<Record<Step, boolean>> = {
          1: isSkipped(session.steps.step1),
          2: isSkipped(session.steps.step2),
          3: isSkipped(session.steps.step3),
          4: isSkipped(session.steps.step4),
          5: isSkipped(session.steps.step5),
          6: isSkipped(session.steps.step6),
          7: isSkipped(session.steps.step7),
        };
        setSessionStepStatus(nextStepStatus);
        setSessionStepSkipped(nextStepSkipped);

        const translated = (session.data.translatedEntries || []) as SubtitleEntry[];
        const extracted = (session.data.extractedEntries || []) as SubtitleEntry[];
        const selectedEntries =
          (session.steps.step3?.status === 'success' && translated.length > 0)
            ? translated
            : (translated.length > 0 ? translated : extracted);
        setSessionPreviewEntries(selectedEntries.length > 0 ? selectedEntries : fileManager.entries);
        setPreviewSourceLabel(
          session.steps.step3?.status === 'success' && translated.length > 0
            ? 'session_translated_entries'
            : 'session_extracted_entries'
        );

        const finalVideoPathRaw =
          typeof session.artifacts.finalVideoPath === 'string' && session.artifacts.finalVideoPath.trim().length > 0
            ? session.artifacts.finalVideoPath
            : (typeof (session.data.renderResult as Record<string, unknown> | undefined)?.outputPath === 'string'
              ? ((session.data.renderResult as Record<string, unknown>).outputPath as string)
              : null);

        if (session.steps.step7?.status === 'success' && finalVideoPathRaw) {
          const verifyRes = await (window.electronAPI as any).captionVideo.getVideoMetadata(finalVideoPathRaw);
          if (!cancelled && verifyRes?.success) {
            setRenderedPreviewVideoPath(finalVideoPathRaw);
          } else if (!cancelled) {
            setRenderedPreviewVideoPath(null);
          }
        } else {
          setRenderedPreviewVideoPath(null);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[CaptionTranslator] Không thể hydrate preview từ caption_session.json', error);
          setSessionStepSkipped({});
          setSessionPreviewEntries(fileManager.entries);
          setRenderedPreviewVideoPath(null);
        }
      }
    };

    hydratePreviewFromSession();
    return () => {
      cancelled = true;
    };
  }, [fileManager.filePath, fileManager.entries, processing.currentFolder?.path, processing.status, projectId, settings.inputType]);

  useEffect(() => {
    if (previewMode === 'render' && !renderedPreviewVideoPath) {
      setPreviewMode('live');
    }
  }, [previewMode, renderedPreviewVideoPath]);

  const effectivePreviewMode: 'render' | 'live' =
    previewMode === 'render' && renderedPreviewVideoPath ? 'render' : 'live';
  const previewVideoPath = effectivePreviewMode === 'render'
    ? renderedPreviewVideoPath
    : livePreviewVideoPath;
  const previewEntries = effectivePreviewMode === 'render'
    ? []
    : (sessionPreviewEntries.length > 0 ? sessionPreviewEntries : fileManager.entries);
  const firstFolderVideoInfo = firstFolderPath ? fileManager.folderVideos[firstFolderPath] : null;
  const thumbnailPreviewVideoPath = firstFolderVideoInfo?.fullPath || fileManager.firstVideoPath || null;
  const thumbnailPreviewText = isMultiFolder
    ? (hardsubSettings.thumbnailTextsByOrder[0] || '')
    : hardsubSettings.thumbnailText;
  const thumbnailPreviewFrameSec = settings.thumbnailFrameTimeSec ?? 0;
  const thumbnailPreviewAspect = thumbnailPreviewSize
    ? `${thumbnailPreviewSize.width} / ${thumbnailPreviewSize.height}`
    : undefined;

  useEffect(() => {
    setThumbnailPreviewFrameData(null);
    setThumbnailPreviewSize(null);
    setThumbnailPreviewStatus('idle');
    setThumbnailPreviewMessage('Cấu hình đã đổi. Bấm "Làm mới" để render thumbnail frame thật.');
  }, [
    thumbnailPreviewVideoPath,
    thumbnailPreviewText,
    settings.thumbnailFontName,
    settings.thumbnailFontSize,
    settings.thumbnailFrameTimeSec,
    settings.renderMode,
    settings.renderResolution,
  ]);

  const handleRefreshThumbnailPreview = async () => {
    if (!thumbnailPreviewVideoPath) {
      setThumbnailPreviewStatus('error');
      setThumbnailPreviewMessage('Không tìm thấy video nguồn để render thumbnail preview.');
      return;
    }

    setThumbnailPreviewStatus('rendering');
    setThumbnailPreviewMessage('Đang render thumbnail frame thật...');
    try {
      const api = (window.electronAPI as any).captionVideo;
      const res = await api.renderThumbnailPreviewFrame({
        videoPath: thumbnailPreviewVideoPath,
        thumbnailTimeSec: thumbnailPreviewFrameSec,
        renderMode: settings.renderMode,
        renderResolution: settings.renderResolution,
        thumbnailText: thumbnailPreviewText,
        thumbnailFontName: settings.thumbnailFontName,
        thumbnailFontSize: settings.thumbnailFontSize,
      });

      if (!res?.success || !res.data?.success || !res.data?.frameData) {
        const err = res?.error || res?.data?.error || 'Không thể render thumbnail preview frame.';
        setThumbnailPreviewStatus('error');
        setThumbnailPreviewMessage(err);
        return;
      }

      setThumbnailPreviewFrameData(res.data.frameData);
      setThumbnailPreviewSize(
        typeof res.data.width === 'number' && typeof res.data.height === 'number'
          ? { width: res.data.width, height: res.data.height }
          : null
      );
      setThumbnailPreviewStatus('ready');
      setThumbnailPreviewMessage('Đã cập nhật thumbnail preview frame thật.');
    } catch (error) {
      setThumbnailPreviewStatus('error');
      setThumbnailPreviewMessage(String(error));
    }
  };

  // 6. Tính toán thời lượng Audio & Video cho Step 7
  // Reset khi chuyển folder cấu hình (firstFolderPath thay đổi)
  useEffect(() => {
    setDiskAudioDuration(null);
    setDiskSubtitleDuration(null);
  }, [firstFolderPath]);

  useEffect(() => {
    let mounted = true;
    const fetchDiskDuration = async () => {
      if (!displayOutputDir) {
        if (mounted) setDiskAudioDuration(null);
        return;
      }
      try {
        const audioPath = `${displayOutputDir}/merged_audio.wav`;
        console.log("Fetching metadata for audio path:", audioPath);
        const res = await (window.electronAPI as any).captionVideo.getVideoMetadata(audioPath);
        console.log("Metadata response:", res);
        if (mounted && res?.success && res.data?.duration) {
          const audioDuration: number = res.data.duration;
          // Sanity check: nếu audio > 2× video duration → stale file từ run cũ, bỏ qua
          if (originalVideoDuration > 0 && audioDuration > originalVideoDuration * 2) {
            console.warn(`diskAudioDuration ${audioDuration}s > 2× video ${originalVideoDuration}s — stale file, ignoring`);
            if (mounted) setDiskAudioDuration(null);
          } else {
            if (mounted) setDiskAudioDuration(audioDuration);
          }
        } else if (mounted) {
          setDiskAudioDuration(null);
        }
      } catch (err) {
        console.error("Error fetching disk duration:", err);
        if (mounted) setDiskAudioDuration(null);
      }
    };

    fetchDiskDuration();
    if (processing.status === 'success') {
      fetchDiskDuration();
    }
    return () => { mounted = false; };
  }, [displayOutputDir, originalVideoDuration, processing.status]);

  const srtDurationMs = fileManager.entries.length > 0 
    ? Math.max(...fileManager.entries.map(e => e.endMs || 0)) 
    : 0;
  const srtTimeScale = settings.srtSpeed > 0 ? settings.srtSpeed : 1.0;

  const normalizeSpeedLabel = (speed: number) => {
    const fixed = speed.toFixed(2);
    return fixed.replace(/\.?0+$/, '');
  };

  useEffect(() => {
    let mounted = true;
    const fetchDiskSubtitleDuration = async () => {
      if (!displayOutputDir) {
        if (mounted) setDiskSubtitleDuration(null);
        return;
      }

      const getDurationFromSrt = async (srtPath: string, scale: number) => {
        try {
          const res = await (window.electronAPI as any).caption.parseSrt(srtPath);
          if (!res?.success || !res?.data?.entries?.length) return null;
          const endMs = Math.max(...res.data.entries.map((e: any) => e.endMs || 0));
          if (!endMs || endMs <= 0) return null;
          return (endMs / 1000) * scale;
        } catch {
          return null;
        }
      };

      const scaleLabel = normalizeSpeedLabel(srtTimeScale);
      const scaledSrtPath = `${displayOutputDir}/srt/subtitle_${scaleLabel}x.srt`;
      const translatedSrtPath = `${displayOutputDir}/srt/translated.srt`;

      let durationSec = await getDurationFromSrt(scaledSrtPath, 1.0);
      if (durationSec == null) {
        durationSec = await getDurationFromSrt(translatedSrtPath, srtTimeScale);
      }

      if (mounted) {
        setDiskSubtitleDuration(durationSec);
      }
    };

    fetchDiskSubtitleDuration();
    if (processing.status === 'success') {
      fetchDiskSubtitleDuration();
    }
    return () => { mounted = false; };
  }, [displayOutputDir, srtTimeScale, processing.status]);

  const scaledSrtDurationSec = srtDurationMs > 0 ? (srtDurationMs / 1000) * srtTimeScale : 0;
  const subtitleSyncDurationSec = scaledSrtDurationSec > 0
    ? scaledSrtDurationSec
    : (diskSubtitleDuration || 0);

  // Multi-folder: entries không được load (guarded by !isMulti) nên srtDurationMs = 0.
  // Fallback: dùng videoInfo.duration của folder hiện tại làm ước tính duration audio
  // (TTS fill theo SRT timing ≈ video duration). Cập nhật real-time khi currentFolder đổi.
  let fallbackBaseAudioDurationMs = srtDurationMs;
  if (isMultiFolder && fallbackBaseAudioDurationMs === 0 && originalVideoDuration > 0) {
    fallbackBaseAudioDurationMs = originalVideoDuration * 1000;
  }

  // Single-folder: có thể dùng audioFiles nếu đã chạy TTS
  if (!isMultiFolder && !settings.autoFitAudio && audioFiles && audioFiles.length > 0) {
    let maxEndTime = 0;
    for (const f of audioFiles) {
      // @ts-ignore
      const ttsEndMs = f.startMs + (typeof f.durationMs === 'number' ? f.durationMs : 0);
      if (ttsEndMs > maxEndTime) maxEndTime = ttsEndMs;
    }
    fallbackBaseAudioDurationMs = Math.max(srtDurationMs, maxEndTime);
  }

  // Dùng diskAudioDuration (file thực trên đĩa) nếu có, cả single và multi-folder
  const baseAudioDuration = (diskAudioDuration !== null && diskAudioDuration > 0)
    ? diskAudioDuration
    : (fallbackBaseAudioDurationMs / 1000);

  // isEstimated: true khi không có audio file thực và dùng video duration fallback
  const isEstimated = diskAudioDuration === null && srtDurationMs === 0 && originalVideoDuration > 0;

  const audioExpectedDuration = settings.renderAudioSpeed > 0 
    ? baseAudioDuration / settings.renderAudioSpeed 
    : baseAudioDuration;

  const step4Scale = srtTimeScale > 0 ? srtTimeScale : 1.0;
  const step7Speed = settings.renderAudioSpeed > 0 ? settings.renderAudioSpeed : 1.0;
  const subRenderDuration = subtitleSyncDurationSec;
  const timingCalc = calculateHardsubTiming({
    step4Scale,
    step7Speed,
    subRenderDuration,
    audioScaledDuration: audioExpectedDuration,
    configuredSrtTimeScale: srtTimeScale,
    srtAlreadyScaled: false,
  });
  const audioEffectiveSpeed = timingCalc.audioEffectiveSpeed;
  const videoSubBaseDuration = timingCalc.videoSubBaseDuration;
  const autoVideoSpeed = timingCalc.videoSpeedMultiplier;
  const videoMarkerSec = timingCalc.videoMarkerSec;

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return '--';
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1);
    return m > 0 ? `${m}p${s}s` : `${s}s`;
  };

  useEffect(() => {
    console.log(`[CaptionTranslator] 🕒 THỜI GIAN GỐC & TÍNH TOÁN (AUTO-FIT):
- File audio trên đĩa (diskAudioDuration): ${diskAudioDuration ? diskAudioDuration.toFixed(2) + 's' : 'null'}
- Thời gian gốc dự phòng (fallbackBaseAudioDurationMs): ${(fallbackBaseAudioDurationMs / 1000).toFixed(2)}s
- Mốc subtitle cuối (scaled theo srtSpeed): ${scaledSrtDurationSec.toFixed(2)}s
- Mốc subtitle từ file SRT trên đĩa: ${diskSubtitleDuration ? diskSubtitleDuration.toFixed(2) + 's' : 'null'}
- Step4 scale: ${step4Scale.toFixed(3)}x
- Step7 speed: ${step7Speed.toFixed(3)}x
- Audio hiệu dụng (step4 - delta step7): ${audioEffectiveSpeed.toFixed(3)}x
- Sub render duration: ${subRenderDuration.toFixed(2)}s
- Video sub base duration: ${videoSubBaseDuration.toFixed(2)}s
- Duration Audio gốc (baseAudioDuration): ${baseAudioDuration.toFixed(2)}s
- Tốc độ Audio thiết lập (settings.renderAudioSpeed): ${settings.renderAudioSpeed}x
- 👉 Duration Audio mới (Render video length): ${audioExpectedDuration.toFixed(2)}s
- Duration Video dùng để sync (videoSubBaseDuration): ${videoSubBaseDuration.toFixed(2)}s
- 👉 Tốc độ Video tự động chỉnh (autoVideoSpeed): ${autoVideoSpeed.toFixed(3)}x
- 🎯 Mốc video chuẩn (gốc): ${videoMarkerSec.toFixed(2)}s
    `);
  }, [diskAudioDuration, diskSubtitleDuration, fallbackBaseAudioDurationMs, scaledSrtDurationSec, baseAudioDuration, settings.renderAudioSpeed, audioExpectedDuration, step4Scale, step7Speed, audioEffectiveSpeed, subRenderDuration, videoSubBaseDuration, autoVideoSpeed, videoMarkerSec]);

  useEffect(() => {
    // Lấy danh sách font thực tế từ resources/fonts
    const fetchFonts = async () => {
      try {
        const res = await (window.electronAPI as any).captionVideo.getAvailableFonts();
        if (res?.success && res.data?.length > 0) {
          setAvailableFonts(res.data);
        }
      } catch (err) {
        console.error("Lỗi lấy font", err);
      }
    };
    fetchFonts();
  }, []);
  
  const getProgressColor = () => {
    if (processing.status === 'error') return 'var(--color-error)';
    if (processing.status === 'success') return 'var(--color-success)';
    return 'var(--color-primary)';
  };

  const step7DependencyWarning = (() => {
    const issue = processing.stepDependencyIssues.find((item) => item.step === 7);
    if (!issue) return undefined;
    return `Step 7 đang bị chặn: ${issue.reason}`;
  })();

  const [stepPanels, setStepPanels] = useState<Record<CaptionStepPanelKey, StepPanelState>>({
    b1: { expanded: true, advanced: false },
    b2: { expanded: false, advanced: false },
    b3: { expanded: true, advanced: false },
    b4: { expanded: true, advanced: false },
    b5: { expanded: false, advanced: false },
    b6: { expanded: false, advanced: false },
    b7: { expanded: true, advanced: false },
    run: { expanded: true, advanced: false },
  });

  const togglePanel = (key: CaptionStepPanelKey) => {
    setStepPanels((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        expanded: !prev[key].expanded,
      },
    }));
  };

  const getStepBadge = (step: Step): { label: string; className: string } => {
    const hasIssue = processing.stepDependencyIssues.some((item) => item.step === step);
    if (processing.status === 'running' && processing.currentStep === step) {
      return { label: 'Running', className: `${styles.statusBadge} ${styles.statusRunning}` };
    }
    if (processing.status === 'error' && processing.currentStep === step) {
      return { label: 'Error', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    if (hasIssue) {
      return { label: 'Blocked', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    const persistedStatus = sessionStepStatus[step];
    if (persistedStatus === 'success' && sessionStepSkipped[step]) {
      return { label: 'Skipped', className: `${styles.statusBadge} ${styles.statusSkipped}` };
    }
    if (persistedStatus === 'success') {
      return { label: 'Done', className: `${styles.statusBadge} ${styles.statusDone}` };
    }
    if (persistedStatus === 'running') {
      return { label: 'Running', className: `${styles.statusBadge} ${styles.statusRunning}` };
    }
    if (persistedStatus === 'error') {
      return { label: 'Error', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    if (persistedStatus === 'stale') {
      return { label: 'Stale', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    if (processing.status === 'success' && processing.enabledSteps.has(step)) {
      return { label: 'Done', className: `${styles.statusBadge} ${styles.statusDone}` };
    }
    return { label: processing.enabledSteps.has(step) ? 'Idle' : 'Off', className: `${styles.statusBadge} ${styles.statusIdle}` };
  };

  const STEP_SHORT_LABELS: Record<Step, string> = {
    1: 'Input',
    2: 'Tách',
    3: 'Dịch',
    4: 'TTS',
    5: 'Trim',
    6: 'Ghép',
    7: 'Render',
  };

  const configSummaryRows = useMemo(() => {
    const subtitlePos = settings.subtitlePosition
      ? `${Math.round(settings.subtitlePosition.x)}, ${Math.round(settings.subtitlePosition.y)}`
      : 'Auto';
    const logoPos = settings.logoPosition
      ? `${Math.round(settings.logoPosition.x)}, ${Math.round(settings.logoPosition.y)}`
      : 'Off';
    return [
      { key: 'Input', value: settings.inputType === 'draft' ? 'Draft' : 'SRT' },
      { key: 'Dịch', value: `${settings.translateMethod?.toUpperCase() || 'API'} / ${settings.geminiModel}` },
      { key: 'TTS', value: `${settings.voice} | rate ${settings.rate} | vol ${settings.volume}` },
      { key: 'Mode', value: `${settings.renderMode} / ${settings.renderResolution}` },
      { key: 'Speed', value: `audio ${settings.renderAudioSpeed}x | video ${autoVideoSpeed.toFixed(2)}x` },
      { key: 'Âm lượng', value: `video ${settings.videoVolume}% | TTS ${settings.audioVolume}%` },
      { key: 'Sub pos', value: subtitlePos },
      { key: 'Logo', value: `${logoPos} | scale ${Math.round((settings.logoScale || 1) * 100)}%` },
      { key: 'Thumbnail', value: `${settings.thumbnailDurationSec ?? 0.5}s @ ${settings.thumbnailFrameTimeSec ?? 0}s | ${settings.thumbnailFontName} ${settings.thumbnailFontSize ?? 145}px` },
      { key: 'Preview', value: `${effectivePreviewMode === 'render' ? 'Render snapshot' : 'Live'} (${previewSourceLabel})` },
    ];
  }, [
    settings.inputType,
    settings.translateMethod,
    settings.geminiModel,
    settings.voice,
    settings.rate,
    settings.volume,
    settings.renderMode,
    settings.renderResolution,
    settings.renderAudioSpeed,
    settings.videoVolume,
    settings.audioVolume,
    settings.subtitlePosition,
    settings.logoPosition,
    settings.logoScale,
    settings.thumbnailDurationSec,
    settings.thumbnailFrameTimeSec,
    settings.thumbnailFontName,
    settings.thumbnailFontSize,
    autoVideoSpeed,
    effectivePreviewMode,
    previewSourceLabel,
  ]);

  const handleSelectLogo = async () => {
    const result = await (window.electronAPI as any).invoke('dialog:openFile', {
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (!result?.canceled && result?.filePaths?.[0]) {
      settings.setLogoPath(result.filePaths[0]);
      settings.setLogoPosition(undefined);
    }
  };

  const handleRemoveLogo = () => {
    settings.setLogoPath(undefined);
    settings.setLogoPosition(undefined);
  };

  return (
    <div className={styles.container}>
      <div className={styles.leftColumn}>
        <div className={styles.accordion}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.b1.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('b1')}
          >
            <div className={styles.accordionTitle}>B1 Input</div>
            <div className={styles.accordionAction}>
              <span className={getStepBadge(1).className}>{getStepBadge(1).label}</span>
              {stepPanels.b1.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.b1.expanded && (
            <div className={styles.accordionBody}>
              <div className={styles.fileTypeSelection}>
                <RadioButton
                  label="SRT"
                  checked={settings.inputType === 'srt'}
                  onChange={() => settings.setInputType('srt')}
                  name="inputType"
                />
                <RadioButton
                  label="Draft"
                  description="CapCut"
                  checked={settings.inputType === 'draft'}
                  onChange={() => settings.setInputType('draft')}
                  name="inputType"
                />
              </div>

              <div className={styles.flexRow} style={settings.inputType === 'draft' ? { alignItems: 'stretch' } : {}}>
                {settings.inputType === 'srt' ? (
                  <Input
                    value={fileManager.filePath}
                    onChange={(e) => fileManager.setFilePath(e.target.value)}
                    placeholder="Đường dẫn .srt"
                  />
                ) : (
                  <div
                    className={`${styles.folderBoxContainer} ${!fileManager.filePath ? styles.emptyFolderBox : ''}`}
                    onClick={!fileManager.filePath ? fileManager.handleBrowseFile : undefined}
                  >
                    {!fileManager.filePath ? (
                      <span className={styles.placeholderText}>Chưa chọn folder...</span>
                    ) : (
                      <div className={styles.folderGrid}>
                        {fileManager.filePath.split('; ').map((path, idx) => {
                          const folderName = path.split(/[/\\]/).pop() || path;
                          const vInfo = fileManager.folderVideos[path];
                          return (
                            <div key={idx} className={styles.folderBox} title={path}>
                              <div className={styles.folderBoxHeader}>
                                <img src={folderIconUrl} alt="folder" className={styles.folderIcon} style={{ width: '16px', height: '16px', marginRight: '6px' }} />
                                <span className={styles.folderName}>{folderName}</span>
                              </div>
                              {vInfo && (
                                <div className={styles.folderBoxSubText}>
                                  <img src={videoIconUrl} alt="video" style={{ width: '14px', height: '14px', display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} />
                                  {vInfo.name}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <Button onClick={fileManager.handleBrowseFile}>Chọn</Button>
              </div>
              {fileManager.entries.length > 0 && (
                <p className={styles.textMuted} style={{ marginTop: '8px' }}>
                  Đã load: {fileManager.entries.length} dòng
                </p>
              )}
            </div>
          )}
        </div>

        <div className={styles.accordion}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.b2.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('b2')}
          >
            <div className={styles.accordionTitle}>B2 Tách</div>
            <div className={styles.accordionAction}>
              <span className={getStepBadge(2).className}>{getStepBadge(2).label}</span>
              {stepPanels.b2.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.b2.expanded && (
            <div className={styles.accordionBody}>
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
                    {LINES_PER_FILE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
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
          )}
        </div>

        <div className={styles.accordion}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.b3.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('b3')}
          >
            <div className={styles.accordionTitle}>B3 Dịch</div>
            <div className={styles.accordionAction}>
              <span className={getStepBadge(3).className}>{getStepBadge(3).label}</span>
              {stepPanels.b3.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.b3.expanded && (
            <div className={styles.accordionBody}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div className={styles.sectionTitleCompact}>Model dịch</div>
                <Button
                  variant="secondary"
                  onClick={handleDownloadPromptPreview}
                  disabled={fileManager.entries.length === 0}
                  title={fileManager.entries.length === 0 ? 'Load SRT trước để xem prompt' : 'Tải prompt preview (batch 1)'}
                  style={{ padding: '4px 10px', fontSize: '12px', height: '28px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Download size={13} />
                  Prompt
                </Button>
              </div>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <RadioButton
                  label="API"
                  checked={settings.translateMethod === 'api'}
                  onChange={() => settings.setTranslateMethod('api')}
                  name="translateMethod"
                />
                <RadioButton
                  label="Impit"
                  checked={settings.translateMethod === 'impit'}
                  onChange={() => settings.setTranslateMethod('impit')}
                  name="translateMethod"
                />
              </div>
              <select
                value={settings.geminiModel}
                onChange={(e) => settings.setGeminiModel(e.target.value)}
                className={styles.select}
                disabled={settings.translateMethod === 'impit'}
                style={settings.translateMethod === 'impit' ? { opacity: 0.4 } : undefined}
              >
                {GEMINI_MODELS.map((m: { value: string; label: string }) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className={styles.accordion}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.b4.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('b4')}
          >
            <div className={styles.accordionTitle}>B4 TTS</div>
            <div className={styles.accordionAction}>
              <span className={getStepBadge(4).className}>{getStepBadge(4).label}</span>
              {stepPanels.b4.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.b4.expanded && (
            <div className={styles.accordionBody}>
              <div className={styles.grid2}>
                <div>
                  <label className={styles.label}>Giọng</label>
                  <select value={settings.voice} onChange={(e) => settings.setVoice(e.target.value)} className={styles.select}>
                    {VOICES.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={styles.label}>Scale SRT</label>
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
                  <label className={styles.label}>Rate</label>
                  <select value={settings.rate} onChange={(e) => settings.setRate(e.target.value)} className={styles.select}>
                    {RATE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={styles.label}>Volume</label>
                  <select value={settings.volume} onChange={(e) => settings.setVolume(e.target.value)} className={styles.select}>
                    {VOLUME_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: '12px' }}>
                <Checkbox
                  label="Auto fit audio"
                  checked={settings.autoFitAudio}
                  onChange={() => settings.setAutoFitAudio(!settings.autoFitAudio)}
                />
              </div>
            </div>
          )}
        </div>

        <div className={styles.accordion}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.b7.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('b7')}
          >
            <div className={styles.accordionTitle}>B7 Render</div>
            <div className={styles.accordionAction}>
              <span className={getStepBadge(7).className}>{getStepBadge(7).label}</span>
              {stepPanels.b7.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.b7.expanded && (
            <div className={styles.accordionBody}>
              <HardsubSettingsPanel
                visible={processing.enabledSteps.has(7)}
                settings={settings}
                availableFonts={availableFonts}
                metrics={{
                  isMultiFolder,
                  isEstimated,
                  displayPath,
                  videoName: videoInfo?.name,
                  baseAudioDuration,
                  audioExpectedDuration,
                  videoSubBaseDuration,
                  videoMarkerSec,
                  autoVideoSpeed,
                  formatDuration,
                } as HardsubTimingMetrics}
                thumbnailListPanel={(
                  <ThumbnailListPanel
                    visible={
                      (settings.renderMode === 'hardsub' || settings.renderMode === 'hardsub_portrait_9_16') &&
                      settings.inputType === 'draft' &&
                      isMultiFolder
                    }
                    items={hardsubSettings.thumbnailFolderItems}
                    autoStartValue={hardsubSettings.thumbnailAutoStartValue}
                    onAutoStartValueChange={hardsubSettings.setThumbnailAutoStartValue}
                    onAutoFill={hardsubSettings.handleAutoFillThumbnailByEpisode}
                    onItemTextChange={hardsubSettings.updateThumbnailTextByOrder}
                    showMissingWarning={hardsubSettings.isThumbnailEnabled && hardsubSettings.hasMissingThumbnailText}
                    dependencyWarning={step7DependencyWarning}
                  />
                )}
              />
              {!processing.enabledSteps.has(7) && (
                <div className={styles.textMuted} style={{ fontSize: 12 }}>
                  Bật Step 7 ở phần Điều khiển để chỉnh render.
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.accordion}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.b5.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('b5')}
          >
            <div className={styles.accordionTitle}>B5 Trim</div>
            <div className={styles.accordionAction}>
              <span className={getStepBadge(5).className}>{getStepBadge(5).label}</span>
              {stepPanels.b5.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.b5.expanded && (
            <div className={styles.accordionBody}>
              <div className={styles.textMuted} style={{ fontSize: 12 }}>
                Step 5 hiện không có cấu hình riêng.
              </div>
            </div>
          )}
        </div>

        <div className={styles.accordion}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.b6.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('b6')}
          >
            <div className={styles.accordionTitle}>B6 Ghép</div>
            <div className={styles.accordionAction}>
              <span className={getStepBadge(6).className}>{getStepBadge(6).label}</span>
              {stepPanels.b6.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.b6.expanded && (
            <div className={styles.accordionBody}>
              <div className={styles.textMuted} style={{ fontSize: 12 }}>
                Step 6 dùng cấu hình audio ở các bước trước.
              </div>
            </div>
          )}
        </div>

        <div className={`${styles.accordion} ${styles.runAccordionTop}`}>
          <button
            className={`${styles.accordionHeader} ${stepPanels.run.expanded ? styles.accordionHeaderOpen : ''}`}
            onClick={() => togglePanel('run')}
          >
            <div className={styles.accordionTitle}>Chạy & Tiến độ</div>
            <div className={styles.accordionAction}>
              <span className={`${styles.statusBadge} ${styles.statusIdle}`}>{processing.status}</span>
              {stepPanels.run.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {stepPanels.run.expanded && (
            <div className={styles.accordionBody}>
              <div className={styles.stepCheckboxes}>
                {([1, 2, 3, 4, 5, 6, 7] as Step[]).map((step) => (
                  <Checkbox
                    key={step}
                    label={`B${step} ${STEP_SHORT_LABELS[step]}`}
                    checked={processing.enabledSteps.has(step)}
                    onChange={() => processing.toggleStep(step)}
                    highlight={processing.currentStep === step}
                  />
                ))}
              </div>

              <div className={styles.configSummaryBox}>
                <div className={styles.configSummaryTitle}>Tóm tắt cấu hình hiện tại</div>
                <div className={styles.configSummaryGrid}>
                  {configSummaryRows.map((row) => (
                    <div key={row.key} className={styles.configSummaryRow}>
                      <span className={styles.configSummaryKey}>{row.key}</span>
                      <span className={styles.configSummaryValue}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {processing.stepDependencyIssues.length > 0 && (
                <div className={styles.stepGuardBox}>
                  <div className={styles.stepGuardTitle}>Step bị chặn:</div>
                  {processing.stepDependencyIssues.slice(0, 6).map((issue, idx) => (
                    <div key={`${issue.folderPath}-${issue.step}-${idx}`} className={styles.stepGuardItem}>
                      [{issue.folderName}] Step {issue.step}: {issue.reason}
                    </div>
                  ))}
                </div>
              )}

              {isMultiFolder && (
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <button
                    className={styles.resetBtnLike}
                    style={{
                      flex: 1,
                      background: settings.processingMode !== 'step-first' ? 'var(--color-accent, #4a9eff)' : 'transparent',
                      color: settings.processingMode !== 'step-first' ? '#fff' : 'var(--color-text-muted)',
                      borderColor: settings.processingMode !== 'step-first' ? 'var(--color-accent, #4a9eff)' : 'var(--color-border)',
                      cursor: processing.status === 'running' ? 'not-allowed' : 'pointer',
                      opacity: processing.status === 'running' ? 0.5 : 1,
                    }}
                    disabled={processing.status === 'running'}
                    onClick={() => settings.setProcessingMode('folder-first')}
                    title="Xong từng folder"
                  >
                    Folder-first
                  </button>
                  <button
                    className={styles.resetBtnLike}
                    style={{
                      flex: 1,
                      background: settings.processingMode === 'step-first' ? 'var(--color-accent, #4a9eff)' : 'transparent',
                      color: settings.processingMode === 'step-first' ? '#fff' : 'var(--color-text-muted)',
                      borderColor: settings.processingMode === 'step-first' ? 'var(--color-accent, #4a9eff)' : 'var(--color-border)',
                      cursor: processing.status === 'running' ? 'not-allowed' : 'pointer',
                      opacity: processing.status === 'running' ? 0.5 : 1,
                    }}
                    disabled={processing.status === 'running'}
                    onClick={() => settings.setProcessingMode('step-first')}
                    title="Xong từng step"
                  >
                    Step-first
                  </button>
                </div>
              )}

              <div className={styles.buttonsRow}>
                <Button
                  onClick={processing.handleStart}
                  disabled={processing.status === 'running'}
                  variant="success"
                  fullWidth
                >
                  ▶ Chạy
                </Button>
                <Button
                  onClick={processing.handleStop}
                  disabled={processing.status !== 'running'}
                  variant="danger"
                  fullWidth
                >
                  ⏹ Dừng
                </Button>
              </div>

              <div className={styles.progressSection} style={{ marginTop: 12 }}>
                {processing.currentFolder && processing.currentFolder.total > 1 && (
                  <div className={styles.progressHeader} style={{ marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-accent, #4a9eff)' }}>
                      Project {processing.currentFolder.index}/{processing.currentFolder.total}: {processing.currentFolder.name}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      {processing.currentFolder.index}/{processing.currentFolder.total}
                    </span>
                  </div>
                )}
                {processing.enabledSteps.has(7) && originalVideoDuration > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span>{videoInfo?.name ?? 'Video'}</span>
                    <span>{formatDuration(originalVideoDuration)}</span>
                    <span>Sync: {formatDuration(videoSubBaseDuration)}</span>
                    <span>Audio: {formatDuration(audioExpectedDuration)}</span>
                    <span>Marker: {formatDuration(videoMarkerSec)}</span>
                    <span style={{ color: autoVideoSpeed < 0.8 || autoVideoSpeed > 1.2 ? 'var(--color-warning, #f59e0b)' : 'inherit' }}>
                      Speed: {autoVideoSpeed.toFixed(2)}x
                    </span>
                  </div>
                )}
                <div className={styles.progressHeader}>
                  <span className={styles.textMuted}>{processing.progress.message}</span>
                  {processing.progress.total > 0 && (
                    <span className={styles.textMuted}>
                      {processing.progress.current}/{processing.progress.total}
                    </span>
                  )}
                </div>
                {processing.currentFolder && processing.currentFolder.total > 1 && (
                  <div className={styles.progressBar} style={{ marginBottom: '4px' }}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${((processing.currentFolder.index - 1) / processing.currentFolder.total) * 100}%`,
                        backgroundColor: 'var(--color-accent, #4a9eff)',
                        opacity: 0.5,
                      }}
                    />
                  </div>
                )}
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
          )}
        </div>
      </div>

      <div className={styles.rightColumn}>
        <div className={styles.previewSticky}>
          <div className={styles.previewDock}>
            <div className={styles.previewDockTitle}>
              <Eye size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Preview
            </div>
            <div className={styles.previewDockHint}>
              Khung cố định. Có thể chuyển Live hoặc Snapshot render từ session.
            </div>
            <div className={styles.previewModeSwitch}>
              <button
                className={`${styles.resetBtnLike} ${effectivePreviewMode === 'live' ? styles.previewModeBtnActive : ''}`}
                onClick={() => setPreviewMode('live')}
                title="Preview live để chỉnh layer"
              >
                Live
              </button>
              <button
                className={`${styles.resetBtnLike} ${effectivePreviewMode === 'render' ? styles.previewModeBtnActive : ''}`}
                onClick={() => setPreviewMode('render')}
                disabled={!renderedPreviewVideoPath}
                title={renderedPreviewVideoPath ? 'Preview từ video đã render (giống output)' : 'Chưa có final video trong session'}
              >
                Render
              </button>
              <span className={styles.previewSourceTag}>
                {effectivePreviewMode === 'render'
                  ? 'source: session.finalVideoPath'
                  : `source: ${previewSourceLabel}`}
              </span>
            </div>
            <SubtitlePreview
              videoPath={previewVideoPath}
              style={settings.style}
              entries={previewEntries}
              subtitlePosition={settings.subtitlePosition}
              blackoutTop={settings.blackoutTop}
              renderMode={settings.renderMode}
              renderResolution={settings.renderResolution}
              logoPath={settings.logoPath}
              logoPosition={settings.logoPosition}
              logoScale={settings.logoScale}
              portraitForegroundCropPercent={settings.portraitForegroundCropPercent ?? settings.foregroundCropPercent ?? 0}
              thumbnailFontName={settings.thumbnailFontName}
              thumbnailFontSize={settings.thumbnailFontSize}
              onPositionChange={settings.setSubtitlePosition}
              onBlackoutChange={settings.setBlackoutTop}
              onRenderResolutionChange={settings.setRenderResolution}
              onLogoPositionChange={(pos) => settings.setLogoPosition(pos || undefined)}
              onLogoScaleChange={(scale) => settings.setLogoScale(scale)}
              thumbnailText={isMultiFolder ? (hardsubSettings.thumbnailTextsByOrder[0] || '') : hardsubSettings.thumbnailText}
              onThumbnailTextChange={isMultiFolder ? undefined : hardsubSettings.setThumbnailText}
              thumbnailTextReadOnly={isMultiFolder}
              thumbnailTextHelper={isMultiFolder ? 'Multi-folder: chỉnh text ở danh sách bên trái.' : undefined}
              onFrameTimeChange={settings.setThumbnailFrameTimeSec}
              selectedFrameTimeSec={settings.thumbnailFrameTimeSec}
              renderSnapshotMode={effectivePreviewMode === 'render'}
              onSelectLogo={handleSelectLogo}
              onRemoveLogo={handleRemoveLogo}
              interactiveDisabledReason={
                effectivePreviewMode === 'render'
                  ? 'Đang xem snapshot render 100% từ caption_session.json. Chuyển Live để chỉnh layer.'
                  : (!processing.enabledSteps.has(7) ? 'Chưa bật B7 Render' : undefined)
              }
            />
            <div className={styles.thumbnailPreviewPanel}>
              <div className={styles.thumbnailPreviewHeader}>
                <span className={styles.thumbnailPreviewTitle}>
                  <ImageIcon size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  Thumbnail Preview (Frame thật)
                </span>
                <span className={styles.thumbnailPreviewSource}>
                  {isMultiFolder ? 'Nguồn: folder đầu tiên' : 'Nguồn: folder hiện tại'}
                </span>
              </div>
              <div className={styles.thumbnailPreviewMeta}>
                frame {thumbnailPreviewFrameSec.toFixed(2)}s | {settings.thumbnailFontName} {settings.thumbnailFontSize ?? 145}px
              </div>
              <div
                className={styles.thumbnailPreviewImageBox}
                style={thumbnailPreviewAspect ? { aspectRatio: thumbnailPreviewAspect } : undefined}
              >
                {thumbnailPreviewFrameData ? (
                  <img
                    src={`data:image/png;base64,${thumbnailPreviewFrameData}`}
                    alt="Thumbnail preview frame thật"
                    className={styles.thumbnailPreviewImage}
                  />
                ) : (
                  <div className={styles.thumbnailPreviewPlaceholder}>
                    Chưa có ảnh thumbnail preview.
                  </div>
                )}
              </div>
              <div className={styles.thumbnailPreviewActions}>
                <button
                  className={styles.resetBtnLike}
                  onClick={handleRefreshThumbnailPreview}
                  disabled={!thumbnailPreviewVideoPath || thumbnailPreviewStatus === 'rendering'}
                  title={!thumbnailPreviewVideoPath ? 'Không có video nguồn' : 'Render lại thumbnail frame thật'}
                >
                  <RefreshCw size={12} />
                  {thumbnailPreviewStatus === 'rendering' ? 'Đang render...' : 'Làm mới'}
                </button>
                <span className={styles.thumbnailPreviewStatus}>
                  {thumbnailPreviewStatus === 'ready' && thumbnailPreviewSize
                    ? `Ready ${thumbnailPreviewSize.width}x${thumbnailPreviewSize.height}`
                    : thumbnailPreviewStatus === 'rendering'
                      ? 'Rendering...'
                      : thumbnailPreviewStatus === 'error'
                        ? 'Error'
                        : 'Idle'}
                </span>
              </div>
              <div className={styles.thumbnailPreviewMessage} title={thumbnailPreviewMessage}>
                {thumbnailPreviewMessage}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
