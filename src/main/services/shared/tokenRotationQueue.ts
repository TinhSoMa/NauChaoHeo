/**
 * TokenRotationQueue — Server-side generic token rotation + concurrency lock
 *
 * Trích xuất pattern từ GeminiChatServiceClass.withTokenLock + getNextActiveConfig
 * thành một class generic, không phụ thuộc vào bất kỳ service cụ thể nào.
 *
 * Features:
 *  - withLock(): Serialize requests per token key + cooldown sau mỗi request
 *  - selectBestConfig(): Ready-first round-robin giữa nhiều accounts
 *
 * Usage (ví dụ cho feature mới):
 *   const queue = new TokenRotationQueue({ minCooldownMs: 10000, maxCooldownMs: 20000 });
 *   const result = await queue.withLock(tokenKey, () => doWork());
 *   const best   = queue.selectBestConfig(activeConfigs, c => c.id, c => c.waitTime);
 */

import { getRandomInt } from '../../../shared/utils/delayUtils';

// ─── Options ──────────────────────────────────────────────────────────────

export interface TokenRotationQueueOptions {
  /** Cooldown tối thiểu sau mỗi request (ms). Default: 10_000 */
  minCooldownMs?: number;
  /** Cooldown tối đa sau mỗi request (ms). Default: 20_000 */
  maxCooldownMs?: number;
  /** Label để log (ví dụ: 'MyFeatureQueue'). Default: 'TokenRotationQueue' */
  label?: string;
}

// ─── Class ────────────────────────────────────────────────────────────────

export class TokenRotationQueue {
  private readonly minCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly label: string;

  /** Chain of promises per token key — ensures serial execution */
  private tokenLocks: Map<string, Promise<void>> = new Map();

  /** Time when the next request for a token key is allowed */
  private nextAvailableTimeByKey: Map<string, number> = new Map();

  /** Track last used config ID for round-robin selection */
  private lastUsedId: string | null = null;

  constructor(options: TokenRotationQueueOptions = {}) {
    this.minCooldownMs = options.minCooldownMs ?? 10_000;
    this.maxCooldownMs = options.maxCooldownMs ?? 20_000;
    this.label = options.label ?? 'TokenRotationQueue';
  }

  // ─── withLock ─────────────────────────────────────────────────────────

  /**
   * Chạy `fn` theo thứ tự (serialize) cho mỗi `tokenKey`.
   * Sau khi `fn` hoàn thành, tự động đặt cooldown ngẫu nhiên trước khi
   * cho phép request tiếp theo chạy trên cùng key.
   *
   * @param tokenKey  Khóa duy nhất của account/token (vd: atToken hay cookie hash)
   * @param fn        Công việc cần thực hiện
   */
  async withLock<T>(tokenKey: string, fn: () => Promise<T>): Promise<T> {
    const key = (tokenKey || '').trim();
    const reqId = Math.random().toString(36).substring(7);

    console.log(`[${this.label}][${reqId}] Queued for key: '${key.substring(0, 12)}...'`);

    // Lấy task trước đó và đặt task mới vào map ngay
    const previousTask = this.tokenLocks.get(key) ?? Promise.resolve();

    let signalDone!: () => void;
    const myTask = new Promise<void>((resolve) => { signalDone = resolve; });
    this.tokenLocks.set(key, myTask);

    // Chờ task trước hoàn thành (bỏ qua lỗi)
    try { await previousTask; } catch { /* ignore */ }

    // Kiểm tra cooldown
    const now = Date.now();
    const nextAllowedTime = this.nextAvailableTimeByKey.get(key) ?? 0;
    const waitTime = Math.max(0, nextAllowedTime - now);

    if (waitTime > 0) {
      console.log(`[${this.label}][${reqId}] Cooling down ${waitTime}ms...`);
      await new Promise((r) => setTimeout(r, waitTime));
    }

    console.log(`[${this.label}][${reqId}] Executing NOW.`);

    try {
      return await fn();
    } finally {
      // Đặt cooldown ngẫu nhiên sau khi task xong
      const cooldown = getRandomInt(this.minCooldownMs, this.maxCooldownMs);
      const completionTime = Date.now();
      this.nextAvailableTimeByKey.set(key, completionTime + cooldown);

      console.log(`[${this.label}][${reqId}] Done. Next allowed in ${cooldown}ms.`);

      signalDone();

      // Cleanup nếu đây là task cuối cùng trong queue
      if (this.tokenLocks.get(key) === myTask) {
        this.tokenLocks.delete(key);
      }
    }
  }

