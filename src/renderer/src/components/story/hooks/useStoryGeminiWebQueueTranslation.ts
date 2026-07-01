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
import type { ProcessingChapterInfo, StoryChapterMethod, StoryMemoryRuntimeState, StoryPromptSaveSettings, StoryStatus } from '../types';
import { buildStoryMemoryPayload } from '../types';
import { saveTranslationPromptArtifact } from '../utils/promptArtifact';
import { resolvePreviousAssistantOutputDebug } from '../utils/previousAssistantOutput';
import { getInfiniteRetryDelayMs, normalizeRetryError } from '../utils/retryUtils';

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
  summaries: Map<string, string>;
  setStatus: Dispatch<SetStateAction<StoryStatus>>;
  setProcessingChapters: Dispatch<SetStateAction<Map<string, ProcessingChapterInfo>>>;
  setTranslatedChapters: Dispatch<SetStateAction<Map<string, string>>>;
  setTranslatedTitles: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterModels: Dispatch<SetStateAction<Map<string, string>>>;
  setChapterMethods: Dispatch<SetStateAction<Map<string, StoryChapterMethod>>>;
  projectId: string | null;
  filePath: string;
  memorySettings: StoryMemoryRuntimeState;
  forceSequential?: boolean;
  promptSaveSettings: StoryPromptSaveSettings;
}

const AUTO_WORKERS_MAX = 8;
const ENFORCE_SEQUENTIAL_CHAPTER_LOCK = true;

