import { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react';
import { Chapter, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { buildTokenKey } from '../utils/tokenUtils';
import { extractTranslatedTitle } from '../utils/chapterUtils';
import type { GeminiChatConfigLite } from '../types';

interface UseStoryBatchTranslationParams {
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  model: string;
  translateMode: 'api' | 'token' | 'both';
  retranslateExisting: boolean;
  useProxy: boolean;
  isChapterIncluded: (id: string) => boolean;
  translatedChapters: Map<string, string>;
  tokenConfigs: GeminiChatConfigLite[];
  getDistinctActiveTokenConfigs: (configs: GeminiChatConfigLite[]) => GeminiChatConfigLite[];
  getPreferredTokenConfig: () => GeminiChatConfigLite | null;
  setStatus: Dispatch<SetStateAction<string>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setTranslatedTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, 'api' | 'token'>>>;
  setTokenContexts: Dispatch<SetStateAction<Map<string, { conversationId: string; responseId: string; choiceId: string }>>>;
}

interface BatchState {
  chapters: Chapter[];
  currentIndex: number;
  completed: number;
  activeWorkerConfigIds: Set<string>;
  isFirstChapterTaken: boolean;
}

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
    translateMode,
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
  } = params;

  // Progress tracking
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [processingChapters, setProcessingChapters] = useState<
    Map<string, { startTime: number; workerId: number; channel: 'api' | 'token' }>
  >(new Map());
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
  
  // Ref to track if batch is currently running (for hot-add workers)
  const isBatchRunningRef = useRef(false);
  // Ref to latest startWorker function for use in effects
  const startWorkerRef = useRef<((channel: 'api' | 'token', tokenConfig?: GeminiChatConfigLite | null) => Promise<void>) | null>(null);

  // Update elapsed time every second
  useEffect(() => {
    if (processingChapters.size === 0) return;
    
    const interval = setInterval(() => {
      setTick(prev => prev + 1); // Force re-render to update elapsed time
    }, 1000);
    
    return () => clearInterval(interval);
  }, [processingChapters.size]);

  const handleStopTranslation = () => {
    console.log('[useStoryBatchTranslation] Dừng dịch thủ công...');
    shouldStopRef.current = true;
    setShouldStop(true);
    isBatchRunningRef.current = false;
  };

  // Helper: Get worker channel based on mode and workerId
  const getWorkerChannel = (workerId: number): 'api' | 'token' => {
    if (translateMode === 'api') return 'api';
    if (translateMode === 'token') return 'token';
    return workerId === 1 ? 'token' : 'api';
  };

  // Helper: Process a single chapter
  const processChapter = async (
    chapter: Chapter,
    index: number,
    workerId: number,
    channel: 'api' | 'token',
    tokenConfig: GeminiChatConfigLite | null
  ): Promise<{ id: string; text: string } | { retryable: boolean } | null> => {
    if (shouldStopRef.current) return null;

    // Mark as processing
    setProcessingChapters(prev => {
      const next = new Map(prev);
      next.set(chapter.id, { startTime: Date.now(), workerId, channel });
      return next;
    });

    try {
      console.log(`[useStoryBatchTranslation] 📖 Dịch chương ${index + 1}/${batchStateRef.current.chapters.length}: ${chapter.title} (Token: ${tokenConfig?.email || tokenConfig?.id || 'API'})`);

      // 1. Prepare Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_PROMPT, {
        chapterContent: chapter.content,
        sourceLang,
        targetLang,
        model
      }) as PreparePromptResult;

      if (!prepareResult.success || !prepareResult.prompt) {
        console.error(`Lỗi chuẩn bị prompt cho chương ${chapter.title}:`, prepareResult.error);
        return null;
      }

      const method = channel === 'token' ? 'IMPIT' : 'API';
      let selectedTokenConfig = method === 'IMPIT'
        ? (tokenConfig || getPreferredTokenConfig()) // Use worker's config if available, fallback to preferred
        : null;

      if (method === 'IMPIT' && !selectedTokenConfig) {
        // Double check fallback if somehow tokenConfig was null
        selectedTokenConfig = getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          console.error('[useStoryBatchTranslation] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return null;
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
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              tokenInfo: tokenConfig ? (tokenConfig.email || tokenConfig.id) : 'API',
              validationRegex: 'hết\\s+chương|end\\s+of\\s+chapter|---\\s*hết\\s*---'
          }
        }
      ) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string }; retryable?: boolean };

      if (translateResult.success && translateResult.data) {
        if (translateResult.metadata?.chapterId !== chapter.id) {
            console.error(`[useStoryBatchTranslation] ⚠️ RACE CONDITION: ${translateResult.metadata?.chapterId} !== ${chapter.id}`);
            return null;
        }

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
        setChapterMethods(prev => new Map(prev).set(chapter.id, channel));

        if (translateResult.context && tokenKey) {
            setTokenContexts(prev => new Map(prev).set(tokenKey, translateResult.context!));
        }

        return { id: chapter.id, text: translateResult.data! };
      } else {
        console.error(`[useStoryBatchTranslation] ❌ Lỗi dịch chương ${chapter.title}:`, translateResult.error);
        return { retryable: translateResult.retryable ?? false };
      }
    } catch (error) {
       console.error(`[useStoryBatchTranslation] ❌ Exception chương ${chapter.title}:`, error);
       return null;
    } finally {
       setProcessingChapters(prev => {
           const next = new Map(prev);
           next.delete(chapter.id);
           return next;
       });
    }
  };

  // Worker function - processes chapters from the queue
  const startWorker = async (channel: 'api' | 'token', tokenConfig?: GeminiChatConfigLite | null) => {
    const workerId = ++workerIdRef.current;
    console.log(`[useStoryBatchTranslation] 🚀 Worker ${workerId} started (${channel})`);

    if (channel === 'token' && tokenConfig) {
        batchStateRef.current.activeWorkerConfigIds.add(tokenConfig.id);
    }

    try {
        while (!shouldStopRef.current) {
            if (shouldStopRef.current) break;
            
            // Check availability
            if (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length) break;

            const index = batchStateRef.current.currentIndex++;
            const chapter = batchStateRef.current.chapters[index];

            if (!batchStateRef.current.isFirstChapterTaken) {
                batchStateRef.current.isFirstChapterTaken = true;
                console.log(`[useStoryBatchTranslation] 🚀 Worker ${workerId} lấy chương đầu tiên`);
            } else {
                console.log(`[useStoryBatchTranslation] 📖 Worker ${workerId} lấy chương ${index + 1}`);
            }

            let result: { id: string; text: string } | { retryable: boolean } | null = null;
            let retryCount = 0;
            const MAX_RETRIES = 3;

            while (retryCount <= MAX_RETRIES) {
                if (retryCount > 0) {
                     console.log(`[useStoryBatchTranslation] ⚠️ Worker ${workerId} Retrying chapter ${index + 1} (${retryCount}/${MAX_RETRIES})...`);
                     await new Promise(r => setTimeout(r, 2000 * retryCount));
                }
                
                result = await processChapter(chapter, index, workerId, channel, tokenConfig || null);

                if (result && 'retryable' in result && result.retryable) {
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                        console.error(`[useStoryBatchTranslation] ❌ Worker ${workerId} Failed chapter ${index + 1} after ${MAX_RETRIES} retries.`);
                        break;
                    }
                    continue; 
                }
                break;
            }

            if (result && !('retryable' in result) && result !== null) {
                 batchStateRef.current.completed++;
                 setBatchProgress({ current: batchStateRef.current.completed, total: batchStateRef.current.chapters.length });
            }
        }
    } finally {
        if (channel === 'token' && tokenConfig) {
            batchStateRef.current.activeWorkerConfigIds.delete(tokenConfig.id);
        }
        console.log(`[useStoryBatchTranslation] ✓ Worker ${workerId} finished`);
        
        // Check if all workers are done
        if (batchStateRef.current.completed >= batchStateRef.current.chapters.length || 
            (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length && 
             batchStateRef.current.activeWorkerConfigIds.size === 0)) {
          isBatchRunningRef.current = false;
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
    if (translateMode !== 'token' && translateMode !== 'both') return;
    
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
      startWorkerRef.current?.('token', config);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenConfigs, translateMode, getDistinctActiveTokenConfigs]);

  // Main batch translation function
  const handleTranslateAll = async () => {
    // 1. Get chapters to translate
    const chaptersToTranslate = chapters.filter(
      c => isChapterIncluded(c.id) && (retranslateExisting || !translatedChapters.has(c.id))
    );
    
    if (chaptersToTranslate.length === 0) {
      alert('Đã dịch xong tất cả các chương được chọn!');
      return;
    }

    // 2. Prepare Configs
    let tokenConfigsForRun: GeminiChatConfigLite[] = [];
    if (translateMode === 'token' || translateMode === 'both') {
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

    // 4. Set Status
    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    shouldStopRef.current = false;
    setShouldStop(false);
    isBatchRunningRef.current = true;

    // 5. Async Checks (Max Browsers)
    let maxImpitBrowsers = Infinity;
    if (translateMode === 'token' || translateMode === 'both') {
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

    const apiWorkerCount = translateMode === 'api' ? 5 : translateMode === 'both' ? 5 : 0;
    let tokenWorkerCount = tokenConfigsForRun.length;
    
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
      startWorker('api');
    }

    // Start Token workers with staggered delays
    const MIN_SPAWN_DELAY = 5000;  // 5s
    const MAX_SPAWN_DELAY = 20000; // 20s
    let cumulativeDelay = 0;
    
    for (let i = 0; i < finalConfigsToUse.length; i++) {
      const config = finalConfigsToUse[i];
      
      if (i === 0) {
        console.log(`[useStoryBatchTranslation] 🚀 Starting worker 1/${finalConfigsToUse.length} immediately`);
        startWorker('token', config);
      } else {
        const spawnDelay = Math.floor(Math.random() * (MAX_SPAWN_DELAY - MIN_SPAWN_DELAY + 1)) + MIN_SPAWN_DELAY;
        cumulativeDelay += spawnDelay;
        console.log(`[useStoryBatchTranslation] ⏳ Worker ${i + 1}/${finalConfigsToUse.length} will start in ${cumulativeDelay}ms from now`);
        
        setTimeout(() => {
          if (!shouldStopRef.current) {
            console.log(`[useStoryBatchTranslation] 🚀 Starting worker ${i + 1}/${finalConfigsToUse.length}`);
            startWorker('token', config);
          }
        }, cumulativeDelay);
      }
    }
  };

  return {
    batchProgress,
    processingChapters,
    handleTranslateAll,
    handleStopTranslation,
    isTranslating: batchProgress !== null,
    setProcessingChapters
  };
}
