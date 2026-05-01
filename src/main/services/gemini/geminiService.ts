/**
 * Gemini Service - Gọi API Gemini
 * Xử lý việc gọi Gemini API với rotation keys tự động
 */

import { getApiManager } from './apiManager';
import { 
  GeminiResponse, 
  KeyInfo,
  GEMINI_API_BASE,
  GEMINI_MODELS,
  getGeminiModelInfo,
} from '../../../shared/types/gemini';
import { getGeminiModelsService } from './geminiModelsService';

// Re-export để các module khác có thể import từ đây
export { GEMINI_MODELS, getGeminiModelInfo };
export type GeminiModel = string;

type GeminiCallControlOptions = {
  shouldStop?: () => boolean;
  stopErrorMessage?: string;
  stopSignal?: AbortSignal;
};

function resolveModelForRuntime(model?: string | null): string {
  try {
    return getGeminiModelsService().resolveModelId(model);
  } catch (error) {
    const fallback = typeof model === 'string' && model.trim().length > 0
      ? model.trim()
      : GEMINI_MODELS.FLASH_3_0;
    console.warn('[GeminiService] Resolve model fallback:', fallback, error);
    return fallback;
  }
}

function isGeminiServerOverloadError(error?: string): boolean {
  const text = (error || '').toLowerCase();
  if (!text) {
    return false;
  }

  const hasHighDemand = text.includes('high demand')
    || text.includes('currently experiencing high demand')
    || text.includes('service unavailable')
    || text.includes('temporarily unavailable');

  if (hasHighDemand) {
    return true;
  }

  const has503 = text.includes('503') || text.includes('http 503') || text.includes('api error 503');

  return has503;
}

function getStopErrorMessage(control?: GeminiCallControlOptions): string {
  return control?.stopErrorMessage || 'STOP_REQUESTED';
}

function isStopRequested(control?: GeminiCallControlOptions): boolean {
  try {
    return control?.shouldStop?.() === true;
  } catch {
    return false;
  }
}

function isControlStopped(control?: GeminiCallControlOptions): boolean {
  return isStopRequested(control) || control?.stopSignal?.aborted === true;
}

function bindStopToAbortController(
  controller: AbortController,
  control?: GeminiCallControlOptions,
): () => void {
  const stopSignal = control?.stopSignal;
  if (!stopSignal) {
    return () => undefined;
  }

  const forwardAbort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (stopSignal.aborted) {
    forwardAbort();
    return () => undefined;
  }

  stopSignal.addEventListener('abort', forwardAbort, { once: true });
  return () => {
    stopSignal.removeEventListener('abort', forwardAbort);
  };
}

