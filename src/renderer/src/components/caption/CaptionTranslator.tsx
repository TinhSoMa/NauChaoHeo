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
  normalizeVoiceValue,
} from '../../config/captionConfig';
import {
  HardsubTimingMetrics,
  Step,
  SubtitleEntry,
  ThumbnailPreviewContextKey,
} from './CaptionTypes';
import { useCaptionSettings } from './hooks/useCaptionSettings';
import { useCaptionFileManagement } from './hooks/useCaptionFileManagement';
import { useCaptionProcessing } from './hooks/useCaptionProcessing';
import { useHardsubSettings } from './hooks/useHardsubSettings';
import { ensureCaptionFontLoaded } from './hooks/captionFontLoader';
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
import { ThumbnailPreviewPanel } from './components/ThumbnailPreviewPanel';
import { SubtitlePreview } from './SubtitlePreview';
import { calculateHardsubTiming } from '@shared/utils/hardsubTiming';
import { Download, Eye } from 'lucide-react';
import { CaptionProjectSettingsValues, CoverQuad, VoiceInfo } from '@shared/types/caption';

type TtsVoiceProvider = 'edge' | 'capcut';
type TtsVoiceTier = 'free' | 'pro';
type CommonConfigTab = 'render' | 'typography' | 'audio';
type LayoutSwitchValue = 'landscape' | 'portrait';
type InspectorPane = 'step' | 'common' | 'snapshot';

const DEFAULT_COVER_QUAD: CoverQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

interface TtsUiVoiceOption {
  value: string;
  label: string;
  provider: TtsVoiceProvider;
  tier: TtsVoiceTier;
}

const FALLBACK_TTS_VOICES: TtsUiVoiceOption[] = VOICES.map((voice) => ({
  value: normalizeVoiceValue(voice.value),
  label: voice.label,
  provider: 'edge',
  tier: 'free',
}));

function parseProviderFromVoiceValue(value: string): TtsVoiceProvider {
  if (value.toLowerCase().startsWith('capcut:')) {
    return 'capcut';
  }
  return 'edge';
}

function toUiVoiceOption(voice: VoiceInfo): TtsUiVoiceOption {
  const provider = voice.provider === 'capcut' ? 'capcut' : 'edge';
  const voiceId = (voice.voiceId || voice.name || '').trim();
  const canonical = normalizeVoiceValue(voice.value || `${provider}:${voiceId}`);
  const tier: TtsVoiceTier = voice.tier === 'pro' ? 'pro' : 'free';
  const providerLabel = provider === 'capcut' ? 'CapCut' : 'Edge';
  const tierSuffix = provider === 'capcut' && tier === 'pro' ? ' [PRO]' : '';
  const displayName = (voice.displayName || voice.name || canonical).trim();
  return {
    value: canonical,
    label: `${displayName} (${providerLabel})${tierSuffix}`,
    provider,
    tier,
  };
}

function ensureVoiceOptionExists(
  options: TtsUiVoiceOption[],
  selectedVoice: string
): TtsUiVoiceOption[] {
  const normalized = normalizeVoiceValue(selectedVoice);
  if (options.some((option) => option.value === normalized)) {
    return options;
  }
  const provider = parseProviderFromVoiceValue(normalized);
  return [
    ...options,
    {
      value: normalized,
      label: `${normalized} (Saved)`,
      provider,
      tier: 'free',
    },
  ];
}

