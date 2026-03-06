import { Dispatch, SetStateAction, useRef, useState } from 'react';
import {
  Chapter,
  PreparePromptResult,
  STORY_IPC_CHANNELS,
  StoryTranslateGeminiWebQueueResult
} from '@shared/types';
import { extractTranslatedTitle } from '../utils/chapterUtils';
import type { ProcessingChapterInfo, StoryStatus } from '../types';

export type StoryWebQueueMode = 'sequential' | 'multi_auto';

interface UseStoryGeminiWebQueueTranslationParams {
  chapters: Chapter[];
  sourceLang: string;
  targetLang: string;
  model: string;
  webQueueMode: StoryWebQueueMode;
  retranslateExisting: boolean;
  isChapterIncluded: (id: string) => boolean;
  translatedChapters: Map<string, string>;
  setStatus: Dispatch<SetStateAction<StoryStatus>>;
  setProcessingChapters: Dispatch<SetStateAction<Map<string, ProcessingChapterInfo>>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setTranslatedTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, 'api' | 'token'>>>;
}

const STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY = 'story.translation.geminiWeb';
const STORY_GEMINI_WEB_QUEUE_POOL_ID = 'story-geminiweb-accounts';
const STORY_GEMINI_WEB_QUEUE_SERVICE_ID = 'story-translator-ui';
const AUTO_WORKERS_FALLBACK = 3;
const AUTO_WORKERS_MAX = 8;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clampWorkers(value: number): number {
  return Math.max(1, Math.min(AUTO_WORKERS_MAX, Math.round(value)));
}

function toQueuePacingDebug(metadata: StoryTranslateGeminiWebQueueResult['metadata']) {
  if (!metadata) return null;
  const mode = typeof metadata.queuePacingMode === 'string' ? metadata.queuePacingMode : '';
  if (!mode) return null;
  const gapMs = typeof metadata.queueGapMs === 'number' && Number.isFinite(metadata.queueGapMs)
    ? metadata.queueGapMs
    : null;
  const startedAt = typeof metadata.startedAt === 'number' && Number.isFinite(metadata.startedAt)
    ? metadata.startedAt
    : null;
  const endedAt = typeof metadata.endedAt === 'number' && Number.isFinite(metadata.endedAt)
    ? metadata.endedAt
    : null;
  const nextAllowedAt = typeof metadata.nextAllowedAt === 'number' && Number.isFinite(metadata.nextAllowedAt)
    ? metadata.nextAllowedAt
    : null;
  return { mode, gapMs, startedAt, endedAt, nextAllowedAt };
}