async function waitWithControl(ms: number, control?: GeminiCallControlOptions): Promise<boolean> {
  if (ms <= 0) {
    return isControlStopped(control);
  }

  if (isControlStopped(control)) {
    return true;
  }

  const stopSignal = control?.stopSignal;
  if (!stopSignal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return isControlStopped(control);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (stopped: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stopSignal.removeEventListener('abort', onAbort);
      resolve(stopped || isControlStopped(control));
    };

    const onAbort = (): void => finish(true);
    const timer = setTimeout(() => finish(false), ms);

    if (stopSignal.aborted) {
      finish(true);
      return;
    }

    stopSignal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Gọi Gemini API với một prompt và API key cụ thể
 */
export async function callGeminiApi(
  prompt: string | object,
  apiKey: string,
  model?: string,
  useProxy: boolean = true, // Mặc định sử dụng proxy
  abortSignal?: AbortSignal,
): Promise<GeminiResponse> {
  try {
    const resolvedModel = resolveModelForRuntime(model);
    const url = `${GEMINI_API_BASE}/${resolvedModel}:generateContent?key=${apiKey}`;

    // Convert prompt thành text nếu là object
    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);

    const payload = {
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
    };

    console.log(`[GeminiService] Gọi Gemini API với model: ${resolvedModel}${useProxy ? ' (via proxy)' : ''}`);

    // Sử dụng proxy client nếu enabled
    if (useProxy) {
      const { makeRequestWithProxy } = await import('../apiClient.js');
      
      const result = await makeRequestWithProxy(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
        timeout: 30000, // 30s cho translation
        useProxy: true,
        proxyScope: 'other',
        signal: abortSignal,
      });

      if (!result.success) {
        if (result.error?.includes('429')) {
          return { success: false, error: 'RATE_LIMIT' };
        }
        return { success: false, error: result.error };
      }

      // Parse response
      const responseData = result.data;
      
      // Trích xuất text từ response
      if (responseData.candidates && responseData.candidates.length > 0) {
        const candidate = responseData.candidates[0];
        if (candidate.content && candidate.content.parts) {
          const text = candidate.content.parts[0]?.text || '';
          return { success: true, data: text.trim() };
        }
      }

      return { success: false, error: 'Response không có nội dung' };
    } else {
      // Fallback về fetch trực tiếp (không dùng proxy)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      // Xử lý lỗi HTTP
      if (response.status === 429) {
        return { success: false, error: 'RATE_LIMIT' };
      }

      if (response.status === 404) {
        return { success: false, error: `Model ${resolvedModel} không tồn tại` };
      }

      if (!response.ok) {
        try {
          const errorDetail = await response.json();
          const errorMsg = errorDetail?.error?.message || 'Lỗi không xác định';
          console.error(`[GeminiService] API Error ${response.status}: ${errorMsg}`);
          return { success: false, error: `API Error: ${errorMsg}` };
        } catch {
          console.error(`[GeminiService] API Error ${response.status}: ${response.statusText}`);
          return { success: false, error: `HTTP ${response.status}` };
        }
      }

      const result = await response.json();

      // Trích xuất text từ response
      if (result.candidates && result.candidates.length > 0) {
        const candidate = result.candidates[0];
        if (candidate.content && candidate.content.parts) {
          const text = candidate.content.parts[0]?.text || '';
          return { success: true, data: text.trim() };
        }
      }

      return { success: false, error: 'Response không có nội dung' };
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      return { success: false, error: 'REQUEST_ABORTED' };
    }
    console.error('[GeminiService] Lỗi gọi API:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Gọi Gemini API với rotation keys tự động
 * Sẽ thử các keys khác nếu key hiện tại bị rate limit
 */
export async function callGeminiWithRotation(
  prompt: string | object,
  model?: string,
  maxRetries: number = 10,
  control?: GeminiCallControlOptions,
): Promise<GeminiResponse & { keyInfo?: KeyInfo }> {
  const resolvedModel = resolveModelForRuntime(model);
  const manager = getApiManager();
  const stats = manager.getStats();
  const stopErrorMessage = getStopErrorMessage(control);

  if (stats.totalProjects === 0) {
    return { success: false, error: 'Không có API key nào trong hệ thống' };
  }

  // Load proxy setting from AppSettings
  const useProxySetting = false; // Modified: Force disable proxy for API calls
  /*
  try {
    const settings = AppSettingsService.getAll();
    useProxySetting = settings.useProxy;
    console.log(`[GeminiService] Proxy setting: ${useProxySetting ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.warn('[GeminiService] Could not load proxy setting, using default (enabled)');
  }
  */

  let lastError = '';
  let rateLimitedCount = 0;
  const triedKeys = new Set<string>();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage };
    }

    const { apiKey, keyInfo } = manager.getNextApiKey();

    if (!apiKey || !keyInfo) {
      console.warn(`[GeminiService] Không còn key available sau ${attempt} lần thử`);
      break;
    }

    // Bỏ qua key đã thử
    if (triedKeys.has(apiKey)) {
      if (triedKeys.size >= stats.available) {
        console.log(`[GeminiService] Đã thử hết tất cả keys (${triedKeys.size} keys)`);
        break;
      }
      continue;
    }

    triedKeys.add(apiKey);
    console.log(`[GeminiService] Thử API key #${triedKeys.size} (${keyInfo.name})`);

    const requestAbortController = new AbortController();
    const detachAbortForwarding = bindStopToAbortController(requestAbortController, control);
    const response = await callGeminiApi(
      prompt,
      apiKey,
      resolvedModel,
      useProxySetting,
      requestAbortController.signal,
    );
    detachAbortForwarding();

    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage };
    }

    if (response.success) {
      manager.recordSuccess(apiKey);
      console.log(`[GeminiService] Thành công với ${keyInfo.name}`);
      return { ...response, keyInfo };
    }

    if (response.error === 'RATE_LIMIT') {
      console.warn(`[GeminiService] Rate limit với ${keyInfo.name}, thử key tiếp theo...`);
      manager.recordRateLimitError(apiKey);
      lastError = 'RATE_LIMIT_ALL_KEYS';
      rateLimitedCount++;

      // Nghỉ ngắn trước khi thử key tiếp theo
      if (await waitWithControl(300, control)) {
        return { success: false, error: stopErrorMessage };
      }
      continue;
    }

    if (isGeminiServerOverloadError(response.error)) {
      // Lỗi 503 high-demand là lỗi hạ tầng Gemini, không phải lỗi key.
      console.warn(`[GeminiService] Server Gemini quá tải với ${keyInfo.name}, không đánh dấu key lỗi.`);
      lastError = response.error || 'SERVER_OVERLOADED';
      if (await waitWithControl(800, control)) {
        return { success: false, error: stopErrorMessage };
      }
      continue;
    }

    // Ghi nhận lỗi khác
    console.error(`[GeminiService] Lỗi với ${keyInfo.name}: ${response.error}`);

    if (response.error?.toLowerCase().includes('exhausted') || response.error?.toLowerCase().includes('quota')) {
      manager.recordQuotaExhausted(apiKey);
    } else {
      manager.recordError(apiKey, response.error || 'Unknown error');
    }

    lastError = response.error || 'Unknown error';
  }

  // Kiểm tra kết quả
  if (rateLimitedCount > 0 && rateLimitedCount >= triedKeys.size) {
    console.warn(`[GeminiService] Tất cả ${rateLimitedCount} keys đã thử đều bị rate limit`);
    return { success: false, error: 'RATE_LIMIT_ALL_KEYS' };
  }

  return { success: false, error: `Thất bại sau ${triedKeys.size} lần thử: ${lastError}` };
}

