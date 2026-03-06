import { getDatabase } from '../../database/schema';
import type {
  GeminiWebApiAccountStatus,
  GeminiWebApiHealthSnapshot,
  GeminiWebApiLogEntry,
  GeminiWebApiLogLevel,
  GeminiWebApiLogType,
  GeminiWebApiOpsSnapshot
} from '../../../shared/types/geminiWebApi';
import type {
  GeminiBrowserType,
  GeminiCookieRefreshResult,
  GeminiCookieSource,
  GeminiCookieStatus,
  GeminiErrorCode,
  GeminiWebApiHealth
} from './types';

interface AccountRuntimeState {
  accountConfigId: string;
  accountName?: string;
  lastRefreshStatus: GeminiWebApiAccountStatus['lastRefreshStatus'];
  lastRefreshAt: number | null;
  lastRefreshBrowser?: GeminiBrowserType;
  updatedPrimary?: boolean;
  updatedFallback?: boolean;
  lastError?: string;
}

interface BaseAccountRecord {
  accountConfigId: string;
  accountName: string;
  isActive: boolean;
  cookieStatus: GeminiCookieStatus;
}

interface AppendLogInput {
  level: GeminiWebApiLogLevel;
  type: GeminiWebApiLogType;
  message: string;
  accountConfigId?: string;
  accountName?: string;
  sourceBrowser?: GeminiBrowserType;
  errorCode?: GeminiErrorCode | string;
  error?: string;
  metadata?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 500;

class GeminiWebApiOpsMonitor {
  private readonly logs: GeminiWebApiLogEntry[] = [];
  private readonly accountStateById = new Map<string, AccountRuntimeState>();
  private seq = 0;
  private lastHealth: GeminiWebApiHealthSnapshot | null = null;

  recordHealthCheck(health: GeminiWebApiHealth): GeminiWebApiHealthSnapshot {
    const snapshot: GeminiWebApiHealthSnapshot = {
      checkedAt: Date.now(),
      pythonOk: health.pythonOk,
      modulesOk: health.modulesOk,
      cookieReady: health.cookieReady,
      runtimeMode: health.details.runtimeMode,
      pythonPath: health.details.pythonPath,
      pythonVersion: health.details.pythonVersion,
      modules: health.details.modules,
      error: health.details.error
    };
    this.lastHealth = snapshot;
    this.appendLog({
      level: health.pythonOk && health.modulesOk ? 'success' : 'error',
      type: 'health_checked',
      message: health.pythonOk && health.modulesOk
        ? 'Gemini WebAPI health check OK.'
        : 'Gemini WebAPI health check failed.',
      metadata: {
        runtimeMode: snapshot.runtimeMode,
        pythonPath: snapshot.pythonPath,
        pythonVersion: snapshot.pythonVersion,
        modules: snapshot.modules,
        cookieReady: snapshot.cookieReady
      },
      error: snapshot.error
    });
    return snapshot;
  }

  getLastHealth(): GeminiWebApiHealthSnapshot | null {
    return this.lastHealth;
  }

  recordWorkerStarted(input: {
    pythonPath: string;
    runtimeMode: 'embedded' | 'system';
    workerPath: string;
  }): void {
    this.appendLog({
      level: 'info',
      type: 'worker_started',
      message: 'Gemini WebAPI Python worker started.',
      metadata: input
    });
  }

