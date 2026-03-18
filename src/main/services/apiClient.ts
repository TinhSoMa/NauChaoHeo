import { ProxyConfig } from '../../shared/types/proxy';
import { getProxyManager } from './proxy/proxyManager';

/**
 * API Client với proxy support
 * Wrapper cho fetch/axios để tự động sử dụng proxy rotation
 */

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  useProxy?: boolean; // Tùy chọn bật/tắt proxy cho request này
  proxyScope?: 'caption' | 'story' | 'chat' | 'tts' | 'other';
}

interface RequestResult {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
}

/**
 * Make HTTP request với proxy support và auto-retry
 */
export async function makeRequestWithProxy(
  url: string,
  options: RequestOptions = {},
  maxRetries: number = 3
): Promise<RequestResult> {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = 150000, // Tăng lên 15s (proxy chậm hơn direct)
    useProxy: useProxyOverride,
    proxyScope = 'other',
  } = options;

  const proxyManager = getProxyManager();
  const proxyContext = proxyManager.getProxyContext(proxyScope);
  const useProxySetting = proxyContext.mode !== 'off';
  const useProxy = typeof useProxyOverride === 'boolean' ? useProxyOverride : useProxySetting;
  let lastError: string = '';
  let currentProxy: ProxyConfig | null = null;

  // Retry loop
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Lấy proxy nếu enabled
      if (useProxy) {
        currentProxy = proxyManager.getNextProxy(undefined, proxyScope);
      }

      console.log(`[ApiClient] Request ${method} ${url} scope=${proxyScope} (Attempt ${attempt + 1}/${maxRetries})${currentProxy ? ` via ${currentProxy.host}:${currentProxy.port}` : ' (direct)'}`);

      const result = await makeRequest(url, {
        method,
        headers,
        body,
        timeout,
        proxy: currentProxy,
      });

      // Thành công
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
      
      // Đánh dấu proxy thất bại
      if (currentProxy) {
        proxyManager.markProxyFailed(currentProxy.id, lastError);
      }

      console.warn(`[ApiClient] ❌ Attempt ${attempt + 1} failed:`, lastError);

      // Retry với proxy khác
      if (attempt < maxRetries - 1) {
        console.log(`[ApiClient] 🔄 Retry với proxy khác...`);
        await sleep(500); // Giảm delay xuống 500ms để fail faster
        continue;
      }
    }
  }

  // Hết retry, thử fallback về direct connection
  if (useProxy && proxyManager.shouldFallbackToDirect()) {
    console.log('[ApiClient] 🔄 Fallback về direct connection...');
    try {
      const result = await makeRequest(url, {
        method,
        headers,
        body,
        timeout,
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

  // Tất cả đều thất bại
  return {
    success: false,
    error: `Request failed after ${maxRetries} retries: ${lastError}`,
  };
}

/**
 * Core request function với proxy agent
 */
async function makeRequest(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: any;
    timeout: number;
    proxy: ProxyConfig | null;
  }
): Promise<{ data: any; statusCode: number }> {
  const { default: fetch } = await import('node-fetch');
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const { SocksProxyAgent } = await import('socks-proxy-agent');
  const AbortController = globalThis.AbortController || (await import('abort-controller')).AbortController;

  let agent: any = undefined;

  // Tạo proxy agent nếu có proxy
  if (options.proxy) {
    const p = options.proxy;
    const proxyUrl = p.username
      ? `${p.type}://${p.username}:${p.password}@${p.host}:${p.port}`
      : `${p.type}://${p.host}:${p.port}`;

    if (p.type === 'socks5') {
      agent = new SocksProxyAgent(proxyUrl, {
        timeout: options.timeout,
      });
    } else {
      // HttpsProxyAgent options
      agent = new HttpsProxyAgent(proxyUrl, {
        timeout: options.timeout,
        rejectUnauthorized: false, // Allow self-signed certs from proxy
        keepAlive: false, // Don't keep connections alive
      });
    }
  }

  // Setup AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);

  try {
    // Prepare request
    const fetchOptions: any = {
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
    };

    if (agent) {
      fetchOptions.agent = agent;
    }

    if (options.body) {
      if (typeof options.body === 'string') {
        fetchOptions.body = options.body;
      } else {
        fetchOptions.body = JSON.stringify(options.body);
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    // Make request
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse response
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
    // Handle timeout
    if (error.name === 'AbortError') {
      throw new Error(`network timeout at: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper sleep function
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Axios-style wrapper (nếu cần tương thích với code cũ)
 */
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