/**
 * Gọi Gemini với key đã được chỉ định trước (dành cho caption parallel batches)
 * Nếu key bị lỗi / rate limit → tự động fallback sang callGeminiWithRotation
 */
export async function callGeminiWithAssignedKey(
  prompt: string | object,
  assignedKey: { apiKey: string; keyInfo: KeyInfo },
  model?: string,
  control?: GeminiCallControlOptions,
): Promise<GeminiResponse & { keyInfo?: KeyInfo }> {
  const resolvedModel = resolveModelForRuntime(model);
  const manager = getApiManager();
  const stopErrorMessage = getStopErrorMessage(control);

  if (isControlStopped(control)) {
    return { success: false, error: stopErrorMessage };
  }

  console.log(`[GeminiService] [assigned] Dùng key: ${assignedKey.keyInfo.name}`);
  const requestAbortController = new AbortController();
  const detachAbortForwarding = bindStopToAbortController(requestAbortController, control);
  const response = await callGeminiApi(
    prompt,
    assignedKey.apiKey,
    resolvedModel,
    false,
    requestAbortController.signal,
  );
  detachAbortForwarding();

  if (isControlStopped(control)) {
    return { success: false, error: stopErrorMessage };
  }

  if (response.success) {
    manager.recordSuccess(assignedKey.apiKey);
    return { ...response, keyInfo: assignedKey.keyInfo };
  }

  // Key được chỉ định bị lỗi — ghi nhận và fallback sang rotation
  if (response.error === 'RATE_LIMIT') {
    console.warn(`[GeminiService] [assigned] ${assignedKey.keyInfo.name} bị rate limit — fallback rotation`);
    manager.recordRateLimitError(assignedKey.apiKey);
  } else if (isGeminiServerOverloadError(response.error)) {
    console.warn(`[GeminiService] [assigned] Gemini server quá tải — không đánh dấu key lỗi`);
  } else if (response.error?.toLowerCase().includes('exhausted') || response.error?.toLowerCase().includes('quota')) {
    manager.recordQuotaExhausted(assignedKey.apiKey);
  } else {
    manager.recordError(assignedKey.apiKey, response.error || 'Unknown');
  }

  console.log(`[GeminiService] [assigned] Fallback sang rotation cho ${assignedKey.keyInfo.name}`);
  return callGeminiWithRotation(prompt, resolvedModel, 10, control);
}

/**
 * Dịch văn bản sử dụng Gemini API
 */
export async function translateText(
  text: string,
  targetLanguage: string = 'Vietnamese',
  model?: string
): Promise<GeminiResponse> {
  const prompt = {
    task: 'translation',
    source_text: text,
    target_language: targetLanguage,
    instructions: {
      rules: [
        'Dịch tự nhiên, không dịch word-by-word',
        'Giữ nguyên format và cấu trúc câu',
        'Không thêm giải thích hoặc ghi chú',
      ],
    },
    response_format: 'Chỉ trả về bản dịch, không có text khác',
  };

  return callGeminiWithRotation(prompt, model);
}

/**
 * Chat với Gemini API (không dùng rotation, dùng key cụ thể)
 */
export async function chat(
  message: string,
  apiKey: string,
  model?: string
): Promise<GeminiResponse> {
  return callGeminiApi(message, apiKey, model);
}

/**
 * Lấy thông tin model - Alias cho getGeminiModelInfo
 */
export function getModelInfo(model: string): { name: string; description: string } {
  const info = getGeminiModelInfo(model);
  return { name: info.name, description: info.description };
}
