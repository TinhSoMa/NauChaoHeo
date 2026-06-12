/**
 * useBatchWorkerQueue — Generic client-side hook cho batch processing
 *
 * Trích xuất pattern từ useStoryBatchTranslation + useStorySummaryGeneration
 * thành một hook generic, tái sử dụng cho mọi tính năng batch.
 *
 * Features:
 *  - Shared job queue với atomic index increment
 *  - Multi-worker (API workers + Token workers song song)
 *  - Staggered spawn: worker[0] start ngay, worker[1..n] delay tích lũy ngẫu nhiên
 *  - Hot-add: tự spawn thêm worker khi tokenConfigs thay đổi mid-batch
 *  - Retry per job với delay tăng dần
 *  - Stop control
 *
 * Usage:
 *   const { start, stop, progress, isRunning } = useBatchWorkerQueue({
 *     jobs: chapters,
 *     workers: [{ channel: 'api' }, { channel: 'token', tokenConfig: cfg }],
 *     processJob: async (job, index, workerId, channel, tokenConfig) => { ... },
 *     onJobComplete: (job, result) => { ... },
 *   });
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { getRandomInt } from '@shared/utils/delayUtils';
import type {
  WorkerChannel,
  WorkerDef,
  JobResult,
  JobProcessFn,
  BatchQueueProgress,
} from '@shared/types/workerQueue';

// Re-export types for convenience
export type { WorkerChannel, WorkerDef, BatchQueueProgress };

// ─── Internal batch state ─────────────────────────────────────────────────

interface BatchState<TJob> {
  jobs: TJob[];
  currentIndex: number;
  completed: number;
  activeWorkerConfigIds: Set<string>;
}

// ─── Options ──────────────────────────────────────────────────────────────

export interface UseBatchWorkerQueueOptions<TJob, TResult, TTokenConfig = unknown> {
  /** Hàm xử lý 1 job */
  processJob: JobProcessFn<TJob, TResult, TTokenConfig>;

  /** Callback sau khi 1 job xử lý thành công */
  onJobComplete?: (job: TJob, result: TResult, index: number) => void;

  /** Callback sau khi job thất bại hoàn toàn (hết retry) */
  onJobFailed?: (job: TJob, index: number) => void;

  /** Số lần retry tối đa per job (default: 3) */
  maxRetries?: number;

  /** delay = retryBaseMs * retryCount (default: 2000) */
  retryBaseMs?: number;

  /** Khoảng delay spawn token worker [min, max] ms (default: [5000, 20000]) */
  spawnDelayRange?: [number, number];

  /**
   * Live token configs để hot-add worker.
   * Truyền state `tokenConfigs` từ component — hook sẽ tự detect config mới.
   */
  liveTokenConfigs?: TTokenConfig[];

  /** Lọc distinct active configs (để hot-add) */
  getDistinctActiveConfigs?: (configs: TTokenConfig[]) => TTokenConfig[];

  /** Lấy unique ID của một config */
  getConfigId?: (config: TTokenConfig) => string;
}

// ─── Return ───────────────────────────────────────────────────────────────

