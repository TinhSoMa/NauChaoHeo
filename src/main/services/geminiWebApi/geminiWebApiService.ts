import { checkPythonModuleAvailability } from '../../utils/pythonRuntime';
import { GeminiWebApiCookieStore, maskSecret, parseGeminiCookieTokens } from './cookieStore';
import { GeminiWebApiPythonBridge } from './pythonBridge';
import { getGeminiWebApiOpsMonitor } from './opsMonitor';
import { AppSettingsService } from '../appSettings';
import { getProxyManager } from '../proxy/proxyManager';
import type { ProxyConfig } from '../../../shared/types/proxy';
import {
  GeminiConversationMetadata,
  GeminiCookieRefreshResult,
  GeminiCookieStatus,
  GeminiErrorCode,
  GeminiGenerateRequest,
  GeminiGenerateResult,
  GeminiWebApiHealth,
  GeminiBrowserType,
} from './types';

interface RefreshCookieOptions {
  browserPriority?: GeminiBrowserType[];
  timeoutMs?: number;
  accountConfigId?: string;
}

interface WorkerRefreshPayload {
  cookie: string;
  sourceBrowser: GeminiBrowserType;
}

interface WorkerGeneratePayload {
  text: string | null;
  conversationMetadata?: GeminiConversationMetadata | null;
  conversationMetadataReason?: string;
  conversationMetadataDebug?: Record<string, unknown> | null;
}

type ProxySelectionSource = 'disabled' | 'manual' | 'pool' | 'none';
type ProxyMode = 'direct' | 'proxy' | 'fallback_direct';
type ProxyAssignmentState = 'none' | 'reused' | 'assigned_new';

interface ProxySelectionResult {
  accountConfigId: string;
  useProxySetting: boolean;
  source: ProxySelectionSource;
  assignmentState: ProxyAssignmentState;
  proxyUrl: string | null;
  proxyConfig: ProxyConfig | null;
}

export class GeminiWebApiService {
  private readonly cookieStore = new GeminiWebApiCookieStore();
  private readonly bridge = new GeminiWebApiPythonBridge();
  private readonly conversationMetadataByKey = new Map<string, GeminiConversationMetadata>();
  private readonly proxyAssignmentByAccount = new Map<string, string>();

  async healthCheck(): Promise<GeminiWebApiHealth> {
    const moduleCheck = await checkPythonModuleAvailability(['gemini_webapi', 'browser_cookie3'], {
      preferredVersion: '3.12',
    });

    const cookieStatus = await this.getCookieStatus();

    if (!moduleCheck.success || !moduleCheck.runtime) {
      const failed = {
        pythonOk: false,
        modulesOk: false,
        cookieReady: cookieStatus.hasSecure1PSID && cookieStatus.hasSecure1PSIDTS,
        details: {
          error: moduleCheck.error,
          modules: moduleCheck.modules,
        },
      };
      getGeminiWebApiOpsMonitor().recordHealthCheck(failed);
      return failed;
    }

    let worker:
      | {
          success: true;
          data?: {
            pythonVersion?: string;
            modules?: Record<string, boolean>;
          };
          error?: string;
        }
      | { success: false; error?: string };
    try {
      const result = await this.bridge.request<{
        pythonVersion?: string;
        modules?: Record<string, boolean>;
      }>('health', {}, 30000);
      worker = result.success
        ? { success: true, data: result.data, error: result.error }
        : { success: false, error: result.error };
    } catch (error) {
      worker = { success: false, error: String(error) };
    }

    const health = {
      pythonOk: true,
      modulesOk: !!worker.success,
      cookieReady: cookieStatus.hasSecure1PSID && cookieStatus.hasSecure1PSIDTS,
      details: {
        runtimeMode: moduleCheck.runtime.mode,
        pythonPath: moduleCheck.runtime.pythonPath,
        pythonVersion: worker.success ? worker.data?.pythonVersion : undefined,
        modules: worker.success ? worker.data?.modules : moduleCheck.modules,
        error: worker.success ? undefined : worker.error || 'Worker health check failed',
      },
    };
    getGeminiWebApiOpsMonitor().recordHealthCheck(health);
    return health;
  }

