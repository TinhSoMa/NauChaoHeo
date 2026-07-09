import { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react';
import { Chapter, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import {
  GeminiChatConfigLite,
  OperationType,
  TokenContext,
  ProcessingChapterInfo,
  StoryChapterMethod,
  StoryPromptSaveSettings,
  StoryPreviousAssistantOutputMode,
  StoryStatus
} from '../types';
import { resolvePreviousTranslatedOutputDebug, resolvePreviousSummaryOutput } from '../utils/previousAssistantOutput';
import { saveSummaryPromptArtifact } from '../utils/promptArtifact';
import { getInfiniteRetryDelayMs, normalizeRetryError } from '../utils/retryUtils';

interface UseStorySummaryGenerationProps {
  chapters: Chapter[];
  translatedChapters: Map<string, string>;
  translatedTitles: Map<string, string>;
  sourceLang: string;
  targetLang: string;
  model: string;
  translateMode: 'api' | 'token' | 'both';
  summaries: Map<string, string>;
  summaryTitles: Map<string, string>;
  chapterModels: Map<string, string>;
  chapterMethods: Map<string, StoryChapterMethod>;
  tokenContexts: Map<string, TokenContext>;
  setSummaries: Dispatch<SetStateAction<Map<string, string>>>;
  setSummaryTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, StoryChapterMethod>>>;
  setTokenContexts: Dispatch<SetStateAction<Map<string, TokenContext>>>;
  setProcessingChapters: (update: (prev: Map<string, ProcessingChapterInfo>) => Map<string, ProcessingChapterInfo>) => void;
  setStatus: (status: StoryStatus) => void;
  setViewMode: (mode: 'original' | 'translated' | 'summary') => void;
  useProxy: boolean;
  projectId: string | null;
  filePath: string;
  loadConfigurations: () => Promise<void>;
  getPreferredTokenConfig: () => GeminiChatConfigLite | null;
  isChapterIncluded: (id: string) => boolean;
  tokenConfigs: GeminiChatConfigLite[];
  getDistinctActiveTokenConfigs: (configs: GeminiChatConfigLite[]) => GeminiChatConfigLite[];
  previousAssistantOutputMode: StoryPreviousAssistantOutputMode;
  promptSaveSettings: StoryPromptSaveSettings;
  setActiveOperation?: Dispatch<SetStateAction<OperationType>>;
}

// Helper functions
const extractCookieKey = (cookie: string): string => {
  const trimmed = cookie.trim();
  const psid1 = trimmed.match(/__Secure-1PSID=([^;\s]+)/)?.[1] || '';
  const psid3 = trimmed.match(/__Secure-3PSID=([^;\s]+)/)?.[1] || '';
  const combined = [psid1, psid3].filter(Boolean).join('|');
  return combined || trimmed;
};

const buildTokenKey = (config: GeminiChatConfigLite): string => {
  return `${extractCookieKey(config.cookie || '')}|${(config.atToken || '').trim()}`;
};

interface BatchState {
  chapters: Chapter[];
  currentIndex: number;
  completed: number;
  activeWorkerConfigIds: Set<string>;
  isFirstChapterTaken: boolean;
}

type SummaryProcessResult =
  | { status: 'success'; id: string; text: string }
  | { status: 'retry'; error: string }
  | { status: 'stopped' };

export function useStorySummaryGeneration({
  chapters,
  translatedChapters,
  translatedTitles,
  sourceLang,
  targetLang,
  model,
  translateMode,
  summaries,
  summaryTitles: _summaryTitles,
  chapterModels: _chapterModels,
  chapterMethods: _chapterMethods,
  tokenContexts: _tokenContexts,
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
}: UseStorySummaryGenerationProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [batchSummaryProgress, setBatchSummaryProgress] = useState<{ current: number; total: number } | null>(null);
  const [, setApiWorkerCountSetting] = useState(1);
  const [apiRequestDelayMs, setApiRequestDelayMs] = useState(500);
  const [, setTick] = useState(0); // Force re-render for elapsed time
  
  // Stop control
  const [, setShouldStop] = useState(false);
  const shouldStopRef = useRef(false);

  // Batch state
  const batchStateRef = useRef<BatchState>({
    chapters: [],
    currentIndex: 0,
    completed: 0,
    activeWorkerConfigIds: new Set(),
    isFirstChapterTaken: false
  });
  const workerIdRef = useRef(0);
  const runtimeSummariesRef = useRef<Map<string, string>>(new Map(summaries));
  const runtimeTranslatedChaptersRef = useRef<Map<string, string>>(new Map(translatedChapters));
  
  // Ref to track if batch is currently running (for hot-add workers)
  const isBatchRunningRef = useRef(false);
  const currentBatchRunIdRef = useRef<string | null>(null);
  const activeWorkerCountRef = useRef(0);
  const spawnTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Update elapsed time every second
  useEffect(() => {
    // Check if any processing chapters exist via a simple size check
    // Note: processingChapters is managed externally, so we can't directly check it here
    // This timer will run when isGenerating is true, which is a good proxy
    if (!isGenerating) return;
    
    const interval = setInterval(() => {
      setTick(prev => prev + 1); // Force re-render to update elapsed time
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isGenerating]);

  useEffect(() => {
    runtimeSummariesRef.current = new Map(summaries);
  }, [summaries]);

  useEffect(() => {
    runtimeTranslatedChaptersRef.current = new Map(translatedChapters);
  }, [translatedChapters]);

  useEffect(() => {
    const loadAppSettings = async () => {
      try {
        const result = await window.electronAPI.appSettings.getAll();
        if (result.success && result.data) {
          const raw = Number(result.data.apiWorkerCount);
          const normalized = Number.isFinite(raw) ? Math.min(10, Math.max(1, Math.floor(raw))) : 1;
          setApiWorkerCountSetting(normalized);
          const rawDelay = Number(result.data.apiRequestDelayMs);
          const delayMs = Number.isFinite(rawDelay) ? Math.min(30000, Math.max(0, Math.floor(rawDelay))) : 500;
          setApiRequestDelayMs(delayMs);
        }
      } catch (error) {
        console.error('[useStorySummaryGeneration] Error loading app settings:', error);
      }
    };
    loadAppSettings();
  }, []);

  const stopGeneration = () => {
    console.log('[useStorySummaryGeneration] Dừng tóm tắt thủ công...');
    shouldStopRef.current = true;
    currentBatchRunIdRef.current = null;
    setShouldStop(true);
    isBatchRunningRef.current = false;
    setIsStopping(true);
    setProcessingChapters(() => new Map());
    setActiveOperation?.('idle');
    for (const timeout of spawnTimeoutsRef.current) {
      clearTimeout(timeout);
    }
    spawnTimeoutsRef.current = [];
  };

  const handleGenerateSummary = async (selectedChapterId: string | null, retranslateSummary: boolean = false) => {
    if (!selectedChapterId) return;
    
    // Check if chapter is already summarized and not forced re-summarize
    if (summaries.has(selectedChapterId) && !retranslateSummary) {
      const confirm = window.confirm('Chương này đã được tóm tắt rồi. Bạn có muốn tóm tắt lại không?');
      if (!confirm) return;
    }

    // Check source data (translated content)
    const sourceContent = translatedChapters.get(selectedChapterId);
    if (!sourceContent) {
      alert('Không tìm thấy bản dịch cho chương này. Vui lòng dịch truyện trước.');
      return;
    }
    const chapter = chapters.find((entry) => entry.id === selectedChapterId);
    if (!chapter) {
      alert('Không tìm thấy thông tin chương để tóm tắt.');
      return;
    }
    const chapterIndex = chapter ? chapters.findIndex((entry) => entry.id === chapter.id) : -1;
    const previousTranslatedOutputResult = chapterIndex >= 0
      ? resolvePreviousTranslatedOutputDebug({
          chapters,
          chapterIndex,
          translatedChapters: runtimeTranslatedChaptersRef.current,
          mode: previousAssistantOutputMode,
          chapterCount: promptSaveSettings.previousAssistantOutputChapterCount
        })
      : {
          content: '',
          debug: {
            requestedChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
            resolvedChapterIds: [],
            missingChapterIds: [],
            finalIncludedChapterIds: []
          }
        };
    const previousSummaryOutput = resolvePreviousSummaryOutput({
      chapters,
      chapterIndex,
      summaries,
      mode: previousAssistantOutputMode
    });

    setIsGenerating(true);
    setStatus('running');
    setActiveOperation?.('summarizing');
    
    try {
      console.log('[useStorySummaryGeneration] Đang chuẩn bị prompt tóm tắt...');
      // 1. Prepare Summary Prompt
const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
        chapterContent: sourceContent,
        sourceLang,
        targetLang,
        previousSummaryOutput: previousSummaryOutput || undefined,
        previousTranslatedOutput: previousTranslatedOutputResult.content,
        previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
        previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
      }) as PreparePromptResult;

      if (!prepareResult.success || !prepareResult.prompt) {
        throw new Error(prepareResult.error || 'Lỗi chuẩn bị prompt tóm tắt');
      }

      console.log('[useStorySummaryGeneration] Đã chuẩn bị prompt, đang gửi đến Gemini...');
      
      // Use IMPIT for token mode, consistent with useStoryTranslation
      const method = translateMode === 'token' ? 'IMPIT' : 'API';
      const methodKey: 'api' | 'token' = method === 'IMPIT' ? 'token' : 'api';

      // Set processing state
      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.set(selectedChapterId, {
            startTime: Date.now(),
            workerId: 0, // 0 indicates manual/summary task
            channel: methodKey
        });
        return next;
      });

      let selectedTokenConfig = method === 'IMPIT' ? getPreferredTokenConfig() : null;
      if (method === 'IMPIT' && !selectedTokenConfig) {
        await loadConfigurations();
        selectedTokenConfig = getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          alert('Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
        }
      }

      const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      // 2. Send to Gemini for Summarization
      const translateResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.TRANSLATE_CHAPTER, {
        prompt: prepareResult.prompt,
        model: model,
        method,
        webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
        useProxy: method === 'IMPIT' && useProxy,
        metadata: { 
          chapterId: selectedChapterId,
          // Include regex for server-side validation and retry
          validationRegex: 'hết\\s+tóm\\s+tắt|end\\s+of\\s+summary|---\\s*hết\\s*---|hết\\s+chương'
        }
      }) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };

      if (promptSaveSettings.autoSaveSentPrompt) {
        await saveSummaryPromptArtifact({
          projectId,
          chapter,
          chapterIndex: chapterIndex + 1,
          method: methodKey,
          model,
          preparedPrompt: prepareResult.prompt,
          storyFilePath: filePath,
          previousAssistantOutputDebug: previousTranslatedOutputResult.debug,
          previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
          previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
          previousAssistantOutputSourceContent: previousTranslatedOutputResult.content
        });
      }

      if (translateResult.success && translateResult.data) {
        // Validate metadata
        if (translateResult.metadata?.chapterId !== selectedChapterId) {
          console.error(`[useStorySummaryGeneration] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== selected (${selectedChapterId})`);
          throw new Error('Metadata validation failed - race condition detected');
        }
        
        // Save summary to Map cache
        runtimeSummariesRef.current.set(selectedChapterId, translateResult.data!);
        setSummaries(prev => new Map(prev).set(selectedChapterId, translateResult.data!));

        setChapterModels(prev => new Map(prev).set(selectedChapterId, model));

        setChapterMethods(prev => new Map(prev).set(selectedChapterId, methodKey));
        
        // Set Summary Title same as Translated Title or Chapter Title
        setSummaryTitles(prev => {
            const next = new Map(prev);
            const translatedTitle = translatedTitles.get(selectedChapterId);
            const chapter = chapters.find(c => c.id === selectedChapterId);
            next.set(selectedChapterId, translatedTitle || (chapter ? chapter.title : ''));
            return next;
        });

        if (translateResult.context && translateResult.context.conversationId && tokenKey) {
          setTokenContexts(prev => new Map(prev).set(tokenKey, translateResult.context!));
        }

        setViewMode('summary');
        console.log('[useStorySummaryGeneration] Tóm tắt thành công!');
      } else {
        throw new Error(translateResult.error || 'Tóm tắt thất bại');
      }

    } catch (error) {
      console.error('[useStorySummaryGeneration] Lỗi trong quá trình tóm tắt:', error);
      alert(`Lỗi tóm tắt: ${error}`);
    } finally {
      setIsGenerating(false);
      setStatus('idle');
      setActiveOperation?.('idle');
      // Clear processing state
      setProcessingChapters(prev => {
          const next = new Map(prev);
          next.delete(selectedChapterId);
          return next;
      });
    }
  };

  // Helper: Process a single chapter summary
  const processChapterSummary = async (
    chapter: Chapter,
    index: number,
    workerId: number,
    channel: 'api' | 'token',
    tokenConfig: GeminiChatConfigLite | null,
    runId: string
  ): Promise<SummaryProcessResult> => {
    if (shouldStopRef.current || currentBatchRunIdRef.current !== runId) {
      return { status: 'stopped' };
    }

    setProcessingChapters(prev => {
      const next = new Map(prev);
      const current = next.get(chapter.id);
      next.set(chapter.id, {
        startTime: current?.startTime || Date.now(),
        workerId,
        channel,
        phase: 'running',
        retryCount: current?.retryCount ?? 0,
        lastError: current?.lastError
      });
      return next;
    });

    try {
      console.log(`[useStorySummaryGeneration] 📝 Tóm tắt chương ${index + 1}/${batchStateRef.current.chapters.length}: ${chapter.title} (Token: ${tokenConfig?.email || tokenConfig?.id || 'API'})`);

      const sourceContent = runtimeTranslatedChaptersRef.current.get(chapter.id);
      if (!sourceContent) {
        const errorMessage = `Không tìm thấy bản dịch cho chương ${chapter.title}`;
        console.error(`[useStorySummaryGeneration] ${errorMessage}`);
        return { status: 'retry', error: errorMessage };
      }

      const actualChapterIndex = chapters.findIndex((entry) => entry.id === chapter.id);
      const previousTranslatedOutputResult = actualChapterIndex >= 0
        ? resolvePreviousTranslatedOutputDebug({
            chapters,
            chapterIndex: actualChapterIndex,
            translatedChapters: runtimeTranslatedChaptersRef.current,
            mode: previousAssistantOutputMode,
            chapterCount: promptSaveSettings.previousAssistantOutputChapterCount
          })
        : {
            content: '',
            debug: {
              requestedChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
              resolvedChapterIds: [],
              missingChapterIds: [],
              finalIncludedChapterIds: []
            }
          };
      const previousSummaryOutput = resolvePreviousSummaryOutput({
        chapters,
        chapterIndex: actualChapterIndex,
        summaries: runtimeSummariesRef.current,
        mode: previousAssistantOutputMode
      });

const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
        chapterContent: sourceContent,
        sourceLang,
        targetLang,
        previousSummaryOutput: previousSummaryOutput || undefined,
        previousTranslatedOutput: previousTranslatedOutputResult.content,
        previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
        previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
      }) as PreparePromptResult;

      if (!prepareResult.success || !prepareResult.prompt) {
        const errorMessage = prepareResult.error || `Lỗi chuẩn bị prompt tóm tắt cho chương ${chapter.title}`;
        console.error(errorMessage);
        return { status: 'retry', error: errorMessage };
      }

      const method = channel === 'token' ? 'IMPIT' : 'API';
      let selectedTokenConfig = method === 'IMPIT'
        ? (tokenConfig || getPreferredTokenConfig())
        : null;

      if (method === 'IMPIT' && !selectedTokenConfig) {
        await loadConfigurations();
        selectedTokenConfig = tokenConfig || getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          const errorMessage = '[useStorySummaryGeneration] Không tìm thấy Cấu hình Web để chạy chế độ Token.';
          console.error(errorMessage);
          return { status: 'retry', error: errorMessage };
        }
      }

      const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      const translateResult = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
        {
          prompt: prepareResult.prompt,
          model: model,
          method,
          webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
          useProxy: method === 'IMPIT' && useProxy,
          metadata: {
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            tokenInfo: tokenConfig ? (tokenConfig.email || tokenConfig.id) : 'API',
            validationRegex: 'hết\\s+tóm\\s+tắt|end\\s+of\\s+summary|---\\s*hết\\s*---|hết\\s+chương'
          }
        }
      ) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string } };

      if (promptSaveSettings.autoSaveSentPrompt) {
        await saveSummaryPromptArtifact({
          projectId,
          chapter,
          chapterIndex: actualChapterIndex >= 0 ? actualChapterIndex + 1 : index + 1,
          method: channel,
          model,
          preparedPrompt: prepareResult.prompt,
          storyFilePath: filePath,
          previousAssistantOutputDebug: previousTranslatedOutputResult.debug,
          previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
          previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
          previousAssistantOutputSourceContent: previousTranslatedOutputResult.content
        });
      }

      if (!translateResult.success || !translateResult.data) {
        const errorMessage = translateResult.error || `Lỗi tóm tắt chương ${chapter.title}`;
        console.error(`[useStorySummaryGeneration] ❌ ${errorMessage}`);
        return { status: 'retry', error: errorMessage };
      }

      if (translateResult.metadata?.chapterId !== chapter.id) {
        const errorMessage = `Metadata validation failed for chapter ${chapter.id}`;
        console.error(`[useStorySummaryGeneration] ⚠️ ${errorMessage}: ${translateResult.metadata?.chapterId} !== ${chapter.id}`);
        return { status: 'retry', error: errorMessage };
      }

      if (!/hết\s+tóm\s+tắt|end\s+of\s+summary|---\s*hết\s*---|hết\s+chương/i.test(translateResult.data)) {
        const errorMessage = `Summary chapter ${chapter.title} thiếu marker "Hết tóm tắt"`;
        console.warn(`[useStorySummaryGeneration] ⚠️ ${errorMessage}`);
        return { status: 'retry', error: errorMessage };
      }

      runtimeSummariesRef.current.set(chapter.id, translateResult.data);
      setSummaries(prev => {
        const next = new Map(prev);
        next.set(chapter.id, translateResult.data!);
        return next;
      });

      setSummaryTitles(prev => {
        const next = new Map(prev);
        const translatedTitle = translatedTitles.get(chapter.id);
        next.set(chapter.id, translatedTitle || chapter.title);
        return next;
      });

      setChapterModels(prev => new Map(prev).set(chapter.id, model));
      setChapterMethods(prev => new Map(prev).set(chapter.id, channel));

      if (translateResult.context && tokenKey) {
        setTokenContexts(prev => new Map(prev).set(tokenKey, translateResult.context!));
      }

      setProcessingChapters(prev => {
        const next = new Map(prev);
        next.delete(chapter.id);
        return next;
      });

      return { status: 'success', id: chapter.id, text: translateResult.data };
    } catch (error) {
      const errorMessage = normalizeRetryError(error);
      console.error(`[useStorySummaryGeneration] ❌ Exception chương ${chapter.title}:`, error);
      return { status: 'retry', error: errorMessage };
    }
  };

  const startWorker = async (channel: 'api' | 'token', tokenConfig: GeminiChatConfigLite | null, runId: string) => {
    if (currentBatchRunIdRef.current !== runId) {
      return;
    }

    const workerId = ++workerIdRef.current;
    activeWorkerCountRef.current += 1;
    console.log(`[useStorySummaryGeneration] 🚀 Worker ${workerId} started (${channel})`);

    let hasDispatched = false;

    if (channel === 'token' && tokenConfig) {
      batchStateRef.current.activeWorkerConfigIds.add(tokenConfig.id);
    }

    try {
      while (!shouldStopRef.current && currentBatchRunIdRef.current === runId) {
        if (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length) break;

        const index = batchStateRef.current.currentIndex++;
        const chapter = batchStateRef.current.chapters[index];

        if (channel === 'api' && apiRequestDelayMs > 0 && hasDispatched) {
          await new Promise(resolve => setTimeout(resolve, apiRequestDelayMs));
        }
        hasDispatched = true;

        if (!batchStateRef.current.isFirstChapterTaken) {
          batchStateRef.current.isFirstChapterTaken = true;
          console.log(`[useStorySummaryGeneration] 🚀 Worker ${workerId} lấy chương đầu tiên`);
        } else {
          console.log(`[useStorySummaryGeneration] 📝 Worker ${workerId} lấy chương ${index + 1}`);
        }

        let result: SummaryProcessResult = { status: 'stopped' };
        let retryCount = 0;

        while (!shouldStopRef.current && currentBatchRunIdRef.current === runId) {
          if (retryCount > 0) {
            const delayMs = getInfiniteRetryDelayMs(retryCount);
            setProcessingChapters(prev => {
              const next = new Map(prev);
              const current = next.get(chapter.id);
              next.set(chapter.id, {
                startTime: current?.startTime || Date.now(),
                workerId,
                channel,
                phase: 'retry_wait',
                retryCount,
                lastError: current?.lastError
              });
              return next;
            });
            console.log(
              `[useStorySummaryGeneration] ⚠️ Worker ${workerId} retrying chapter ${index + 1} (${chapter.id}) attempt ${retryCount} in ${delayMs}ms`
            );
            await new Promise(r => setTimeout(r, delayMs));
          }

          result = await processChapterSummary(chapter, index, workerId, channel, tokenConfig, runId);

          if (result.status === 'retry') {
            const retryError = result.error;
            if (shouldStopRef.current || currentBatchRunIdRef.current !== runId) {
              break;
            }
            retryCount++;
            setProcessingChapters(prev => {
              const next = new Map(prev);
              const current = next.get(chapter.id);
              next.set(chapter.id, {
                startTime: current?.startTime || Date.now(),
                workerId,
                channel,
                phase: 'retry_wait',
                retryCount,
                lastError: retryError
              });
              return next;
            });
            console.error(
              `[useStorySummaryGeneration] ❌ Worker ${workerId} chapter ${index + 1} failed. Retry #${retryCount}. Error: ${retryError}`
            );
            continue;
          }
          break;
        }

        if (result.status === 'success') {
          batchStateRef.current.completed++;
          setBatchSummaryProgress({ current: batchStateRef.current.completed, total: batchStateRef.current.chapters.length });
        }
      }
    } finally {
      activeWorkerCountRef.current = Math.max(0, activeWorkerCountRef.current - 1);
      if (channel === 'token' && tokenConfig) {
        batchStateRef.current.activeWorkerConfigIds.delete(tokenConfig.id);
      }
      console.log(`[useStorySummaryGeneration] ✓ Worker ${workerId} finished`);

      if (
        activeWorkerCountRef.current === 0 &&
        (currentBatchRunIdRef.current === runId || currentBatchRunIdRef.current === null) &&
        (
          shouldStopRef.current ||
          batchStateRef.current.completed >= batchStateRef.current.chapters.length ||
          batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length
        )
      ) {
        isBatchRunningRef.current = false;
        currentBatchRunIdRef.current = null;
        setIsGenerating(false);
        setIsStopping(false);
        setStatus('idle');
        setActiveOperation?.('idle');
        setBatchSummaryProgress(null);
        if (shouldStopRef.current) {
          setProcessingChapters(() => new Map());
        }
      }
    }
  };

  const handleGenerateAllSummaries = async () => {
    if (isBatchRunningRef.current && currentBatchRunIdRef.current) {
      alert('Batch tóm tắt đang chạy. Vui lòng dừng batch hiện tại trước khi chạy lại.');
      return;
    }

    const chaptersToSummarize = chapters.filter(c =>
      translatedChapters.has(c.id) && !summaries.has(c.id) && isChapterIncluded(c.id)
    );

    if (chaptersToSummarize.length === 0) {
      alert('Không có chương nào cần tóm tắt (đã tóm tắt hết hoặc chưa có bản dịch).');
      return;
    }

    const shouldUseTokenWorker = translateMode === 'token';
    const shouldUseApiWorker = !shouldUseTokenWorker;

    let tokenConfigsForRun: GeminiChatConfigLite[] = [];
    if (shouldUseTokenWorker) {
      tokenConfigsForRun = getDistinctActiveTokenConfigs(tokenConfigs);
      if (tokenConfigsForRun.length === 0) {
        console.error('[useStorySummaryGeneration] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
        return;
      }
    }

    const initialWorkerIds = new Set(tokenConfigsForRun.slice(0, 1).map(c => c.id));
    batchStateRef.current = {
      chapters: chaptersToSummarize,
      currentIndex: 0,
      completed: 0,
      activeWorkerConfigIds: initialWorkerIds,
      isFirstChapterTaken: false
    };
    workerIdRef.current = 0;
    activeWorkerCountRef.current = 0;
    for (const timeout of spawnTimeoutsRef.current) {
      clearTimeout(timeout);
    }
    spawnTimeoutsRef.current = [];

    const runId = `story-summary-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentBatchRunIdRef.current = runId;
    setIsGenerating(true);
    setStatus('running');
    setActiveOperation?.('summarizing');
    setBatchSummaryProgress({ current: 0, total: chaptersToSummarize.length });
    runtimeSummariesRef.current = new Map(summaries);
    runtimeTranslatedChaptersRef.current = new Map(translatedChapters);
    shouldStopRef.current = false;
    setShouldStop(false);
    setIsStopping(false);
    isBatchRunningRef.current = true;

    let maxImpitBrowsers = Infinity;
    if (shouldUseTokenWorker) {
      try {
        await window.electronAPI.geminiChat.releaseAllImpitBrowsers();
        const browserResult = await window.electronAPI.geminiChat.getMaxImpitBrowsers();
        if (browserResult.success && browserResult.data) {
          maxImpitBrowsers = browserResult.data;
        }
      } catch (e) {
        console.error('[useStorySummaryGeneration] Lỗi lấy số trình duyệt impit:', e);
      }
    }

    const apiWorkerCount = shouldUseApiWorker ? 1 : 0;
    let tokenWorkerCount = shouldUseTokenWorker ? Math.min(1, tokenConfigsForRun.length) : 0;

    if (tokenWorkerCount > maxImpitBrowsers) {
      console.warn(`[useStorySummaryGeneration] Impit: Giới hạn token workers xuống ${maxImpitBrowsers}`);
      tokenWorkerCount = maxImpitBrowsers;
    }

    const finalConfigsToUse = tokenConfigsForRun.slice(0, tokenWorkerCount);
    batchStateRef.current.activeWorkerConfigIds = new Set(finalConfigsToUse.map(c => c.id));

    const totalWorkers = apiWorkerCount + tokenWorkerCount;
    console.log(`[useStorySummaryGeneration] 🎯 Bắt đầu tóm tắt ${chaptersToSummarize.length} chapters với ${totalWorkers} worker tuần tự`);

    if (apiWorkerCount > 0) {
      startWorker('api', null, runId);
      return;
    }

    if (finalConfigsToUse.length > 0) {
      console.log('[useStorySummaryGeneration] 🚀 Starting token worker 1/1');
      startWorker('token', finalConfigsToUse[0], runId);
    }
  };

  return {
    isGenerating,
    handleGenerateSummary,
    handleGenerateAllSummaries,
    stopGeneration,
    batchSummaryProgress,
    isStopping
  };
}

// ... existing code ...


