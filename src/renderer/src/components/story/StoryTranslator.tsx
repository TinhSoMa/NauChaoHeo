import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Chapter, STORY_IPC_CHANNELS } from '@shared/types';
import { StoryChapterMethod, StoryStatus, StoryTranslationMethod } from './types';
import { GEMINI_MODEL_LIST } from '@shared/constants';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { FileText, BookOpen, Clock, CheckSquare, Square, Loader, Sparkles, StopCircle, Download } from 'lucide-react';
import { extractTranslatedTitle } from './utils/chapterUtils';
import { useChapterSelection } from './hooks/useChapterSelection';
import { useTokenManagement } from './hooks/useTokenManagement';
import { useStoryTranslatorPersistence } from './hooks/useStoryTranslatorPersistence';
import { useProxySettings } from './hooks/useProxySettings';
import { useStoryFileManagement } from './hooks/useStoryFileManagement';
import { useStoryTranslation } from './hooks/useStoryTranslation';
import { useStoryBatchTranslation } from './hooks/useStoryBatchTranslation';
import { useStoryExport } from './hooks/useStoryExport';
import { useStorySummaryGeneration } from './hooks/useStorySummaryGeneration';
import { useStoryGeminiWebQueueTranslation } from './hooks/useStoryGeminiWebQueueTranslation';
import type { StoryWebQueueMode } from './hooks/useStoryGeminiWebQueueTranslation';

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
  const [filePath, setFilePath] = useState('');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [model, setModel] = useState('gemini-3-flash-preview');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>(
    () => GEMINI_MODEL_LIST.map((m: { id: string; label: string }) => ({ value: m.id, label: m.label }))
  );
  const [translationMethod, setTranslationMethod] = useState<StoryTranslationMethod>('api');
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
  const [retranslateExisting, setRetranslateExisting] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(getInitialViewportWidth);
  const [chapterScrollPositions, setChapterScrollPositions] = useState<Map<string, number>>(new Map());
  const isReaderMode = viewportWidth <= READER_MODE_BREAKPOINT;
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const chapterScrollPositionsRef = useRef<Map<string, number>>(new Map());
  const scrollFlushTimeoutRef = useRef<number | null>(null);

  // Proxy settings hook
  const { useProxy } = useProxySettings();

  // File management hook
  const fileManagement = useStoryFileManagement({
    sourceLang,
    targetLang,
    model,
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
    tokenConfigs,
    getDistinctActiveTokenConfigs,
    getPreferredTokenConfig,
    setStatus,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    setTokenContexts
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
    setStatus,
    setProcessingChapters,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods
  });

  // Single translation hook (using processingChapters from batch hook)
  const translation = useStoryTranslation({
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
    translatedChapters
  });

  // Project state persistence
  const { projectId } = useStoryTranslatorPersistence(
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
      chapterScrollPositions
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
      setChapterScrollPositions,
      setChapters
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

  const handleViewModeChange = useCallback(
    (nextMode: 'original' | 'translated' | 'summary') => {
      if (nextMode === viewMode) {
        return;
      }
      saveCurrentScrollPosition();
      flushScrollPositions();
      setViewMode(nextMode);
    },
    [flushScrollPositions, saveCurrentScrollPosition, viewMode]
  );

  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      if (chapterId === selectedChapterId) {
        return;
      }
      saveCurrentScrollPosition();
      flushScrollPositions();
      setSelectedChapterId(chapterId);
      if (translatedChapters.has(chapterId)) {
        setViewMode('translated');
      } else {
        setViewMode('original');
      }
    },
    [flushScrollPositions, saveCurrentScrollPosition, selectedChapterId, translatedChapters]
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
      if (translatedChapters.has(nextChapterId)) {
        setViewMode('translated');
      } else {
        setViewMode('original');
      }
    },
    [flushScrollPositions, navigableChapterIds, saveCurrentScrollPosition, selectedChapterId, translatedChapters]
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
    if (translatedChapters.has(firstChapterId)) {
      setViewMode('translated');
    }
  }, [isReaderMode, navigableChapterIds, selectedChapterId, translatedChapters]);

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
    loadConfigurations,
    getPreferredTokenConfig,
    setProcessingChapters,
    isChapterIncluded,
    tokenConfigs,
    getDistinctActiveTokenConfigs
  });
  
  // Debug logging
  console.log('[StoryTranslator] Render - translatedChapters.size:', translatedChapters.size);
  console.log('[StoryTranslator] Render - status:', status);
  console.log('[StoryTranslator] Render - chapters.length:', chapters.length);
  console.log('[StoryTranslator] Render - isBatchTranslating:', isBatchTranslating);
  console.log('[StoryTranslator] Render - batchTranslationProgress:', batchTranslationProgress);

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

  // Listen for progress/retry events
  useEffect(() => {
    // Note: onMessage returns a cleanup function in implementation, but type def says void.
    // We cast to any to avoid TS error if types are not updated.
    const removeListener = (window.electronAPI as any).onMessage(STORY_IPC_CHANNELS.TRANSLATION_PROGRESS, (data: any) => {
      const { chapterId, attempt, maxRetries } = data;
      setProcessingChapters(prev => {
        const info = prev.get(chapterId);
        if (info) {
          const next = new Map(prev);
          next.set(chapterId, { ...info, retryCount: attempt, maxRetries });
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

  const handleTranslate = async () => {
    await translation.handleTranslate(selectedChapterId);
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
      const eligibleChapterIds = chapters
        .filter((chapter) => isChapterIncluded(chapter.id) && (retranslateExisting || !translatedChapters.has(chapter.id)))
        .map((chapter) => chapter.id);

      if (eligibleChapterIds.length === 0) {
        alert('Đã dịch xong tất cả các chương được chọn!');
        return;
      }

      const queueChapterIds: string[] = [];
      const apiChapterIds: string[] = [];
      eligibleChapterIds.forEach((chapterId, index) => {
        if (index % 2 === 0) {
          queueChapterIds.push(chapterId);
        } else {
          apiChapterIds.push(chapterId);
        }
      });

      const tasks: Array<Promise<void>> = [];
      if (queueChapterIds.length > 0) {
        tasks.push(handleTranslateAllWebQueue({ chapterIds: queueChapterIds }));
      }
      if (apiChapterIds.length > 0) {
        tasks.push(handleBatchTranslate({ chapterIds: apiChapterIds }));
      }

      await Promise.all(tasks);
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

  const handleSavePrompt = async () => {
    await fileManagement.handleSavePrompt(selectedChapterId, chapters);
  };

  const handleSaveSummaryPrompt = async () => {
    const translatedContent = selectedChapterId ? translatedChapters.get(selectedChapterId) : undefined;
    await fileManagement.handleSaveSummaryPrompt(selectedChapterId, chapters, translatedContent);
  };

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

  // const LANG_OPTIONS = [
  //   { value: 'auto', label: 'Tự động phát hiện' },
  //   { value: 'en', label: 'Tiếng Anh (English)' },
  //   { value: 'vi', label: 'Tiếng Việt (Vietnamese)' },
  //   { value: 'zh', label: 'Tiếng Trung (Chinese)' },
  //   { value: 'ja', label: 'Tiếng Nhật (Japanese)' },
  //   { value: 'ko', label: 'Tiếng Hàn (Korean)' },
  // ];

  return (
    <div className="flex flex-col w-full h-[calc(100vh-4rem)] min-h-0 gap-3 overflow-hidden">
      {/* Configuration Section */}
      {!isReaderMode && (
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 p-2.5 bg-card border border-border rounded-xl shrink-0 overflow-hidden">
        <div className="md:col-span-3 flex flex-col gap-1 min-w-0">
           <label className="text-sm font-medium text-text-secondary">File</label>
           <div className="flex gap-2">
             <Input 
               placeholder="Chọn file" 
               value={filePath}
               onChange={(e) => setFilePath(e.target.value)}
               containerClassName="flex-1"
             />
             <Button
               onClick={handleBrowse}
               variant="secondary"
               className="shrink-0 h-8 px-2 text-xs"
               disabled={status === 'running'}
               title={status === 'running' ? 'Đang chạy tiến trình, tạm thời không đổi file' : 'Chọn file truyện'}
             >
               <FileText size={16} />
             </Button>
           </div>
        </div>

        {/* <div className="md:col-span-2">
          <Select
            label="Ngôn ngữ gốc"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            options={LANG_OPTIONS}
          />
        </div>

        <div className="md:col-span-2 min-w-0">
           <Select
            label="Ngôn ngữ đích"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            options={LANG_OPTIONS}
          />
        </div> */}

        <div className="md:col-span-2">
          <Select
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            options={modelOptions.map(m => ({
              value: m.value,
              label: compactModelLabel(m.label)
            }))}
          />
        </div>

        <div className="md:col-span-1 min-w-0">
          <Select
            label="Mode"
            value={translationMethod}
            onChange={(e) => setTranslationMethod(e.target.value as StoryTranslationMethod)}
            options={[
              { value: 'api', label: 'API' },
              { value: 'token', label: 'IMPIT Token' },
              ...(isGeminiWebQueueEnabled
                ? [
                    { value: 'gemini_webapi_queue', label: 'Gemini WebAPI Queue' },
                    { value: 'api_gemini_webapi_queue', label: 'Kết hợp (API + Queue)' }
                  ]
                : [])
            ]}
          />
        </div>

        {isGeminiWebQueueEnabled && isQueueMethodSelected && (
          <div className="md:col-span-2 min-w-0">
            <label className="text-xs text-text-secondary mb-1 block">Queue</label>
            <select
              value={webQueueMode}
              onChange={(e) => setWebQueueMode(e.target.value as StoryWebQueueMode)}
              disabled={isWebQueueTranslating || isWebQueueStopping || status === 'running'}
              className="h-8 px-2 rounded-md border border-border bg-card text-text-primary text-xs w-full"
            >
              <option value="multi_auto">Auto</option>
              <option value="sequential">Tuần tự</option>
            </select>
            {webQueueMode === 'multi_auto' && (
              <span className="text-[10px] text-text-secondary block mt-1">
                {isWebQueueTranslating
                  ? `Auto workers: ${webQueueResolvedWorkerCount ?? 3}`
                  : 'Tự điều phối'}
              </span>
            )}
          </div>
        )}

        {chapters.length > 0 && (
          <div className="md:col-span-4 flex items-end justify-end gap-2 min-w-0">
            <span className="text-xs px-2.5 py-1 bg-primary/10 text-primary rounded-full whitespace-nowrap">
              Đã dịch: {translatedChapters.size}/{chapters.length} chương
            </span>
            {translatedChapters.size > 0 && (
              <Button
                onClick={handleExportEbook}
                variant="primary"
                disabled={exportStatus === 'exporting'}
                className="h-8 px-3 text-xs shrink-0"
              >
                <Download size={14} />
                {exportStatus === 'exporting' ? 'Đang export...' : 'Export EPUB'}
              </Button>
            )}
          </div>
        )}

        <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button 
              onClick={handleTranslate} 
              variant="secondary" 
              disabled={!filePath || status === 'running' || !selectedChapterId}
              className="h-8 px-2.5 text-xs shrink-0"
              title="Dịch chương đang chọn"
            >
              <BookOpen size={16} />
              Dịch 1
            </Button>
            <Button 
              onClick={() => handleGenerateSummary(selectedChapterId)} 
              variant="secondary" 
              disabled={!filePath || status === 'running' || !selectedChapterId || !translatedChapters.has(selectedChapterId) || isGeneratingSummary}
              className="h-8 px-2.5 text-xs shrink-0"
              title="Tóm tắt chương đang chọn"
            >
              <FileText size={16} />
              {isGeneratingSummary ? 'Đang tóm...' : 'Tóm 1'}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            {isGeneratingSummary && batchSummaryProgress ? (
              <Button 
                onClick={stopSummaryGeneration}
                variant="secondary"
                className="h-8 px-2.5 text-xs shrink-0 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
                title="Dừng tóm tắt batch hiện tại"
              >
                <StopCircle size={16} />
                {isSummaryStopping
                  ? `Đang dừng TT (${batchSummaryProgress?.current}/${batchSummaryProgress?.total})`
                  : `Dừng TT (${batchSummaryProgress?.current}/${batchSummaryProgress?.total})`}
              </Button>
            ) : (isBatchTranslating || isWebQueueTranslating) && combinedBatchProgress ? (
              <Button 
                onClick={handleStopBatchByMethod}
                variant="secondary"
                className="h-8 px-2.5 text-xs shrink-0 bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30"
                title="Dừng dịch batch hiện tại"
              >
                <StopCircle size={16} />
                {isBatchStopping || isWebQueueStopping
                  ? `Đang dừng Dịch (${combinedBatchProgress.current}/${combinedBatchProgress.total})`
                  : `Dừng Dịch (${combinedBatchProgress.current}/${combinedBatchProgress.total})`}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={handleTranslateAllByMethod}
                  className="flex items-center gap-1.5 h-8 px-3 text-xs shrink-0"
                  disabled={
                    !filePath ||
                    isGeneratingSummary ||
                    isSummaryStopping ||
                    isBatchStopping ||
                    isWebQueueStopping ||
                    status === 'running'
                  }
                  title="Dịch batch theo Mode đã chọn"
                >
                  <FileText size={16} />
                  Dịch
                </Button>

                <Button
                    variant="secondary"
                    onClick={isGeneratingSummary ? stopSummaryGeneration : handleGenerateAllSummaries}
                    className="flex items-center gap-1.5 h-8 px-3 text-xs shrink-0"
                    disabled={isBatchTranslating || isBatchStopping || isWebQueueTranslating || isWebQueueStopping || (status !== 'idle' && !isGeneratingSummary)}
                    title="Tóm tắt các chương đã dịch nhưng chưa có tóm tắt"
                >
                    {isGeneratingSummary ? <StopCircle size={16} /> : <Sparkles size={16} />}
                    {isGeneratingSummary ? (isSummaryStopping ? 'Đang dừng tóm' : 'Dừng tóm') : 'Tóm tất cả'}
                </Button>
              </>
            )}
          </div>
        </div>


        <div className="md:col-span-12 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer hover:text-primary">
            <input
              type="checkbox"
              checked={retranslateExisting}
              onChange={(e) => setRetranslateExisting(e.target.checked)}
              className="w-4 h-4 rounded border-border cursor-pointer"
            />
            <span>Dịch lại chương đã dịch</span>
          </label>
        </div>
      </div>
      )}

      {/* Main Split View */}
      <div className={`flex-1 flex min-h-0 overflow-hidden ${isReaderMode ? '' : 'gap-3'}`}>
        {/* Left Panel: Chapter List */}
        {!isReaderMode && (
        <div className="w-[320px] max-w-[35%] min-w-[280px] bg-card border border-border rounded-xl flex flex-col overflow-hidden">
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
                  <span className={`break-words leading-5 ${
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
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-500 border border-green-500/30"
                          title="Đã dịch"
                        >
                          D
                        </span>
                      )}
                      {summaries.has(chapter.id) && (
                        <span 
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-500 border border-teal-500/30"
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
                        <span className="text-[10px] ml-1 opacity-80 whitespace-nowrap">
                            ({processingInfo.retryCount}/{processingInfo.maxRetries || 3})
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
        <div className={`${isReaderMode ? 'flex-1 flex flex-col overflow-hidden border-0 rounded-none bg-transparent' : 'flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden'}`}>
          {!isReaderMode && (
           <div className="p-3 border-b border-border font-semibold text-text-primary bg-surface/50 flex flex-wrap justify-between items-start gap-2">
            <div className="flex items-center gap-3 min-w-0 flex-wrap">
              <span>Nội dung</span>
              {selectedChapterId && (
                <div className="flex gap-1 bg-surface rounded p-1">
                  <button 
                    onClick={() => handleViewModeChange('original')}
                    className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'original' ? 'bg-primary text-white shadow' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    Gốc
                  </button>
                  <button 
                    onClick={() => handleViewModeChange('translated')}
                    disabled={!selectedChapterId || !translatedChapters.has(selectedChapterId)}
                    className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'translated' ? 'bg-primary text-white shadow' : 'text-text-secondary hover:text-text-primary disabled:opacity-50'}`}
                  >
                    Bản dịch
                  </button>
                  <button 
                    onClick={() => handleViewModeChange('summary')}
                    disabled={!selectedChapterId || !summaries.has(selectedChapterId)}
                    className={`px-3 py-1 text-xs rounded transition-all ${viewMode === 'summary' ? 'bg-primary text-white shadow' : 'text-text-secondary hover:text-text-primary disabled:opacity-50'}`}
                  >
                    Tóm tắt
                  </button>
                </div>
              )}
              
              {/* Reading Controls */}
              {selectedChapterId && (
                <div className="flex items-center gap-3 ml-2 pl-3 border-l border-border flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">Cỡ chữ:</span>
                    <button 
                      onClick={() => setFontSize(prev => Math.max(12, prev - 2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      -
                    </button>
                    <span className="text-xs text-text-secondary min-w-8 text-center">{fontSize}px</span>
                    <button 
                      onClick={() => setFontSize(prev => Math.min(32, prev + 2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      +
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">Giãn dòng:</span>
                    <button 
                      onClick={() => setLineHeight(prev => Math.max(1.2, prev - 0.2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      -
                    </button>
                    <span className="text-xs text-text-secondary min-w-8 text-center">{lineHeight.toFixed(1)}</span>
                    <button 
                      onClick={() => setLineHeight(prev => Math.min(3, prev + 0.2))}
                      className="w-6 h-6 rounded bg-surface hover:bg-surface/80 text-text-primary flex items-center justify-center text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

            </div>
            {selectedChapterId && (
              <div className="flex gap-2 items-center flex-wrap justify-end min-w-0">
                 {/* Hien thi trang thai loai tru */}
                 {!isChapterIncluded(selectedChapterId) && (
                   <span className="text-xs text-orange-500 bg-orange-500/10 px-2 py-1 rounded">
                     Đã loại trừ
                   </span>
                 )}
                 <Button onClick={handleSavePrompt} variant="secondary" className="text-xs h-8 px-2">
                   Lưu Prompt Dịch
                 </Button>
                 <Button onClick={handleSaveSummaryPrompt} variant="secondary" className="text-xs h-8 px-2">
                   Lưu Prompt Tóm Tắt
                 </Button>
                 <span className="text-xs text-text-secondary px-2 py-1 bg-surface rounded border border-border max-w-[320px] truncate">
                   {chapters.find(c => c.id === selectedChapterId)?.title}
                 </span>
              </div>
            )}
          </div>
          )}
          <div 
            ref={contentScrollRef}
            onScroll={handleContentScroll}
            className={`flex-1 overflow-y-auto text-text-primary ${isReaderMode ? 'px-2 py-2' : 'px-8 py-6'}`}
            style={{
              fontSize: `${fontSize}px`,
              lineHeight: lineHeight,
              fontFamily: "'Noto Sans', 'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif",
              letterSpacing: '0.01em',
              wordSpacing: '0.05em'
            }}
          >
            <div className={`${isReaderMode ? 'w-full max-w-none' : 'mx-auto max-w-4xl'}`}>
              {selectedChapterId ? (
                viewMode === 'original' ? (
                  <div className="whitespace-pre-wrap wrap-break-word">
                    {chapters.find(c => c.id === selectedChapterId)?.content}
                  </div>
                ) : viewMode === 'translated' ? (
                  translatedChapters.get(selectedChapterId) ? (
                    <div className="whitespace-pre-wrap wrap-break-word">
                      {translatedChapters.get(selectedChapterId) || ''}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                      <BookOpen size={48} className="mb-4" />
                      <p className="text-base">Chưa có bản dịch. Nhấn "Dịch 1" hoặc "Dịch All" để bắt đầu.</p>
                    </div>
                  )
                ) : (
                  // Summary View
                  summaries.get(selectedChapterId) ? (
                    <div className="whitespace-pre-wrap wrap-break-word">
                       {summaryTitles.get(selectedChapterId) && (
                          <h3 className="text-lg font-bold mb-4 text-primary">{summaryTitles.get(selectedChapterId) || ''}</h3>
                       )}
                       {summaries.get(selectedChapterId) || ''}
                    </div>
                  ) : (
                     <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                       <FileText size={48} className="mb-4" />
                       <p className="text-base">Chưa có tóm tắt cho chương này.</p>
                    </div>
                  )
                )
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                  <BookOpen size={48} className="mb-4" />
                  <p className="text-base">Chọn một chương để xem nội dung</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