  async getCookieStatus(accountConfigId?: string): Promise<GeminiCookieStatus> {
    const resolved = this.cookieStore.resolveStoredCookie(accountConfigId);

    return {
      hasStoredCookie: !!(resolved.cookie || resolved.secure1psid || resolved.secure1psidts),
      hasSecure1PSID: !!resolved.secure1psid,
      hasSecure1PSIDTS: !!resolved.secure1psidts,
      source: resolved.source,
    };
  }

  async refreshCookieFromBrowser(options: RefreshCookieOptions = {}): Promise<GeminiCookieRefreshResult> {
    const timeoutMs = options.timeoutMs ?? 30000;
    getGeminiWebApiOpsMonitor().recordCookieRefreshStarted(options.accountConfigId);

    let response;
    try {
      response = await this.bridge.request<WorkerRefreshPayload>(
        'refresh_cookie',
        {
          browserPriority: options.browserPriority ?? ['chrome', 'edge'],
        },
        timeoutMs,
      );
    } catch (error) {
      const classified = this.classifyBridgeError(error);
      const failed: GeminiCookieRefreshResult = {
        success: false,
        cookieSource: 'none',
        updatedPrimary: false,
        updatedFallback: false,
        warnings: [],
        errorCode: classified.errorCode,
        error: classified.error,
      };
      getGeminiWebApiOpsMonitor().recordCookieRefreshResult(options.accountConfigId, failed);
      return failed;
    }

    if (!response.success || !response.data?.cookie) {
      const failed: GeminiCookieRefreshResult = {
        success: false,
        cookieSource: 'none',
        updatedPrimary: false,
        updatedFallback: false,
        warnings: [],
        errorCode: this.normalizeGeminiErrorCode(response.errorCode, 'COOKIE_NOT_FOUND'),
        error: response.error || 'No cookie returned by browser refresh',
      };
      getGeminiWebApiOpsMonitor().recordCookieRefreshResult(options.accountConfigId, failed);
      return failed;
    }

    const parsed = parseGeminiCookieTokens(response.data.cookie);
    if (!parsed.secure1psid || !parsed.secure1psidts) {
      const failed: GeminiCookieRefreshResult = {
        success: false,
        cookieSource: 'none',
        sourceBrowser: response.data.sourceBrowser,
        updatedPrimary: false,
        updatedFallback: false,
        warnings: [],
        errorCode: 'COOKIE_INVALID',
        error: 'Refreshed cookie is missing __Secure-1PSID or __Secure-1PSIDTS',
      };
      getGeminiWebApiOpsMonitor().recordCookieRefreshResult(options.accountConfigId, failed);
      return failed;
    }

    const persist = this.cookieStore.persistRefreshedCookie(
      response.data.cookie,
      response.data.sourceBrowser,
      options.accountConfigId
    );
    const cookieSource = this.cookieStore.getCookieSourceAfterRefresh(persist.updatedPrimary, persist.updatedFallback);

    if (!persist.updatedPrimary && !persist.updatedFallback) {
      const failed: GeminiCookieRefreshResult = {
        success: false,
        cookieSource,
        sourceBrowser: response.data.sourceBrowser,
        updatedPrimary: false,
        updatedFallback: false,
        warnings: persist.warnings,
        errorCode: 'COOKIE_INVALID',
        error: 'Cookie refreshed but failed to persist in both primary and fallback stores',
      };
      getGeminiWebApiOpsMonitor().recordCookieRefreshResult(options.accountConfigId, failed);
      return failed;
    }

    console.log(
      `[GeminiWebApiService] Refreshed cookie (${response.data.sourceBrowser}) 1PSID=${maskSecret(parsed.secure1psid)} 1PSIDTS=${maskSecret(parsed.secure1psidts)}`,
    );

    const successResult: GeminiCookieRefreshResult = {
      success: true,
      cookieSource,
      sourceBrowser: response.data.sourceBrowser,
      updatedPrimary: persist.updatedPrimary,
      updatedFallback: persist.updatedFallback,
      warnings: persist.warnings,
    };
    getGeminiWebApiOpsMonitor().recordCookieRefreshResult(options.accountConfigId, successResult);
    return successResult;
  }

