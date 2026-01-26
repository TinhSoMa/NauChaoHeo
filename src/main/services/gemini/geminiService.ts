/**
 * Gemini Service - Gọi API Gemini
 * Xử lý việc gọi Gemini API với rotation keys tự động
 */

import { getApiManager } from './apiManager';
import { AppSettingsService } from '../appSettings';
import { 
  GeminiResponse, 
  KeyInfo,
  GEMINI_API_BASE,
  GEMINI_MODELS,
  getGeminiModelInfo,
  type GeminiModel,
} from '../../../shared/types/gemini';

// Re-export để các module khác có thể import từ đây
export { GEMINI_MODELS, getGeminiModelInfo };
export type { GeminiModel };

/**
 * Gọi Gemini API với một prompt và API key cụ thể
 */
export async function callGeminiApi(
  prompt: string | object,
  apiKey: string,
  model: GeminiModel = GEMINI_MODELS.FLASH_3_0,
  useProxy: boolean = true // Mặc định sử dụng proxy
): Promise<GeminiResponse> {
  try {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

    // Convert prompt thành text nếu là object
    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);

    const payload = {
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
    };

    console.log(`[GeminiService] Gọi Gemini API với model: ${model}${useProxy ? ' (via proxy)' : ''}`);

    // Sử dụng proxy client nếu enabled
    if (useProxy) {
      const { makeRequestWithProxy } = await import('../apiClient');
      
      const result = await makeRequestWithProxy(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
        timeout: 30000, // 30s cho translation
        useProxy: true,
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
      });

      // Xử lý lỗi HTTP
      if (response.status === 429) {
        return { success: false, error: 'RATE_LIMIT' };
      }

      if (response.status === 404) {
        return { success: false, error: `Model ${model} không tồn tại` };
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
  model: GeminiModel = GEMINI_MODELS.FLASH_3_0,
  maxRetries: number = 10
): Promise<GeminiResponse & { keyInfo?: KeyInfo }> {
  const manager = getApiManager();
  const stats = manager.getStats();

  if (stats.totalProjects === 0) {
    return { success: false, error: 'Không có API key nào trong hệ thống' };
  }

  // Load proxy setting from AppSettings
  let useProxySetting = true; // Default
  try {
    const settings = AppSettingsService.getAll();
    useProxySetting = settings.useProxy;
    console.log(`[GeminiService] Proxy setting: ${useProxySetting ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.warn('[GeminiService] Could not load proxy setting, using default (enabled)');
  }

  let lastError = '';
  let rateLimitedCount = 0;
  const triedKeys = new Set<string>();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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

    const response = await callGeminiApi(prompt, apiKey, model, useProxySetting);

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
      await new Promise((resolve) => setTimeout(resolve, 300));
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
 * Dịch văn bản sử dụng Gemini API
 */
export async function translateText(
  text: string,
  targetLanguage: string = 'Vietnamese',
  model: GeminiModel = GEMINI_MODELS.FLASH_3_0
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
  model: GeminiModel = GEMINI_MODELS.FLASH_3_0
): Promise<GeminiResponse> {
  return callGeminiApi(message, apiKey, model);
}

/**
 * Lấy thông tin model - Alias cho getGeminiModelInfo
 */
export function getModelInfo(model: GeminiModel): { name: string; description: string } {
  const info = getGeminiModelInfo(model);
  return { name: info.name, description: info.description };
}