type QueueChapterProcessResult =
  | { status: 'success' }
  | { status: 'retry'; error: string }
  | { status: 'stopped' };

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

  if (event.state === 'succeeded' || event.state === 'cancelled') {
    if (current?.source === 'story_web_queue') {
      next.delete(event.chapterId);
    }
    return next;
  }

  if (event.state === 'failed') {
    if (current?.source === 'story_web_queue') {
      next.set(event.chapterId, {
        ...current,
        phase: 'retry_wait'
      });
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
    if (info.source === 'story_web_queue' && info.phase !== 'retry_wait') {
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
    summaries,
    setStatus,
    setProcessingChapters,
    setTranslatedChapters,
    setTranslatedTitles,
    setChapterModels,
    setChapterMethods,
    projectId,
    filePath,
    memorySettings,
    forceSequential = false,
    promptSaveSettings
  } = params;

  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const shouldStopRef = useRef(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [resolvedWorkerCount, setResolvedWorkerCount] = useState<number | null>(null);
  const currentBatchIdRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const runtimeTranslatedChaptersRef = useRef<Map<string, string>>(new Map(translatedChapters));

  useEffect(() => {
    runtimeTranslatedChaptersRef.current = new Map(translatedChapters);
  }, [translatedChapters]);

  const isActiveBatch = (batchId?: string): boolean => {
    const activeBatchId = currentBatchIdRef.current;
    return Boolean(activeBatchId && batchId && batchId === activeBatchId);
  };

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
    const batchId = currentBatchIdRef.current;
    setIsStopping(true);

    // Hard-stop UI immediately. Late responses/events are ignored by run/batch guards.
    currentBatchIdRef.current = null;
    setIsTranslating(false);
    setBatchProgress(null);
    setResolvedWorkerCount(null);
    setStatus('idle');
    setProcessingChapters((prev) => {
      const next = new Map(prev);
      for (const [chapterId, info] of next.entries()) {
        if (info.source === 'story_web_queue') {
          next.delete(chapterId);
        }
      }
      return next;
    });

    if (!batchId) {
      setIsStopping(false);
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
    } finally {
      setIsStopping(false);
    }
  };

  useEffect(() => {
    const unsubEvent = window.electronAPI.onMessage(
      STORY_IPC_CHANNELS.GEMINI_WEB_QUEUE_STREAM_EVENT,
      (payload: unknown) => {
        const event = payload as StoryGeminiWebQueueStreamEvent;
        if (!isActiveBatch(event.batchId)) {
          return;
        }
        setProcessingChapters((prev) => applyStoryQueueEventToProcessingMap(prev, event));
      }
    );
    const unsubSnapshot = window.electronAPI.onMessage(
      STORY_IPC_CHANNELS.GEMINI_WEB_QUEUE_STREAM_SNAPSHOT,
      (payload: unknown) => {
        const snapshot = payload as StoryGeminiWebQueueSnapshot;
        const activeBatchId = currentBatchIdRef.current;
        if (!activeBatchId) {
          return;
        }
        const filteredSnapshot: StoryGeminiWebQueueSnapshot = {
          ...snapshot,
          jobs: snapshot.jobs.filter((job: any) => job.batchId === activeBatchId)
        };
        setProcessingChapters((prev) => applyStoryQueueSnapshotToProcessingMap(prev, filteredSnapshot));
      }
    );

    void window.electronAPI.invoke(STORY_IPC_CHANNELS.START_GEMINI_WEB_QUEUE_STREAM);
    void window.electronAPI.invoke(STORY_IPC_CHANNELS.GET_GEMINI_WEB_QUEUE_SNAPSHOT).then((result) => {
      const snapshotResult = result as { success?: boolean; data?: StoryGeminiWebQueueSnapshot };
      const activeBatchId = currentBatchIdRef.current;
      if (snapshotResult?.success && snapshotResult.data && activeBatchId) {
        const filteredSnapshot: StoryGeminiWebQueueSnapshot = {
          ...snapshotResult.data,
          jobs: snapshotResult.data.jobs.filter((job: any) => job.batchId === activeBatchId)
        };
        setProcessingChapters((prev) => applyStoryQueueSnapshotToProcessingMap(prev, filteredSnapshot));
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
      retryCount?: number;
    }
  ): Promise<QueueChapterProcessResult> => {
    const expectedChapterId = chapter.id;
    const chapterIndex = chapters.findIndex((entry) => entry.id === chapter.id) + 1;
    const previousAssistantOutputResult = resolvePreviousAssistantOutputDebug({
      chapters,
      chapterIndex: chapterIndex - 1,
      summaries,
      translatedChapters: runtimeTranslatedChaptersRef.current,
      mode: promptSaveSettings.previousAssistantOutputMode,
      chapterCount: promptSaveSettings.previousAssistantOutputChapterCount
    });
    const previousAssistantOutput = previousAssistantOutputResult.content;
    const memoryPayload = buildStoryMemoryPayload({
      projectId,
      filePath,
      chapter,
      chapterIndex,
      totalChapters: chapters.length,
      previousAssistantOutput,
      previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
      previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
      settings: memorySettings
    });
    const runId = options?.runId;
    if (!runId || currentRunIdRef.current !== runId || shouldStopRef.current) {
      return { status: 'stopped' };
    }

    const queuedAt = Date.now();
    setProcessingChapters((prev) => {
      const next = new Map(prev);
      next.set(expectedChapterId, {
        startTime: queuedAt,
        workerId,
        channel: 'token',
        source: 'story_web_queue',
        phase: 'running',
        queuedAt,
        retryCount: options?.retryCount ?? 0,
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
          model,
          memory: memoryPayload
        }
      ) as PreparePromptResult;

      if (!prepareResult.success || !prepareResult.prompt) {
        const errorMessage = prepareResult.error || `Prepare prompt failed for chapter ${expectedChapterId}`;
        console.error(`[StoryGeminiWebQueue] ${errorMessage}`);
        return { status: 'retry', error: errorMessage };
      }

      if (shouldStopRef.current || currentRunIdRef.current !== runId) {
        return { status: 'stopped' };
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
            chapterIndex,
            sourceText: chapter.content,
            batchId: options?.batchId,
            workerId,
            mode: webQueueMode
          },
          memory: memoryPayload
        }
      ) as StoryTranslateGeminiWebQueueResult;

      if (promptSaveSettings.autoSaveSentPrompt) {
        await saveTranslationPromptArtifact({
          projectId,
          chapter,
          chapterIndex,
          method: 'gemini_webapi_queue',
          model,
          preparedPrompt: prepareResult.prompt,
          prepareResult,
          storyFilePath: filePath,
          previousAssistantOutputDebug: previousAssistantOutputResult.debug,
          previousAssistantOutputMode: promptSaveSettings.previousAssistantOutputMode,
          previousAssistantOutputChapterCount: promptSaveSettings.previousAssistantOutputChapterCount,
          previousAssistantOutputSourceContent: previousAssistantOutputResult.content
        });
      }
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
          return { status: 'stopped' };
        }

        const responseRunId = translateResult.metadata?.runId;
        if (responseRunId && responseRunId !== runId) {
          console.warn('[StoryGeminiWebQueue] Drop stale response due to runId mismatch', {
            expectedChapterId,
            runId,
            responseRunId
          });
          return { status: 'stopped' };
        }

        const responseChapterId = translateResult.metadata?.chapterId;
        if (responseChapterId && responseChapterId !== expectedChapterId) {
          const errorMessage = `[StoryGeminiWebQueue] Drop mismatched response chapter ${responseChapterId} !== ${expectedChapterId}`;
          console.error(errorMessage, {
            expectedChapterId,
            responseChapterId,
            runId
          });
          return { status: 'retry', error: errorMessage };
        }

        runtimeTranslatedChaptersRef.current.set(expectedChapterId, translateResult.data!);

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
        setChapterMethods((prev) => new Map(prev).set(expectedChapterId, 'gemini_webapi_queue'));
        setProcessingChapters((prev) => {
          const next = new Map(prev);
          next.delete(expectedChapterId);
          return next;
        });
        return { status: 'success' };
      } else {
        const errorMessage = translateResult.error || translateResult.errorCode || `Translate failed for chapter ${expectedChapterId}`;
        console.error(
          `[StoryGeminiWebQueue] Translate failed for chapter ${expectedChapterId}:`,
          translateResult.errorCode,
          translateResult.error
        );
        if (shouldStopRef.current && translateResult.errorCode === 'CANCELLED_BY_USER') {
          return { status: 'stopped' };
        }
        return { status: 'retry', error: errorMessage };
      }
    } catch (error) {
      console.error(`[StoryGeminiWebQueue] Unexpected error at chapter ${expectedChapterId}:`, error);
      return { status: 'retry', error: normalizeRetryError(error) };
    }
    return { status: 'retry', error: `Unknown translate failure for chapter ${expectedChapterId}` };
  };

  const handleTranslateAll = async (options?: { chapterIds?: string[] }) => {
    const chapterIdsSet = options?.chapterIds ? new Set(options.chapterIds) : null;
    const chaptersToTranslate = getEligibleChapters().filter((chapter) =>
      chapterIdsSet ? chapterIdsSet.has(chapter.id) : true
    );
    if (chaptersToTranslate.length === 0) {
      alert('Không có chương hợp lệ để dịch Web Queue.');
      return;
    }

    shouldStopRef.current = false;
    const runId = `story-webqueue-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentRunIdRef.current = runId;
    runtimeTranslatedChaptersRef.current = new Map(translatedChapters);
    setIsTranslating(true);
    setIsStopping(false);
    setStatus('running');
    setBatchProgress({ current: 0, total: chaptersToTranslate.length });
    const effectiveQueueMode: StoryWebQueueMode =
      ENFORCE_SEQUENTIAL_CHAPTER_LOCK || forceSequential ? 'sequential' : webQueueMode;
    const resolvedWorkers =
      effectiveQueueMode === 'multi_auto'
        ? await resolveAutoWorkerCount()
        : 1;
    setResolvedWorkerCount(resolvedWorkers);

    let processed = 0;

    try {
      if (effectiveQueueMode === 'multi_auto') {
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
            let retryCount = 0;
            let result: QueueChapterProcessResult = { status: 'stopped' };
            while (!shouldStopRef.current) {
              if (retryCount > 0) {
                const delayMs = getInfiniteRetryDelayMs(retryCount);
                setProcessingChapters((prev) => {
                  const next = new Map(prev);
                  const current = next.get(chapter.id);
                  next.set(chapter.id, {
                    startTime: current?.startTime || Date.now(),
                    workerId,
                    channel: 'token',
                    source: 'story_web_queue',
                    phase: 'retry_wait',
                    queuedAt: current?.queuedAt || Date.now(),
                    retryCount,
                    lastError: current?.lastError,
                    resourceId: current?.resourceId ?? null,
                    resourceLabel: current?.resourceLabel ?? null
                  });
                  return next;
                });
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
              result = await processChapter(chapter, workerId, {
                runId,
                batchId,
                conversationKey: `${batchId}-${chapter.id}`,
                resetConversation: true,
                retryCount
              });
              if (result.status === 'success' || result.status === 'stopped') {
                break;
              }
              const retryError = result.error;
              retryCount++;
              console.error(
                `[StoryGeminiWebQueue] Retry chapter ${chapter.id} (#${retryCount}) after error: ${retryError}`
              );
              setProcessingChapters((prev) => {
                const next = new Map(prev);
                const current = next.get(chapter.id);
                next.set(chapter.id, {
                  startTime: current?.startTime || Date.now(),
                  workerId,
                  channel: 'token',
                  source: 'story_web_queue',
                    phase: 'retry_wait',
                    queuedAt: current?.queuedAt || Date.now(),
                    retryCount,
                    lastError: retryError,
                    resourceId: current?.resourceId ?? null,
                    resourceLabel: current?.resourceLabel ?? null
                  });
                return next;
              });
            }
            if (result.status !== 'success') {
              break;
            }
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
          let retryCount = 0;
          let result: QueueChapterProcessResult = { status: 'stopped' };
          while (!shouldStopRef.current) {
            if (retryCount > 0) {
              const delayMs = getInfiniteRetryDelayMs(retryCount);
              setProcessingChapters((prev) => {
                const next = new Map(prev);
                const current = next.get(chapter.id);
                next.set(chapter.id, {
                  startTime: current?.startTime || Date.now(),
                  workerId: 1,
                  channel: 'token',
                  source: 'story_web_queue',
                  phase: 'retry_wait',
                  queuedAt: current?.queuedAt || Date.now(),
                  retryCount,
                  lastError: current?.lastError,
                  resourceId: current?.resourceId ?? null,
                  resourceLabel: current?.resourceLabel ?? null
                });
                return next;
              });
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            result = await processChapter(chapter, 1, {
              runId,
              conversationKey: batchConversationKey,
              resetConversation: isFirstTurn,
              batchId: batchConversationKey,
              retryCount
            });
            if (result.status === 'success' || result.status === 'stopped') {
              break;
            }
            const retryError = result.error;
            retryCount++;
            console.error(
              `[StoryGeminiWebQueue] Retry chapter ${chapter.id} (#${retryCount}) after error: ${retryError}`
            );
            setProcessingChapters((prev) => {
              const next = new Map(prev);
              const current = next.get(chapter.id);
              next.set(chapter.id, {
                startTime: current?.startTime || Date.now(),
                workerId: 1,
                channel: 'token',
                source: 'story_web_queue',
                phase: 'retry_wait',
                queuedAt: current?.queuedAt || Date.now(),
                retryCount,
                lastError: retryError,
                resourceId: current?.resourceId ?? null,
                resourceLabel: current?.resourceLabel ?? null
              });
              return next;
            });
          }
          if (result.status !== 'success') {
            break;
          }
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