  async generateContent(request: GeminiGenerateRequest): Promise<GeminiGenerateResult> {
    const accountConfigId = (request.accountConfigId || '').trim();
    if (!accountConfigId) {
      return {
        success: false,
        errorCode: 'GEMINI_REQUEST_FAILED',
        error: 'accountConfigId is required',
        cookieSource: 'none',
        refreshed: false,
      };
    }

    const prompt = (request.prompt || '').trim();
    if (!prompt) {
      return {
        success: false,
        errorCode: 'GEMINI_REQUEST_FAILED',
        error: 'Prompt is required',
        cookieSource: 'none',
        refreshed: false,
      };
    }

    const timeoutMs = request.timeoutMs ?? 90000;
    const conversationStoreKey = this.buildConversationStoreKey({
      accountConfigId,
      conversationKey: request.conversationKey,
    });
    let inputConversationMetadata = this.toConversationMetadata(request.conversationMetadata);
    const useChatSession = request.useChatSession || !!conversationStoreKey || !!inputConversationMetadata;
    if (conversationStoreKey && request.resetConversation) {
      this.conversationMetadataByKey.delete(conversationStoreKey);
      if (!request.conversationMetadata) {
        inputConversationMetadata = null;
      }
    }

    let conversationContinued = !!inputConversationMetadata;
    if (!inputConversationMetadata && conversationStoreKey) {
      inputConversationMetadata = this.conversationMetadataByKey.get(conversationStoreKey) || null;
      conversationContinued = !!inputConversationMetadata;
    }

    let resolved = this.cookieStore.resolveStoredCookie(accountConfigId);
    let secure1psid = resolved.secure1psid || null;
    let secure1psidts = resolved.secure1psidts || null;
    let refreshed = false;

    if (request.forceCookieRefresh || !secure1psid || !secure1psidts) {
      const refresh = await this.refreshCookieFromBrowser({
        browserPriority: request.browserPriority,
        accountConfigId,
      });

      if (!refresh.success) {
        const reResolved = this.cookieStore.resolveStoredCookie(accountConfigId);
        if (reResolved.secure1psid && reResolved.secure1psidts) {
          resolved = reResolved;
          secure1psid = reResolved.secure1psid;
          secure1psidts = reResolved.secure1psidts;
          console.warn(
            `[GeminiWebApiService] Cookie refresh failed but stored cookie is now available accountConfigId=${accountConfigId} source=${reResolved.source}`,
          );
        } else {
          const failed: GeminiGenerateResult = {
            success: false,
            errorCode: this.normalizeGeminiErrorCode(refresh.errorCode, 'COOKIE_NOT_FOUND'),
            error: refresh.error || 'Unable to refresh browser cookie',
            cookieSource: refresh.cookieSource,
            refreshed: false,
          };
          getGeminiWebApiOpsMonitor().recordRequestResult({
            success: false,
            accountConfigId,
            cookieSource: failed.cookieSource,
            refreshed: failed.refreshed,
            errorCode: failed.errorCode,
            error: failed.error
          });
          return failed;
        }
      }

      if (refresh.success) {
        refreshed = true;
        resolved = this.cookieStore.resolveStoredCookie(accountConfigId);
        secure1psid = resolved.secure1psid || null;
        secure1psidts = resolved.secure1psidts || null;
      }
    }

    if (!secure1psid || !secure1psidts) {
      const failed: GeminiGenerateResult = {
        success: false,
        errorCode: 'COOKIE_INVALID',
        error: 'Cookie is missing __Secure-1PSID or __Secure-1PSIDTS',
        cookieSource: resolved.source,
        refreshed,
      };
      getGeminiWebApiOpsMonitor().recordRequestResult({
        success: false,
        accountConfigId,
        cookieSource: failed.cookieSource,
        refreshed: failed.refreshed,
        errorCode: failed.errorCode,
        error: failed.error
      });
      return failed;
    }

    const proxySelection = this.selectProxyForRequest(accountConfigId, request);
    let proxyMode: ProxyMode = proxySelection.proxyUrl ? 'proxy' : 'direct';
    let fallbackUsed = false;
    if (proxySelection.source === 'manual' && proxySelection.proxyUrl) {
      console.log(
        `[GeminiWebApiService] Proxy route mode=manual accountConfigId=${accountConfigId} endpoint=${this.maskProxyForLog(proxySelection.proxyUrl)}`
      );
    } else if (proxySelection.source === 'pool' && proxySelection.proxyConfig) {
      console.log(
        `[GeminiWebApiService] Proxy route mode=pool accountConfigId=${accountConfigId} assignment=${proxySelection.assignmentState} proxyId=${proxySelection.proxyConfig.id} endpoint=${proxySelection.proxyConfig.host}:${proxySelection.proxyConfig.port}`
      );
    } else if (proxySelection.useProxySetting && proxySelection.source === 'none') {
      console.warn(
        `[GeminiWebApiService] Proxy enabled but no available proxy accountConfigId=${accountConfigId}. Falling back to direct request.`
      );
    }

    const buildProxyTraceMetadata = (mode: ProxyMode, fallback: boolean) =>
      this.buildProxyTraceMetadata(proxySelection, mode, fallback);
    const bridgeTimeoutMs = Math.max(timeoutMs + 5000, Math.floor(timeoutMs * 1.1));
    const invokeGenerate = async (proxyUrl: string | null) =>
      this.bridge.request<WorkerGeneratePayload>(
        'generate',
        {
          prompt,
          secure1psid,
          secure1psidts,
          proxy: proxyUrl,
          timeoutMs,
          temporary: !!request.temporary,
          useChatSession,
          conversationMetadata: inputConversationMetadata,
        },
        bridgeTimeoutMs,
      );

    let response;
    if (proxySelection.proxyUrl) {
      try {
        response = await invokeGenerate(proxySelection.proxyUrl);
      } catch (error) {
        const classified = this.classifyBridgeError(error);
        const shouldFallback = this.shouldFallbackToDirect(classified.errorCode);
        if (shouldFallback) {
          this.markProxyFailed(proxySelection, classified.error);
        }
        if (!shouldFallback) {
          const failed: GeminiGenerateResult = {
            success: false,
            errorCode: classified.errorCode,
            error: classified.error,
            cookieSource: resolved.source,
            refreshed,
          };
          getGeminiWebApiOpsMonitor().recordRequestResult({
            success: false,
            accountConfigId,
            cookieSource: failed.cookieSource,
            refreshed: failed.refreshed,
            errorCode: failed.errorCode,
            error: failed.error,
            metadata: buildProxyTraceMetadata(proxyMode, fallbackUsed),
          });
          return failed;
        }

        fallbackUsed = true;
        proxyMode = 'fallback_direct';
        console.warn(
          `[GeminiWebApiService] Proxy request failed accountConfigId=${accountConfigId}. Retry direct once. errorCode=${classified.errorCode}`
        );
        try {
          response = await invokeGenerate(null);
        } catch (directError) {
          const classifiedDirect = this.classifyBridgeError(directError);
          const failed: GeminiGenerateResult = {
            success: false,
            errorCode: classifiedDirect.errorCode,
            error: classifiedDirect.error,
            cookieSource: resolved.source,
            refreshed,
          };
          getGeminiWebApiOpsMonitor().recordRequestResult({
            success: false,
            accountConfigId,
            cookieSource: failed.cookieSource,
            refreshed: failed.refreshed,
            errorCode: failed.errorCode,
            error: failed.error,
            metadata: buildProxyTraceMetadata(proxyMode, fallbackUsed),
          });
          return failed;
        }
      }

      if (response && !response.success) {
        const normalizedErrorCode = this.normalizeGeminiErrorCode(response.errorCode, 'GEMINI_REQUEST_FAILED');
        if (this.shouldFallbackToDirect(normalizedErrorCode)) {
          this.markProxyFailed(proxySelection, response.error || 'Gemini request failed via proxy');
          fallbackUsed = true;
          proxyMode = 'fallback_direct';
          console.warn(
            `[GeminiWebApiService] Proxy response failed accountConfigId=${accountConfigId}. Retry direct once. errorCode=${normalizedErrorCode}`
          );
          try {
            response = await invokeGenerate(null);
          } catch (directError) {
            const classifiedDirect = this.classifyBridgeError(directError);
            const failed: GeminiGenerateResult = {
              success: false,
              errorCode: classifiedDirect.errorCode,
              error: classifiedDirect.error,
              cookieSource: resolved.source,
              refreshed,
            };
            getGeminiWebApiOpsMonitor().recordRequestResult({
              success: false,
              accountConfigId,
              cookieSource: failed.cookieSource,
              refreshed: failed.refreshed,
              errorCode: failed.errorCode,
              error: failed.error,
              metadata: buildProxyTraceMetadata(proxyMode, fallbackUsed),
            });
            return failed;
          }
        }
      } else if (response?.success) {
        this.markProxySuccess(proxySelection);
      }
    } else {
      try {
        response = await invokeGenerate(null);
      } catch (error) {
        const classified = this.classifyBridgeError(error);
        const failed: GeminiGenerateResult = {
          success: false,
          errorCode: classified.errorCode,
          error: classified.error,
          cookieSource: resolved.source,
          refreshed,
        };
        getGeminiWebApiOpsMonitor().recordRequestResult({
          success: false,
          accountConfigId,
          cookieSource: failed.cookieSource,
          refreshed: failed.refreshed,
          errorCode: failed.errorCode,
          error: failed.error,
          metadata: buildProxyTraceMetadata(proxyMode, fallbackUsed),
        });
        return failed;
      }
    }

    if (!response.success) {
      const failed: GeminiGenerateResult = {
        success: false,
        errorCode: this.normalizeGeminiErrorCode(response.errorCode, 'GEMINI_REQUEST_FAILED'),
        error: response.error || 'Gemini request failed',
        cookieSource: resolved.source,
        refreshed,
      };
      getGeminiWebApiOpsMonitor().recordRequestResult({
        success: false,
        accountConfigId,
        cookieSource: failed.cookieSource,
        refreshed: failed.refreshed,
        errorCode: failed.errorCode,
        error: failed.error,
        metadata: buildProxyTraceMetadata(proxyMode, fallbackUsed),
      });
      return failed;
    }

    const outputConversationMetadata = this.toConversationMetadata(response.data?.conversationMetadata);
    const conversationMetadataReason = response.data?.conversationMetadataReason;
    const conversationMetadataDebug = response.data?.conversationMetadataDebug || null;
    if (conversationStoreKey && outputConversationMetadata && useChatSession) {
      this.conversationMetadataByKey.set(conversationStoreKey, outputConversationMetadata);
    }

    if (useChatSession) {
      const conversationState = conversationContinued ? 'reused' : 'created_new';
      const conversationTraceId = this.extractConversationTraceId(outputConversationMetadata || inputConversationMetadata);
      console.log(
        `[GeminiWebApiService] Chat session accountConfigId=${accountConfigId} state=${conversationState} conversationId=${conversationTraceId} key=${request.conversationKey || '(none)'}`
      );
      if (!outputConversationMetadata) {
        console.warn(
          `[GeminiWebApiService] Missing conversation metadata accountConfigId=${accountConfigId} key=${request.conversationKey || '(none)'} reason=${conversationMetadataReason || 'unknown'} textLen=${(response.data?.text || '').length} debug=${JSON.stringify(conversationMetadataDebug || {})}`
        );
      }
    }

    const successResult: GeminiGenerateResult = {
      success: true,
      text: response.data?.text || '',
      cookieSource: resolved.source,
      refreshed,
      conversationKey: request.conversationKey,
      conversationMetadata: outputConversationMetadata,
      conversationMetadataReason,
      conversationMetadataDebug,
      conversationContinued,
    };
    getGeminiWebApiOpsMonitor().recordRequestResult({
      success: true,
      accountConfigId,
      cookieSource: successResult.cookieSource,
      refreshed: successResult.refreshed,
      metadata: {
        conversationKey: request.conversationKey || null,
        conversationContinued,
        conversationTraceId: this.extractConversationTraceId(outputConversationMetadata || inputConversationMetadata),
        conversationMetadataReason: conversationMetadataReason || null,
        conversationMetadataDebug: conversationMetadataDebug || null,
        responseTextLength: (successResult.text || '').length,
        ...buildProxyTraceMetadata(proxyMode, fallbackUsed),
      },
    });
    return successResult;
  }

