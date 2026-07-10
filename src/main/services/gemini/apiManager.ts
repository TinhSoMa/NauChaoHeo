/**
 * API Key Manager - Quản lý thông minh API keys cho Gemini
 * Thuật toán "Quét Ngang" (Horizontal Sweep):
 * - Quét qua tất cả accounts trước khi chuyển sang project tiếp theo
 * - Mỗi account được nghỉ 13-14 giây giữa các request
 * 
 * Optimizations v2:
 * - Lazy recovery: không autoRecoverAll/checkDailyReset trên hot path
 * - availableFlat cache: pre-compute flat list, O(1) rotation lookup
 * - Cache invalidation: tự động rebuild khi có mutation
 */

import {
  ApiConfig,
  Account,
  Project,
  KeyInfo,
  ApiStats,
  RotationState,
  ProjectStatus,
} from '../../../shared/types/gemini';
import { getMergedConfig, saveStateFromConfig } from './apiConfig';
import { GeminiErrorCode, isKeyErrorCode } from './geminiError';

// Các trạng thái của project
const STATUS_AVAILABLE: ProjectStatus = 'available';
const STATUS_RATE_LIMITED: ProjectStatus = 'rate_limited';
const STATUS_EXHAUSTED: ProjectStatus = 'exhausted';
const STATUS_ERROR: ProjectStatus = 'error';
const STATUS_DISABLED: ProjectStatus = 'disabled';

const CACHE_TTL_MS = 5_000; // 5s cache TTL
const RECOVERY_INTERVAL_MS = 30_000; // 30s giữa các lần recovery

interface FlatEntry {
  project: Project;
  account: Account;
  accIdx: number;
  projIdx: number;
}

/**
 * API Key Manager Class
 * Quản lý rotation và trạng thái của API keys
 */
export class ApiKeyManager {
  private config: ApiConfig;

  // availableFlat cache
  private availableFlat: FlatEntry[] | null = null;
  private cacheTimestamp = 0;
  private flatIndex = 0;

  // Lazy recovery timestamp
  private lastRecoveryMs = 0;

  constructor() {
    /* console.log('[ApiManager] Khởi tạo API Key Manager...') */;
    this.config = this.loadConfig();
    // Không gọi autoRecoverAll + checkDailyReset ở constructor
    // Chúng chạy lazy qua tryLazyRecovery()
    /* console.log('[ApiManager] Đã khởi tạo xong') */;
  }

  /**
   * Load config từ embedded keys + AppData state
   */
  private loadConfig(): ApiConfig {
    try {
      return getMergedConfig();
    } catch (error) {
      console.error('[ApiManager] Lỗi load config:', error);
      return this.createDefaultConfig();
    }
  }

  /**
   * Tạo config mặc định
   */
  private createDefaultConfig(): ApiConfig {
    return {
      settings: {
        globalCooldownSeconds: 65,
        defaultRpmLimit: 15,
        maxRpdLimit: 1500,
        rotationStrategy: 'horizontal_sweep',
        retryExhaustedAfterHours: 24,
        delayBetweenRequestsMs: 1000,
      },
      rotationState: {
        currentProjectIndex: 0,
        currentAccountIndex: 0,
        totalRequestsSent: 0,
        rotationRound: 1,
        lastDailyReset: null,
      },
      accounts: [],
    };
  }

  /**
   * Lưu config vào AppData (chỉ lưu state, không lưu keys)
   */
  private saveConfig(): void {
    try {
      saveStateFromConfig(this.config);
    } catch (error) {
      console.error('[ApiManager] Lỗi lưu config:', error);
    }
  }

  /**
   * Lấy rotation state
   */
  private getRotationState(): RotationState {
    if (!this.config.rotationState) {
      this.config.rotationState = {
        currentProjectIndex: 0,
        currentAccountIndex: 0,
        totalRequestsSent: 0,
        rotationRound: 1,
        lastDailyReset: null,
      };
    }
    return this.config.rotationState;
  }

  /**
   * Lazy recovery: chỉ chạy autoRecoverAll + checkDailyReset
   * nếu lần cuối > RECOVERY_INTERVAL_MS trước
   */
  private tryLazyRecovery(): void {
    const now = Date.now();
    if (now - this.lastRecoveryMs < RECOVERY_INTERVAL_MS) return;
    this.lastRecoveryMs = now;
    this.autoRecoverAll();
    this.checkDailyReset();
  }