export function useStoryGeminiWebQueueTranslation(
  params: UseStoryGeminiWebQueueTranslationParams
) {
  const {
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
  } = params;

  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const shouldStopRef = useRef(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [resolvedWorkerCount, setResolvedWorkerCount] = useState<number | null>(null);

  const getEligibleChapters = (): Chapter[] => {
    return chapters.filter((chapter) => {
      if (!isChapterIncluded(chapter.id)) {
        return false;
      }
      if (!retranslateExisting && translatedChapters.has(chapter.id)) {
        return false;
      }
      return true;
    });
  };

  const handleStopTranslation = () => {
    shouldStopRef.current = true;
  };

  const resolveAutoWorkerCount = async (): Promise<number> => {
    try {
      const snapshotResult = await window.electronAPI.rotationQueue.getSnapshot(
        undefined,
        STORY_GEMINI_WEB_QUEUE_RUNTIME_KEY
      );
      if (!snapshotResult.success || !snapshotResult.data) {
        return AUTO_WORKERS_FALLBACK;
      }

      const scheduler = asRecord(snapshotResult.data.scheduler);
      const resources = asArray(scheduler.resources).map((item) => asRecord(item));
      let capacity = 0;

      for (const resource of resources) {
        const poolId = asString(resource.poolId);
        if (poolId !== STORY_GEMINI_WEB_QUEUE_POOL_ID) {
          continue;
        }
        const state = asString(resource.state).toLowerCase();
        if (state !== 'ready' && state !== 'busy') {
          continue;
        }
        const assignedServiceId = asString(resource.assignedServiceId);
        if (
          assignedServiceId &&
          assignedServiceId !== '-' &&
          assignedServiceId !== STORY_GEMINI_WEB_QUEUE_SERVICE_ID
        ) {
          continue;
        }
        const maxConcurrency = Math.max(1, asNumber(resource.maxConcurrency, 1));
        const inFlight = Math.max(0, asNumber(resource.inFlight, 0));
        capacity += Math.max(0, maxConcurrency - inFlight);
      }

      if (capacity > 0) {
        return clampWorkers(capacity);
      }

      const byPool = asRecord(scheduler.resourceStateCountsByPool);
      const poolState = asRecord(byPool[STORY_GEMINI_WEB_QUEUE_POOL_ID]);
      const ready = asNumber(poolState.ready, 0);
      const busy = asNumber(poolState.busy, 0);
      const fallbackFromState = ready + busy;
      if (fallbackFromState > 0) {
        return clampWorkers(fallbackFromState);
      }

      return AUTO_WORKERS_FALLBACK;
    } catch (error) {
      console.warn('[StoryGeminiWebQueue] Resolve auto workers failed:', error);
      return AUTO_WORKERS_FALLBACK;
    }
  };

  const processChapter = async (
    chapter: Chapter,
    workerId: number,
    options?: {
      conversationKey?: string;
      resetConversation?: boolean;
      batchId?: string;
    }
  ): Promise<void> => {
    setProcessingChapters((prev) => {
      const next = new Map(prev);
      next.set(chapter.id, {
        startTime: Date.now(),
        workerId,
        channel: 'token'
      });
      return next;
    });

    try {
      const prepareResult = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.PREPARE_PROMPT,
        {
          chapterContent: chapter.content,
          sourceLang,
          targetLang,
          model
        }
      ) as PreparePromptResult;

      if (!prepareResult.success || !prepareResult.prompt) {
        console.error(`[StoryGeminiWebQueue] Prepare prompt failed for chapter ${chapter.id}:`, prepareResult.error);
        return;
      }

      const translateResult = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.TRANSLATE_CHAPTER_GEMINI_WEB_QUEUE,
        {
          prompt: prepareResult.prompt,
          model,
          timeoutMs: 120000,
          conversationKey: options?.conversationKey,
          resetConversation: options?.resetConversation ?? true,
          metadata: {
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            batchId: options?.batchId,
            workerId,
            mode: webQueueMode
          }
        }
      ) as StoryTranslateGeminiWebQueueResult;
      const pacingDebug = toQueuePacingDebug(translateResult.metadata);
      if (pacingDebug) {
        console.log('[StoryGeminiWebQueue][Pacing]', {
          chapterId: chapter.id,
          resourceId: translateResult.resourceId,
          ...pacingDebug
        });
      }

      if (translateResult.success && translateResult.data) {
        setTranslatedChapters((prev) => {
          const next = new Map(prev);
          next.set(chapter.id, translateResult.data!);
          return next;
        });
        setTranslatedTitles((prev) => {
          const next = new Map(prev);
          next.set(chapter.id, extractTranslatedTitle(translateResult.data!, chapter.id));
          return next;
        });
        setChapterModels((prev) => new Map(prev).set(chapter.id, model));
        setChapterMethods((prev) => new Map(prev).set(chapter.id, 'token'));
      } else {
        console.error(
          `[StoryGeminiWebQueue] Translate failed for chapter ${chapter.id}:`,
          translateResult.errorCode,
          translateResult.error
        );
      }
    } catch (error) {
      console.error(`[StoryGeminiWebQueue] Unexpected error at chapter ${chapter.id}:`, error);
    } finally {
      setProcessingChapters((prev) => {
        const next = new Map(prev);
        next.delete(chapter.id);
        return next;
      });
    }
  };

  const handleTranslateAll = async () => {
    const chaptersToTranslate = getEligibleChapters();
    if (chaptersToTranslate.length === 0) {
      alert('Không có chương hợp lệ để dịch Web Queue.');
      return;
    }

    shouldStopRef.current = false;
    setIsTranslating(true);
    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    const resolvedWorkers =
      webQueueMode === 'multi_auto'
        ? await resolveAutoWorkerCount()
        : 1;
    setResolvedWorkerCount(resolvedWorkers);

    let processed = 0;

    try {
      if (webQueueMode === 'multi_auto') {
        const batchId = `story-webqueue-${Date.now()}`;
        let currentIndex = 0;
        const runWorker = async (workerId: number) => {
          while (!shouldStopRef.current) {
            const chapterIndex = currentIndex;
            currentIndex += 1;
            if (chapterIndex >= chaptersToTranslate.length) {
              break;
            }
            const chapter = chaptersToTranslate[chapterIndex];
            await processChapter(chapter, workerId, {
              batchId,
              conversationKey: `${batchId}-${chapter.id}`,
              resetConversation: true
            });
            processed += 1;
            setBatchProgress({
              current: processed,
              total: chaptersToTranslate.length
            });
          }
        };

        const workers = Array.from({ length: resolvedWorkers }, (_, index) => runWorker(index + 1));
        await Promise.all(workers);
      } else {
        const batchConversationKey = `story-webqueue-${Date.now()}`;
        let isFirstTurn = true;
        for (const chapter of chaptersToTranslate) {
          if (shouldStopRef.current) {
            break;
          }
          await processChapter(chapter, 1, {
            conversationKey: batchConversationKey,
            resetConversation: isFirstTurn
          });
          isFirstTurn = false;
          processed += 1;
          setBatchProgress({
            current: processed,
            total: chaptersToTranslate.length
          });
        }
      }
    } finally {
      setIsTranslating(false);
      setStatus('idle');
      setBatchProgress(null);
      setResolvedWorkerCount(null);
    }
  };

  return {
    isTranslating,
    batchProgress,
    resolvedWorkerCount,
    handleTranslateAll,
    handleStopTranslation,
    eligibleChapterCount: getEligibleChapters().length
  };
}