  async shutdown(): Promise<void> {
    await this.bridge.shutdown();
  }

  private classifyBridgeError(error: unknown): { errorCode: GeminiErrorCode; error: string } {
    const text = String(error || 'Unknown error');

    if (text.includes('PYTHON_MODULE_MISSING')) {
      return { errorCode: 'PYTHON_MODULE_MISSING', error: text };
    }
    if (text.includes('PYTHON_RUNTIME_MISSING')) {
      return { errorCode: 'PYTHON_RUNTIME_MISSING', error: text };
    }
    if (text.toLowerCase().includes('timeout')) {
      return { errorCode: 'GEMINI_TIMEOUT', error: text };
    }

    return { errorCode: 'GEMINI_REQUEST_FAILED', error: text };
  }

  private normalizeGeminiErrorCode(
    value: string | undefined,
    fallback: GeminiErrorCode
  ): GeminiErrorCode {
    switch (value) {
      case 'PYTHON_RUNTIME_MISSING':
      case 'PYTHON_MODULE_MISSING':
      case 'COOKIE_NOT_FOUND':
      case 'COOKIE_INVALID':
      case 'GEMINI_REQUEST_FAILED':
      case 'GEMINI_TIMEOUT':
        return value;
      default:
        return fallback;
    }
  }

  private buildConversationStoreKey(request: {
    accountConfigId: string;
    conversationKey?: string;
  }): string | null {
    const conversationKey = request.conversationKey?.trim();
    if (!conversationKey) {
      return null;
    }
    const accountConfigId = request.accountConfigId.trim();
    if (!accountConfigId) {
      return null;
    }
    return `${accountConfigId}::${conversationKey}`;
  }