  /**
   * Build flat list các projects available để rotation O(1) lookup
   */
  private buildAvailableFlat(): FlatEntry[] {
    const now = Date.now();
    if (this.availableFlat && (now - this.cacheTimestamp) < CACHE_TTL_MS) {
      return this.availableFlat;
    }

    const flat: FlatEntry[] = [];
    const accounts = this.config.accounts;
    // Horizontal Sweep: quét ngang qua tất cả account ở cùng project index trước,
    // rồi xuống project kế tiếp (acc1/P1 → acc2/P1 → ... → acc1/P2 → acc2/P2 → ...)
    const maxProjects = Math.max(0, ...accounts.map((a) => a.projects.length));
    for (let projIdx = 0; projIdx < maxProjects; projIdx++) {
      for (let accIdx = 0; accIdx < accounts.length; accIdx++) {
        const account = accounts[accIdx];
        if (account.accountStatus !== 'active') continue;
        const project = account.projects[projIdx];
        if (project && this.isProjectAvailable(project)) {
          flat.push({ project, account, accIdx, projIdx });
        }
      }
    }

    this.availableFlat = flat;
    this.cacheTimestamp = now;
    return flat;
  }

  /**
   * Invalidate availableFlat cache khi có mutation
   */
  private invalidateCache(): void {
    this.availableFlat = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Auto-recover tất cả projects bị rate_limited đã hết cooldown
   */
  private autoRecoverAll(): void {
    const currentTime = new Date();
    let recoveredCount = 0;

    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        if (project.status === STATUS_RATE_LIMITED) {
          const resetAt = project.limitTracking.rateLimitResetAt;
          if (resetAt) {
            try {
              const resetTime = new Date(resetAt);
              if (currentTime >= resetTime) {
                project.status = STATUS_AVAILABLE;
                project.limitTracking.rateLimitResetAt = null;
                project.limitTracking.minuteRequestCount = 0;
                recoveredCount++;
              }
            } catch {
              // Bỏ qua lỗi parse date
            }
          }
        }
      }
    }