export function CaptionTranslator() {
  // Project output paths
  const { paths, projectId } = useProjectContext();
  const captionFolder = paths?.caption ?? null;

  // 1. Settings Hook
  const settings = useCaptionSettings();
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<TtsUiVoiceOption[]>(() =>
    ensureVoiceOptionExists(FALLBACK_TTS_VOICES, settings.voice)
  );

  useEffect(() => {
    const normalizedVoice = normalizeVoiceValue(settings.voice);
    if (normalizedVoice !== settings.voice) {
      settings.setVoice(normalizedVoice);
      return;
    }
    setTtsVoiceOptions((current) => ensureVoiceOptionExists(current, normalizedVoice));
  }, [settings.voice, settings.setVoice]);

  useEffect(() => {
    let cancelled = false;

    const loadTtsVoices = async () => {
      try {
        const response = await window.electronAPI.tts.getVoices();
        if (!response?.success || !Array.isArray(response.data) || response.data.length === 0) {
          if (!cancelled) {
            setTtsVoiceOptions(ensureVoiceOptionExists(FALLBACK_TTS_VOICES, settings.voice));
          }
          return;
        }

        const deduped = new Map<string, TtsUiVoiceOption>();
        for (const voice of response.data) {
          const mapped = toUiVoiceOption(voice);
          if (!deduped.has(mapped.value)) {
            deduped.set(mapped.value, mapped);
          }
        }

        const nextOptions = Array.from(deduped.values());
        if (!cancelled) {
          setTtsVoiceOptions(ensureVoiceOptionExists(nextOptions, settings.voice));
        }
      } catch (error) {
        console.warn('[CaptionTranslator] Không thể tải voice list từ main process', error);
        if (!cancelled) {
          setTtsVoiceOptions(ensureVoiceOptionExists(FALLBACK_TTS_VOICES, settings.voice));
        }
      }
    };

    loadTtsVoices();
    return () => {
      cancelled = true;
    };
  }, []);

  const edgeVoiceOptions = useMemo(
    () => ttsVoiceOptions.filter((voice) => voice.provider === 'edge'),
    [ttsVoiceOptions]
  );
  const capCutVoiceOptions = useMemo(
    () => ttsVoiceOptions.filter((voice) => voice.provider === 'capcut'),
    [ttsVoiceOptions]
  );
  const isCapCutVoiceSelected = useMemo(
    () => normalizeVoiceValue(settings.voice).startsWith('capcut:'),
    [settings.voice]
  );
  const selectedVoiceLabel = useMemo(
    () => ttsVoiceOptions.find((voice) => voice.value === settings.voice)?.label || settings.voice,
    [settings.voice, ttsVoiceOptions]
  );

  // 2. File Management Hook
  const fileManager = useCaptionFileManagement({
    inputType: settings.inputType,
  });

  const hardsubSettings = useHardsubSettings({
    inputType: settings.inputType,
    filePath: fileManager.filePath,
    folderVideos: fileManager.folderVideos,
    thumbnailEnabled: settings.thumbnailFrameTimeSec !== null && settings.thumbnailFrameTimeSec !== undefined,
    thumbnailTextSecondaryGlobal: settings.thumbnailTextSecondary || '',
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
    renderContainer: settings.renderContainer,
    blackoutTop: settings.blackoutTop,
    coverMode: settings.coverMode,
    coverQuad: settings.coverQuad,
    audioSpeed: settings.audioSpeed,
    renderAudioSpeed: settings.renderAudioSpeed,
    videoVolume: settings.videoVolume,
    audioVolume: settings.audioVolume,
    thumbnailFontName: settings.thumbnailFontName,
    thumbnailFontSize: settings.thumbnailFontSize,
    thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
    thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
    thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
    thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
    thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
    thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
    thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
    thumbnailTextSecondary: settings.thumbnailTextSecondary,
    thumbnailTextPrimaryPosition: settings.thumbnailTextPrimaryPosition,
    thumbnailTextSecondaryPosition: settings.thumbnailTextSecondaryPosition,
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
    settings.renderContainer,
    settings.blackoutTop,
    settings.coverMode,
    settings.coverQuad,
    settings.audioSpeed,
    settings.renderAudioSpeed,
    settings.videoVolume,
    settings.audioVolume,
    settings.thumbnailFontName,
    settings.thumbnailFontSize,
    settings.thumbnailTextPrimaryFontName,
    settings.thumbnailTextPrimaryFontSize,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextSecondaryFontName,
    settings.thumbnailTextSecondaryFontSize,
    settings.thumbnailTextSecondaryColor,
    settings.thumbnailLineHeightRatio,
    settings.thumbnailTextSecondary,
    settings.thumbnailTextPrimaryPosition,
    settings.thumbnailTextSecondaryPosition,
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
        const secondaryTexts: string[] = [];
        const secondaryOverrideFlags: boolean[] = [];
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
          secondaryTexts.push(typeof step7.thumbnailTextSecondary === 'string' ? step7.thumbnailTextSecondary : '');
          secondaryOverrideFlags.push(step7.thumbnailTextSecondarySource === 'override');
        }
        if (!cancelled) {
          hardsubSettings.setThumbnailTextsByOrder(texts);
          hardsubSettings.setSecondaryStateFromSession(secondaryTexts, secondaryOverrideFlags);
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
        settings.setThumbnailTextSecondary(typeof step7.thumbnailTextSecondary === 'string' ? step7.thumbnailTextSecondary : '');
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
          const secondaryText = (hardsubSettings.thumbnailTextsSecondaryByOrder[i] || '').trim();
          const secondarySource = hardsubSettings.thumbnailTextSecondaryOverrideFlags[i] ? 'override' : 'global';
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
                  thumbnailTextSecondary: secondaryText,
                  thumbnailTextSecondarySource: secondarySource,
                  thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
                  thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
                  thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
                  thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
                  thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
                  thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
                  thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
                  thumbnailTextPrimaryPosition: settings.thumbnailTextPrimaryPosition,
                  thumbnailTextSecondaryPosition: settings.thumbnailTextSecondaryPosition,
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
              thumbnailTextSecondary: settings.thumbnailTextSecondary || '',
              thumbnailTextSecondarySource: 'single',
              thumbnailTextPrimaryFontName: settings.thumbnailTextPrimaryFontName,
              thumbnailTextPrimaryFontSize: settings.thumbnailTextPrimaryFontSize,
              thumbnailTextPrimaryColor: settings.thumbnailTextPrimaryColor,
              thumbnailTextSecondaryFontName: settings.thumbnailTextSecondaryFontName,
              thumbnailTextSecondaryFontSize: settings.thumbnailTextSecondaryFontSize,
              thumbnailTextSecondaryColor: settings.thumbnailTextSecondaryColor,
              thumbnailLineHeightRatio: settings.thumbnailLineHeightRatio,
              thumbnailTextPrimaryPosition: settings.thumbnailTextPrimaryPosition,
              thumbnailTextSecondaryPosition: settings.thumbnailTextSecondaryPosition,
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
    hardsubSettings.thumbnailTextsSecondaryByOrder,
    hardsubSettings.thumbnailTextSecondaryOverrideFlags,
    settings.thumbnailTextSecondary,
    settings.thumbnailTextPrimaryFontName,
    settings.thumbnailTextPrimaryFontSize,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextSecondaryFontName,
    settings.thumbnailTextSecondaryFontSize,
    settings.thumbnailTextSecondaryColor,
    settings.thumbnailLineHeightRatio,
    settings.thumbnailTextPrimaryPosition,
    settings.thumbnailTextSecondaryPosition,
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
      thumbnailTextSecondary: settings.thumbnailTextSecondary,
      thumbnailTextsSecondaryByOrder: hardsubSettings.thumbnailTextsSecondaryByOrder,
      thumbnailTextSecondaryOverrideFlags: hardsubSettings.thumbnailTextSecondaryOverrideFlags,
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
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);

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
  const [previewMode, setPreviewMode] = useState<'render' | 'live'>('live');

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

        if (finalVideoPathRaw) {
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
  const thumbnailPreviewInputPath = settings.inputType === 'draft'
    ? (firstFolderPath || getInputPaths('draft', fileManager.filePath)[0] || '')
    : fileManager.filePath;
  const thumbnailPreviewContextKey: ThumbnailPreviewContextKey | null = (projectId && thumbnailPreviewInputPath)
    ? {
        projectId,
        folderPath: thumbnailPreviewInputPath,
        layoutKey: settings.renderMode === 'hardsub_portrait_9_16' ? 'portrait' : 'landscape',
      }
    : null;
  const thumbnailPreviewText = isMultiFolder
    ? (hardsubSettings.thumbnailTextsByOrder[0] || '')
    : hardsubSettings.thumbnailText;
  const thumbnailPreviewSecondaryText = isMultiFolder
    ? (hardsubSettings.thumbnailTextsSecondaryByOrder[0] || '')
    : (settings.thumbnailTextSecondary || '');

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
        const inputPaths = getInputPaths(settings.inputType, fileManager.filePath);
        const activeInputPath = processing.currentFolder?.path ?? inputPaths[0];
        const safeScale = settings.srtSpeed > 0 ? settings.srtSpeed : 1.0;
        const speedLabel = safeScale.toFixed(2).replace(/\.?0+$/, '');
        const candidateAudioPaths: string[] = [];

        if (activeInputPath) {
          const sessionPath = getSessionPathForInputPath(settings.inputType, activeInputPath);
          const session = await readCaptionSession(sessionPath, {
            projectId,
            inputType: settings.inputType,
            sourcePath: activeInputPath,
            folderPath: settings.inputType === 'draft'
              ? activeInputPath
              : activeInputPath.replace(/[^/\\]+$/, ''),
          });
          const artifactMergedPath = typeof session.artifacts.mergedAudioPath === 'string'
            ? session.artifacts.mergedAudioPath.trim()
            : '';
          const mergeResult = (session.data.mergeResult && typeof session.data.mergeResult === 'object')
            ? (session.data.mergeResult as Record<string, unknown>)
            : {};
          const mergeResultPath = typeof mergeResult.outputPath === 'string'
            ? mergeResult.outputPath.trim()
            : '';

          if (artifactMergedPath) {
            candidateAudioPaths.push(artifactMergedPath);
          }
          if (mergeResultPath) {
            candidateAudioPaths.push(mergeResultPath);
          }
        }

        candidateAudioPaths.push(`${displayOutputDir}/merged_audio_${speedLabel}x.wav`);
        candidateAudioPaths.push(`${displayOutputDir}/merged_audio.wav`);

        const uniqueAudioPaths = Array.from(new Set(candidateAudioPaths.filter((p) => !!p)));
        let resolvedDuration: number | null = null;

        for (const audioPath of uniqueAudioPaths) {
          console.log('Fetching metadata for audio path:', audioPath);
          const res = await (window.electronAPI as any).captionVideo.getVideoMetadata(audioPath);
          console.log('Metadata response:', res);
          if (!res?.success || !res.data?.duration) {
            continue;
          }

          const audioDuration: number = res.data.duration;
          // Sanity check: nếu audio > 2× video duration → stale file từ run cũ, thử candidate khác
          if (originalVideoDuration > 0 && audioDuration > originalVideoDuration * 2) {
            console.warn(`diskAudioDuration ${audioDuration}s > 2× video ${originalVideoDuration}s — stale candidate, continue`);
            continue;
          }

          resolvedDuration = audioDuration;
          break;
        }

        if (mounted) {
          setDiskAudioDuration(resolvedDuration);
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
  }, [
    displayOutputDir,
    fileManager.filePath,
    originalVideoDuration,
    processing.currentFolder?.path,
    processing.status,
    projectId,
    settings.inputType,
    settings.srtSpeed,
  ]);

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

  useEffect(() => {
    let cancelled = false;

    const preloadFontsForUi = async () => {
      for (const fontName of availableFonts) {
        if (cancelled) {
          return;
        }
        try {
          await ensureCaptionFontLoaded(fontName);
        } catch (error) {
          console.warn(`[CaptionTranslator] Không preload được font: ${fontName}`, error);
        }
      }
    };

    preloadFontsForUi();
    return () => {
      cancelled = true;
    };
  }, [availableFonts]);
  
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
    if (persistedStatus === 'stopped') {
      return { label: 'Stopped', className: `${styles.statusBadge} ${styles.statusStopped}` };
    }
    if (persistedStatus === 'stale') {
      return { label: 'Stale', className: `${styles.statusBadge} ${styles.statusError}` };
    }
    if (processing.status === 'success' && processing.enabledSteps.has(step)) {
      return { label: 'Done', className: `${styles.statusBadge} ${styles.statusDone}` };
    }
    return { label: processing.enabledSteps.has(step) ? 'Idle' : 'Off', className: `${styles.statusBadge} ${styles.statusIdle}` };
  };

  const getStepToneClass = (label: string): string => {
    if (label === 'Running') return styles.stepToneRunning;
    if (label === 'Done') return styles.stepToneDone;
    if (label === 'Skipped') return styles.stepToneWarning;
    if (label === 'Error' || label === 'Blocked' || label === 'Stale') return styles.stepToneError;
    if (label === 'Stopped') return styles.stepToneWarning;
    if (label === 'Off') return styles.stepToneMuted;
    return styles.stepToneIdle;
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
      {
        key: 'TTS',
        value: isCapCutVoiceSelected
          ? `${selectedVoiceLabel} | Rate/Volume: fixed (CapCut)`
          : `${selectedVoiceLabel} | rate ${settings.rate} | vol ${settings.volume}`,
      },
      { key: 'Mode', value: `${settings.renderMode} / ${settings.renderResolution} / ${settings.renderContainer?.toUpperCase() || 'MP4'}` },
      { key: 'Speed', value: `audio ${settings.renderAudioSpeed}x | video ${autoVideoSpeed.toFixed(2)}x` },
      { key: 'Âm lượng', value: `video ${settings.videoVolume}% | TTS ${settings.audioVolume}%` },
      { key: 'Sub pos', value: subtitlePos },
      { key: 'Logo', value: `${logoPos} | scale ${Math.round((settings.logoScale || 1) * 100)}%` },
      {
        key: 'Thumbnail',
        value:
          `${settings.thumbnailDurationSec ?? 0.5}s @ ${settings.thumbnailFrameTimeSec ?? 0}s | ` +
          `T1 ${settings.thumbnailTextPrimaryFontName || settings.thumbnailFontName} ${settings.thumbnailTextPrimaryFontSize ?? settings.thumbnailFontSize ?? 145}px | ` +
          `T2 ${settings.thumbnailTextSecondaryFontName || settings.thumbnailFontName} ${settings.thumbnailTextSecondaryFontSize ?? settings.thumbnailFontSize ?? 145}px | ` +
          `C1 ${(settings.thumbnailTextPrimaryColor || '#FFFF00').toUpperCase()} | C2 ${(settings.thumbnailTextSecondaryColor || '#FFFF00').toUpperCase()} | ` +
          `line ${Number(settings.thumbnailLineHeightRatio ?? 1.16).toFixed(2)}x`,
      },
      {
        key: 'Preview',
        value: previewSourceLabel === 'session_translated_entries'
          ? 'Session translated'
          : 'Session data',
      },
    ];
  }, [
    settings.inputType,
    settings.translateMethod,
    settings.geminiModel,
    isCapCutVoiceSelected,
    selectedVoiceLabel,
    settings.rate,
    settings.volume,
    settings.renderMode,
    settings.renderResolution,
    settings.renderContainer,
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
    settings.thumbnailTextPrimaryFontName,
    settings.thumbnailTextPrimaryFontSize,
    settings.thumbnailTextPrimaryColor,
    settings.thumbnailTextSecondaryFontName,
    settings.thumbnailTextSecondaryFontSize,
    settings.thumbnailTextSecondaryColor,
    settings.thumbnailLineHeightRatio,
    autoVideoSpeed,
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

  const [activeStep, setActiveStep] = useState<Step>(1);
  const [activePreviewTab, setActivePreviewTab] = useState<'subtitle' | 'thumbnail'>('subtitle');
  const [commonConfigTab, setCommonConfigTab] = useState<CommonConfigTab>('render');
  const [inspectorPane, setInspectorPane] = useState<InspectorPane>('step');
  const [preferredLandscapeRenderMode, setPreferredLandscapeRenderMode] = useState<'hardsub' | 'black_bg'>(
    settings.renderMode === 'black_bg' ? 'black_bg' : 'hardsub'
  );

  useEffect(() => {
    if (settings.renderMode === 'hardsub' || settings.renderMode === 'black_bg') {
      setPreferredLandscapeRenderMode(settings.renderMode);
    }
  }, [settings.renderMode]);

  useEffect(() => {
    setInspectorPane('step');
  }, [activeStep]);

  const activeLayoutSwitch: LayoutSwitchValue = settings.renderMode === 'hardsub_portrait_9_16'
    ? 'portrait'
    : 'landscape';

  const applyLayoutSwitch = (layout: LayoutSwitchValue) => {
    if (layout === 'portrait') {
      settings.setRenderMode('hardsub_portrait_9_16');
      return;
    }
    settings.setRenderMode(preferredLandscapeRenderMode || 'hardsub');
  };

  const applyLandscapeRenderMode = (mode: 'hardsub' | 'black_bg') => {
    setPreferredLandscapeRenderMode(mode);
    if (activeLayoutSwitch === 'landscape') {
      settings.setRenderMode(mode);
    }
  };

  const STEP_DESCRIPTION: Record<Step, string> = {
    1: 'Chọn nguồn SRT/Draft và nạp dữ liệu caption.',
    2: 'Tách subtitle theo dòng hoặc theo số phần.',
    3: 'Thiết lập phương thức dịch và model.',
    4: 'Thiết lập voice TTS (tham số render/audio ở Common).',
    5: 'Step 5 chưa có cấu hình riêng.',
    6: 'Step 6 dùng cấu hình audio ở các bước trước.',
    7: 'Tiện ích Step 7 + thumbnail theo folder.',
  };

  const selectedInputPaths = useMemo(
    () => getInputPaths('draft', fileManager.filePath),
    [fileManager.filePath]
  );

  const commonConfigBar = (
    <div className={styles.commonConfigBar}>
      <div className={styles.commonConfigTop}>
        <div className={styles.commonConfigTitle}>Common Config</div>
        <div className={styles.commonLayoutSwitch}>
          <button
            type="button"
            className={`${styles.commonLayoutBtn} ${activeLayoutSwitch === 'landscape' ? styles.commonLayoutBtnActive : ''}`}
            onClick={() => applyLayoutSwitch('landscape')}
          >
            16:9
          </button>
          <button
            type="button"
            className={`${styles.commonLayoutBtn} ${activeLayoutSwitch === 'portrait' ? styles.commonLayoutBtnActive : ''}`}
            onClick={() => applyLayoutSwitch('portrait')}
          >
            9:16
          </button>
        </div>
      </div>

      <div className={styles.commonConfigTabs}>
        <button
          type="button"
          className={`${styles.commonConfigTabBtn} ${commonConfigTab === 'render' ? styles.commonConfigTabBtnActive : ''}`}
          onClick={() => setCommonConfigTab('render')}
        >
          Render
        </button>
        <button
          type="button"
          className={`${styles.commonConfigTabBtn} ${commonConfigTab === 'typography' ? styles.commonConfigTabBtnActive : ''}`}
          onClick={() => setCommonConfigTab('typography')}
        >
          Typography
        </button>
        <button
          type="button"
          className={`${styles.commonConfigTabBtn} ${commonConfigTab === 'audio' ? styles.commonConfigTabBtnActive : ''}`}
          onClick={() => setCommonConfigTab('audio')}
        >
          Audio
        </button>
      </div>

      <div className={styles.commonConfigBody}>
        {commonConfigTab === 'render' && (
          <div className={styles.commonConfigSection}>
            <div className={styles.commonInlineSection}>
              <span className={styles.label}>Landscape mode</span>
              <div className={styles.commonPillRow}>
                <button
                  type="button"
                  className={`${styles.commonPillBtn} ${preferredLandscapeRenderMode === 'hardsub' ? styles.commonPillBtnActive : ''}`}
                  onClick={() => applyLandscapeRenderMode('hardsub')}
                >
                  Hardsub
                </button>
                <button
                  type="button"
                  className={`${styles.commonPillBtn} ${preferredLandscapeRenderMode === 'black_bg' ? styles.commonPillBtnActive : ''}`}
                  onClick={() => applyLandscapeRenderMode('black_bg')}
                >
                  Nền đen
                </button>
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Render resolution</label>
                <select
                  value={settings.renderResolution}
                  onChange={(e) => settings.setRenderResolution(e.target.value as any)}
                  className={styles.select}
                >
                  {settings.renderMode === 'hardsub_portrait_9_16' ? (
                    <>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="540p">540p</option>
                      <option value="360p">360p</option>
                    </>
                  ) : (
                    <>
                      <option value="original">Gốc</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="540p">540p</option>
                      <option value="360p">360p</option>
                    </>
                  )}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Container</label>
                <select
                  value={settings.renderContainer || 'mp4'}
                  onChange={(e) => settings.setRenderContainer(e.target.value as 'mp4' | 'mov')}
                  className={styles.select}
                >
                  <option value="mp4">MP4</option>
                  <option value="mov">MOV</option>
                </select>
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Hardware</label>
                <select
                  className={styles.select}
                  value={settings.hardwareAcceleration}
                  onChange={(e) => settings.setHardwareAcceleration(e.target.value as 'none' | 'qsv' | 'nvenc')}
                >
                  <option value="none">CPU</option>
                  <option value="qsv">QSV</option>
                  <option value="nvenc">NVENC</option>
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Mask mode</label>
                <select
                  className={styles.select}
                  value={settings.coverMode || 'blackout_bottom'}
                  onChange={(e) => settings.setCoverMode(e.target.value as 'blackout_bottom' | 'copy_from_above')}
                  disabled={settings.renderMode === 'black_bg'}
                >
                  <option value="blackout_bottom">Che đen đáy</option>
                  <option value="copy_from_above">Copy vùng trên</option>
                </select>
              </div>
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Mức che đáy</span>
                <span className={styles.commonInlineValue}>
                  {Math.round((1 - (settings.blackoutTop ?? 0.9)) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.99}
                step={0.01}
                value={settings.blackoutTop ?? 0.9}
                onChange={(e) => settings.setBlackoutTop(Number(e.target.value))}
                disabled={settings.renderMode === 'black_bg'}
              />
              <div className={styles.commonInlineActions}>
                <button type="button" className={styles.resetBtnLike} onClick={() => settings.setBlackoutTop(null)}>
                  Auto
                </button>
                <button type="button" className={styles.resetBtnLike} onClick={() => settings.setCoverQuad(DEFAULT_COVER_QUAD)}>
                  Reset cover quad
                </button>
              </div>
            </div>

            {settings.renderMode === 'hardsub_portrait_9_16' && (
              <div className={styles.commonInlineSection}>
                <div className={styles.commonInlineHeader}>
                  <span className={styles.label}>Crop ngang foreground</span>
                  <span className={styles.commonInlineValue}>{Math.round(settings.portraitForegroundCropPercent ?? 0)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={settings.portraitForegroundCropPercent ?? 0}
                  onChange={(e) => settings.setPortraitForegroundCropPercent(Number(e.target.value))}
                />
              </div>
            )}

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Thumb duration (s)</label>
                <Input
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={settings.thumbnailDurationSec ?? 0.5}
                  onChange={(e) => settings.setThumbnailDurationSec(Number(e.target.value))}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Thumb frame (s)</label>
                <Input
                  type="number"
                  min={0}
                  max={3600}
                  step={0.1}
                  value={settings.thumbnailFrameTimeSec ?? 0}
                  onChange={(e) => settings.setThumbnailFrameTimeSec(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Logo</span>
                <span className={styles.commonInlineValue}>
                  {settings.logoPath ? `${Math.round((settings.logoScale || 1) * 100)}%` : 'Off'}
                </span>
              </div>
              <div className={styles.commonInlineActions}>
                <button type="button" className={styles.resetBtnLike} onClick={handleSelectLogo}>
                  Chọn logo
                </button>
                <button
                  type="button"
                  className={styles.resetBtnLike}
                  onClick={handleRemoveLogo}
                  disabled={!settings.logoPath}
                >
                  Xóa logo
                </button>
                <button
                  type="button"
                  className={styles.resetBtnLike}
                  onClick={() => settings.setLogoPosition(undefined)}
                  disabled={!settings.logoPath}
                >
                  Reset vị trí
                </button>
              </div>
              <div className={styles.commonHint}>
                {settings.logoPath
                  ? `Logo: ${(settings.logoPath.split(/[/\\]/).pop() || settings.logoPath)}`
                  : 'Chưa chọn logo'}
              </div>
            </div>
          </div>
        )}

        {commonConfigTab === 'typography' && (
          <div className={styles.commonConfigSection}>
            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Font subtitle</label>
                <select
                  className={styles.select}
                  value={settings.style?.fontName || 'ZYVNA Fairy'}
                  onChange={(e) => settings.setStyle((s: any) => ({ ...s, fontName: e.target.value }))}
                >
                  {availableFonts.map((font) => (
                    <option key={`sub-${font}`} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Size subtitle</label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={settings.style?.fontSize}
                  onChange={(e) => settings.setStyle((s: any) => ({ ...s, fontSize: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Màu subtitle</label>
                <input
                  className={styles.colorInput}
                  type="color"
                  value={settings.style?.fontColor || '#FFFF00'}
                  onChange={(e) => settings.setStyle((s: any) => ({ ...s, fontColor: e.target.value }))}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Shadow subtitle</label>
                <Input
                  type="number"
                  min={0}
                  max={20}
                  step={1}
                  value={settings.style?.shadow ?? 4}
                  onChange={(e) => settings.setStyle((s: any) => ({ ...s, shadow: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Subtitle position</span>
                <span className={styles.commonInlineValue}>
                  {settings.subtitlePosition
                    ? `${settings.subtitlePosition.x.toFixed(3)}, ${settings.subtitlePosition.y.toFixed(3)}`
                    : 'Auto'}
                </span>
              </div>
              <div className={styles.commonInlineActions}>
                <button type="button" className={styles.resetBtnLike} onClick={() => settings.setSubtitlePosition(null)}>
                  Dùng auto
                </button>
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Font Text1</label>
                <select
                  className={styles.select}
                  value={settings.thumbnailTextPrimaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
                  onChange={(e) => settings.setThumbnailTextPrimaryFontName(e.target.value)}
                >
                  {availableFonts.map((font) => (
                    <option key={`t1-${font}`} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Size Text1</label>
                <Input
                  type="number"
                  min={24}
                  max={400}
                  step={1}
                  value={settings.thumbnailTextPrimaryFontSize ?? 145}
                  onChange={(e) => settings.setThumbnailTextPrimaryFontSize(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Màu Text1</label>
                <input
                  className={styles.colorInput}
                  type="color"
                  value={settings.thumbnailTextPrimaryColor || '#FFFF00'}
                  onChange={(e) => settings.setThumbnailTextPrimaryColor(e.target.value)}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Line height</label>
                <Input
                  type="number"
                  min={0}
                  max={4}
                  step={0.02}
                  value={Number(settings.thumbnailLineHeightRatio ?? 1.16).toFixed(2)}
                  onChange={(e) => settings.setThumbnailLineHeightRatio(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Font Text2</label>
                <select
                  className={styles.select}
                  value={settings.thumbnailTextSecondaryFontName || settings.thumbnailFontName || 'BrightwallPersonal'}
                  onChange={(e) => settings.setThumbnailTextSecondaryFontName(e.target.value)}
                >
                  {availableFonts.map((font) => (
                    <option key={`t2-${font}`} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Size Text2</label>
                <Input
                  type="number"
                  min={24}
                  max={400}
                  step={1}
                  value={settings.thumbnailTextSecondaryFontSize ?? 145}
                  onChange={(e) => settings.setThumbnailTextSecondaryFontSize(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Màu Text2</label>
                <input
                  className={styles.colorInput}
                  type="color"
                  value={settings.thumbnailTextSecondaryColor || '#FFFF00'}
                  onChange={(e) => settings.setThumbnailTextSecondaryColor(e.target.value)}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Text1 pos</label>
                <div className={styles.commonHint}>
                  {settings.thumbnailTextPrimaryPosition.x.toFixed(3)}, {settings.thumbnailTextPrimaryPosition.y.toFixed(3)}
                </div>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Text2 pos</label>
                <div className={styles.commonHint}>
                  {settings.thumbnailTextSecondaryPosition.x.toFixed(3)}, {settings.thumbnailTextSecondaryPosition.y.toFixed(3)}
                </div>
              </div>
            </div>

            <div className={styles.commonInlineActions}>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => settings.setThumbnailTextPrimaryPosition({ x: 0.5, y: 0.5 })}
              >
                Reset Text1 pos
              </button>
              <button
                type="button"
                className={styles.resetBtnLike}
                onClick={() => settings.setThumbnailTextSecondaryPosition({ x: 0.5, y: 0.64 })}
              >
                Reset Text2 pos
              </button>
            </div>
          </div>
        )}

        {commonConfigTab === 'audio' && (
          <div className={styles.commonConfigSection}>
            <div className={styles.grid2}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Scale SRT (step4/6/7)</label>
                <Input
                  type="number"
                  value={settings.srtSpeed}
                  onChange={(e) => settings.setSrtSpeed(Number(e.target.value))}
                  min={1}
                  max={2}
                  step={0.1}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Render audio speed</label>
                <Input
                  type="number"
                  value={settings.renderAudioSpeed}
                  onChange={(e) => settings.setRenderAudioSpeed(Number(e.target.value))}
                  min={0.5}
                  max={5}
                  step={0.1}
                />
              </div>
            </div>

            <div style={{ marginTop: '8px' }}>
              <Checkbox
                label="Auto fit audio"
                checked={settings.autoFitAudio}
                onChange={() => settings.setAutoFitAudio(!settings.autoFitAudio)}
              />
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Âm lượng video</span>
                <span className={styles.commonInlineValue}>{settings.videoVolume}%</span>
              </div>
              <input
                type="range"
                value={settings.videoVolume}
                onChange={(e) => settings.setVideoVolume(Number(e.target.value))}
                min={0}
                max={200}
                step={10}
              />
            </div>

            <div className={styles.commonInlineSection}>
              <div className={styles.commonInlineHeader}>
                <span className={styles.label}>Âm lượng TTS render</span>
                <span className={styles.commonInlineValue}>{settings.audioVolume}%</span>
              </div>
              <input
                type="range"
                value={settings.audioVolume}
                onChange={(e) => settings.setAudioVolume(Number(e.target.value))}
                min={0}
                max={400}
                step={10}
              />
            </div>

            <div className={styles.commonHint}>
              Video {formatDuration(originalVideoDuration)} | Sync {formatDuration(videoSubBaseDuration)} | Audio {formatDuration(audioExpectedDuration)} | Marker {formatDuration(videoMarkerSec)}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const activeStepContent = (() => {
    if (activeStep === 1) {
      return (
        <div className={styles.panelSection}>
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
                onClick={() => {
                  void fileManager.handleBrowseFile();
                }}
              >
                {!fileManager.filePath ? (
                  <span className={styles.placeholderText}>Chưa chọn folder...</span>
                ) : (
                  <div className={styles.folderGrid}>
                    {selectedInputPaths.map((path, idx) => {
                      const folderName = path.split(/[/\\]/).pop() || path;
                      const vInfo = fileManager.folderVideos[path];
                      return (
                        <div key={`${path}-${idx}`} className={styles.folderBox} title={path}>
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
          {settings.inputType === 'draft' && (
            <div className={styles.textMuted} style={{ fontSize: 11, marginTop: '8px' }}>
              Có thể chọn nhiều folder cùng lúc bằng Ctrl/Shift trong hộp thoại.
            </div>
          )}
          {fileManager.entries.length > 0 && (
            <p className={styles.textMuted} style={{ marginTop: '8px' }}>
              Đã load: {fileManager.entries.length} dòng
            </p>
          )}
        </div>
      );
    }

    if (activeStep === 2) {
      return (
        <div className={styles.panelSection}>
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
      );
    }

    if (activeStep === 3) {
      return (
        <div className={styles.panelSection}>
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
      );
    }

    if (activeStep === 4) {
      return (
        <div className={styles.panelSection}>
          <div>
            <label className={styles.label}>Giọng</label>
            <select value={settings.voice} onChange={(e) => settings.setVoice(e.target.value)} className={styles.select}>
              {edgeVoiceOptions.length > 0 && (
                <optgroup label="Edge">
                  {edgeVoiceOptions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {capCutVoiceOptions.length > 0 && (
                <optgroup label="CapCut">
                  {capCutVoiceOptions.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {!isCapCutVoiceSelected && (
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
          )}
          {isCapCutVoiceSelected && (
            <div style={{ marginTop: '12px', fontSize: '12px', opacity: 0.8 }}>
              Giọng CapCut dùng thông số mặc định từ provider, không áp dụng Rate/Volume của Edge.
            </div>
          )}
          <div className={styles.textMuted} style={{ marginTop: '12px', fontSize: 11 }}>
            Các tham số đồng bộ render/audio đã chuyển sang Common Config &gt; Audio.
          </div>
        </div>
      );
    }

    if (activeStep === 5) {
      return (
        <div className={styles.panelSection}>
          <div className={styles.textMuted} style={{ fontSize: 12 }}>
            Step 5 hiện không có cấu hình riêng.
          </div>
        </div>
      );
    }

    if (activeStep === 6) {
      return (
        <div className={styles.panelSection}>
          <div className={styles.textMuted} style={{ fontSize: 12 }}>
            Step 6 dùng cấu hình audio ở các bước trước.
          </div>
        </div>
      );
    }

    return (
      <div className={styles.panelSection}>
        <HardsubSettingsPanel
          visible={processing.enabledSteps.has(7)}
          renderSummary={{
            renderMode: settings.renderMode,
            renderResolution: settings.renderResolution,
            renderContainer: settings.renderContainer || 'mp4',
            thumbnailDurationSec: settings.thumbnailDurationSec ?? 0.5,
            thumbnailFrameTimeSec: settings.thumbnailFrameTimeSec ?? null,
          }}
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
          audioPreview={{
            status: processing.audioPreviewStatus,
            progressText: processing.audioPreviewProgressText,
            dataUri: processing.audioPreviewDataUri,
            meta: processing.audioPreviewMeta
              ? {
                  folderName: processing.audioPreviewMeta.folderName,
                  startSec: processing.audioPreviewMeta.startSec,
                  endSec: processing.audioPreviewMeta.endSec,
                  markerSec: processing.audioPreviewMeta.markerSec,
                  outputPath: processing.audioPreviewMeta.outputPath,
                }
              : null,
            disabled: processing.status === 'running',
            onTest: () => processing.handleStep7AudioPreview(displayPath || undefined),
            onStop: () => {
              void processing.stopStep7AudioPreview();
            },
          }}
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
              secondaryGlobalText={hardsubSettings.thumbnailTextSecondary}
              onSecondaryGlobalTextChange={(value) => {
                hardsubSettings.setThumbnailTextSecondaryGlobal(value);
                settings.setThumbnailTextSecondary(value);
              }}
              onItemTextChange={hardsubSettings.updateThumbnailTextByOrder}
              onItemSecondaryTextChange={hardsubSettings.setThumbnailTextSecondaryByOrder}
              onResetSecondaryOverride={hardsubSettings.resetThumbnailTextSecondaryOverride}
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
    );
  })();

  return (
    <div className={styles.container}>
      <div className={styles.workspace}>
        <aside className={styles.stepRail}>
          <div className={styles.stepRailTitle}>Pipeline</div>
          <div className={styles.stepStatusList}>
            {([1, 2, 3, 4, 5, 6, 7] as Step[]).map((step) => {
              const badge = getStepBadge(step);
              const toneClass = getStepToneClass(badge.label);
              const isActive = activeStep === step;
              const isCurrent = processing.currentStep === step && processing.status === 'running';
              return (
                <button
                  key={step}
                  type="button"
                  className={`${styles.stepStatusBtn} ${isActive ? styles.stepStatusBtnActive : ''} ${isCurrent ? styles.stepStatusBtnCurrent : ''}`}
                  onClick={() => {
                    setActiveStep(step);
                    setInspectorPane('step');
                  }}
                  title={`B${step} ${STEP_SHORT_LABELS[step]} - ${badge.label}`}
                >
                  <span className={`${styles.stepStatusDot} ${toneClass}`} />
                  <span className={styles.stepStatusMain}>
                    <span className={styles.stepStatusCode}>B{step}</span>
                    <span className={styles.stepStatusName}>{STEP_SHORT_LABELS[step]}</span>
                  </span>
                  <span className={`${styles.stepStatusState} ${toneClass}`}>{badge.label}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.stepRailQuick}>
            <button
              type="button"
              className={styles.resetBtnLike}
              onClick={() => {
                setActiveStep(1);
                setInspectorPane('step');
              }}
              title="Mở cấu hình nguồn vào"
            >
              B1 Input
            </button>
            <button
              type="button"
              className={styles.resetBtnLike}
              onClick={() => {
                setActiveStep(1);
                setInspectorPane('step');
                void fileManager.handleBrowseFile();
              }}
              title={settings.inputType === 'draft' ? 'Chọn lại/ thêm nhiều folder' : 'Chọn file SRT'}
            >
              Chọn nguồn
            </button>
          </div>
        </aside>

        <section className={styles.workspaceStage}>
          <div className={styles.stageHeader}>
            <div className={styles.stageTitle}>
              <Eye size={14} />
              Preview
            </div>
            <div className={styles.previewTabGroup}>
              <button
                type="button"
                className={`${styles.resetBtnLike} ${activePreviewTab === 'subtitle' ? styles.previewModeBtnActive : ''}`}
                onClick={() => setActivePreviewTab('subtitle')}
              >
                Subtitle
              </button>
              <button
                type="button"
                className={`${styles.resetBtnLike} ${activePreviewTab === 'thumbnail' ? styles.previewModeBtnActive : ''}`}
                onClick={() => setActivePreviewTab('thumbnail')}
              >
                Thumbnail
              </button>
            </div>
          </div>

          <div className={styles.stageBody}>
            {activePreviewTab === 'subtitle' ? (
              <div className={styles.previewSurface}>
                <SubtitlePreview
                  videoPath={previewVideoPath}
                  style={settings.style}
                  entries={previewEntries}
                  subtitlePosition={settings.subtitlePosition}
                  blackoutTop={settings.blackoutTop}
                  coverMode={settings.coverMode}
                  coverQuad={settings.coverQuad}
                  renderMode={settings.renderMode}
                  renderResolution={settings.renderResolution}
                  logoPath={settings.logoPath}
                  logoPosition={settings.logoPosition}
                  logoScale={settings.logoScale}
                  portraitForegroundCropPercent={settings.portraitForegroundCropPercent ?? settings.foregroundCropPercent ?? 0}
                  onPositionChange={settings.setSubtitlePosition}
                  onBlackoutChange={settings.setBlackoutTop}
                  onCoverModeChange={settings.setCoverMode}
                  onCoverQuadChange={settings.setCoverQuad}
                  onRenderResolutionChange={settings.setRenderResolution}
                  onLogoPositionChange={(pos) => settings.setLogoPosition(pos || undefined)}
                  onLogoScaleChange={(scale) => settings.setLogoScale(scale)}
                  renderSnapshotMode={effectivePreviewMode === 'render'}
                  onSelectLogo={handleSelectLogo}
                  onRemoveLogo={handleRemoveLogo}
                  interactiveDisabledReason={
                    effectivePreviewMode === 'render'
                      ? 'Đang xem snapshot render 100% từ caption_session.json. Chuyển Live để chỉnh layer.'
                      : (!processing.enabledSteps.has(7) ? 'Chưa bật B7 Render' : undefined)
                  }
                />
              </div>
            ) : (
              <div className={styles.previewSurface}>
                <ThumbnailPreviewPanel
                  videoPath={thumbnailPreviewVideoPath}
                  sourceLabel={isMultiFolder ? 'Nguồn: folder đầu tiên' : 'Nguồn: folder hiện tại'}
                  renderMode={settings.renderMode}
                  renderResolution={settings.renderResolution}
                  thumbnailText={thumbnailPreviewText}
                  thumbnailTextSecondary={thumbnailPreviewSecondaryText}
                  thumbnailTextReadOnly={isMultiFolder}
                  thumbnailTextHelper={isMultiFolder ? 'Multi-folder: chỉnh text ở danh sách bên trái.' : undefined}
                  onThumbnailTextChange={isMultiFolder ? undefined : hardsubSettings.setThumbnailText}
                  onThumbnailTextSecondaryChange={isMultiFolder ? undefined : settings.setThumbnailTextSecondary}
                  thumbnailFrameTimeSec={settings.thumbnailFrameTimeSec}
                  onThumbnailFrameTimeSecChange={settings.setThumbnailFrameTimeSec}
                  thumbnailFontName={settings.thumbnailFontName}
                  thumbnailFontSize={settings.thumbnailFontSize}
                  thumbnailTextPrimaryFontName={settings.thumbnailTextPrimaryFontName}
                  thumbnailTextPrimaryFontSize={settings.thumbnailTextPrimaryFontSize}
                  thumbnailTextPrimaryColor={settings.thumbnailTextPrimaryColor}
                  thumbnailTextSecondaryFontName={settings.thumbnailTextSecondaryFontName}
                  thumbnailTextSecondaryFontSize={settings.thumbnailTextSecondaryFontSize}
                  thumbnailTextSecondaryColor={settings.thumbnailTextSecondaryColor}
                  thumbnailLineHeightRatio={settings.thumbnailLineHeightRatio}
                  thumbnailTextPrimaryPosition={settings.thumbnailTextPrimaryPosition}
                  thumbnailTextSecondaryPosition={settings.thumbnailTextSecondaryPosition}
                  onThumbnailTextPrimaryPositionChange={settings.setThumbnailTextPrimaryPosition}
                  onThumbnailTextSecondaryPositionChange={settings.setThumbnailTextSecondaryPosition}
                  contextKey={thumbnailPreviewContextKey}
                  inputType={settings.inputType}
                />
              </div>
            )}
          </div>
        </section>
        <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <div className={styles.inspectorTitle}>B{activeStep} {STEP_SHORT_LABELS[activeStep]}</div>
            <div className={styles.inspectorHint}>{STEP_DESCRIPTION[activeStep]}</div>
          </div>
          <div className={styles.inspectorTabs}>
            <button
              type="button"
              className={`${styles.inspectorTabBtn} ${inspectorPane === 'step' ? styles.inspectorTabBtnActive : ''}`}
              onClick={() => setInspectorPane('step')}
            >
              Step
            </button>
            <button
              type="button"
              className={`${styles.inspectorTabBtn} ${inspectorPane === 'common' ? styles.inspectorTabBtnActive : ''}`}
              onClick={() => setInspectorPane('common')}
            >
              Common
            </button>
            <button
              type="button"
              className={`${styles.inspectorTabBtn} ${inspectorPane === 'snapshot' ? styles.inspectorTabBtnActive : ''}`}
              onClick={() => setInspectorPane('snapshot')}
            >
              Snapshot
            </button>
          </div>
          <div className={styles.inspectorBody}>
            {inspectorPane === 'step' && activeStepContent}
            {inspectorPane === 'common' && commonConfigBar}
            {inspectorPane === 'snapshot' && (
              <div className={styles.panelSection}>
                <div className={styles.configSummaryTitle}>Session Snapshot</div>
                <div className={styles.configSummaryGrid}>
                  {configSummaryRows.map((row) => (
                    <div key={row.key} className={styles.configSummaryRow}>
                      <span className={styles.configSummaryKey}>{row.key}</span>
                      <span className={styles.configSummaryValue}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.commonHint} style={{ marginTop: 8 }} title={fileManager.filePath || undefined}>
              {inspectorPane === 'step'
                ? (settings.inputType === 'draft'
                  ? `Input: Draft ${selectedInputPaths.length} folder | ${fileManager.entries.length} dòng`
                  : `Input: SRT | ${fileManager.entries.length} dòng`)
                : inspectorPane === 'common'
                  ? 'Common: Render / Typography / Audio dùng lại nhiều step. Voice giữ ở B4.'
                  : `Snapshot: trạng thái ${processing.status}, rà nhanh trước khi chạy.`}
            </div>
          </div>
        </aside>
      </div>

      <div className={styles.runBar}>
        <div className={styles.runBarHeader}>
          <div className={styles.runBarTitle}>Chạy & Tiến độ</div>
          <span className={`${styles.statusBadge} ${styles.statusIdle}`}>{processing.status}</span>
        </div>

        <div className={styles.runBarControls}>
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

          {isMultiFolder && (
            <div className={styles.runBarModeSwitch}>
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
        </div>

        {processing.stepDependencyIssues.length > 0 && (
          <div className={styles.stepGuardBox}>
            <div className={styles.stepGuardTitle}>Step bị chặn:</div>
            {processing.stepDependencyIssues.slice(0, 2).map((issue, idx) => (
              <div
                key={`${issue.folderPath}-${issue.step}-${idx}`}
                className={styles.stepGuardItem}
                title={`[${issue.folderName}] Step ${issue.step}: ${issue.reason}`}
              >
                [{issue.folderName}] Step {issue.step}: {issue.reason}
              </div>
            ))}
          </div>
        )}

        <div className={styles.progressSection}>
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
    </div>
  );
}