  private extractConversationTraceId(metadata: GeminiConversationMetadata | null): string {
    if (!metadata || typeof metadata !== 'object') {
      return 'unknown';
    }
    if (Array.isArray(metadata)) {
      for (const item of metadata) {
        if (!item || typeof item !== 'object') continue;
        const trace = this.extractConversationTraceId(item as GeminiConversationMetadata);
        if (trace !== 'unknown') return trace;
      }
      return 'unknown';
    }
    const candidates = [
      (metadata as Record<string, unknown>).conversationId,
      (metadata as Record<string, unknown>).conversation_id,
      (metadata as Record<string, unknown>).chatId,
      (metadata as Record<string, unknown>).chat_id,
      (metadata as Record<string, unknown>).id,
    ];
    const raw = candidates.find((item) => typeof item === 'string' && item.trim().length > 0);
    if (!raw || typeof raw !== 'string') {
      return 'unknown';
    }
    const trimmed = raw.trim();
    if (trimmed.length <= 12) {
      return trimmed;
    }
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }

  private toConversationMetadata(value: unknown): GeminiConversationMetadata | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    if (Array.isArray(value)) {
      return value;
    }
    return value as Record<string, unknown>;
  }

  private selectProxyForRequest(accountConfigId: string, request: GeminiGenerateRequest): ProxySelectionResult {
    const useProxySetting = this.readUseProxySetting();
    if (!useProxySetting) {
      return {
        accountConfigId,
        useProxySetting,
        source: 'disabled',
        assignmentState: 'none',
        proxyUrl: null,
        proxyConfig: null,
      };
    }

    const manualProxy = this.normalizeProxy(request.proxy);
    if (manualProxy) {
      return {
        accountConfigId,
        useProxySetting,
        source: 'manual',
        assignmentState: 'none',
        proxyUrl: manualProxy,
        proxyConfig: null,
      };
    }

    const reusedProxy = this.resolveAssignedProxy(accountConfigId);
    if (reusedProxy) {
      return {
        accountConfigId,
        useProxySetting,
        source: 'pool',
        assignmentState: 'reused',
        proxyUrl: this.toProxyUrl(reusedProxy),
        proxyConfig: reusedProxy,
      };
    }

    const proxyConfig = getProxyManager().getNextProxy();
    if (!proxyConfig) {
      return {
        accountConfigId,
        useProxySetting,
        source: 'none',
        assignmentState: 'none',
        proxyUrl: null,
        proxyConfig: null,
      };
    }

    this.proxyAssignmentByAccount.set(accountConfigId, proxyConfig.id);
    console.log(
      `[GeminiWebApiService] Proxy assigned accountConfigId=${accountConfigId} proxyId=${proxyConfig.id} endpoint=${proxyConfig.host}:${proxyConfig.port}`
    );

    return {
      accountConfigId,
      useProxySetting,
      source: 'pool',
      assignmentState: 'assigned_new',
      proxyUrl: this.toProxyUrl(proxyConfig),
      proxyConfig,
    };
  }

  private shouldFallbackToDirect(errorCode: GeminiErrorCode): boolean {
    return errorCode === 'GEMINI_TIMEOUT' || errorCode === 'GEMINI_REQUEST_FAILED';
  }

  private buildProxyTraceMetadata(
    selection: ProxySelectionResult,
    mode: ProxyMode,
    fallbackUsed: boolean
  ): Record<string, unknown> {
    return {
      useProxySetting: selection.useProxySetting,
      proxySource: selection.source,
      proxyAssignmentState: selection.assignmentState,
      proxyMode: mode,
      fallbackUsed,
      proxyId: selection.proxyConfig?.id || null,
      proxyEndpoint: selection.proxyConfig
        ? `${selection.proxyConfig.host}:${selection.proxyConfig.port}`
        : (selection.source === 'manual' ? selection.proxyUrl : null),
    };
  }

  private markProxySuccess(selection: ProxySelectionResult): void {
    if (selection.proxyConfig?.id) {
      getProxyManager().markProxySuccess(selection.proxyConfig.id);
    }
  }

  private markProxyFailed(selection: ProxySelectionResult, reason: string): void {
    if (selection.proxyConfig?.id) {
      getProxyManager().markProxyFailed(selection.proxyConfig.id, reason);
      this.clearProxyAssignment(selection.accountConfigId, selection.proxyConfig.id, reason);
    }
  }

  private resolveAssignedProxy(accountConfigId: string): ProxyConfig | null {
    const assignedProxyId = this.proxyAssignmentByAccount.get(accountConfigId);
    if (!assignedProxyId) {
      return null;
    }
    const proxy = getProxyManager()
      .getAllProxies()
      .find((item) => item.id === assignedProxyId && item.enabled);
    if (!proxy) {
      this.proxyAssignmentByAccount.delete(accountConfigId);
      return null;
    }
    return proxy;
  }

  private clearProxyAssignment(accountConfigId: string, proxyId: string, reason: string): void {
    const assigned = this.proxyAssignmentByAccount.get(accountConfigId);
    if (assigned !== proxyId) {
      return;
    }
    this.proxyAssignmentByAccount.delete(accountConfigId);
    console.warn(
      `[GeminiWebApiService] Proxy assignment cleared accountConfigId=${accountConfigId} proxyId=${proxyId} reason=${reason}`
    );
  }

  private readUseProxySetting(): boolean {
    try {
      return !!AppSettingsService.getAll().useProxy;
    } catch (error) {
      console.warn('[GeminiWebApiService] Could not read useProxy setting, defaulting to false.', error);
      return false;
    }
  }

  private normalizeProxy(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toProxyUrl(proxy: ProxyConfig): string {
    const scheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http';
    if (proxy.username) {
      const username = encodeURIComponent(proxy.username);
      const password = encodeURIComponent(proxy.password || '');
      return `${scheme}://${username}:${password}@${proxy.host}:${proxy.port}`;
    }
    return `${scheme}://${proxy.host}:${proxy.port}`;
  }

  private maskProxyForLog(proxyUrl: string): string {
    try {
      const parsed = new URL(proxyUrl);
      const host = parsed.hostname || 'unknown-host';
      const port = parsed.port ? `:${parsed.port}` : '';
      return `${parsed.protocol}//${host}${port}`;
    } catch {
      return proxyUrl;
    }
  }
}
