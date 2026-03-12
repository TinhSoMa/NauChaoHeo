/**
 * Generic Worker Queue & Token Rotation Types
 *
 * Dùng chung cho mọi tính năng batch processing (story, caption, hardsub, v.v.)
 * Không phụ thuộc vào bất kỳ service cụ thể nào.
 */

// ─── Channel ───────────────────────────────────────────────────────────────

/** Loại kênh gửi request */
export type WorkerChannel = 'api' | 'token';

// ─── Worker Definition ─────────────────────────────────────────────────────

/**
 * Mô tả một worker instance.
 * TTokenConfig = kiểu config token (ví dụ: GeminiChatConfigLite)
 */
export interface WorkerDef<TTokenConfig = unknown> {
  channel: WorkerChannel;
  tokenConfig?: TTokenConfig | null;
}

// ─── Job Result ────────────────────────────────────────────────────────────

/** Job xử lý có thể retry */
export interface RetryableFailure {
  retryable: true;
}

/** Kết quả trả về của processJob có 3 khả năng:
 *  - TResult: thành công
 *  - RetryableFailure: thất bại nhưng có thể retry
 *  - null: thất bại không retry (skip)
 */
export type JobResult<TResult> = TResult | RetryableFailure | null;

// ─── Process Function ──────────────────────────────────────────────────────

/**
 * Hàm xử lý một job.
 * Caller tự implement, hook chỉ gọi hàm này.
 */
export type JobProcessFn<TJob, TResult, TTokenConfig = unknown> = (
  job: TJob,
  index: number,
  workerId: number,
  channel: WorkerChannel,
  tokenConfig: TTokenConfig | null
) => Promise<JobResult<TResult>>;

// ─── Progress ──────────────────────────────────────────────────────────────

export interface BatchQueueProgress {
  current: number;
  total: number;
}

// ─── Options ───────────────────────────────────────────────────────────────

export interface BatchWorkerQueueOptions<TJob, TResult, TTokenConfig = unknown> {
  /** Danh sách jobs cần xử lý */
  jobs: TJob[];

  /** Workers sẽ chạy (mỗi entry = 1 goroutine) */
  workers: WorkerDef<TTokenConfig>[];

  /** Hàm xử lý 1 job */
  processJob: JobProcessFn<TJob, TResult, TTokenConfig>;

  /** Callback sau khi 1 job thành công */
  onJobComplete?: (job: TJob, result: TResult, index: number) => void;

  /** Callback sau khi 1 job thất bại hẳn (sau hết retry) */
  onJobFailed?: (job: TJob, index: number) => void;

  /** Số lần retry tối đa per job (default: 3) */
  maxRetries?: number;

  /** Delay base giữa các retry: actualDelay = retryBaseMs * retryCount (default: 2000) */
  retryBaseMs?: number;

  /** Khoảng delay spawn worker [min, max] ms (default: [5000, 20000]) */
  spawnDelayRange?: [number, number];

  /** Live token configs để hot-add worker (pass tokenConfigs state) */
  liveTokenConfigs?: TTokenConfig[];

  /** Lấy distinct active configs (để hot-add) */
  getDistinctActiveConfigs?: (configs: TTokenConfig[]) => TTokenConfig[];

  /** Lấy ID của config (để track activeWorkerConfigIds) */
  getConfigId?: (config: TTokenConfig) => string;
}

// ─── Return Type ───────────────────────────────────────────────────────────

export interface UseBatchWorkerQueueReturn<TJob> {
  /** Bắt đầu queue với options hiện tại */
  start: () => void;
  /** Dừng queue */
  stop: () => void;
  /** Tiến độ hiện tại (null = chưa chạy) */
  progress: BatchQueueProgress | null;
  /** Đang chạy hay không */
  isRunning: boolean;
  /** Map<jobId, { startTime, workerId, channel }> - dùng cho UI spinner */
  processingJobIds: Set<string>;
}
