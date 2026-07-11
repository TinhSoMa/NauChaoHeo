import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Chapter,
  STORY_IPC_CHANNELS,
  type StoryStreamChunk,
} from '@shared/types';
import type {
  OperationType,
  StoryReadingTheme,
  StoryChapterMethod,
  StoryPromptSaveSettings,
  StoryPreviousAssistantOutputMode,
  StoryStatus,
  StoryTranslationMethod
} from './types';
import { GEMINI_MODEL_LIST } from '@shared/constants';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { FileText, BookOpen, Clock, CheckSquare, Square, Loader, Sparkles, StopCircle, AlertTriangle, Check, Volume2 } from 'lucide-react';
import { extractTranslatedTitle } from './utils/chapterUtils';
import { useChapterSelection } from './hooks/useChapterSelection';
import { useTokenManagement } from './hooks/useTokenManagement';
import { useStoryTranslatorPersistence } from './hooks/useStoryTranslatorPersistence';
import { useProxySettings } from './hooks/useProxySettings';
import { useStoryFileManagement } from './hooks/useStoryFileManagement';
import { useStoryTranslation } from './hooks/useStoryTranslation';
import { useStoryBatchTranslation } from './hooks/useStoryBatchTranslation';
import { useStorySummaryGeneration } from './hooks/useStorySummaryGeneration';
import { useStoryGeminiWebQueueTranslation } from './hooks/useStoryGeminiWebQueueTranslation';
import type { StoryWebQueueMode } from './hooks/useStoryGeminiWebQueueTranslation';
import { useStoryExport } from './hooks/useStoryExport';
import { useStoryTtsExport } from './hooks/useStoryTtsExport';
import { resolveStoryReadingThemePalette } from './styles/readerThemes';
import { ReaderPane } from './components/ReaderPane';
import { useProjectContext } from '../../context/ProjectContext';
import { VOLUME_OPTIONS } from '../../config/captionConfig';

interface TtsUiVoiceOption {
  value: string;
  label: string;
  provider: 'edge' | 'capcut';
  tier: 'free' | 'pro';
}

function normalizeVoiceValue(value: string): string {
  const trimmed = (value || '').trim();
  const match = trimmed.match(/^(edge|capcut):(.+)$/i);
  if (match) {
    const provider = match[1].toLowerCase();
    const voiceId = match[2].trim();
    if (voiceId) return `${provider}:${voiceId}`;
  }
  if (trimmed) return `edge:${trimmed}`;
  return 'edge:vi-VN-HoaiMyNeural';
}

interface VoiceInfoData {
  name: string;
  provider: 'edge' | 'capcut';
  voiceId: string;
  displayName: string;
  language: string;
  gender: 'Male' | 'Female';
  tier?: 'free' | 'pro';
  value?: string;
}

function toUiVoiceOption(voice: VoiceInfoData): TtsUiVoiceOption {
  const provider = voice.provider === 'capcut' ? 'capcut' : 'edge';
  const voiceId = (voice.voiceId || voice.name || '').trim();
  const canonical = normalizeVoiceValue(voice.value || `${provider}:${voiceId}`);
  const tier = voice.tier === 'pro' ? 'pro' : 'free';
  const providerLabel = provider === 'capcut' ? 'CapCut' : 'Edge';
  const tierSuffix = provider === 'capcut' && tier === 'pro' ? ' [PRO]' : '';
  const displayName = (voice.displayName || voice.name || canonical).trim();
  return { value: canonical, label: `${displayName} (${providerLabel})${tierSuffix}`, provider, tier };
}

function ensureVoiceOptionExists(options: TtsUiVoiceOption[], selectedVoice: string): TtsUiVoiceOption[] {
  const normalized = normalizeVoiceValue(selectedVoice);
  if (options.some((o) => o.value === normalized)) return options;
  const provider = normalized.startsWith('capcut:') ? 'capcut' : 'edge';
  return [...options, { value: normalized, label: `${normalized} (Saved)`, provider, tier: 'free' }];
}

const STORY_RATE_OPTIONS = Array.from({ length: 11 }, (_, i) => {
  const multiplier = 1.0 + i * 0.1;
  const pct = Math.round((multiplier - 1.0) * 100);
  return { value: `${pct >= 0 ? '+' : ''}${pct}%`, label: `${multiplier.toFixed(1)}x` };
});

const FALLBACK_TTS_VOICES: TtsUiVoiceOption[] = [
  { value: 'edge:vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ) (Edge)', provider: 'edge', tier: 'free' },
  { value: 'edge:vi-VN-NamMinhNeural', label: 'Nam Minh (Nam) (Edge)', provider: 'edge', tier: 'free' },
];

const READER_MODE_BREAKPOINT = 1024;
const READER_PAGE_OVERLAP_PX = 72;
const READER_MIN_PAGE_STEP = 220;

const getInitialViewportWidth = (): number => {
  if (typeof window === 'undefined') {
    return READER_MODE_BREAKPOINT + 1;
  }
  return window.innerWidth;
};