  recordWorkerLog(input: {
    level: GeminiWebApiLogLevel;
    message: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.appendLog({
      level: input.level,
      type: 'worker_log',
      message: input.message,
      metadata: input.metadata
    });
  }

  recordWorkerError(input: { error: string; metadata?: Record<string, unknown> }): void {
    this.appendLog({
      level: 'error',
      type: 'worker_error',
      message: 'Gemini WebAPI Python worker error.',
      error: input.error,
      metadata: input.metadata
    });
  }

  recordCookieRefreshStarted(accountConfigId?: string): void {
    const runtime = this.getOrCreateAccountRuntime(accountConfigId);
    runtime.lastRefreshStatus = 'running';
    runtime.lastError = undefined;
    runtime.lastRefreshAt = Date.now();
    this.appendLog({
      level: 'info',
      type: 'cookie_refresh_started',
      message: 'Started refreshing Gemini WebAPI cookie.',
      accountConfigId: runtime.accountConfigId || undefined,
      accountName: runtime.accountName
    });
  }

  recordCookieRefreshResult(
    accountConfigId: string | undefined,
    result: GeminiCookieRefreshResult
  ): void {
    const runtime = this.getOrCreateAccountRuntime(accountConfigId);
    runtime.lastRefreshAt = Date.now();
    runtime.lastRefreshBrowser = result.sourceBrowser;
    runtime.updatedPrimary = result.updatedPrimary;
    runtime.updatedFallback = result.updatedFallback;
    runtime.lastRefreshStatus = result.success ? 'success' : 'failed';
    runtime.lastError = result.success ? undefined : result.error || 'Cookie refresh failed';

    this.appendLog({
      level: result.success ? 'success' : 'error',
      type: result.success ? 'cookie_refresh_succeeded' : 'cookie_refresh_failed',
      message: result.success
        ? 'Cookie refresh completed.'
        : 'Cookie refresh failed.',
      accountConfigId: runtime.accountConfigId || undefined,
      accountName: runtime.accountName,
      sourceBrowser: result.sourceBrowser,
      errorCode: result.errorCode,
      error: result.error,
      metadata: {
        updatedPrimary: result.updatedPrimary,
        updatedFallback: result.updatedFallback,
        cookieSource: result.cookieSource,
        warnings: result.warnings
      }
    });
  }

  recordRequestResult(input: {
    success: boolean;
    accountConfigId?: string;
    cookieSource: GeminiCookieSource;
    refreshed: boolean;
    errorCode?: GeminiErrorCode;
    error?: string;
  }): void {
    const runtime = this.getOrCreateAccountRuntime(input.accountConfigId);
    this.appendLog({
      level: input.success ? 'success' : 'error',
      type: input.success ? 'request_succeeded' : 'request_failed',
      message: input.success
        ? 'Gemini WebAPI request succeeded.'
        : 'Gemini WebAPI request failed.',
      accountConfigId: runtime.accountConfigId || undefined,
      accountName: runtime.accountName,
      errorCode: input.errorCode,
      error: input.error,
      metadata: {
        cookieSource: input.cookieSource,
        refreshed: input.refreshed
      }
    });
  }

  buildOpsSnapshot(baseAccounts: BaseAccountRecord[]): GeminiWebApiOpsSnapshot {
    const accounts: GeminiWebApiAccountStatus[] = baseAccounts.map((account) => {
      const runtime = this.accountStateById.get(account.accountConfigId);
      return {
        accountConfigId: account.accountConfigId,
        accountName: account.accountName,
        isActive: account.isActive,
        hasStoredCookie: account.cookieStatus.hasStoredCookie,
        hasSecure1PSID: account.cookieStatus.hasSecure1PSID,
        hasSecure1PSIDTS: account.cookieStatus.hasSecure1PSIDTS,
        cookieSource: account.cookieStatus.source,
        lastRefreshStatus: runtime?.lastRefreshStatus ?? 'idle',
        lastRefreshAt: runtime?.lastRefreshAt ?? null,
        lastRefreshBrowser: runtime?.lastRefreshBrowser,
        updatedPrimary: runtime?.updatedPrimary,
        updatedFallback: runtime?.updatedFallback,
        lastError: runtime?.lastError
      };
    });

    accounts.sort((a, b) => {
      if (Number(b.isActive) !== Number(a.isActive)) return Number(b.isActive) - Number(a.isActive);
      const timeA = a.lastRefreshAt ?? 0;
      const timeB = b.lastRefreshAt ?? 0;
      if (timeA !== timeB) return timeB - timeA;
      return a.accountName.localeCompare(b.accountName);
    });

    return {
      summary: {
        totalAccounts: accounts.length,
        activeAccounts: accounts.filter((item) => item.isActive).length,
        refreshSuccessCount: accounts.filter((item) => item.lastRefreshStatus === 'success').length,
        refreshFailCount: accounts.filter((item) => item.lastRefreshStatus === 'failed').length,
        refreshRunningCount: accounts.filter((item) => item.lastRefreshStatus === 'running').length,
        cookieReadyCount: accounts.filter((item) => item.hasSecure1PSID && item.hasSecure1PSIDTS).length
      },
      accounts
    };
  }

  getLogs(limit = 200): GeminiWebApiLogEntry[] {
    const normalizedLimit = Math.max(1, Math.min(limit, MAX_LOG_ENTRIES));
    return this.logs.slice(0, normalizedLimit);
  }

  clearLogs(): void {
    this.logs.length = 0;
  }

  private getOrCreateAccountRuntime(accountConfigId?: string): AccountRuntimeState {
    const normalizedId = accountConfigId?.trim() || '';
    const existing = this.accountStateById.get(normalizedId);
    if (existing) {
      if (!existing.accountName && normalizedId) {
        existing.accountName = this.resolveAccountName(normalizedId);
      }
      return existing;
    }

    const created: AccountRuntimeState = {
      accountConfigId: normalizedId,
      accountName: normalizedId ? this.resolveAccountName(normalizedId) : undefined,
      lastRefreshStatus: 'idle',
      lastRefreshAt: null
    };
    this.accountStateById.set(normalizedId, created);
    return created;
  }

  private resolveAccountName(accountConfigId: string): string | undefined {
    try {
      const db = getDatabase();
      const row = db
        .prepare('SELECT name FROM gemini_chat_config WHERE id = ? LIMIT 1')
        .get(accountConfigId) as { name?: string | null } | undefined;
      return row?.name?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private appendLog(input: AppendLogInput): void {
    const entry: GeminiWebApiLogEntry = {
      seq: ++this.seq,
      timestamp: Date.now(),
      level: input.level,
      type: input.type,
      message: input.message,
      accountConfigId: input.accountConfigId,
      accountName: input.accountName,
      sourceBrowser: input.sourceBrowser,
      errorCode: input.errorCode,
      error: input.error,
      metadata: input.metadata
    };
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.length = MAX_LOG_ENTRIES;
    }
  }
}

let monitorInstance: GeminiWebApiOpsMonitor | null = null;

export function getGeminiWebApiOpsMonitor(): GeminiWebApiOpsMonitor {
  if (!monitorInstance) {
    monitorInstance = new GeminiWebApiOpsMonitor();
  }
  return monitorInstance;
}
