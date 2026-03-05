import { checkPythonModuleAvailability } from '../../utils/pythonRuntime';
import { GeminiWebApiCookieStore, maskSecret, parseGeminiCookieTokens } from './cookieStore';
import { GeminiWebApiPythonBridge } from './pythonBridge';
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
}

export class GeminiWebApiService {
  private readonly cookieStore = new GeminiWebApiCookieStore();
  private readonly bridge = new GeminiWebApiPythonBridge();
  private readonly conversationMetadataByKey = new Map<string, GeminiConversationMetadata>();

  async healthCheck(): Promise<GeminiWebApiHealth> {
    const moduleCheck = await checkPythonModuleAvailability(['gemini_webapi', 'browser_cookie3'], {
      preferredVersion: '3.12',
    });

    const cookieStatus = await this.getCookieStatus();

    if (!moduleCheck.success || !moduleCheck.runtime) {
      return {
        pythonOk: false,
        modulesOk: false,
        cookieReady: cookieStatus.hasSecure1PSID && cookieStatus.hasSecure1PSIDTS,
        details: {
          error: moduleCheck.error,
          modules: moduleCheck.modules,
        },
      };
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

    return {
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
      return {
        success: false,
        cookieSource: 'none',
        updatedPrimary: false,
        updatedFallback: false,
        warnings: [],
        errorCode: classified.errorCode,
        error: classified.error,
      };
    }

    if (!response.success || !response.data?.cookie) {
      return {
        success: false,
        cookieSource: 'none',
        updatedPrimary: false,
        updatedFallback: false,
        warnings: [],
        errorCode: response.errorCode || 'COOKIE_NOT_FOUND',
        error: response.error || 'No cookie returned by browser refresh',
      };
    }

    const parsed = parseGeminiCookieTokens(response.data.cookie);
    if (!parsed.secure1psid || !parsed.secure1psidts) {
      return {
        success: false,
        cookieSource: 'none',
        sourceBrowser: response.data.sourceBrowser,
        updatedPrimary: false,
        updatedFallback: false,
        warnings: [],
        errorCode: 'COOKIE_INVALID',
        error: 'Refreshed cookie is missing __Secure-1PSID or __Secure-1PSIDTS',
      };
    }

    const persist = this.cookieStore.persistRefreshedCookie(
      response.data.cookie,
      response.data.sourceBrowser,
      options.accountConfigId
    );
    const cookieSource = this.cookieStore.getCookieSourceAfterRefresh(persist.updatedPrimary, persist.updatedFallback);

    if (!persist.updatedPrimary && !persist.updatedFallback) {
      return {
        success: false,
        cookieSource,
        sourceBrowser: response.data.sourceBrowser,
        updatedPrimary: false,
        updatedFallback: false,
        warnings: persist.warnings,
        errorCode: 'COOKIE_INVALID',
        error: 'Cookie refreshed but failed to persist in both primary and fallback stores',
      };
    }

    console.log(
      `[GeminiWebApiService] Refreshed cookie (${response.data.sourceBrowser}) 1PSID=${maskSecret(parsed.secure1psid)} 1PSIDTS=${maskSecret(parsed.secure1psidts)}`,
    );

    return {
      success: true,
      cookieSource,
      sourceBrowser: response.data.sourceBrowser,
      updatedPrimary: persist.updatedPrimary,
      updatedFallback: persist.updatedFallback,
      warnings: persist.warnings,
    };
  }

  async generateContent(request: GeminiGenerateRequest): Promise<GeminiGenerateResult> {
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
    const conversationStoreKey = this.buildConversationStoreKey(request);
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

    let resolved = this.cookieStore.resolveStoredCookie(request.accountConfigId);
    let secure1psid = resolved.secure1psid || null;
    let secure1psidts = resolved.secure1psidts || null;
    let refreshed = false;

    if (request.forceCookieRefresh || !secure1psid || !secure1psidts) {
      const refresh = await this.refreshCookieFromBrowser({
        browserPriority: request.browserPriority,
        accountConfigId: request.accountConfigId,
      });

      if (!refresh.success) {
        return {
          success: false,
          errorCode: refresh.errorCode || 'COOKIE_NOT_FOUND',
          error: refresh.error || 'Unable to refresh browser cookie',
          cookieSource: refresh.cookieSource,
          refreshed: false,
        };
      }

      refreshed = true;
      resolved = this.cookieStore.resolveStoredCookie(request.accountConfigId);
      secure1psid = resolved.secure1psid || null;
      secure1psidts = resolved.secure1psidts || null;
    }

    if (!secure1psid || !secure1psidts) {
      return {
        success: false,
        errorCode: 'COOKIE_INVALID',
        error: 'Cookie is missing __Secure-1PSID or __Secure-1PSIDTS',
        cookieSource: resolved.source,
        refreshed,
      };
    }

    let response;
    try {
      response = await this.bridge.request<WorkerGeneratePayload>(
        'generate',
        {
          prompt,
          secure1psid,
          secure1psidts,
          proxy: request.proxy ?? null,
          timeoutMs,
          temporary: !!request.temporary,
          useChatSession,
          conversationMetadata: inputConversationMetadata,
        },
        timeoutMs,
      );
    } catch (error) {
      const classified = this.classifyBridgeError(error);
      return {
        success: false,
        errorCode: classified.errorCode,
        error: classified.error,
        cookieSource: resolved.source,
        refreshed,
      };
    }

    if (!response.success) {
      return {
        success: false,
        errorCode: response.errorCode || 'GEMINI_REQUEST_FAILED',
        error: response.error || 'Gemini request failed',
        cookieSource: resolved.source,
        refreshed,
      };
    }

    const outputConversationMetadata = this.toConversationMetadata(response.data?.conversationMetadata);
    if (conversationStoreKey && outputConversationMetadata && useChatSession) {
      this.conversationMetadataByKey.set(conversationStoreKey, outputConversationMetadata);
    }

    return {
      success: true,
      text: response.data?.text || '',
      cookieSource: resolved.source,
      refreshed,
      conversationKey: request.conversationKey,
      conversationMetadata: outputConversationMetadata,
      conversationContinued,
    };
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

  private buildConversationStoreKey(request: GeminiGenerateRequest): string | null {
    const conversationKey = request.conversationKey?.trim();
    if (!conversationKey) {
      return null;
    }
    const accountConfigId = request.accountConfigId?.trim() || 'default';
    return `${accountConfigId}::${conversationKey}`;
  }

  private toConversationMetadata(value: unknown): GeminiConversationMetadata | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as GeminiConversationMetadata;
  }
}
