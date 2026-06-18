import { ProxyAgent } from 'undici';
import { ProxyConfig } from '../../shared/types/proxy';
import { getProxyManager } from './proxy/proxyManager';

export class GeminiHttpError extends Error {
  constructor(
    public httpStatus: number,
    public errorStatus: string,
    public errorMessage: string,
  ) {
    super(`HTTP ${httpStatus}: ${errorStatus} — ${errorMessage}`);
    this.name = 'GeminiHttpError';
  }
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  signal?: AbortSignal;
  useProxy?: boolean;
  proxyScope?: 'caption' | 'story' | 'chat' | 'tts' | 'other';
}

interface RequestResult {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
  retryAfter?: number;
}

function buildDispatcher(proxy: ProxyConfig | null): { dispatcher?: ProxyAgent } {
  if (!proxy) return {};
  const proxyUrl = proxy.username
    ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
    : `${proxy.type}://${proxy.host}:${proxy.port}`;
  return { dispatcher: new ProxyAgent(proxyUrl) };
}

export async function makeRequestWithProxy(
  url: string,
  options: RequestOptions = {},
  maxRetries: number = 3
): Promise<RequestResult> {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = 150000,
    signal,
    useProxy: useProxyOverride,
    proxyScope = 'other',
  } = options;

  const proxyManager = getProxyManager();
  const proxyContext = proxyManager.getProxyContext(proxyScope);
  const useProxySetting = proxyContext.mode !== 'off';
  const useProxy = typeof useProxyOverride === 'boolean' ? useProxyOverride : useProxySetting;
  let lastError: string = '';
  let currentProxy: ProxyConfig | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (useProxy) {
        currentProxy = proxyManager.getNextProxy(undefined, proxyScope);
      }

      console.log(`[ApiClient] Request ${method} ${url} scope=${proxyScope} (Attempt ${attempt + 1}/${maxRetries})${currentProxy ? ` via ${currentProxy.host}:${currentProxy.port}` : ' (direct)'}`);

      const result = await makeRequest(url, {
        method,
        headers,
        body,
        timeout,
        signal,
        proxy: currentProxy,
      });

      if (currentProxy) {
        proxyManager.markProxySuccess(currentProxy.id);
      }

      return {
        success: true,
        data: result.data,
        statusCode: result.statusCode,
      };

    } catch (error: any) {
      lastError = error.message || String(error);
      const retryAfter = error.retryAfter as number | undefined;

      if (lastError === 'REQUEST_ABORTED') {
        return {
          success: false,
          error: 'REQUEST_ABORTED',
        };
      }

      if (currentProxy) {
        proxyManager.markProxyFailed(currentProxy.id, lastError);
      }

      console.warn(`[ApiClient] ❌ Attempt ${attempt + 1} failed:`, lastError);

      if (attempt < maxRetries - 1) {
        const label = useProxy ? 'proxy khác' : 'direct';
        console.log(`[ApiClient] 🔄 Retry với ${label}...`);
        const delay = retryAfter && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : Math.min(1000 * Math.pow(2, attempt), 30_000);
        await sleep(delay);
        continue;
      }
    }
  }

  if (lastError === 'REQUEST_ABORTED') {
    return {
      success: false,
      error: 'REQUEST_ABORTED',
    };
  }

  if (useProxy && proxyManager.shouldFallbackToDirect()) {
    console.log('[ApiClient] 🔄 Fallback về direct connection...');
    try {
      const result = await makeRequest(url, {
        method,
        headers,
        body,
        timeout,
        signal,
        proxy: null,
      });

      console.log('[ApiClient] ✅ Direct connection thành công');

      return {
        success: true,
        data: result.data,
        statusCode: result.statusCode,
      };
    } catch (error: any) {
      lastError = error.message || String(error);
      console.error('[ApiClient] ❌ Direct connection cũng thất bại:', lastError);
    }
  }

  return {
    success: false,
    error: `Request failed after ${maxRetries} retries: ${lastError}`,
  };
}

async function makeRequest(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: any;
    timeout: number;
    signal?: AbortSignal;
    proxy: ProxyConfig | null;
  }
): Promise<{ data: any; statusCode: number }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeout);

  const forwardAbort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (options.signal?.aborted) {
    forwardAbort();
  } else if (options.signal) {
    options.signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const fetchOptions: any = {
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
      ...buildDispatcher(options.proxy),
    };

    if (options.body) {
      if (typeof options.body === 'string') {
        fetchOptions.body = options.body;
      } else {
        fetchOptions.body = JSON.stringify(options.body);
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      let errorStatus = '';
      let errorMessage = '';
      let retryAfter: number | undefined;
      try {
        const errorBody = await response.json();
        errorStatus = errorBody?.error?.status || '';
        errorMessage = errorBody?.error?.message || response.statusText;
      } catch {
        errorMessage = response.statusText;
      }
      const retryAfterHeader = response.headers.get('retry-after');
      if (retryAfterHeader) {
        retryAfter = parseInt(retryAfterHeader, 10);
        if (isNaN(retryAfter)) retryAfter = undefined;
      }
      const error = new GeminiHttpError(response.status, errorStatus, errorMessage);
      (error as any).retryAfter = retryAfter;
      throw error;
    }

    const contentType = response.headers.get('content-type');
    let data: any;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      data,
      statusCode: response.status,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      if (options.signal?.aborted && !timedOut) {
        throw new Error('REQUEST_ABORTED');
      }
      throw new Error(`network timeout at: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (options.signal) {
      options.signal.removeEventListener('abort', forwardAbort);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const proxyClient = {
  get: (url: string, config?: RequestOptions) =>
    makeRequestWithProxy(url, { ...config, method: 'GET' }),

  post: (url: string, data?: any, config?: RequestOptions) =>
    makeRequestWithProxy(url, { ...config, method: 'POST', body: data }),

  put: (url: string, data?: any, config?: RequestOptions) =>
    makeRequestWithProxy(url, { ...config, method: 'PUT', body: data }),

  delete: (url: string, config?: RequestOptions) =>
    makeRequestWithProxy(url, { ...config, method: 'DELETE' }),
};