  // ─── selectBestConfig ─────────────────────────────────────────────────

  /**
   * Chọn config tốt nhất từ danh sách: ưu tiên ready (wait ≤ 0),
   * round-robin giữa các account đã sẵn sàng.
   * Nếu không ai ready → chọn account có wait time nhỏ nhất.
   *
   * @param configs       Danh sách configs active
   * @param getId         Hàm lấy ID duy nhất của config
   * @param getWaitTimeMs Hàm trả về thời gian chờ (ms) của config.
   *                      Nên dùng: `Math.max(0, nextAllowedTime - Date.now())`
   * @returns Config tốt nhất hoặc null nếu danh sách rỗng
   */
  selectBestConfig<TConfig>(
    configs: TConfig[],
    getId: (config: TConfig) => string,
    getWaitTimeMs: (config: TConfig) => number,
    getSortKey?: (config: TConfig) => number
  ): TConfig | null {
    if (configs.length === 0) return null;

    const readyCandidates: TConfig[] = [];
    let bestConfig: TConfig | null = null;
    let minWait = Infinity;

    for (const config of configs) {
      const waitMs = getWaitTimeMs(config);

      if (waitMs <= 0) {
        readyCandidates.push(config);
      }

      if (waitMs < minWait) {
        minWait = waitMs;
        bestConfig = config;
      }
    }

    if (readyCandidates.length > 0) {
      // Stable sort để rotation nhất quán
      if (getSortKey) {
        readyCandidates.sort((a, b) => getSortKey(a) - getSortKey(b));
      }

      let nextIndex = 0;
      if (this.lastUsedId) {
        const lastIdx = readyCandidates.findIndex((c) => getId(c) === this.lastUsedId);
        if (lastIdx !== -1) {
          nextIndex = (lastIdx + 1) % readyCandidates.length;
        }
      }

      bestConfig = readyCandidates[nextIndex];
      console.log(`[${this.label}] Selected READY config: ${getId(bestConfig)} (wait: 0ms)`);
    } else if (bestConfig) {
      console.log(`[${this.label}] All busy. Selected BEST config: ${getId(bestConfig)} (wait: ${minWait}ms)`);
    }

    if (bestConfig) {
      this.lastUsedId = getId(bestConfig);
    }

    return bestConfig;
  }

  // ─── Utils ────────────────────────────────────────────────────────────

  /**
   * Lấy wait time hiện tại (ms) cho một token key (0 nếu không trong cooldown).
   * Dùng để truyền vào getWaitTimeMs của selectBestConfig.
   */
  getWaitTimeMs(tokenKey: string): number {
    const key = (tokenKey || '').trim();
    const nextTime = this.nextAvailableTimeByKey.get(key) ?? 0;
    return Math.max(0, nextTime - Date.now());
  }

  /**
   * Đặt thủ công thời điểm ready tiếp theo cho một key.
   * Hữu ích sau khi nhận được lỗi rate-limit từ server.
   */
  setNextAvailableTime(tokenKey: string, atMs: number): void {
    this.nextAvailableTimeByKey.set((tokenKey || '').trim(), atMs);
  }

  /** Xóa toàn bộ locks và cooldown state (dùng khi reset) */
  reset(): void {
    this.tokenLocks.clear();
    this.nextAvailableTimeByKey.clear();
    this.lastUsedId = null;
  }
}