export function StoryTranslator() {
  const { projectId } = useProjectContext();
  const [filePath, setFilePath] = useState('');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [model, setModel] = useState('gemini-3-flash-preview');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>(
    () => GEMINI_MODEL_LIST.map((m: { id: string; label: string }) => ({ value: m.id, label: m.label }))
  );
  const [translationMethod, setTranslationMethod] = useState<StoryTranslationMethod>('api');
  const [activeOperation, setActiveOperation] = useState<OperationType>('idle');
  const [status, setStatus] = useState<StoryStatus>('idle');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Map lưu trữ bản dịch theo chapterId
  const [translatedChapters, setTranslatedChapters] = useState<Map<string, string>>(new Map());
  const [chapterModels, setChapterModels] = useState<Map<string, string>>(new Map());
  const [chapterMethods, setChapterMethods] = useState<Map<string, StoryChapterMethod>>(new Map());
  const [translatedTitles, setTranslatedTitles] = useState<Map<string, string>>(new Map());
  const [summaries, setSummaries] = useState<Map<string, string>>(new Map());
  const [summaryTitles, setSummaryTitles] = useState<Map<string, string>>(new Map());
  const [viewMode, setViewMode] = useState<'original' | 'translated' | 'summary'>('original');
  const [isGeminiWebQueueEnabled, setIsGeminiWebQueueEnabled] = useState(false);
  const [webQueueMode, setWebQueueMode] = useState<StoryWebQueueMode>('multi_auto');
  const [autoSaveSentPrompt, setAutoSaveSentPrompt] = useState(false);
  const [previousAssistantOutputMode, setPreviousAssistantOutputMode] =
    useState<StoryPreviousAssistantOutputMode>('sampled');
  const [previousAssistantOutputChapterCount, setPreviousAssistantOutputChapterCount] = useState(1);
  const [contextChapterIds, setContextChapterIds] = useState<string[] | null>(null);
  const [contextPopupOpen, setContextPopupOpen] = useState(false);
  const contextPopupRef = useRef<HTMLDivElement | null>(null);
  const [geminiStreamingEnabled, setGeminiStreamingEnabled] = useState(true);
  const [streamingContent, setStreamingContent] = useState<ReadonlyMap<string, string>>(new Map());
  const [streamingErrors, setStreamingErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const promptSaveSettings = useMemo<StoryPromptSaveSettings>(() => ({
    autoSaveSentPrompt,
    previousAssistantOutputMode,
    previousAssistantOutputChapterCount,
    contextChapterIds
  }), [autoSaveSentPrompt, previousAssistantOutputChapterCount, previousAssistantOutputMode, contextChapterIds]);
  
  // Token management (using custom hook)
  const {
    tokenConfigs,
    tokenConfigId,
    setTokenConfigId,
    tokenContexts,
    setTokenContexts,
    loadConfigurations,
    getDistinctActiveTokenConfigs,
    getPreferredTokenConfig
  } = useTokenManagement();
  
  // Chapter selection (using custom hook)
  const {
    excludedChapterIds,
    setExcludedChapterIds,
    isChapterIncluded,
    toggleChapterExclusion,
    selectAllChapters,
    deselectAllChapters,
    selectedChapterCount
  } = useChapterSelection(chapters);

  // Reading settings
  const [fontSize, setFontSize] = useState<number>(18);
  const [lineHeight, setLineHeight] = useState<number>(1.8);
  const [readingTheme, setReadingTheme] = useState<StoryReadingTheme>('light');
  const [retranslateExisting, setRetranslateExisting] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(getInitialViewportWidth);
  const [chapterScrollPositions, setChapterScrollPositions] = useState<Map<string, number>>(new Map());
  const isReaderMode = viewportWidth <= READER_MODE_BREAKPOINT;
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const chapterScrollPositionsRef = useRef<Map<string, number>>(new Map());
  const scrollFlushTimeoutRef = useRef<number | null>(null);
  const readerPalette = useMemo(() => resolveStoryReadingThemePalette(readingTheme), [readingTheme]);

  // Proxy settings hook
  const { useProxy } = useProxySettings();

  // File management hook
  const fileManagement = useStoryFileManagement({
    isTranslationActive: status === 'running',
    setFilePath,
    setChapters,
    setExcludedChapterIds,
    setSelectedChapterId,
    setTranslatedChapters,
    setViewMode,
    setStatus
  });

  // Batch translation hook (provides processingChapters state)
  // Batch translation hook
  const {
    processingChapters,
    setProcessingChapters,
    batchProgress: batchTranslationProgress,
    isTranslating: isBatchTranslating,
    isStopping: isBatchStopping,
    handleTranslateAll: handleBatchTranslate,
    handleStopTranslation: handleStopBatchTranslation
  } = useStoryBatchTranslation({
    chapters,
    sourceLang,
    targetLang,
    model,
    translationMethod,
    retranslateExisting,
    useProxy,
    isChapterIncluded,
    translatedChapters,
    summaries,
    tokenConfigs,
    getDistinctActiveTokenConfigs,
    getPreferredTokenConfig,
    setStatus,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    setTokenContexts,
    projectId,
    filePath,
    forceSequential: false,
    promptSaveSettings,
    streamingEnabled: geminiStreamingEnabled,
    setActiveOperation
  });

  const {
    isTranslating: isWebQueueTranslating,
    isStopping: isWebQueueStopping,
    batchProgress: webQueueBatchProgress,
    resolvedWorkerCount: webQueueResolvedWorkerCount,
    handleTranslateAll: handleTranslateAllWebQueue,
    handleStopTranslation: handleStopWebQueueTranslation
  } = useStoryGeminiWebQueueTranslation({
    chapters,
    sourceLang,
    targetLang,
    model,
    webQueueMode,
    retranslateExisting,
    isChapterIncluded,
    translatedChapters,
    summaries,
    setStatus,
    setProcessingChapters,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    projectId,
    filePath,
    forceSequential: false,
    promptSaveSettings,
    setActiveOperation
  });

  // Single translation hook (using processingChapters from batch hook)
  const {
    handleTranslate: handleSingleTranslate,
    handleStopSingle,
    isSingleTranslating
  } = useStoryTranslation({
    chapters,
    sourceLang,
    targetLang,
    model,
    translationMethod,
    retranslateExisting,
    useProxy,
    isChapterIncluded,
    getPreferredTokenConfig,
    loadConfigurations,
    setStatus,
    setProcessingChapters, // Share state with batch translation
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    setTokenContexts,
    setViewMode,
    translatedChapters,
    summaries,
    projectId,
    filePath,
    promptSaveSettings,
    streamingEnabled: geminiStreamingEnabled,
    setActiveOperation
  });

  // Project state persistence
  useStoryTranslatorPersistence(
    {
      filePath,
      sourceLang,
      targetLang,
      model,
      translationMethod,
      chapters,
      translatedChapters,
      chapterModels,
      chapterMethods,
      translatedTitles,
      tokenConfigId,
      tokenContexts,
      viewMode,
      excludedChapterIds,
      selectedChapterId,
      summaries,
      summaryTitles,
      readingTheme,
      chapterScrollPositions,
      previousAssistantOutputMode,
      previousAssistantOutputChapterCount,
      contextChapterIds,
      autoSaveSentPrompt
    },
    {
      setFilePath,
      setSourceLang,
      setTargetLang,
      setModel,
      setTranslationMethod,
      setTranslatedChapters,
      setChapterModels,
      setChapterMethods,
      setTranslatedTitles,
      setTokenConfigId,
      setTokenContexts,
      setViewMode,
      setExcludedChapterIds,
      setSelectedChapterId,
      setSummaries,
      setSummaryTitles,
      setReadingTheme,
      setChapterScrollPositions,
      setChapters,
      setPreviousAssistantOutputMode,
      setPreviousAssistantOutputChapterCount,
      setContextChapterIds,
      setAutoSaveSentPrompt
    },
    fileManagement.parseFile
  );

  useEffect(() => {
    chapterScrollPositionsRef.current = new Map(chapterScrollPositions);
  }, [chapterScrollPositions]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getScrollKey = useCallback(
    (chapterId: string, mode: 'original' | 'translated' | 'summary') => `${mode}:${chapterId}`,
    []
  );

  const flushScrollPositions = useCallback(() => {
    setChapterScrollPositions(new Map(chapterScrollPositionsRef.current));
  }, []);

  const saveCurrentScrollPosition = useCallback(() => {
    if (!selectedChapterId || !contentScrollRef.current) {
      return;
    }
    const key = getScrollKey(selectedChapterId, viewMode);
    const next = new Map(chapterScrollPositionsRef.current);
    next.set(key, contentScrollRef.current.scrollTop);
    chapterScrollPositionsRef.current = next;
  }, [getScrollKey, selectedChapterId, viewMode]);

  const scheduleScrollFlush = useCallback(() => {
    if (scrollFlushTimeoutRef.current !== null) {
      window.clearTimeout(scrollFlushTimeoutRef.current);
    }
    scrollFlushTimeoutRef.current = window.setTimeout(() => {
      scrollFlushTimeoutRef.current = null;
      flushScrollPositions();
    }, 300);
  }, [flushScrollPositions]);

  const handleContentScroll = useCallback(() => {
    if (!selectedChapterId || !contentScrollRef.current) {
      return;
    }
    const key = getScrollKey(selectedChapterId, viewMode);
    const next = new Map(chapterScrollPositionsRef.current);
    next.set(key, contentScrollRef.current.scrollTop);
    chapterScrollPositionsRef.current = next;
    scheduleScrollFlush();
  }, [getScrollKey, scheduleScrollFlush, selectedChapterId, viewMode]);

  const resolveViewModeForChapter = useCallback(
    (
      _chapterId: string,
      preferredMode: 'original' | 'translated' | 'summary'
    ): 'original' | 'translated' | 'summary' => {
      return preferredMode;
    },
    []
  );

  const handleViewModeChange = useCallback(
    (nextMode: 'original' | 'translated' | 'summary') => {
      const resolvedMode = selectedChapterId
        ? resolveViewModeForChapter(selectedChapterId, nextMode)
        : nextMode;

      if (resolvedMode === viewMode) {
        return;
      }
      saveCurrentScrollPosition();
      flushScrollPositions();
      setViewMode(resolvedMode);
    },
    [flushScrollPositions, resolveViewModeForChapter, saveCurrentScrollPosition, selectedChapterId, viewMode]
  );

  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      if (chapterId === selectedChapterId) {
        return;
      }
      saveCurrentScrollPosition();
      flushScrollPositions();
      setSelectedChapterId(chapterId);
      setViewMode(resolveViewModeForChapter(chapterId, viewMode));
    },
    [flushScrollPositions, resolveViewModeForChapter, saveCurrentScrollPosition, selectedChapterId, viewMode]
  );

  const navigableChapterIds = useMemo(() => {
    const included = chapters.filter((chapter) => isChapterIncluded(chapter.id)).map((chapter) => chapter.id);
    return included.length > 0 ? included : chapters.map((chapter) => chapter.id);
  }, [chapters, isChapterIncluded]);

  const goToAdjacentChapter = useCallback(
    (direction: -1 | 1) => {
      if (navigableChapterIds.length === 0) {
        return;
      }

      const currentIndex = selectedChapterId ? navigableChapterIds.indexOf(selectedChapterId) : -1;
      const targetIndex =
        currentIndex === -1
          ? direction > 0
            ? 0
            : navigableChapterIds.length - 1
          : Math.min(Math.max(currentIndex + direction, 0), navigableChapterIds.length - 1);

      if (targetIndex === currentIndex) {
        return;
      }

      const nextChapterId = navigableChapterIds[targetIndex];
      if (!nextChapterId) {
        return;
      }

      saveCurrentScrollPosition();
      flushScrollPositions();
      setSelectedChapterId(nextChapterId);
      setViewMode(resolveViewModeForChapter(nextChapterId, viewMode));
    },
    [flushScrollPositions, navigableChapterIds, resolveViewModeForChapter, saveCurrentScrollPosition, selectedChapterId, viewMode]
  );

  const scrollReaderByPage = useCallback((direction: -1 | 1) => {
    const container = contentScrollRef.current;
    if (!container) {
      return;
    }

    const viewportHeight = container.clientHeight;
    const pageStep = Math.max(READER_MIN_PAGE_STEP, viewportHeight - READER_PAGE_OVERLAP_PX);
    const maxScrollTop = Math.max(0, container.scrollHeight - viewportHeight);
    const targetTop = Math.min(
      maxScrollTop,
      Math.max(0, container.scrollTop + direction * pageStep)
    );

    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!isReaderMode || selectedChapterId || navigableChapterIds.length === 0) {
      return;
    }
    const firstChapterId = navigableChapterIds[0];
    setSelectedChapterId(firstChapterId);
    setViewMode(resolveViewModeForChapter(firstChapterId, viewMode));
  }, [isReaderMode, navigableChapterIds, resolveViewModeForChapter, selectedChapterId, viewMode]);

  useEffect(() => {
    if (!selectedChapterId) {
      return;
    }

    const resolvedMode = resolveViewModeForChapter(selectedChapterId, viewMode);
    if (resolvedMode !== viewMode) {
      setViewMode(resolvedMode);
    }
  }, [resolveViewModeForChapter, selectedChapterId, viewMode]);

  useEffect(() => {
    const container = contentScrollRef.current;
    if (!container) {
      return;
    }

    const key = selectedChapterId ? getScrollKey(selectedChapterId, viewMode) : null;
    const targetScrollTop = key ? chapterScrollPositionsRef.current.get(key) ?? 0 : 0;
    const frameId = window.requestAnimationFrame(() => {
      container.scrollTop = targetScrollTop;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [getScrollKey, selectedChapterId, viewMode]);

  useEffect(() => {
    return () => {
      saveCurrentScrollPosition();
      if (scrollFlushTimeoutRef.current !== null) {
        window.clearTimeout(scrollFlushTimeoutRef.current);
      }
      flushScrollPositions();
    };
  }, [flushScrollPositions, saveCurrentScrollPosition]);

  useEffect(() => {
    if (!isReaderMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToAdjacentChapter(-1);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToAdjacentChapter(1);
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        scrollReaderByPage(event.key === 'ArrowUp' ? -1 : 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToAdjacentChapter, isReaderMode, scrollReaderByPage]);

  // Summary generation hook
  const { 
    isGenerating: isGeneratingSummary, 
    isStopping: isSummaryStopping,
    handleGenerateSummary, 
    handleGenerateAllSummaries, 
    stopGeneration: stopSummaryGeneration, 
    batchSummaryProgress 
  } = useStorySummaryGeneration({
    chapters,
    translatedChapters,
    translatedTitles,
    sourceLang,
    targetLang,
    model,
    translateMode: translationMethod === 'token' ? 'token' : 'api',
    summaries,
    summaryTitles,
    chapterModels,
    chapterMethods,
    tokenContexts,
    setSummaries,
    setSummaryTitles,
    setChapterModels,
    setChapterMethods,
    setTokenContexts,
    setStatus,
    setViewMode,
    useProxy,
    projectId,
    filePath,
    loadConfigurations,
    getPreferredTokenConfig,
    setProcessingChapters,
      isChapterIncluded,
      tokenConfigs,
      getDistinctActiveTokenConfigs,
      previousAssistantOutputMode,
      promptSaveSettings,
      setActiveOperation
    });
  
  // Export ebook hook
  const { exportStatus, handleExportEbook } = useStoryExport({
    translatedChapters,
    translatedTitles,
    chapters,
    sourceLang,
    targetLang,
    filePath,
    projectId
  });

  // Story TTS audio export hook
  const {
    audioExportProgress,
    audioDetail,
    isAudioGenerating,
    voice,
    rate,
    volume,
    setVoice,
    setRate,
    setVolume,
    handleGenerateAudioBatch,
    handleStopAudioBatch,
  } = useStoryTtsExport({
    chapters,
    translatedChapters,
    summaries,
    isChapterIncluded,
    filePath,
  });

  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<TtsUiVoiceOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadTtsVoices = async () => {
      try {
        const response = await window.electronAPI.tts.getVoices();
        if (!response?.success || !Array.isArray(response.data) || response.data.length === 0) {
          if (!cancelled) setTtsVoiceOptions(FALLBACK_TTS_VOICES);
          return;
        }
        const deduped = new Map<string, TtsUiVoiceOption>();
        for (const v of response.data) {
          const mapped = toUiVoiceOption(v as VoiceInfoData);
          if (!deduped.has(mapped.value)) deduped.set(mapped.value, mapped);
        }
        if (!cancelled) setTtsVoiceOptions(Array.from(deduped.values()));
      } catch {
        if (!cancelled) setTtsVoiceOptions(FALLBACK_TTS_VOICES);
      }
    };
    loadTtsVoices();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setTtsVoiceOptions((prev) => ensureVoiceOptionExists(prev, voice));
  }, [voice]);

  const edgeVoiceOptions = useMemo(
    () => ttsVoiceOptions.filter((v) => v.provider === 'edge'),
    [ttsVoiceOptions]
  );
  const capCutVoiceOptions = useMemo(
    () => ttsVoiceOptions.filter((v) => v.provider === 'capcut'),
    [ttsVoiceOptions]
  );
  const selectedVoiceLabel = useMemo(
    () => ttsVoiceOptions.find((v) => v.value === voice)?.label || voice,
    [voice, ttsVoiceOptions]
  );

  // Debug logging
  /* console.log('[StoryTranslator] Render - translatedChapters.size:', translatedChapters.size) */;
  /* console.log('[StoryTranslator] Render - status:', status) */;
  /* console.log('[StoryTranslator] Render - chapters.length:', chapters.length) */;
  /* console.log('[StoryTranslator] Render - isBatchTranslating:', isBatchTranslating) */;
  /* console.log('[StoryTranslator] Render - batchTranslationProgress:', batchTranslationProgress) */;

  const isQueueMethodSelected =
    translationMethod === 'gemini_webapi_queue' ||
    translationMethod === 'api_gemini_webapi_queue';

  useEffect(() => {
    let active = true;
    const loadGeminiModels = async () => {
      try {
        const res = await window.electronAPI.gemini.getModels();
        if (!active || !res.success || !res.data) {
          return;
        }
        const options = res.data
          .filter((item) => item.enabled)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => ({ value: item.modelId, label: item.label || item.name || item.modelId }));
        if (options.length > 0) {
          setModelOptions(options);
        }
      } catch (error) {
        console.warn('[StoryTranslator] Failed to load dynamic models, fallback to static list:', error);
      }
    };

    void loadGeminiModels();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (translationMethod === 'token') {
      if (!tokenConfigId) {
        loadConfigurations();
      }
    }
  }, [translationMethod, tokenConfigId]);

  useEffect(() => {
    if (isBatchTranslating || isWebQueueTranslating || isGeneratingSummary) {
      setStatus('running');
    }
  }, [isBatchTranslating, isWebQueueTranslating, isGeneratingSummary]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const result = await window.electronAPI.invoke(
          STORY_IPC_CHANNELS.IS_GEMINI_WEB_QUEUE_ENABLED
        ) as { success?: boolean; data?: boolean };
        if (mounted) {
          setIsGeminiWebQueueEnabled(result?.success ? !!result.data : false);
        }
      } catch (error) {
        console.warn('[StoryTranslator] Failed to load Gemini Web Queue flag:', error);
        if (mounted) {
          setIsGeminiWebQueueEnabled(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isGeminiWebQueueEnabled && isQueueMethodSelected) {
      setTranslationMethod('api');
    }
  }, [isGeminiWebQueueEnabled, isQueueMethodSelected]);

  // Load streaming setting from app settings
  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.appSettings.getAll();
        if (result.success && result.data) {
          const data = result.data as unknown as Record<string, unknown>;
          if (typeof data.geminiStreamingEnabled === 'boolean') {
            setGeminiStreamingEnabled(data.geminiStreamingEnabled);
          }
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // Listen for streaming chunks
  useEffect(() => {
    const removeListener = (window.electronAPI as any).onMessage(
      STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_STREAM_REPLY,
      (chunk: StoryStreamChunk) => {
        setStreamingContent(prev => {
          const next = new Map(prev);
          if (chunk.done) {
            if (!chunk.serverError) {
              next.delete(chunk.chapterId);
            }
            return next;
          }
          if (chunk.accumulated) {
            next.set(chunk.chapterId, chunk.accumulated);
          }
          return next;
        });
        setStreamingErrors(prev => {
          const next = new Map(prev);
          if (chunk.done && !chunk.serverError) {
            next.delete(chunk.chapterId);
          } else if (chunk.serverError) {
            next.set(chunk.chapterId, chunk.serverError);
          }
          return next;
        });
      }
    );
    return () => {
      if (typeof removeListener === 'function') {
        removeListener();
      }
    };
  }, []);

  // Listen for progress/retry events
  useEffect(() => {
    // Note: onMessage returns a cleanup function in implementation, but type def says void.
    // We cast to any to avoid TS error if types are not updated.
    const removeListener = (window.electronAPI as any).onMessage(STORY_IPC_CHANNELS.TRANSLATION_PROGRESS, (data: any) => {
      const { chapterId, attempt } = data;
      setProcessingChapters(prev => {
        const info = prev.get(chapterId);
        if (info) {
          const next = new Map(prev);
          next.set(chapterId, { ...info, retryCount: attempt });
          return next;
        }
        return prev;
      });
    });

    return () => {
      if (typeof removeListener === 'function') {
        removeListener();
      }
    };
  }, [setProcessingChapters]);

  // Close context popup on outside click
  useEffect(() => {
    if (!contextPopupOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (contextPopupRef.current && !contextPopupRef.current.contains(e.target as Node)) {
        setContextPopupOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextPopupOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextPopupOpen]);

  const computeDefaultContextIds = useCallback((count?: number): string[] => {
    const effectiveCount = count ?? previousAssistantOutputChapterCount;
    if (!selectedChapterId || effectiveCount <= 0) return [];
    const idx = chapters.findIndex((c) => c.id === selectedChapterId);
    if (idx <= 0) return [];
    const start = Math.max(0, idx - effectiveCount);
    return chapters.slice(start, idx).map((c) => c.id);
  }, [chapters, selectedChapterId, previousAssistantOutputChapterCount]);

  const openContextPopup = useCallback(() => {
    if (!contextChapterIds) {
      setContextChapterIds(computeDefaultContextIds());
    }
    setContextPopupOpen(true);
  }, [contextChapterIds, computeDefaultContextIds]);

  const toggleContextChapter = useCallback((chapterId: string) => {
    setContextChapterIds((prev) => {
      const current = prev ?? computeDefaultContextIds();
      if (current.includes(chapterId)) {
        return current.filter((id) => id !== chapterId);
      }
      return [...current, chapterId];
    });
  }, [computeDefaultContextIds]);

  const handlePrefillContext = useCallback((count: number) => {
    setContextChapterIds(computeDefaultContextIds(count));
  }, [computeDefaultContextIds]);

  const translatedChapterIds = useMemo(() => {
    return chapters.filter((c) => translatedChapters.has(c.id)).map((c) => c.id);
  }, [chapters, translatedChapters]);

  const handleTranslate = async () => {
    await handleSingleTranslate(selectedChapterId);
  };

  const handleTranslateAllByMethod = async () => {
    if (isQueueMethodSelected && !isGeminiWebQueueEnabled) {
      alert('Gemini WebAPI Queue hiện đang tắt. Vui lòng chọn mode khác.');
      return;
    }

    if (translationMethod === 'gemini_webapi_queue') {
      await handleTranslateAllWebQueue();
      return;
    }

    if (translationMethod === 'api_gemini_webapi_queue') {
      await handleBatchTranslate();
      return;
    }

    await handleBatchTranslate();
  };

  const handleStopBatchByMethod = async () => {
    if (isBatchTranslating || isBatchStopping) {
      handleStopBatchTranslation();
    }
    if (isWebQueueTranslating || isWebQueueStopping) {
      await handleStopWebQueueTranslation();
    }
  };

  const combinedBatchProgress = useMemo(() => {
    const hasApiProgress = Boolean(batchTranslationProgress);
    const hasQueueProgress = Boolean(webQueueBatchProgress);

    if (!hasApiProgress && !hasQueueProgress) {
      return null;
    }

    return {
      current: (batchTranslationProgress?.current || 0) + (webQueueBatchProgress?.current || 0),
      total: (batchTranslationProgress?.total || 0) + (webQueueBatchProgress?.total || 0)
    };
  }, [batchTranslationProgress, webQueueBatchProgress]);

  const handleBrowse = async () => {
    await fileManagement.handleBrowse();
  };



  const compactModelLabel = (label: string): string => {
    const raw = (label || '').trim();
    if (!raw) return raw;
    return raw
      .replace(/\s*\(Mới nhất\)\s*/gi, '')
      .replace(/\s*Preview\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const LANG_OPTIONS = [
    { value: 'auto', label: 'Tự động' },
    { value: 'en', label: 'English' },
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'zh', label: '中文' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
  ];

  return (
    <div className={`flex flex-col w-full h-full min-h-0 overflow-hidden ${isReaderMode ? 'gap-0' : 'gap-3'}`}>
      {/* Toolbar */}
      {!isReaderMode && (
      <div className="flex flex-col gap-1.5 p-3 bg-card border border-border rounded-xl shrink-0 overflow-hidden">
        {/* Row 1: Controls (file, lang, model, mode, stream) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {/* File */}
          <div className="flex items-center gap-1">
            <FileText size={15} className="text-text-secondary shrink-0" />
            <Input
              placeholder="Chọn file"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              containerClassName="w-44"
            />
            <Button
              onClick={handleBrowse}
              variant="secondary"
              className="shrink-0 h-7 px-2 text-2xs"
              disabled={status === 'running'}
              title={status === 'running' ? 'Đang chạy tiến trình, tạm thời không đổi file' : 'Chọn file truyện'}
            >
              Browse
            </Button>
          </div>

          {/* Language pair */}
          <div className="flex items-center gap-1">
            <span className="text-2xs text-text-secondary uppercase tracking-wider">Từ</span>
            <Select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              options={LANG_OPTIONS}
              variant="small"
              containerClassName="w-16"
            />
            <span className="text-2xs text-text-secondary">→</span>
            <Select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              options={LANG_OPTIONS}
              variant="small"
              containerClassName="w-16"
            />
          </div>

          {/* Model */}
          <Select
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            options={modelOptions.map(m => ({
              value: m.value,
              label: compactModelLabel(m.label)
            }))}
            variant="small"
            containerClassName="w-32"
          />

          {/* Mode + Queue (inline group) */}
          <div className="flex items-center gap-1">
            <Select
              label="Mode"
              value={translationMethod}
              onChange={(e) => setTranslationMethod(e.target.value as StoryTranslationMethod)}
              options={[
                { value: 'api', label: 'API' },
                { value: 'token', label: 'IMPIT' },
                ...(isGeminiWebQueueEnabled
                  ? [
                      { value: 'gemini_webapi_queue', label: 'Queue' },
                      { value: 'api_gemini_webapi_queue', label: 'API+Queue' }
                    ]
                  : [])
              ]}
              variant="small"
              containerClassName="w-20"
            />
            {isGeminiWebQueueEnabled && isQueueMethodSelected && (
              <select
                value={webQueueMode}
                onChange={(e) => setWebQueueMode(e.target.value as StoryWebQueueMode)}
                disabled={isWebQueueTranslating || isWebQueueStopping || status === 'running'}
                className="h-7 px-1.5 rounded-md border border-border bg-card text-text-primary text-2xs"
              >
                <option value="multi_auto">Auto</option>
                <option value="sequential">Tuần tự</option>
              </select>
            )}
            {isGeminiWebQueueEnabled && isQueueMethodSelected && webQueueMode === 'multi_auto' && isWebQueueTranslating && (
              <span className="text-2xs text-text-secondary whitespace-nowrap">
                ({webQueueResolvedWorkerCount ?? 3}w)
              </span>
            )}
          </div>

          {/* Streaming toggle */}
          {translationMethod === 'api' && (
            <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
              <button
                type="button"
                onClick={() => {
                  const next = !geminiStreamingEnabled;
                  setGeminiStreamingEnabled(next);
                  window.electronAPI.appSettings.update({ geminiStreamingEnabled: next } as any).catch(() => {});
                }}
                disabled={status === 'running'}
                className={`w-7 h-4 rounded-full transition-colors duration-300 relative ${
                  geminiStreamingEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                } ${status === 'running' ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-md transition-transform duration-300 ${
                  geminiStreamingEnabled ? 'translate-x-3' : 'translate-x-0'
                }`} />
              </button>
              <span className="text-2xs text-text-secondary">Stream</span>
            </label>
          )}

          <div className="ml-auto" />

          {/* Previous output + Chapters (inline, compact) */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1">
              <span className="text-2xs text-text-secondary">Prev</span>
              <select
                value={previousAssistantOutputMode}
                onChange={(e) => setPreviousAssistantOutputMode(e.target.value as StoryPreviousAssistantOutputMode)}
                className="h-7 rounded border border-border bg-card px-1.5 text-2xs text-text-primary"
                disabled={status === 'running'}
              >
                <option value="sampled">Sampled</option>
                <option value="full">Full</option>
              </select>
            </label>
            <div className="relative" ref={contextPopupRef}>
              <button
                onClick={openContextPopup}
                disabled={status === 'running'}
                className="h-7 rounded border border-border bg-card px-1.5 text-2xs text-text-primary flex items-center gap-1 hover:bg-hover disabled:opacity-50"
                title="Chọn chương làm context"
              >
                <BookOpen size={10} />
                {(contextChapterIds ?? computeDefaultContextIds()).length}
              </button>

              {contextPopupOpen && (
                <div className="absolute top-full right-0 mt-1 z-50 w-72 rounded border border-border bg-card shadow-lg p-2 max-h-80 overflow-y-auto">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-text-primary font-medium">Chương context</span>
                    <select
                      value={previousAssistantOutputChapterCount}
                      onChange={(e) => {
                        const count = Number(e.target.value) || 1;
                        setPreviousAssistantOutputChapterCount(count);
                        handlePrefillContext(count);
                      }}
                      className="h-6 rounded border border-border bg-surface px-1 text-2xs text-text-primary"
                    >
                      <option value={1}>1 chương</option>
                      <option value={2}>2 chương</option>
                      <option value={3}>3 chương</option>
                      <option value={5}>5 chương</option>
                      <option value={10}>10 chương</option>
                    </select>
                  </div>

                  <div className="space-y-0.5">
                    {chapters.map((ch) => {
                      const isTranslated = translatedChapters.has(ch.id);
                      const isSelected = (contextChapterIds ?? computeDefaultContextIds()).includes(ch.id);
                      const isCurrent = ch.id === selectedChapterId;
                      return (
                        <label
                          key={ch.id}
                          className={`flex items-center gap-1.5 px-1 py-0.5 rounded text-2xs cursor-pointer ${
                            isCurrent ? 'opacity-40' : 'hover:bg-hover'
                          } ${!isTranslated ? 'opacity-30' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected && isTranslated}
                            disabled={!isTranslated || isCurrent}
                            onChange={() => toggleContextChapter(ch.id)}
                            className="w-3 h-3 rounded border-border cursor-pointer accent-primary"
                          />
                          <span className="truncate flex-1">{ch.title || ch.id}</span>
                          {isCurrent && <span className="text-2xs text-text-tertiary shrink-0">(current)</span>}
                          {!isTranslated && <span className="text-2xs text-text-tertiary shrink-0">chưa dịch</span>}
                          {isTranslated && isSelected && <Check size={10} className="text-primary shrink-0" />}
                        </label>
                      );
                    })}
                  </div>

                  {translatedChapterIds.length === 0 && (
                    <div className="text-2xs text-text-tertiary text-center py-2">Chưa có chương nào được dịch</div>
                  )}

                  <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border">
                    <button
                      onClick={() => {
                        setContextChapterIds(null);
                        setContextPopupOpen(false);
                      }}
                      className="text-2xs text-text-tertiary hover:text-text-primary"
                    >
                      Mặc định
                    </button>
                    <button
                      onClick={() => setContextPopupOpen(false)}
                      className="text-2xs text-text-primary font-medium"
                    >
                      Xong
                    </button>
                  </div>
                </div>
              )}
            </div>
            <label className="flex items-center gap-1 cursor-pointer hover:text-primary">
              <input
                type="checkbox"
                checked={retranslateExisting}
                onChange={(e) => setRetranslateExisting(e.target.checked)}
                className="w-3 h-3 rounded border-border cursor-pointer"
              />
              <span className="text-2xs text-text-secondary">Dịch lại</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer hover:text-primary">
              <input
                type="checkbox"
                checked={autoSaveSentPrompt}
                onChange={(e) => setAutoSaveSentPrompt(e.target.checked)}
                className="w-3 h-3 rounded border-border cursor-pointer"
                disabled={!projectId || status === 'running'}
              />
              <span className="text-2xs text-text-secondary">Auto save</span>
            </label>
          </div>
        </div>

        {/* Row 2: Action buttons + errors */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Single actions */}
          {isSingleTranslating ? (
            <Button
              onClick={handleStopSingle}
              variant="secondary"
              className="h-7 px-2 text-2xs shrink-0 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
              title="Dừng dịch chương"
            >
              <StopCircle size={12} />
              {activeOperation === 'translating' ? 'Đang dịch...' : 'Đang tóm...'}
            </Button>
          ) : (
            <Button
              onClick={handleTranslate}
              variant="secondary"
              disabled={!filePath || (activeOperation !== 'idle') || !selectedChapterId}
              className="h-7 px-2 text-2xs shrink-0"
              title="Dịch chương đang chọn"
            >
              <BookOpen size={12} />
              Dịch 1
            </Button>
          )}
          {isGeneratingSummary && !batchSummaryProgress ? (
            <Button
              onClick={stopSummaryGeneration}
              variant="secondary"
              className="h-7 px-2 text-2xs shrink-0 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
              title="Dừng tóm tắt chương"
            >
              <StopCircle size={12} />
              Đang tóm...
            </Button>
          ) : (
            <Button
              onClick={() => handleGenerateSummary(selectedChapterId)}
              variant="secondary"
              disabled={!filePath || activeOperation !== 'idle' || !selectedChapterId || !translatedChapters.has(selectedChapterId)}
              className="h-7 px-2 text-2xs shrink-0"
              title="Tóm tắt chương đang chọn"
            >
              <FileText size={12} />
              Tóm 1
            </Button>
          )}

          <div className="w-px h-5 bg-border/60 mx-1 shrink-0" />

          {/* Batch actions + stop state */}
          {isBatchTranslating || isWebQueueTranslating ? (
            <Button
              onClick={handleStopBatchByMethod}
              variant="secondary"
              className="h-7 px-2 text-2xs shrink-0 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
              title="Dừng dịch hàng loạt"
            >
              <StopCircle size={12} />
              {combinedBatchProgress
                ? `Dịch (${combinedBatchProgress.current}/${combinedBatchProgress.total})`
                : 'Đang dịch...'}
            </Button>
          ) : batchSummaryProgress ? (
            <Button
              onClick={stopSummaryGeneration}
              variant="secondary"
              className="h-7 px-2 text-2xs shrink-0 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
              title="Dừng tóm tắt hàng loạt"
            >
              <StopCircle size={12} />
              Tóm ({batchSummaryProgress.current}/{batchSummaryProgress.total})
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                onClick={handleTranslateAllByMethod}
                className="h-7 px-2.5 text-2xs shrink-0"
                disabled={
                  !filePath ||
                  isGeneratingSummary ||
                  isSummaryStopping ||
                  isBatchStopping ||
                  isWebQueueStopping ||
                  isSingleTranslating ||
                  activeOperation !== 'idle'
                }
              >
                Dịch
              </Button>
              <Button
                variant="secondary"
                onClick={handleGenerateAllSummaries}
                className="h-7 px-2.5 text-2xs shrink-0"
                disabled={
                  !filePath ||
                  isBatchTranslating ||
                  isWebQueueTranslating ||
                  isBatchStopping ||
                  isWebQueueStopping ||
                  isSingleTranslating ||
                  isGeneratingSummary ||
                  isSummaryStopping ||
                  activeOperation !== 'idle'
                }
              >
                <Sparkles size={12} />
                Tóm tất cả
              </Button>
            </>
          )}

          {translatedChapters.size > 0 && (
            <Button
              onClick={handleExportEbook}
              variant="primary"
              disabled={exportStatus === 'exporting'}
              className="h-7 px-2 text-2xs shrink-0"
              title="Export Ebook ra file EPUB"
            >
              {exportStatus === 'exporting' ? 'Đang export...' : 'Export EPUB'}
            </Button>
          )}

          {filePath && ttsVoiceOptions.length > 0 && (
            <div className="flex items-center gap-1 shrink-0 bg-surface/40 border border-border/50 rounded-md px-2 py-0.5">
              <span className="text-2xs text-text-secondary mr-0.5">Giọng</span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="h-6 max-w-36 px-1 text-2xs bg-surface border border-border rounded cursor-pointer"
                title={`Giọng đọc: ${selectedVoiceLabel}`}
              >
                {edgeVoiceOptions.length > 0 && (
                  <optgroup label="Edge">
                    {edgeVoiceOptions.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </optgroup>
                )}
                {capCutVoiceOptions.length > 0 && (
                  <optgroup label="CapCut">
                    {capCutVoiceOptions.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="text-2xs text-text-secondary ml-1 mr-0.5">Tốc độ</span>
              <select
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="h-6 w-16 px-1 text-2xs bg-surface border border-border rounded cursor-pointer"
                title="Tốc độ đọc"
              >
                {STORY_RATE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <span className="text-2xs text-text-secondary ml-1 mr-0.5">Âm lượng</span>
              <select
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                className="h-6 w-16 px-1 text-2xs bg-surface border border-border rounded cursor-pointer"
                title="Âm lượng"
              >
                {VOLUME_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}

          {isAudioGenerating ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                onClick={handleStopAudioBatch}
                variant="secondary"
                className="h-7 px-2 text-2xs shrink-0 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
                title="Dừng tạo audio"
              >
                <StopCircle size={12} />
                Audio ({audioExportProgress?.current ?? 0}/{audioExportProgress?.total ?? 0})
              </Button>
              {audioDetail && (
                <span className="text-2xs text-text-secondary truncate max-w-48" title={audioDetail.message}>
                  {audioDetail.message}
                </span>
              )}
            </div>
          ) : (
            <>
              <Button
                onClick={() => handleGenerateAudioBatch('translation')}
                variant="secondary"
                disabled={translatedChapters.size === 0 || chapters.filter(c => isChapterIncluded(c.id) && translatedChapters.has(c.id)).length === 0}
                className="h-7 px-2 text-2xs shrink-0"
                title="Tạo audio cho bản dịch các chương được chọn"
              >
                <Volume2 size={12} />
                Audio bản dịch
              </Button>
              <Button
                onClick={() => handleGenerateAudioBatch('summary')}
                variant="secondary"
                disabled={summaries.size === 0 || chapters.filter(c => isChapterIncluded(c.id) && summaries.has(c.id)).length === 0}
                className="h-7 px-2 text-2xs shrink-0"
                title="Tạo audio cho tóm tắt các chương được chọn"
              >
                <Volume2 size={12} />
                Audio tóm tắt
              </Button>
            </>
          )}

          {/* Streaming error */}
          {selectedChapterId && streamingErrors.has(selectedChapterId) && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-2xs ml-auto">
              <AlertTriangle size={10} className="shrink-0" />
              <span className="truncate max-w-48">{streamingErrors.get(selectedChapterId)}</span>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Main Split View */}
      <div className={`flex-1 flex min-h-0 overflow-hidden ${isReaderMode ? '' : 'gap-3'}`}>
        {/* Left Panel: Chapter List */}
        {!isReaderMode && (
        <div className="w-[320px] max-w-[35%] min-w-70 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
          {/* Header voi toggle buttons */}
          <div className="p-3 border-b border-border bg-surface/50">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-text-primary">Danh sách chương</span>
              <span className="text-xs text-text-secondary bg-surface px-2 py-1 rounded">
                {selectedChapterCount}/{chapters.length}
              </span>
            </div>
            {chapters.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={selectAllChapters}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center justify-center gap-1"
                >
                  <CheckSquare size={12} />
                  Chọn tất cả
                </button>
                <button
                  onClick={deselectAllChapters}
                  className="flex-1 text-xs px-2 py-1.5 rounded bg-surface text-text-secondary hover:bg-surface/80 transition-colors flex items-center justify-center gap-1"
                >
                  <Square size={12} />
                  Bỏ chọn
                </button>
              </div>
            )}
          </div>
          
          {/* Chapter list voi checkboxes */}
          <div className="flex-1 flex flex-col-reverse overflow-hidden">
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
            {chapters.map((chapter) => {
              const isProcessing = processingChapters.has(chapter.id);
              const processingInfo = processingChapters.get(chapter.id);
              const elapsedAnchor = isProcessing && processingInfo
                ? processingInfo.phase === 'queued'
                  ? (processingInfo.queuedAt || processingInfo.startTime)
                  : processingInfo.startTime
                : 0;
              const elapsedTime = isProcessing && processingInfo
                ? Math.floor((Date.now() - elapsedAnchor) / 1000)
                : 0;
              const hasTranslatedTitle = translatedTitles.has(chapter.id) || translatedChapters.has(chapter.id);
              
              return (
              <div
                key={chapter.id}
                className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
                  selectedChapterId === chapter.id
                    ? 'bg-primary text-text-invert'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleChapterExclusion(chapter.id, e.shiftKey);
                  }}
                  className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    isChapterIncluded(chapter.id)
                      ? selectedChapterId === chapter.id
                        ? 'bg-white border-white text-primary'
                        : 'bg-primary border-primary text-white'
                      : selectedChapterId === chapter.id
                        ? 'border-white/50'
                        : 'border-border'
                  }`}
                >
                  {isChapterIncluded(chapter.id) && (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                
                {/* Chapter title */}
                <button
                  onClick={() => handleSelectChapter(chapter.id)}
                  className="min-w-0 flex-1 text-left flex items-center gap-2"
                >
                  <span className={`wrap-break-word leading-5 ${
                    !isChapterIncluded(chapter.id)
                      ? selectedChapterId === chapter.id
                        ? 'text-white/60 italic'
                        : 'text-text-secondary/40 italic'
                      : hasTranslatedTitle
                        ? 'text-emerald-500 font-medium'
                        : selectedChapterId === chapter.id
                          ? 'text-white'
                          : 'text-text-secondary'
                  }`}>
                    {translatedTitles.get(chapter.id)
                      || (translatedChapters.has(chapter.id)
                        ? extractTranslatedTitle(translatedChapters.get(chapter.id) || '', chapter.id)
                        : chapter.title)}
                  </span>
                  
                  {/* Status Indicators */}
                  {(translatedChapters.has(chapter.id) || summaries.has(chapter.id)) && (
                    <div className="flex gap-1 shrink-0 ml-auto">
                      {translatedChapters.has(chapter.id) && (
                        <span 
                          className="text-2xs font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-500 border border-green-500/30"
                          title="Đã dịch"
                        >
                          D
                        </span>
                      )}
                      {summaries.has(chapter.id) && (
                        <span 
                          className="text-2xs font-bold px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-500 border border-teal-500/30"
                          title="Đã tóm tắt"
                        >
                          T
                        </span>
                      )}
                    </div>
                  )}
                </button>

                {/* Processing Indicator - outside button to prevent truncation */}
                {isProcessing && processingInfo && (
                  <span className={`flex items-center gap-1 shrink-0 text-xs ${
                    selectedChapterId === chapter.id ? 'text-yellow-300' : 'text-yellow-500'
                  }`}>
                    <span className={`px-1.5 py-0.5 rounded border ${
                      selectedChapterId === chapter.id
                        ? 'border-yellow-300/60 bg-yellow-300/10'
                        : 'border-yellow-500/60 bg-yellow-500/10'
                    }`}>
                      {processingInfo.phase === 'queued'
                        ? 'QUEUE'
                        : processingInfo.channel === 'api'
                          ? 'API'
                          : 'TOKEN'}
                    </span>
                    <Loader
                      size={12}
                      className={processingInfo.phase === 'queued' ? '' : 'animate-spin'}
                    />
                    <span className="font-mono">W{processingInfo.workerId}</span>
                    {processingInfo.resourceLabel && (
                      <span className="px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-500">
                        {processingInfo.resourceLabel}
                      </span>
                    )}
                    <Clock size={10} />
                    <span className="font-mono">{elapsedTime}s</span>
                    {processingInfo.retryCount && processingInfo.retryCount > 0 && (
                        <span className="text-2xs ml-1 opacity-80 whitespace-nowrap">
                          {processingInfo.phase === 'retry_wait'
                            ? `retry #${processingInfo.retryCount}`
                            : `retry #${processingInfo.retryCount}`}
                        </span>
                    )}
                    {processingInfo.lastError && (
                      <span className="text-red-400 text-xs ml-1 max-w-[200px] truncate" title={processingInfo.lastError}>
                        {processingInfo.lastError}
                      </span>
                    )}
                  </span>
                )}
              </div>
            )})}
            </div>
          </div>
        </div>
        )}

        {/* Right Panel: Content */}
        <div
          className={`${
            isReaderMode
              ? 'flex-1 flex flex-col overflow-hidden border-0 rounded-none'
              : 'flex-1 border rounded-xl flex flex-col overflow-hidden'
          }`}
          style={{
            backgroundColor: readerPalette.panelBackground,
            borderColor: isReaderMode ? 'transparent' : readerPalette.borderColor
          }}
        >
          <ReaderPane
            selectedChapterId={selectedChapterId}
            chapters={chapters}
            translatedChapters={translatedChapters}
            summaries={summaries}
            summaryTitles={summaryTitles}
            skippedChapters={excludedChapterIds}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            isReaderMode={isReaderMode}
            fontSize={fontSize}
            lineHeight={lineHeight}
            setFontSize={setFontSize}
            setLineHeight={setLineHeight}
            readingTheme={readingTheme}
            setReadingTheme={setReadingTheme}
            palette={readerPalette}
            contentScrollRef={contentScrollRef}
            onContentScroll={handleContentScroll}
            streamingContent={streamingContent}
            streamingErrors={streamingErrors}
          />
        </div>
      </div>
    </div>
  );
}

