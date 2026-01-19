/**
 * API Key Manager - Quản lý thông minh API keys cho Gemini
 * Thuật toán "Quét Ngang" (Horizontal Sweep):
 * - Quét qua tất cả accounts trước khi chuyển sang project tiếp theo
 * - Mỗi account được nghỉ 13-14 giây giữa các request
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

// Các trạng thái của project
const STATUS_AVAILABLE: ProjectStatus = 'available';
const STATUS_RATE_LIMITED: ProjectStatus = 'rate_limited';
const STATUS_EXHAUSTED: ProjectStatus = 'exhausted';
const STATUS_ERROR: ProjectStatus = 'error';

/**
 * API Key Manager Class
 * Quản lý rotation và trạng thái của API keys
 */
export class ApiKeyManager {
  private config: ApiConfig;

  constructor() {
    console.log('[ApiManager] Khởi tạo API Key Manager...');
    this.config = this.loadConfig();
    this.autoRecoverAll();
    this.checkDailyReset();
    console.log('[ApiManager] Đã khởi tạo xong');
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
      console.log(`[ApiManager] Đã auto-recover ${recoveredCount} projects từ rate_limited`);
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
      console.log(`[ApiManager] Đang reset daily stats (last: ${lastReset}, current: ${currentDate})`);

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
   * 
   * Logic:
   * 1. Lấy key tại (current_account_index, current_project_index)
   * 2. Tăng current_account_index
   * 3. Nếu đã hết accounts -> reset account_index, tăng project_index
   * 4. Nếu đã hết projects -> reset project_index (quay lại vòng mới)
   */
  getNextApiKey(): { apiKey: string | null; keyInfo: KeyInfo | null } {
    this.autoRecoverAll();

    const accounts = this.config.accounts;
    if (!accounts || accounts.length === 0) {
      return { apiKey: null, keyInfo: null };
    }

    const numAccounts = accounts.length;
    // Tính số projects thực tế (không cố định 5)
    const numProjects = Math.max(...accounts.map(acc => acc.projects.length), 1);

    // Lấy state hiện tại
    const state = this.getRotationState();
    let currentAccIdx = state.currentAccountIndex || 0;
    let currentProjIdx = state.currentProjectIndex || 0;

    console.log(`[ApiManager] Bắt đầu tìm key từ acc_${currentAccIdx + 1}/project_${currentProjIdx + 1}`);

    // Thử tìm key available, quét qua tất cả accounts/projects
    const totalAttempts = numAccounts * numProjects;
    let attempts = 0;

    while (attempts < totalAttempts) {
      // Wrap around indices
      const accIdx = currentAccIdx % numAccounts;
      const projIdx = currentProjIdx % numProjects;

      const account = accounts[accIdx];
      const projects = account.projects;

      // Kiểm tra account active và có project
      if (account.accountStatus === 'active' && projIdx < projects.length) {
        const project = projects[projIdx];

        if (this.isProjectAvailable(project)) {
          // Tìm thấy key available
          const apiKey = project.apiKey;

          const keyInfo: KeyInfo = {
            accountId: account.accountId,
            accountEmail: account.email || '',
            projectName: project.projectName,
            apiKey,
            name: `${account.accountId}/${project.projectName}`,
            accountIndex: accIdx,
            projectIndex: projIdx,
          };

          // Cập nhật state cho lần request tiếp theo (QUAN TRỌNG: tăng trước khi lưu)
          let nextAccIdx = accIdx + 1;
          let nextProjIdx = projIdx;

          // Nếu đã hết accounts -> chuyển sang project tiếp theo
          if (nextAccIdx >= numAccounts) {
            nextAccIdx = 0;
            nextProjIdx = (projIdx + 1) % numProjects;
            state.rotationRound = (state.rotationRound || 1) + 1;
            console.log(`[ApiManager] Đã hết accounts, chuyển sang project ${nextProjIdx + 1}`);
          }

          state.currentAccountIndex = nextAccIdx;
          state.currentProjectIndex = nextProjIdx;
          state.totalRequestsSent = (state.totalRequestsSent || 0) + 1;

          this.saveConfig();

          console.log(`[ApiManager] Đã lấy key: ${keyInfo.name}`);
          return { apiKey, keyInfo };
        }
      }

      // Key không available, thử vị trí tiếp theo theo thuật toán quét ngang
      currentAccIdx++;
      if (currentAccIdx >= numAccounts) {
        currentAccIdx = 0;
        currentProjIdx++;
        console.log(`[ApiManager] Đã hết accounts cho project ${currentProjIdx}, chuyển sang project ${currentProjIdx + 1}`);
      }

      attempts++;
    }

    // Cập nhật state để lần gọi tiếp theo bắt đầu đúng vị trí
    state.currentAccountIndex = currentAccIdx % numAccounts;
    state.currentProjectIndex = currentProjIdx % numProjects;
    this.saveConfig();

    // Không tìm thấy key available nào
    console.warn('[ApiManager] Không còn key available nào');
    return { apiKey: null, keyInfo: null };
  }

  /**
   * Lấy tất cả API keys đang available theo thứ tự "Quét Ngang"
   */
  getAllAvailableKeys(): KeyInfo[] {
    this.autoRecoverAll();

    const maxProjects = 5;
    const keysByProject: Map<number, KeyInfo[]> = new Map();

    // Khởi tạo map
    for (let i = 0; i < maxProjects; i++) {
      keysByProject.set(i, []);
    }

    for (const account of this.config.accounts) {
      if (account.accountStatus !== 'active') {
        continue;
      }

      for (let projIdx = 0; projIdx < account.projects.length; projIdx++) {
        const project = account.projects[projIdx];
        if (this.isProjectAvailable(project)) {
          const keyInfo: KeyInfo = {
            accountId: account.accountId,
            accountEmail: account.email || '',
            projectName: project.projectName,
            apiKey: project.apiKey,
            name: `${account.accountId}/${project.projectName}`,
            accountIndex: this.config.accounts.indexOf(account),
            projectIndex: projIdx,
          };
          keysByProject.get(projIdx)?.push(keyInfo);
        }
      }
    }

    // Ghép lại theo thứ tự horizontal
    const available: KeyInfo[] = [];
    for (let projIdx = 0; projIdx < maxProjects; projIdx++) {
      available.push(...(keysByProject.get(projIdx) || []));
    }

    console.log(`[ApiManager] Có ${available.length} key(s) available`);
    return available;
  }

  /**
   * Reset trạng thái của tất cả keys từ rate_limited/exhausted -> available
   * Dùng khi chuyển model
   */
  resetAllStatusExceptDisabled(): void {
    console.log('[ApiManager] Đang reset tất cả trạng thái keys...');
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
          console.log(`[ApiManager] Reset project: ${project.projectName} (was: ${status})`);
        }
      }
    }

    this.saveConfig();
    console.log(`[ApiManager] Đã reset ${resetCount} project(s)`);
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
      console.log(`[ApiManager] Ghi nhận thành công cho key: ${apiKey.substring(0, 10)}...`);
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

      console.warn(`[ApiManager] API key bị rate limit, sẽ reset lúc ${resetTime.toISOString()}`);
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

      console.warn(`[ApiManager] API key hết quota ngày, sẽ reset lúc ${tomorrow.toISOString()}`);
      this.saveConfig();
    }
  }

  /**
   * Ghi nhận lỗi khác (không phải rate limit)
   */
  recordError(apiKey: string, errorMessage: string): void {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      project.stats.errorCount++;
      project.stats.lastErrorMessage = errorMessage;

      // Nếu lỗi nghiêm trọng (key invalid), đánh dấu error
      if (errorMessage.toLowerCase().includes('invalid') || errorMessage.toLowerCase().includes('api key')) {
        project.status = STATUS_ERROR;
      }

      console.error(`[ApiManager] Ghi nhận lỗi cho key: ${errorMessage}`);
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
    console.log('[ApiManager] Đang reload config...');
    this.config = this.loadConfig();
    this.autoRecoverAll();
    this.checkDailyReset();
    console.log('[ApiManager] Đã reload xong');
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
    console.log('[ApiManager] Đã reset rotation state');
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
