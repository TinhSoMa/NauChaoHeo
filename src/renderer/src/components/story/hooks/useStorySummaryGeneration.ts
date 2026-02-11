import { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react';
import { Chapter, PreparePromptResult, STORY_IPC_CHANNELS } from '@shared/types';
import { GeminiChatConfigLite, TokenContext, ProcessingChapterInfo, StoryStatus } from '../types';
import { getRandomInt } from '@shared/utils/delayUtils';

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
  chapterMethods: Map<string, 'api' | 'token'>;
  tokenContexts: Map<string, TokenContext>;
  setSummaries: Dispatch<SetStateAction<Map<string, string>>>;
  setSummaryTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, 'api' | 'token'>>>;
  setTokenContexts: Dispatch<SetStateAction<Map<string, TokenContext>>>;
  setProcessingChapters: (update: (prev: Map<string, ProcessingChapterInfo>) => Map<string, ProcessingChapterInfo>) => void;
  setStatus: (status: StoryStatus) => void;
  setViewMode: (mode: 'original' | 'translated' | 'summary') => void;
  useProxy: boolean;
  loadConfigurations: () => Promise<void>;
  getPreferredTokenConfig: () => GeminiChatConfigLite | null;
  isChapterIncluded: (id: string) => boolean;
  tokenConfigs: GeminiChatConfigLite[];
  getDistinctActiveTokenConfigs: (configs: GeminiChatConfigLite[]) => GeminiChatConfigLite[];
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

export function useStorySummaryGeneration({
  chapters,
  translatedChapters,
  translatedTitles,
  sourceLang,
  targetLang,
  model,
  translateMode,
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
}: UseStorySummaryGenerationProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [batchSummaryProgress, setBatchSummaryProgress] = useState<{ current: number; total: number } | null>(null);
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
    // Check if any processing chapters exist via a simple size check
    // Note: processingChapters is managed externally, so we can't directly check it here
    // This timer will run when isGenerating is true, which is a good proxy
    if (!isGenerating) return;
    
    const interval = setInterval(() => {
      setTick(prev => prev + 1); // Force re-render to update elapsed time
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isGenerating]);

  const stopGeneration = () => {
    console.log('[useStorySummaryGeneration] Dừng tóm tắt thủ công...');
    shouldStopRef.current = true;
    setShouldStop(true);
    isBatchRunningRef.current = false;
    setIsGenerating(false);
    setStatus('idle');
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

    setIsGenerating(true);
    setStatus('running');
    
    try {
      console.log('[useStorySummaryGeneration] Đang chuẩn bị prompt tóm tắt...');
      // 1. Prepare Summary Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
        chapterContent: sourceContent,
        sourceLang,
        targetLang
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

      if (translateResult.success && translateResult.data) {
        // Validate metadata
        if (translateResult.metadata?.chapterId !== selectedChapterId) {
          console.error(`[useStorySummaryGeneration] ⚠️ RACE CONDITION DETECTED! Response chapterId (${translateResult.metadata?.chapterId}) !== selected (${selectedChapterId})`);
          throw new Error('Metadata validation failed - race condition detected');
        }
        
        // Save summary to Map cache
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
      console.log(`[useStorySummaryGeneration] 📝 Tóm tắt chương ${index + 1}/${batchStateRef.current.chapters.length}: ${chapter.title} (Token: ${tokenConfig?.email || tokenConfig?.id || 'API'})`);

      // Get translated content as source
      const sourceContent = translatedChapters.get(chapter.id);
      if (!sourceContent) {
        console.error(`[useStorySummaryGeneration] Không tìm thấy bản dịch cho chương ${chapter.title}`);
        return null;
      }

      // 1. Prepare Summary Prompt
      const prepareResult = await window.electronAPI.invoke(STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT, {
        chapterContent: sourceContent,
        sourceLang,
        targetLang
      }) as PreparePromptResult;

      if (!prepareResult.success || !prepareResult.prompt) {
        console.error(`Lỗi chuẩn bị prompt tóm tắt cho chương ${chapter.title}:`, prepareResult.error);
        return null;
      }

      const method = channel === 'token' ? 'IMPIT' : 'API';
      let selectedTokenConfig = method === 'IMPIT'
        ? (tokenConfig || getPreferredTokenConfig()) // Use worker's config if available, fallback to preferred
        : null;

      if (method === 'IMPIT' && !selectedTokenConfig) {
        selectedTokenConfig = getPreferredTokenConfig();
        if (!selectedTokenConfig) {
          console.error('[useStorySummaryGeneration] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return null;
        }
      }

      const tokenKey = method === 'IMPIT' && selectedTokenConfig ? buildTokenKey(selectedTokenConfig) : null;

      // 2. Send to Gemini for Summarization
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
      ) as { success: boolean; data?: string; error?: string; context?: { conversationId: string; responseId: string; choiceId: string }; configId?: string; metadata?: { chapterId: string }; retryable?: boolean };

      if (translateResult.success && translateResult.data) {
        if (translateResult.metadata?.chapterId !== chapter.id) {
            console.error(`[useStorySummaryGeneration] ⚠️ RACE CONDITION: ${translateResult.metadata?.chapterId} !== ${chapter.id}`);
            return null;
        }

        // Update UI hooks
        setSummaries(prev => {
            const next = new Map(prev);
            next.set(chapter.id, translateResult.data!);
            return next;
        });
        
        // Set Summary Title same as Translated Title or Chapter Title
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

        return { id: chapter.id, text: translateResult.data! };
      } else {
        console.error(`[useStorySummaryGeneration] ❌ Lỗi tóm tắt chương ${chapter.title}:`, translateResult.error);
        return { retryable: translateResult.retryable ?? false };
      }
    } catch (error) {
       console.error(`[useStorySummaryGeneration] ❌ Exception chương ${chapter.title}:`, error);
       return null;
    } finally {
       setProcessingChapters(prev => {
           const next = new Map(prev);
           next.delete(chapter.id);
           return next;
       });
    }
  };

  // Worker function - processes chapter summaries from the queue
  const startWorker = async (channel: 'api' | 'token', tokenConfig?: GeminiChatConfigLite | null) => {
    const workerId = ++workerIdRef.current;
    console.log(`[useStorySummaryGeneration] 🚀 Worker ${workerId} started (${channel})`);

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
                console.log(`[useStorySummaryGeneration] 🚀 Worker ${workerId} lấy chương đầu tiên`);
            } else {
                console.log(`[useStorySummaryGeneration] 📝 Worker ${workerId} lấy chương ${index + 1}`);
            }

            let result: { id: string; text: string } | { retryable: boolean } | null = null;
            let retryCount = 0;
            const MAX_RETRIES = 3;

            while (retryCount <= MAX_RETRIES) {
                if (retryCount > 0) {
                     console.log(`[useStorySummaryGeneration] ⚠️ Worker ${workerId} Retrying chapter ${index + 1} (${retryCount}/${MAX_RETRIES})...`);
                     await new Promise(r => setTimeout(r, 2000 * retryCount));
                }
                
                result = await processChapterSummary(chapter, index, workerId, channel, tokenConfig || null);

                if (result && 'retryable' in result && result.retryable) {
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                        console.error(`[useStorySummaryGeneration] ❌ Worker ${workerId} Failed chapter ${index + 1} after ${MAX_RETRIES} retries.`);
                        break;
                    }
                    continue; 
                }
                break;
            }

            if (result && !('retryable' in result) && result !== null) {
                 batchStateRef.current.completed++;
                 setBatchSummaryProgress({ current: batchStateRef.current.completed, total: batchStateRef.current.chapters.length });
            }
        }
    } finally {
        if (channel === 'token' && tokenConfig) {
            batchStateRef.current.activeWorkerConfigIds.delete(tokenConfig.id);
        }
        console.log(`[useStorySummaryGeneration] ✓ Worker ${workerId} finished`);
        
        // Check if all workers are done
        if (batchStateRef.current.completed >= batchStateRef.current.chapters.length || 
            (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length && 
             batchStateRef.current.activeWorkerConfigIds.size === 0)) {
          isBatchRunningRef.current = false;
          setIsGenerating(false);
          setStatus('idle');
          setBatchSummaryProgress(null);
        }
    }
  };

  // Keep ref updated with latest startWorker function
  startWorkerRef.current = startWorker;

  // Hot-add token workers when new configs become active during batch summarization
  useEffect(() => {
    if (!isBatchRunningRef.current || shouldStopRef.current) return;
    if (translateMode !== 'token' && translateMode !== 'both') return;
    
    // Check if there are remaining chapters to summarize
    if (batchStateRef.current.currentIndex >= batchStateRef.current.chapters.length) return;
    
    const distinctActive = getDistinctActiveTokenConfigs(tokenConfigs);
    const newConfigs = distinctActive.filter(
      c => !batchStateRef.current.activeWorkerConfigIds.has(c.id)
    );
    
    if (newConfigs.length === 0) return;
    
    console.log(`[useStorySummaryGeneration] 🔥 Hot-adding ${newConfigs.length} new token worker(s) during batch...`);
    
    for (const config of newConfigs) {
      console.log(`[useStorySummaryGeneration] 🚀 Hot-starting worker for ${config.email || config.id}`);
      startWorkerRef.current?.('token', config);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenConfigs, translateMode, getDistinctActiveTokenConfigs]);

  const handleGenerateAllSummaries = async () => {
    // 1. Get chapters to summarize - chapters that have translation but no summary
    const chaptersToSummarize = chapters.filter(c => 
      translatedChapters.has(c.id) && !summaries.has(c.id) && isChapterIncluded(c.id)
    );

    if (chaptersToSummarize.length === 0) {
      alert('Không có chương nào cần tóm tắt (đã tóm tắt hết hoặc chưa có bản dịch).');
      return;
    }

    // 2. Prepare Configs
    let tokenConfigsForRun: GeminiChatConfigLite[] = [];
    if (translateMode === 'token' || translateMode === 'both') {
       tokenConfigsForRun = getDistinctActiveTokenConfigs(tokenConfigs);
       if (tokenConfigsForRun.length === 0) {
          console.error('[useStorySummaryGeneration] Không tìm thấy Cấu hình Web để chạy chế độ Token.');
          return;
       }
    }

    // 3. Initialize Batch State
    const initialWorkerIds = new Set(tokenConfigsForRun.map(c => c.id));
    
    batchStateRef.current = {
        chapters: chaptersToSummarize,
        currentIndex: 0,
        completed: 0,
        activeWorkerConfigIds: initialWorkerIds,
        isFirstChapterTaken: false
    };
    workerIdRef.current = 0;

    // 4. Set Status
    setIsGenerating(true);
    setStatus('running');
    setBatchSummaryProgress({ current: 0, total: chaptersToSummarize.length });
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
        console.error('[useStorySummaryGeneration] Lỗi lấy số trình duyệt impit:', e);
      }
    }

    const apiWorkerCount = translateMode === 'api' ? 5 : translateMode === 'both' ? 5 : 0;
    let tokenWorkerCount = tokenConfigsForRun.length;
    
    if (tokenWorkerCount > maxImpitBrowsers) {
      console.warn(`[useStorySummaryGeneration] Impit: Giới hạn token workers xuống ${maxImpitBrowsers}`);
      tokenWorkerCount = maxImpitBrowsers;
    }
    
    // Sync batchStateRef with actual count after pruning
    const finalConfigsToUse = tokenConfigsForRun.slice(0, tokenWorkerCount);
    const finalIds = new Set(finalConfigsToUse.map(c => c.id));
    batchStateRef.current.activeWorkerConfigIds = finalIds;

    const totalWorkers = apiWorkerCount + tokenWorkerCount;
    console.log(`[useStorySummaryGeneration] 🎯 Bắt đầu tóm tắt ${chaptersToSummarize.length} chapters với ${totalWorkers} workers`);

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
        console.log(`[useStorySummaryGeneration] 🚀 Starting worker 1/${finalConfigsToUse.length} immediately`);
        startWorker('token', config);
      } else {
        const spawnDelay = getRandomInt(MIN_SPAWN_DELAY, MAX_SPAWN_DELAY);
        cumulativeDelay += spawnDelay;
        console.log(`[useStorySummaryGeneration] ⏳ Worker ${i + 1}/${finalConfigsToUse.length} will start in ${cumulativeDelay}ms from now`);
        
        setTimeout(() => {
          if (!shouldStopRef.current) {
            console.log(`[useStorySummaryGeneration] 🚀 Starting worker ${i + 1}/${finalConfigsToUse.length}`);
            startWorker('token', config);
          }
        }, cumulativeDelay);
      }
    }
  };

  return {
    isGenerating,
    handleGenerateSummary,
    handleGenerateAllSummaries,
    stopGeneration,
    batchSummaryProgress
  };
}

// ... existing code ...