    if (recoveredCount > 0) {
      /* console.log(`[ApiManager] Đã auto-recover ${recoveredCount} projects từ rate_limited`) */;
      this.saveConfig();
    }
  }

  /**
   * Kiểm tra và reset stats hàng ngày (0h sáng)
   */
  private checkDailyReset(): void {
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const rotationState = this.getRotationState();
    const lastReset = rotationState.lastDailyReset;

    if (lastReset !== currentDate) {
      /* console.log(`[ApiManager] Đang reset daily stats (last: ${lastReset}, current: ${currentDate})`) */;

      for (const account of this.config.accounts) {
        for (const project of account.projects) {
          // Reset stats
          project.stats.totalRequestsToday = 0;
          project.stats.successCount = 0;
          project.stats.errorCount = 0;

          // Recover exhausted projects
          if (project.status === STATUS_EXHAUSTED) {
            project.status = STATUS_AVAILABLE;
            project.limitTracking.dailyLimitResetAt = null;
          }
        }
      }

      rotationState.lastDailyReset = currentDate;
      this.saveConfig();
    }
  }

  /**
   * Kiểm tra project có available không (bao gồm auto-recover)
   */
  private isProjectAvailable(project: Project): boolean {
    const status = project.status || STATUS_AVAILABLE;

    // Check rate limit recovery
    if (status === STATUS_RATE_LIMITED) {
      const resetAt = project.limitTracking.rateLimitResetAt;
      if (resetAt) {
        try {
          const resetTime = new Date(resetAt);
          if (new Date() >= resetTime) {
            project.status = STATUS_AVAILABLE;
            project.limitTracking.rateLimitResetAt = null;
            project.limitTracking.minuteRequestCount = 0;
            return true;
          }
        } catch {
          // Bỏ qua lỗi parse date
        }
      }
      return false;
    }

    // Check exhausted
    if (status === STATUS_EXHAUSTED) {
      return false;
    }

    // Check disabled
    if (status === 'disabled') {
      return false;
    }

    // Check error
    if (status === STATUS_ERROR) {
      return false;
    }

    // Check if api_key is empty
    if (!project.apiKey) {
      return false;
    }

    return status === STATUS_AVAILABLE;
  }

  /**
   * Lấy API key tiếp theo theo thuật toán "Quét Ngang"
   * Optimized: dùng availableFlat cache, O(n) worst-case thay vì O(n*m)
   */
  getNextApiKey(): { apiKey: string | null; keyInfo: KeyInfo | null } {
    this.tryLazyRecovery();

    const flat = this.buildAvailableFlat();
    if (flat.length === 0) {
      console.warn('[ApiManager] Không còn key available nào');
      return { apiKey: null, keyInfo: null };
    }

    const startIdx = this.flatIndex % flat.length;
    for (let i = 0; i < flat.length; i++) {
      const idx = (startIdx + i) % flat.length;
      const entry = flat[idx];

      if (this.isProjectAvailable(entry.project)) {
        const { project, account, accIdx, projIdx } = entry;

        const keyInfo: KeyInfo = {
          accountId: account.accountId,
          accountEmail: account.email || '',
          projectName: project.projectName,
          apiKey: project.apiKey,
          name: `${account.accountId}/${project.projectName}`,
          accountIndex: accIdx,
          projectIndex: projIdx,
        };

        // Cập nhật flatIndex cho lần gọi tiếp theo
        this.flatIndex = (idx + 1) % flat.length;

        // Cập nhật rotation state
        const state = this.getRotationState();
        state.currentAccountIndex = accIdx;
        state.currentProjectIndex = projIdx;
        state.totalRequestsSent = (state.totalRequestsSent || 0) + 1;
        this.saveConfig();

        return { apiKey: project.apiKey, keyInfo };
      }
    }

    // Hết available: không thay đổi state, batch exhausted
    console.warn('[ApiManager] Không còn key available nào');
    return { apiKey: null, keyInfo: null };
  }

  /**
   * Lấy tất cả API keys đang available — dùng availableFlat cache
   */
  getAllAvailableKeys(): KeyInfo[] {
    this.tryLazyRecovery();

    const flat = this.buildAvailableFlat();
    const keys: KeyInfo[] = flat.map((entry) => ({
      accountId: entry.account.accountId,
      accountEmail: entry.account.email || '',
      projectName: entry.project.projectName,
      apiKey: entry.project.apiKey,
      name: `${entry.account.accountId}/${entry.project.projectName}`,
      accountIndex: entry.accIdx,
      projectIndex: entry.projIdx,
    }));

    /* console.log(`[ApiManager] Có ${keys.length} key(s) available`) */;
    return keys;
  }

  /**
   * Reset trạng thái của tất cả keys từ rate_limited/exhausted -> available
   * Dùng khi chuyển model
   */
  resetAllStatusExceptDisabled(): void {
    /* console.log('[ApiManager] Đang reset tất cả trạng thái keys...') */;
    let resetCount = 0;

    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        const status = project.status;
        // Reset tất cả các trạng thái lỗi, trừ 'disabled'
        if (status === STATUS_RATE_LIMITED || status === STATUS_EXHAUSTED || status === STATUS_ERROR) {
          project.status = STATUS_AVAILABLE;
          project.limitTracking.rateLimitResetAt = null;
          project.limitTracking.dailyLimitResetAt = null;
          project.limitTracking.minuteRequestCount = 0;
          project.stats.lastErrorMessage = '';
          resetCount++;
          /* console.log(`[ApiManager] Reset project: ${project.projectName} (was: ${status})`) */;
        }
      }
    }

    this.saveConfig();
    /* console.log(`[ApiManager] Đã reset ${resetCount} project(s)`) */;
  }

  /**
   * Ghi nhận request thành công
   */
  recordSuccess(apiKey: string): void {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      project.stats.totalRequestsToday++;
      project.stats.successCount++;
      project.stats.lastSuccessTimestamp = new Date().toISOString();

      project.limitTracking.lastUsedTimestamp = new Date().toISOString();
      project.limitTracking.minuteRequestCount++;

      this.saveConfig();
    }
  }

  /**
   * Ghi nhận lỗi rate limit (429) - RPM
   */
  recordRateLimitError(apiKey: string): void {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      const cooldown = this.config.settings.globalCooldownSeconds || 65;
      const resetTime = new Date(Date.now() + cooldown * 1000);

      project.status = STATUS_RATE_LIMITED;
      project.stats.errorCount++;
      project.stats.lastErrorMessage = `429 Rate Limited at ${new Date().toISOString()}`;
      project.limitTracking.rateLimitResetAt = resetTime.toISOString();
      project.limitTracking.minuteRequestCount = 0;

      this.invalidateCache();
      this.saveConfig();
    }
  }

  /**
   * Ghi nhận lỗi hết quota ngày (RPD)
   */
  recordQuotaExhausted(apiKey: string): void {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      project.status = STATUS_EXHAUSTED;
      project.stats.errorCount++;
      project.stats.lastErrorMessage = `Daily quota exhausted at ${new Date().toISOString()}`;
      project.limitTracking.dailyLimitResetAt = tomorrow.toISOString();

      this.invalidateCache();
      this.saveConfig();
    }
  }

  /**
   * Ghi nhận lỗi khác (không phải rate limit)
   */
  recordError(apiKey: string, errorMessage: string, errorCode?: GeminiErrorCode): void {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      project.stats.errorCount++;
      project.stats.lastErrorMessage = errorCode ? `[${errorCode}] ${errorMessage}` : errorMessage;

      if (errorCode && isKeyErrorCode(errorCode)) {
        project.status = STATUS_ERROR;
      } else if (!errorCode && (errorMessage.toLowerCase().includes('invalid') || errorMessage.toLowerCase().includes('api key'))) {
        project.status = STATUS_ERROR;
      }

      this.invalidateCache();
      this.saveConfig();
    }
  }

  /**
   * Tìm project theo API key
   */
  private findProjectByKey(apiKey: string): Project | null {
    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        if (project.apiKey === apiKey) {
          return project;
        }
      }
    }
    return null;
  }

  /**
   * Lấy thống kê tổng quan
   */
  getStats(): ApiStats {
    const totalAccounts = this.config.accounts.length;
    let totalProjects = 0;
    let available = 0;
    let rateLimited = 0;
    let exhausted = 0;
    let error = 0;
    let emptyKeys = 0;
    let totalRequests = 0;

    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        totalProjects++;

        if (!project.apiKey) {
          emptyKeys++;
          continue;
        }

        if (this.isProjectAvailable(project)) {
          available++;
        } else if (project.status === STATUS_RATE_LIMITED) {
          rateLimited++;
        } else if (project.status === STATUS_EXHAUSTED) {
          exhausted++;
        } else {
          error++;
        }

        totalRequests += project.stats.totalRequestsToday || 0;
      }
    }

    const state = this.getRotationState();

    return {
      totalAccounts,
      totalProjects,
      available,
      rateLimited,
      exhausted,
      error,
      emptyKeys,
      totalRequestsToday: totalRequests,
      currentAccountIndex: state.currentAccountIndex || 0,
      currentProjectIndex: state.currentProjectIndex || 0,
      rotationRound: state.rotationRound || 1,
    };
  }

  /**
   * Lấy delay giữa các request (milliseconds)
   */
  getDelayMs(): number {
    return this.config.settings.delayBetweenRequestsMs || 1000;
  }

  /**
   * Reload config từ file
   */
  reload(): void {
    /* console.log('[ApiManager] Đang reload config...') */;
    this.config = this.loadConfig();
    this.lastRecoveryMs = 0; // buộc recovery ở lần gọi tiếp theo
    this.invalidateCache();
    /* console.log('[ApiManager] Đã reload xong') */;
  }

  /**
   * Reset rotation state về đầu
   */
  resetRotationState(): void {
    const state = this.getRotationState();
    state.currentAccountIndex = 0;
    state.currentProjectIndex = 0;
    state.rotationRound = 1;
    this.saveConfig();
    /* console.log('[ApiManager] Đã reset rotation state') */;
  }

  disableAccount(accountId: string): boolean {
    const account = this.config.accounts.find((item) => item.accountId === accountId);
    if (!account) {
      return false;
    }
    account.accountStatus = 'disabled';
    for (const project of account.projects) {
      project.status = STATUS_DISABLED;
    }
    this.invalidateCache();
    this.saveConfig();
    return true;
  }

  enableAccount(accountId: string): boolean {
    const account = this.config.accounts.find((item) => item.accountId === accountId);
    if (!account) {
      return false;
    }
    account.accountStatus = 'active';
    for (const project of account.projects) {
      project.status = STATUS_AVAILABLE;
      project.limitTracking.rateLimitResetAt = null;
      project.limitTracking.dailyLimitResetAt = null;
    }
    this.invalidateCache();
    this.saveConfig();
    return true;
  }

  disableProject(accountId: string, projectIndex: number): boolean {
    const account = this.config.accounts.find((item) => item.accountId === accountId);
    if (!account) {
      return false;
    }
    const project = account.projects.find((item) => item.projectIndex === projectIndex);
    if (!project) {
      return false;
    }
    project.status = STATUS_DISABLED;
    this.invalidateCache();
    this.saveConfig();
    return true;
  }

  enableProject(accountId: string, projectIndex: number): boolean {
    const account = this.config.accounts.find((item) => item.accountId === accountId);
    if (!account) {
      return false;
    }
    const project = account.projects.find((item) => item.projectIndex === projectIndex);
    if (!project) {
      return false;
    }
    project.status = STATUS_AVAILABLE;
    project.limitTracking.rateLimitResetAt = null;
    project.limitTracking.dailyLimitResetAt = null;
    this.invalidateCache();
    this.saveConfig();
    return true;
  }
}

// Singleton instance
let managerInstance: ApiKeyManager | null = null;

/**
 * Lấy instance của ApiKeyManager (singleton)
 */
export function getApiManager(): ApiKeyManager {
  if (!managerInstance) {
    managerInstance = new ApiKeyManager();
  }
  return managerInstance;
}
