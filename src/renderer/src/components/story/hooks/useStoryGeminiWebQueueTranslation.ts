import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import {
  Chapter,
  StoryCancelGeminiWebQueueBatchResult,
  PreparePromptResult,
  StoryGeminiWebQueueCapacity,
  StoryGeminiWebQueueSnapshot,
  StoryGeminiWebQueueStreamEvent,
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

const AUTO_WORKERS_MAX = 8;

function clampWorkers(value: number): number {
  return Math.max(1, Math.min(AUTO_WORKERS_MAX, Math.round(value)));
}

function applyStoryQueueEventToProcessingMap(
  prev: Map<string, ProcessingChapterInfo>,
  event: StoryGeminiWebQueueStreamEvent
): Map<string, ProcessingChapterInfo> {
  if (!event.chapterId) {
    return prev;
  }

  const next = new Map(prev);
  const current = next.get(event.chapterId);

  if (event.state === 'succeeded' || event.state === 'failed' || event.state === 'cancelled') {
    if (current?.source === 'story_web_queue') {
      next.delete(event.chapterId);
    }
    return next;
  }

  const phase = event.state === 'running' ? 'running' : 'queued';
  const queuedAt = event.queuedAt ?? current?.queuedAt ?? event.timestamp;
  const startedAt = event.startedAt ?? current?.startTime ?? queuedAt;
  next.set(event.chapterId, {
    startTime: phase === 'running' ? startedAt : queuedAt,
    queuedAt,
    workerId: event.workerId ?? current?.workerId ?? 1,
    channel: 'token',
    source: 'story_web_queue',
    phase,
    resourceId: event.resourceId ?? current?.resourceId ?? null,
    resourceLabel: event.resourceLabel ?? current?.resourceLabel ?? null,
    retryCount: current?.retryCount,
    maxRetries: current?.maxRetries
  });
  return next;
}

function applyStoryQueueSnapshotToProcessingMap(
  prev: Map<string, ProcessingChapterInfo>,
  snapshot: StoryGeminiWebQueueSnapshot
): Map<string, ProcessingChapterInfo> {
  const next = new Map(prev);

  for (const [chapterId, info] of next.entries()) {
    if (info.source === 'story_web_queue') {
      next.delete(chapterId);
    }
  }

  for (const job of snapshot.jobs) {
    if (!job.chapterId) {
      continue;
    }
    next.set(job.chapterId, {
      startTime: job.state === 'running'
        ? (job.startedAt ?? job.queuedAt ?? snapshot.timestamp)
        : (job.queuedAt ?? snapshot.timestamp),
      queuedAt: job.queuedAt ?? snapshot.timestamp,
      workerId: job.workerId ?? 1,
      channel: 'token',
      source: 'story_web_queue',
      phase: job.state === 'running' ? 'running' : 'queued',
      resourceId: job.resourceId ?? null,
      resourceLabel: job.resourceLabel ?? null
    });
  }

  return next;
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
  const [isStopping, setIsStopping] = useState(false);
  const [resolvedWorkerCount, setResolvedWorkerCount] = useState<number | null>(null);
  const currentBatchIdRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

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

  const handleStopTranslation = async () => {
    shouldStopRef.current = true;
    currentRunIdRef.current = null;
    setIsStopping(true);
    const batchId = currentBatchIdRef.current;
    if (!batchId) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.CANCEL_GEMINI_WEB_QUEUE_BATCH,
        { batchId }
      ) as StoryCancelGeminiWebQueueBatchResult;
      if (!result.success) {
        console.warn('[StoryGeminiWebQueue] Cancel batch failed:', result.error);
      }
    } catch (error) {
      console.warn('[StoryGeminiWebQueue] Cancel batch failed:', error);
    }
  };

  useEffect(() => {
    const unsubEvent = window.electronAPI.onMessage(
      STORY_IPC_CHANNELS.GEMINI_WEB_QUEUE_STREAM_EVENT,
      (payload: unknown) => {
        const event = payload as StoryGeminiWebQueueStreamEvent;
        setProcessingChapters((prev) => applyStoryQueueEventToProcessingMap(prev, event));
      }
    );
    const unsubSnapshot = window.electronAPI.onMessage(
      STORY_IPC_CHANNELS.GEMINI_WEB_QUEUE_STREAM_SNAPSHOT,
      (payload: unknown) => {
        const snapshot = payload as StoryGeminiWebQueueSnapshot;
        setProcessingChapters((prev) => applyStoryQueueSnapshotToProcessingMap(prev, snapshot));
      }
    );

    void window.electronAPI.invoke(STORY_IPC_CHANNELS.START_GEMINI_WEB_QUEUE_STREAM);
    void window.electronAPI.invoke(STORY_IPC_CHANNELS.GET_GEMINI_WEB_QUEUE_SNAPSHOT).then((result) => {
      const snapshotResult = result as { success?: boolean; data?: StoryGeminiWebQueueSnapshot };
      if (snapshotResult?.success && snapshotResult.data) {
        setProcessingChapters((prev) => applyStoryQueueSnapshotToProcessingMap(prev, snapshotResult.data!));
      }
    });

    return () => {
      unsubEvent();
      unsubSnapshot();
      void window.electronAPI.invoke(STORY_IPC_CHANNELS.STOP_GEMINI_WEB_QUEUE_STREAM);
    };
  }, [setProcessingChapters]);

  const resolveAutoWorkerCount = async (): Promise<number> => {
    try {
      const capacityResult = await window.electronAPI.invoke(
        STORY_IPC_CHANNELS.GET_GEMINI_WEB_QUEUE_CAPACITY
      ) as { success?: boolean; data?: StoryGeminiWebQueueCapacity; error?: string };

      if (capacityResult?.success && capacityResult.data) {
        const workerCount = Math.max(1, capacityResult.data.workerCount || capacityResult.data.resourceCount || 1);
        console.log('[StoryGeminiWebQueue][Capacity]', capacityResult.data);
        return clampWorkers(workerCount);
      }
      return 1;
    } catch (error) {
      console.warn('[StoryGeminiWebQueue] Resolve auto workers failed:', error);
      return 1;
    }
  };

  const processChapter = async (
    chapter: Chapter,
    workerId: number,
    options?: {
      conversationKey?: string;
      resetConversation?: boolean;
      batchId?: string;
      runId?: string;
    }
  ): Promise<void> => {
    const expectedChapterId = chapter.id;
    const runId = options?.runId;
    if (!runId || currentRunIdRef.current !== runId || shouldStopRef.current) {
      return;
    }

    const queuedAt = Date.now();
    setProcessingChapters((prev) => {
      const next = new Map(prev);
      next.set(expectedChapterId, {
        startTime: queuedAt,
        workerId,
        channel: 'token',
        source: 'story_web_queue',
        phase: 'queued',
        queuedAt,
        resourceId: null,
        resourceLabel: null
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
        console.error(`[StoryGeminiWebQueue] Prepare prompt failed for chapter ${expectedChapterId}:`, prepareResult.error);
        return;
      }

      if (shouldStopRef.current || currentRunIdRef.current !== runId) {
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
            runId,
            chapterId: expectedChapterId,
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
          chapterId: expectedChapterId,
          resourceId: translateResult.resourceId,
          ...pacingDebug
        });
      }

      if (translateResult.success && translateResult.data) {
        if (shouldStopRef.current || currentRunIdRef.current !== runId) {
          console.warn('[StoryGeminiWebQueue] Drop stale success after stop/run change', {
            expectedChapterId,
            runId,
            activeRunId: currentRunIdRef.current
          });
          return;
        }

        const responseRunId = translateResult.metadata?.runId;
        if (responseRunId && responseRunId !== runId) {
          console.warn('[StoryGeminiWebQueue] Drop stale response due to runId mismatch', {
            expectedChapterId,
            runId,
            responseRunId
          });
          return;
        }

        const responseChapterId = translateResult.metadata?.chapterId;
        if (responseChapterId && responseChapterId !== expectedChapterId) {
          console.error('[StoryGeminiWebQueue] Drop mismatched response chapter', {
            expectedChapterId,
            responseChapterId,
            runId
          });
          return;
        }

        setTranslatedChapters((prev) => {
          const next = new Map(prev);
          next.set(expectedChapterId, translateResult.data!);
          return next;
        });
        setTranslatedTitles((prev) => {
          const next = new Map(prev);
          next.set(expectedChapterId, extractTranslatedTitle(translateResult.data!, expectedChapterId));
          return next;
        });
        setChapterModels((prev) => new Map(prev).set(expectedChapterId, model));
        setChapterMethods((prev) => new Map(prev).set(expectedChapterId, 'token'));
      } else {
        console.error(
          `[StoryGeminiWebQueue] Translate failed for chapter ${expectedChapterId}:`,
          translateResult.errorCode,
          translateResult.error
        );
        if (shouldStopRef.current && translateResult.errorCode === 'CANCELLED_BY_USER') {
          return;
        }
      }
    } catch (error) {
      console.error(`[StoryGeminiWebQueue] Unexpected error at chapter ${expectedChapterId}:`, error);
    } finally {
      setProcessingChapters((prev) => {
        const next = new Map(prev);
        const current = next.get(expectedChapterId);
        if (
          current?.source === 'story_web_queue'
          && current.workerId === workerId
          && current.queuedAt === queuedAt
        ) {
          next.delete(expectedChapterId);
        }
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
    const runId = `story-webqueue-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentRunIdRef.current = runId;
    setIsTranslating(true);
    setIsStopping(false);
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
        currentBatchIdRef.current = batchId;
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
              runId,
              batchId,
              conversationKey: `${batchId}-${chapter.id}`,
              resetConversation: true
            });
            if (shouldStopRef.current) {
              break;
            }
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
        currentBatchIdRef.current = batchConversationKey;
        let isFirstTurn = true;
        for (const chapter of chaptersToTranslate) {
          if (shouldStopRef.current) {
            break;
          }
          await processChapter(chapter, 1, {
            runId,
            conversationKey: batchConversationKey,
            resetConversation: isFirstTurn,
            batchId: batchConversationKey
          });
          if (shouldStopRef.current) {
            break;
          }
          isFirstTurn = false;
          processed += 1;
          setBatchProgress({
            current: processed,
            total: chaptersToTranslate.length
          });
        }
      }
    } finally {
      if (currentRunIdRef.current === runId || currentRunIdRef.current === null) {
        currentRunIdRef.current = null;
        setIsTranslating(false);
        setIsStopping(false);
        setStatus('idle');
        setBatchProgress(null);
        setResolvedWorkerCount(null);
        currentBatchIdRef.current = null;
      }
    }
  };

  return {
    isTranslating,
    isStopping,
    batchProgress,
    resolvedWorkerCount,
    handleTranslateAll,
    handleStopTranslation,
    eligibleChapterCount: getEligibleChapters().length
  };
}
