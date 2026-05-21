import { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react';
import { Chapter, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { buildTokenKey } from '../utils/tokenUtils';
import { extractTranslatedTitle } from '../utils/chapterUtils';
import { getRandomInt } from '@shared/utils/delayUtils';
import type {
  GeminiChatConfigLite,
  ProcessingChapterInfo,
  StoryChapterMethod,
  StoryMemoryRuntimeState,
  StoryPromptSaveSettings,
  StoryStatus,
  StoryTranslationMethod
} from '../types';
import { buildStoryMemoryPayload } from '../types';
import { saveTranslationPromptArtifact } from '../utils/promptArtifact';
import { resolvePreviousAssistantOutput } from '../utils/previousAssistantOutput';
import { getInfiniteRetryDelayMs, normalizeRetryError } from '../utils/retryUtils';

interface UseStoryBatchTranslationParams {
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  model: string;
  translationMethod: StoryTranslationMethod;
  retranslateExisting: boolean;
  useProxy: boolean;
  isChapterIncluded: (id: string) => boolean;
  translatedChapters: Map<string, string>;
  summaries: Map<string, string>;
  tokenConfigs: GeminiChatConfigLite[];
  getDistinctActiveTokenConfigs: (configs: GeminiChatConfigLite[]) => GeminiChatConfigLite[];
  getPreferredTokenConfig: () => GeminiChatConfigLite | null;
  setStatus: Dispatch<SetStateAction<StoryStatus>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setTranslatedTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, StoryChapterMethod>>>;
  setTokenContexts: Dispatch<SetStateAction<Map<string, { conversationId: string; responseId: string; choiceId: string }>>>;
  projectId: string | null;
  filePath: string;
  memorySettings: StoryMemoryRuntimeState;
  forceSequential?: boolean;
  promptSaveSettings: StoryPromptSaveSettings;
}

interface BatchState {
  chapters: Chapter[];
  currentIndex: number;
  completed: number;
  activeWorkerConfigIds: Set<string>;
  isFirstChapterTaken: boolean;
}

type ChapterProcessResult =
  | { status: 'success'; id: string; text: string }
  | { status: 'retry'; error: string }
  | { status: 'stopped' };

const ENFORCE_SEQUENTIAL_CHAPTER_LOCK = true;

/**
 * Custom hook to manage batch translation of multiple chapters
 * Handles worker management, progress tracking, and concurrent translations
 */
export function useStoryBatchTranslation(params: UseStoryBatchTranslationParams) {
  const {
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
    memorySettings,
    forceSequential = false,
    promptSaveSettings
  } = params;

  // Progress tracking
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [processingChapters, setProcessingChapters] = useState<
    Map<string, ProcessingChapterInfo>
  >(new Map());
  const [, setApiWorkerCountSetting] = useState(1);
  const [apiRequestDelayMs, setApiRequestDelayMs] = useState(500);
  const [, setTick] = useState(0); // Force re-render for elapsed time
  const [isStopping, setIsStopping] = useState(false);
  
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
  const runtimeTranslatedChaptersRef = useRef<Map<string, string>>(new Map(translatedChapters));
  
  // Ref to track if batch is currently running (for hot-add workers)
  const isBatchRunningRef = useRef(false);
  const currentBatchRunIdRef = useRef<string | null>(null);
  const activeWorkerCountRef = useRef(0);
  const spawnTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Ref to latest startWorker function for use in effects
  const startWorkerRef = useRef<((channel: 'api' | 'token', tokenConfig: GeminiChatConfigLite | null, runId: string) => Promise<void>) | null>(null);

  // Update elapsed time every second
  useEffect(() => {
    if (processingChapters.size === 0) return;
    
    const interval = setInterval(() => {
      setTick(prev => prev + 1); // Force re-render to update elapsed time
    }, 1000);
    
    return () => clearInterval(interval);
  }, [processingChapters.size]);

  useEffect(() => {
    runtimeTranslatedChaptersRef.current = new Map(translatedChapters);
  }, [translatedChapters]);

  useEffect(() => {
    const loadAppSettings = async () => {
      try {
        const result = await window.electronAPI.appSettings.getAll();
        if (result.success && result.data) {
          const settingsData = result.data as unknown as Record<string, unknown>;
          const raw = Number(settingsData.apiWorkerCount);
          const normalized = Number.isFinite(raw) ? Math.min(10, Math.max(1, Math.floor(raw))) : 1;
          setApiWorkerCountSetting(normalized);
          const rawDelay = Number(settingsData.apiRequestDelayMs);
          const delayMs = Number.isFinite(rawDelay) ? Math.min(30000, Math.max(0, Math.floor(rawDelay))) : 500;
          setApiRequestDelayMs(delayMs);
        }
      } catch (error) {
        console.error('[useStoryBatchTranslation] Error loading app settings:', error);
      }
    };
    loadAppSettings();
  }, []);

  const handleStopTranslation = () => {
    console.log('[useStoryBatchTranslation] Dừng dịch thủ công...');
    shouldStopRef.current = true;
    currentBatchRunIdRef.current = null;
    setShouldStop(true);
    isBatchRunningRef.current = false;
    setIsStopping(true);
    for (const timeout of spawnTimeoutsRef.current) {
      clearTimeout(timeout);
    }
    spawnTimeoutsRef.current = [];

    // Hard-stop UI immediately. In-flight requests may still resolve, but commit paths are run-guarded.
    setBatchProgress(null);
    setStatus('idle');
    setProcessingChapters((prev) => {
      const next = new Map(prev);
      for (const [chapterId, info] of next.entries()) {
        if (info.source !== 'story_web_queue') {
          next.delete(chapterId);
        }
      }
      return next;
    });
    setIsStopping(false);
  };



  // Helper: Process a single chapter
  const processChapter = async (
    chapter: Chapter,
    index: number,
    workerId: number,
    channel: 'api' | 'token',
    tokenConfig: GeminiChatConfigLite | null,
    runId: string
  ): Promise<ChapterProcessResult> => {
    if (shouldStopRef.current || currentBatchRunIdRef.current !== runId) {
      return { status: 'stopped' };
    }

    // Mark as processing
    setProcessingChapters(prev => {
      const next = new Map(prev);
      const current = next.get(chapter.id);
      next.set(chapter.id, {
        startTime: Date.now(),
        workerId,
        channel,
        phase: 'running',
        retryCount: current?.retryCount ?? 0,
        lastError: current?.lastError
      });
      return next;
    });

    try {
      console.log(`[useStoryBatchTranslation] 📖 Dịch chương ${index + 1}/${batchStateRef.current.chapters.length}: ${chapter.title} (Token: ${tokenConfig?.email || tokenConfig?.id || 'API'})`);
      const actualChapterIndex = chapters.findIndex((entry) => entry.id === chapter.id);
      const previousAssistantOutput = actualChapterIndex >= 0
        ? resolvePreviousAssistantOutput({
            chapters,
            chapterIndex: actualChapterIndex,
            summaries,
            translatedChapters: runtimeTranslatedChaptersRef.current,
            mode: promptSaveSettings.previousAssistantOutputMode
          })
        : '';
      const memoryPayload = buildStoryMemoryPayload({
        projectId,
        filePath,
        chapter,
        chapterIndex: actualChapterIndex >= 0 ? actualChapterIndex + 1 : index + 1,
        totalChapters: chapters.length,
        previousAssistantOutput,
        previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
        settings: memorySettings
      });

      // 1. Prepare Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang,
        model,
        memory: memoryPayload
      }) as PreparePromptResult;

      if (!prepareResult.success || !prepareResult.prompt) {
        const errorMessage = prepareResult.error || `Lỗi chuẩn bị prompt cho chương ${chapter.title}`;
        console.error(errorMessage);
        return { status: 'retry', error: errorMessage };
      }

      const method = channel === 'token' ? 'IMPIT' : 'API';
      const storyMethod: StoryChapterMethod = method === 'IMPIT' ? 'token' : 'api';
      let selectedTokenConfig = method === 'IMPIT'
        ? (tokenConfig || getPreferredTokenConfig()) // Use worker's config if available, fallback to preferred
        : null;

      if (method === 'IMPIT' && !selectedTokenConfig) {
        // Double check fallback if somehow tokenConfig was null
        selectedTokenConfig = getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          const errorMessage = '[useStoryBatchTranslation] Không tìm thấy Cấu hình Web để chạy chế độ Token.';
          console.error(errorMessage);
          return { status: 'retry', error: errorMessage };
        }
      }

      const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      // 2. Send to Gemini
      const translateResult = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
        {
          prompt: prepareResult.prompt,
          model: model,
          method,
          webConfigId: method === 'IMPIT' && selectedTokenConfig ? selectedTokenConfig.id : undefined,
          useProxy: method === 'IMPIT' && useProxy,
          metadata: { 
              runId,
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              chapterIndex: actualChapterIndex >= 0 ? actualChapterIndex + 1 : index + 1,
              sourceText: chapter.content,
              tokenInfo: tokenConfig ? (tokenConfig.email || tokenConfig.id) : 'API',
              validationRegex: 'hết\\s+chương|end\\s+of\\s+chapter|---\\s*hết\\s*---'
          },
          memory: memoryPayload
        }
      ) as {
        success: boolean;
        data?: string;
        error?: string;
        context?: { conversationId: string; responseId: string; choiceId: string };
        configId?: string;
        metadata?: { chapterId?: string; runId?: string };
        retryable?: boolean;
      };

      if (promptSaveSettings.autoSaveSentPrompt) {
        await saveTranslationPromptArtifact({
          projectId,
          chapter,
          chapterIndex: actualChapterIndex >= 0 ? actualChapterIndex + 1 : index + 1,
          method: storyMethod,
          model,
          preparedPrompt: prepareResult.prompt,
          prepareResult,
          storyFilePath: filePath
        });
      }

      if (shouldStopRef.current || currentBatchRunIdRef.current !== runId) {
        return { status: 'stopped' };
      }

      if (translateResult.success && translateResult.data) {
        if (translateResult.metadata?.runId && translateResult.metadata.runId !== runId) {
            console.warn(`[useStoryBatchTranslation] ⚠️ STALE RUN: ${translateResult.metadata.runId} !== ${runId}`);
            return { status: 'stopped' };
        }

        if (translateResult.metadata?.chapterId !== chapter.id) {
            const errorMessage = `[useStoryBatchTranslation] ⚠️ RACE CONDITION: ${translateResult.metadata?.chapterId} !== ${chapter.id}`;
            console.error(errorMessage);
            return { status: 'retry', error: errorMessage };
        }

        if (shouldStopRef.current || currentBatchRunIdRef.current !== runId) {
          return { status: 'stopped' };
        }

        runtimeTranslatedChaptersRef.current.set(chapter.id, translateResult.data);

        // Update UI hooks
        setTranslatedChapters(prev => {
            const next = new Map(prev);
            next.set(chapter.id, translateResult.data!);
            return next;
        });
        setTranslatedTitles(prev => {
            const next = new Map(prev);
            next.set(chapter.id, extractTranslatedTitle(translateResult.data!, chapter.id));
            return next;
        });
        setChapterModels(prev => new Map(prev).set(chapter.id, model));
        setChapterMethods(prev => new Map(prev).set(chapter.id, storyMethod));

        if (translateResult.context && tokenKey) {
            setTokenContexts(prev => new Map(prev).set(tokenKey, translateResult.context!));
        }

        setProcessingChapters(prev => {
          const next = new Map(prev);
          next.delete(chapter.id);
          return next;
        });

        return { status: 'success', id: chapter.id, text: translateResult.data! };
      } else {
        const errorMessage = translateResult.error || `Lỗi dịch chương ${chapter.title}`;
        console.error(`[useStoryBatchTranslation] ❌ ${errorMessage}`);
        return { status: 'retry', error: errorMessage };
      }
    } catch (error) {
       const errorMessage = normalizeRetryError(error);
       console.error(`[useStoryBatchTranslation] ❌ Exception chương ${chapter.title}:`, error);
       return { status: 'retry', error: errorMessage };
    }
  };

  // Worker function - processes chapters from the queue
  const startWorker = async (channel: 'api' | 'token', tokenConfig: GeminiChatConfigLite | null, runId: string) => {
    if (currentBatchRunIdRef.current !== runId) {
      return;
    }

    const workerId = ++workerIdRef.current;
    activeWorkerCountRef.current += 1;
    console.log(`[useStoryBatchTranslation] 🚀 Worker ${workerId} started (${channel})`);

    let hasDispatched = false;

    if (channel === 'token' && tokenConfig) {
        batchStateRef.current.activeWorkerConfigIds.add(tokenConfig.id);
    }

    try {
      while (!shouldStopRef.current && currentBatchRunIdRef.current === runId) {
        if (shouldStopRef.current || currentBatchRunIdRef.current !== runId) break;
            
            // Check availability
            if (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length) break;

            const index = batchStateRef.current.currentIndex++;
            const chapter = batchStateRef.current.chapters[index];

            if (channel === 'api' && apiRequestDelayMs > 0 && hasDispatched) {
                await new Promise(resolve => setTimeout(resolve, apiRequestDelayMs));
            }
            hasDispatched = true;

            if (!batchStateRef.current.isFirstChapterTaken) {
                batchStateRef.current.isFirstChapterTaken = true;
                console.log(`[useStoryBatchTranslation] 🚀 Worker ${workerId} lấy chương đầu tiên`);
            } else {
                console.log(`[useStoryBatchTranslation] 📖 Worker ${workerId} lấy chương ${index + 1}`);
            }

            let result: ChapterProcessResult = { status: 'stopped' };
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
                      `[useStoryBatchTranslation] ⚠️ Worker ${workerId} retrying chapter ${index + 1} (${chapter.id}) attempt ${retryCount} in ${delayMs}ms`
                    );
                    await new Promise(r => setTimeout(r, delayMs));
                }

                result = await processChapter(chapter, index, workerId, channel, tokenConfig, runId);

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
                      `[useStoryBatchTranslation] ❌ Worker ${workerId} chapter ${index + 1} failed. Retry #${retryCount}. Error: ${retryError}`
                    );
                    continue;
                }
                break;
            }

            if (result.status === 'success') {
                if (shouldStopRef.current || currentBatchRunIdRef.current !== runId) {
                    break;
                 }
                 batchStateRef.current.completed++;
                 setBatchProgress({ current: batchStateRef.current.completed, total: batchStateRef.current.chapters.length });
            }
        }
    } finally {
        activeWorkerCountRef.current = Math.max(0, activeWorkerCountRef.current - 1);
        if (channel === 'token' && tokenConfig) {
            batchStateRef.current.activeWorkerConfigIds.delete(tokenConfig.id);
        }
        console.log(`[useStoryBatchTranslation] ✓ Worker ${workerId} finished`);
        
        // Check if all workers are done
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
          setIsStopping(false);
          setStatus('idle');
          setBatchProgress(null);
        }
    }
  };

  // Keep ref updated with latest startWorker function
  startWorkerRef.current = startWorker;

  // Hot-add token workers when new configs become active during batch translation
  useEffect(() => {
    if (!isBatchRunningRef.current || shouldStopRef.current) return;
    if (ENFORCE_SEQUENTIAL_CHAPTER_LOCK) return;
    if (translationMethod !== 'token') return;
    if (forceSequential) return;
    
    // Check if there are remaining chapters to translate
    if (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length) return;
    
    const distinctActive = getDistinctActiveTokenConfigs(tokenConfigs);
    const newConfigs = distinctActive.filter(
      c => !batchStateRef.current.activeWorkerConfigIds.has(c.id)
    );
    
    if (newConfigs.length === 0) return;
    
    console.log(`[useStoryBatchTranslation] 🔥 Hot-adding ${newConfigs.length} new token worker(s) during batch...`);
    
    for (const config of newConfigs) {
      console.log(`[useStoryBatchTranslation] 🚀 Hot-starting worker for ${config.email || config.id}`);
      const runId = currentBatchRunIdRef.current;
      if (!runId) {
        break;
      }
      startWorkerRef.current?.('token', config, runId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceSequential, tokenConfigs, translationMethod, getDistinctActiveTokenConfigs]);

  // Main batch translation function
  const handleTranslateAll = async (options?: { chapterIds?: string[] }) => {
    if (isBatchRunningRef.current && currentBatchRunIdRef.current) {
      alert('Batch dịch đang chạy. Vui lòng dừng batch hiện tại trước khi chạy lại.');
      return;
    }

    const chapterIdsSet = options?.chapterIds ? new Set(options.chapterIds) : null;

    const shouldUseTokenWorkers = translationMethod === 'token';
    const shouldUseApiWorkers = translationMethod === 'api' || translationMethod === 'api_gemini_webapi_queue';

    if (!shouldUseApiWorkers && !shouldUseTokenWorkers) {
      return;
    }

    // 1. Get chapters to translate
    const chaptersToTranslate = chapters.filter(
      c =>
        (!chapterIdsSet || chapterIdsSet.has(c.id)) &&
        isChapterIncluded(c.id) &&
        (retranslateExisting || !translatedChapters.has(c.id))
    );
    
    if (chaptersToTranslate.length === 0) {
      alert('Đã dịch xong tất cả các chương được chọn!');
      return;
    }

    // 2. Prepare Configs
    let tokenConfigsForRun: GeminiChatConfigLite[] = [];
     if (shouldUseTokenWorkers) {
       tokenConfigsForRun = getDistinctActiveTokenConfigs(tokenConfigs);
       if (tokenConfigsForRun.length === 0) {
          console.error('[useStoryBatchTranslation] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
       }
    }

    // 3. Initialize Batch State
    const initialWorkerIds = new Set(tokenConfigsForRun.map(c => c.id));
    
    batchStateRef.current = {
        chapters: chaptersToTranslate,
        currentIndex: 0,
        completed: 0,
        activeWorkerConfigIds: initialWorkerIds,
        isFirstChapterTaken: false
    };
    workerIdRef.current = 0;
    runtimeTranslatedChaptersRef.current = new Map(translatedChapters);
    activeWorkerCountRef.current = 0;
    for (const timeout of spawnTimeoutsRef.current) {
      clearTimeout(timeout);
    }
    spawnTimeoutsRef.current = [];

    // 4. Set Status
    const runId = `story-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentBatchRunIdRef.current = runId;
    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    shouldStopRef.current = false;
    setShouldStop(false);
    setIsStopping(false);
    isBatchRunningRef.current = true;

    // 5. Async Checks (Max Browsers)
    let maxImpitBrowsers = Infinity;
    if (shouldUseTokenWorkers) {
      try {
        await window.electronAPI.geminiChat.releaseAllImpitBrowsers();
        const browserResult = await window.electronAPI.geminiChat.getMaxImpitBrowsers();
        if (browserResult.success && browserResult.data) {
          maxImpitBrowsers = browserResult.data;
        }
      } catch (e) {
        console.error('[useStoryBatchTranslation] Lỗi lấy số trình duyệt impit:', e);
      }
    }

    const apiWorkerCount = shouldUseApiWorkers ? 1 : 0;
    let tokenWorkerCount = shouldUseTokenWorkers ? Math.min(1, tokenConfigsForRun.length) : 0;
    
    if (tokenWorkerCount > maxImpitBrowsers) {
      console.warn(`[useStoryBatchTranslation] Impit: Giới hạn token workers xuống ${maxImpitBrowsers}`);
      tokenWorkerCount = maxImpitBrowsers;
    }
    
    // Sync batchStateRef with actual count after pruning
    const finalConfigsToUse = tokenConfigsForRun.slice(0, tokenWorkerCount);
    const finalIds = new Set(finalConfigsToUse.map(c => c.id));
    batchStateRef.current.activeWorkerConfigIds = finalIds;

    const totalWorkers = apiWorkerCount + tokenWorkerCount;
    console.log(`[useStoryBatchTranslation] 🎯 Bắt đầu dịch ${chaptersToTranslate.length} chapters với ${totalWorkers} workers`);

    // Start API workers
    for (let i = 0; i < apiWorkerCount; i += 1) {
      startWorker('api', null, runId);
    }

    // Start Token workers with staggered delays
    const MIN_SPAWN_DELAY = 5000;  // 5s
    const MAX_SPAWN_DELAY = 20000; // 20s
    let cumulativeDelay = 0;
    
    for (let i = 0; i < finalConfigsToUse.length; i++) {
      const config = finalConfigsToUse[i];
      
      if (i === 0) {
        console.log(`[useStoryBatchTranslation] 🚀 Starting worker 1/${finalConfigsToUse.length} immediately`);
        startWorker('token', config, runId);
      } else {
        const spawnDelay = getRandomInt(MIN_SPAWN_DELAY, MAX_SPAWN_DELAY);
        cumulativeDelay += spawnDelay;
        console.log(`[useStoryBatchTranslation] ⏳ Worker ${i + 1}/${finalConfigsToUse.length} will start in ${cumulativeDelay}ms from now`);
        spawnTimeoutsRef.current.push(setTimeout(() => {
          if (!shouldStopRef.current && currentBatchRunIdRef.current === runId) {
            console.log(`[useStoryBatchTranslation] 🚀 Starting worker ${i + 1}/${finalConfigsToUse.length}`);
            startWorker('token', config, runId);
          }
        }, cumulativeDelay));
      }
    }
  };

  return {
    batchProgress,
    processingChapters,
    handleTranslateAll,
    handleStopTranslation,
    isStopping,
    isTranslating: batchProgress !== null,
    setProcessingChapters
  };
}