export interface UseBatchWorkerQueueReturn {
  /** Bắt đầu batch với danh sách jobs và workers */
  start: <TJob, TTokenConfig>(
    jobs: TJob[],
    workers: WorkerDef<TTokenConfig>[]
  ) => void;
  /** Dừng batch */
  stop: () => void;
  /** Tiến độ (null = chưa / đã xong) */
  progress: BatchQueueProgress | null;
  /** Đang chạy */
  isRunning: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useBatchWorkerQueue<TJob, TResult, TTokenConfig = unknown>(
  options: UseBatchWorkerQueueOptions<TJob, TResult, TTokenConfig>
): UseBatchWorkerQueueReturn {
  const {
    processJob,
    onJobComplete,
    onJobFailed,
    maxRetries = 3,
    retryBaseMs = 2000,
    spawnDelayRange = [5000, 20_000],
    liveTokenConfigs,
    getDistinctActiveConfigs,
    getConfigId,
  } = options;

  // ─── State ──────────────────────────────────────────────────────────

  const [progress, setProgress] = useState<BatchQueueProgress | null>(null);
  const [, setShouldStop] = useState(false);

  const shouldStopRef = useRef(false);
  const isRunningRef = useRef(false);
  const workerIdRef = useRef(0);

  // Batch state accessible from any worker closure
  const batchStateRef = useRef<BatchState<TJob>>({
    jobs: [],
    currentIndex: 0,
    completed: 0,
    activeWorkerConfigIds: new Set(),
  });

  // Ref to latest startWorker (allows hot-add useEffect to always call newest version)
  const startWorkerRef = useRef<
    ((channel: WorkerChannel, tokenConfig?: TTokenConfig | null) => Promise<void>) | null
  >(null);

  // ─── stop ───────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    shouldStopRef.current = true;
    setShouldStop(true);
    isRunningRef.current = false;
  }, []);

  // ─── Worker ─────────────────────────────────────────────────────────

  const startWorker = useCallback(
    async (channel: WorkerChannel, tokenConfig?: TTokenConfig | null): Promise<void> => {
      const workerId = ++workerIdRef.current;

      if (channel === 'token' && tokenConfig && getConfigId) {
        batchStateRef.current.activeWorkerConfigIds.add(getConfigId(tokenConfig));
      }

      try {
        while (!shouldStopRef.current) {
          const state = batchStateRef.current;

          if (state.currentIndex >= state.jobs.length) break;

          const index = state.currentIndex++;
          const job = state.jobs[index];

          let result: JobResult<TResult> = null;
          let retryCount = 0;

          while (retryCount <= maxRetries) {
            if (shouldStopRef.current) break;

            if (retryCount > 0) {
              await new Promise((r) => setTimeout(r, retryBaseMs * retryCount));
            }

            result = await processJob(job, index, workerId, channel, tokenConfig ?? null);

            // Retryable failure → retry
            if (result !== null && typeof result === 'object' && 'retryable' in result && result.retryable) {
              retryCount++;
              if (retryCount > maxRetries) {
                onJobFailed?.(job, index);
                result = null;
              }
              continue;
            }

            break;
          }

          // Successful result
          if (result !== null && !(typeof result === 'object' && 'retryable' in result)) {
            batchStateRef.current.completed++;
            setProgress({
              current: batchStateRef.current.completed,
              total: batchStateRef.current.jobs.length,
            });
            onJobComplete?.(job, result as TResult, index);
          }
        }
      } finally {
        if (channel === 'token' && tokenConfig && getConfigId) {
          batchStateRef.current.activeWorkerConfigIds.delete(getConfigId(tokenConfig));
        }

        // If all workers are done, cleanup
        const state = batchStateRef.current;
        const allJobsTaken = state.currentIndex >= state.jobs.length;
        const noActiveTokenWorkers = state.activeWorkerConfigIds.size === 0;

        if (allJobsTaken && noActiveTokenWorkers) {
          isRunningRef.current = false;
          setProgress(null);
        }
      }
    },
    [processJob, onJobComplete, onJobFailed, maxRetries, retryBaseMs, getConfigId]
  );

  // Keep ref in sync with latest closure
  startWorkerRef.current = startWorker;

  // ─── Hot-add ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isRunningRef.current || shouldStopRef.current) return;
    if (!liveTokenConfigs || !getDistinctActiveConfigs || !getConfigId) return;
    if (batchStateRef.current.currentIndex >= batchStateRef.current.jobs.length) return;

    const distinctActive = getDistinctActiveConfigs(liveTokenConfigs);
    const newConfigs = distinctActive.filter(
      (c) => !batchStateRef.current.activeWorkerConfigIds.has(getConfigId(c))
    );

    if (newConfigs.length === 0) return;

    for (const config of newConfigs) {
      startWorkerRef.current?.('token', config);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTokenConfigs]);

  // ─── start ──────────────────────────────────────────────────────────

  const start = useCallback(
    <TJ, TC>(jobs: TJ[], workers: WorkerDef<TC>[]): void => {
      if (jobs.length === 0) return;

      const typedJobs = jobs as unknown as TJob[];
      const typedWorkers = workers as unknown as WorkerDef<TTokenConfig>[];

      // Init batch state
      const initialTokenIds = new Set(
        typedWorkers
          .filter((w) => w.channel === 'token' && w.tokenConfig && getConfigId)
          .map((w) => getConfigId!(w.tokenConfig!))
      );

      batchStateRef.current = {
        jobs: typedJobs,
        currentIndex: 0,
        completed: 0,
        activeWorkerConfigIds: initialTokenIds,
      };
      workerIdRef.current = 0;
      shouldStopRef.current = false;
      setShouldStop(false);
      isRunningRef.current = true;

      setProgress({ current: 0, total: typedJobs.length });

      // Separate API workers and token workers
      const apiWorkers = typedWorkers.filter((w) => w.channel === 'api');
      const tokenWorkers = typedWorkers.filter((w) => w.channel === 'token');

      // API workers: start all immediately
      for (let i = 0; i < apiWorkers.length; i++) {
        startWorker('api', null);
      }

      // Token workers: staggered spawn
      const [minDelay, maxDelay] = spawnDelayRange;
      let cumulativeDelay = 0;

      for (let i = 0; i < tokenWorkers.length; i++) {
        const worker = tokenWorkers[i];

        if (i === 0) {
          startWorker('token', worker.tokenConfig ?? null);
        } else {
          cumulativeDelay += getRandomInt(minDelay, maxDelay);
          const delay = cumulativeDelay;

          setTimeout(() => {
            if (!shouldStopRef.current) {
              startWorkerRef.current?.('token', worker.tokenConfig ?? null);
            }
          }, delay);
        }
      }
    },
    [startWorker, spawnDelayRange, getConfigId]
  );

  return {
    start: start as UseBatchWorkerQueueReturn['start'],
    stop,
    progress,
    isRunning: isRunningRef.current,
  };
}
