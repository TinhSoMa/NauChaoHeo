/**
 * Gemini Service - Gọi API Gemini
 * Xử lý việc gọi Gemini API với rotation keys tự động
 */

import { getApiManager } from './apiManager';
import { classifyGeminiError, GeminiErrorResult, GeminiErrorCode } from './geminiError';
import { GeminiHttpError } from '../apiClient';
import { getApiRequestTimeoutMs } from '../appSettings.js';
import {
  GeminiResponse,
  KeyInfo,
  GEMINI_API_BASE,
  GEMINI_MODELS,
  getGeminiModelInfo,
} from '../../../shared/types/gemini';
import { getGeminiModelsService } from './geminiModelsService';
import { GeminiModelsDatabase } from '../../database/geminiModelsDatabase';
import type { ThinkingLevel } from '../../../shared/types/gemini';

const DEBUG_STREAM_TIMING = false;

function isProModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('pro');
}

/** Chỉ Flash/Lite của Gemini 3.x hỗ trợ minimal */
function supportsMinimal(modelId: string): boolean {
  return /^gemini-3/i.test(modelId) && !isProModel(modelId);
}

function resolveThinkingLevel(modelId: string, level: ThinkingLevel): ThinkingLevel | 'disabled' {
  if (level === 'disabled') return 'disabled';
  if (level === 'minimal' && !supportsMinimal(modelId)) {
    console.log(`[GeminiService] Model không hỗ trợ minimal, fallback → low`);
    return 'low';
  }
  return level;
}

function addThinkingConfig(payload: Record<string, unknown>, modelId: string, thinkingLevel: ThinkingLevel): void {
  const effectiveLevel = resolveThinkingLevel(modelId, thinkingLevel);
  if (effectiveLevel === 'disabled') return;

  payload.generationConfig = {
    ...(payload.generationConfig as object | undefined),
    thinkingConfig: {
      thinkingLevel: effectiveLevel,
    },
  };
}

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
  useProxy: boolean = true,
  abortSignal?: AbortSignal,
  timeoutMs: number = getApiRequestTimeoutMs(),
  imageBase64?: string,
): Promise<GeminiResponse> {
  try {
    const resolvedModel = resolveModelForRuntime(model);
    const url = `${GEMINI_API_BASE}/${resolvedModel}:generateContent?key=${apiKey}`;

    // Convert prompt thành text nếu là object
    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);

    const parts: Array<Record<string, unknown>> = [{ text: promptText }];
    if (imageBase64) {
      parts.push({ inlineData: { mimeType: 'image/png', data: imageBase64 } });
    }

    const payload: Record<string, unknown> = {
      contents: [{ parts }],
    };

    const thinkingLevel = GeminiModelsDatabase.getThinkingLevel();
    addThinkingConfig(payload, resolvedModel, thinkingLevel);

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
        timeout: timeoutMs,
        useProxy: true,
        proxyScope: 'other',
        signal: abortSignal,
      });

      if (!result.success) {
        const classified = classifyGeminiError(result.statusCode || 0, '', result.error || '');
        return {
          success: false,
          error: classified.code === GeminiErrorCode.UNKNOWN ? result.error : classified.code,
          errorCode: classified.code,
          userMessage: classified.userMessage,
        };
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
      const fetchSignal = abortSignal
        ? AbortSignal.any ? AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)]) : abortSignal
        : AbortSignal.timeout(timeoutMs);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: fetchSignal,
      });

      // Xử lý lỗi HTTP
      if (!response.ok) {
        let errorStatus = '';
        let errorMessage = response.statusText;
        try {
          const errorBody = await response.json();
          errorStatus = errorBody?.error?.status || '';
          errorMessage = errorBody?.error?.message || response.statusText;
        } catch {
          // use defaults
        }
        const classified = classifyGeminiError(response.status, errorStatus, errorMessage);
        return {
          success: false,
          error: classified.code === GeminiErrorCode.UNKNOWN ? `HTTP ${response.status}` : classified.code,
          errorCode: classified.code,
          userMessage: classified.userMessage,
        };
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
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { success: false, error: 'REQUEST_TIMEOUT' };
    }
    console.error('[GeminiService] Lỗi gọi API:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Gọi Gemini API stream với một prompt và API key cụ thể
 * Dùng endpoint :streamGenerateContent để nhận response dạng SSE
 */
export async function callGeminiApiStream(
  prompt: string | object,
  apiKey: string,
  onChunk: (text: string) => void,
  model?: string,
  useProxy: boolean = true,
  abortSignal?: AbortSignal,
  timeoutMs: number = getApiRequestTimeoutMs(),
  imageBase64?: string,
): Promise<GeminiResponse> {
  try {
    const t0 = Date.now();
    const resolvedModel = resolveModelForRuntime(model);
    const url = `${GEMINI_API_BASE}/${resolvedModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);

    const parts: Array<Record<string, unknown>> = [{ text: promptText }];
    if (imageBase64) {
      parts.push({ inlineData: { mimeType: 'image/png', data: imageBase64 } });
    }

    const payload: Record<string, unknown> = {
      contents: [{ parts }],
    };

    const thinkingLevel = GeminiModelsDatabase.getThinkingLevel();
    addThinkingConfig(payload, resolvedModel, thinkingLevel);
    if (DEBUG_STREAM_TIMING) console.log(`[GeminiStream] thinkingLevel=${thinkingLevel}, model=${resolvedModel}`);

    const fetchImportStart = Date.now();
    const { default: fetch } = await import('node-fetch');
    if (DEBUG_STREAM_TIMING) console.log(`[GeminiStream] import node-fetch: +${Date.now() - fetchImportStart}ms`);

    let agent: any = undefined;

    if (useProxy) {
      const { getProxyManager } = await import('../proxy/proxyManager.js');
      const proxyManager = getProxyManager();
      const proxyContext = proxyManager.getProxyContext('other');
      if (proxyContext.mode !== 'off') {
        const proxy = proxyManager.getNextProxy(undefined, 'other');
        if (proxy) {
          const { HttpsProxyAgent } = await import('https-proxy-agent');
          const { SocksProxyAgent } = await import('socks-proxy-agent');
          const proxyUrl = proxy.username
            ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
            : `${proxy.type}://${proxy.host}:${proxy.port}`;
          agent = proxy.type === 'socks5'
            ? new SocksProxyAgent(proxyUrl, { timeout: timeoutMs })
            : new HttpsProxyAgent(proxyUrl, { timeout: timeoutMs, rejectUnauthorized: false, keepAlive: false });
        }
      }
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (abortSignal?.aborted) {
      controller.abort();
    } else if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const fetchOptions: any = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    };
    if (agent) fetchOptions.agent = agent;

    if (DEBUG_STREAM_TIMING) console.log(`[GeminiStream] Before fetch: +${Date.now() - t0}ms`);
    const beforeFetch = Date.now();
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);
    if (DEBUG_STREAM_TIMING) console.log(`[GeminiStream] After fetch (status=${response.status}): +${Date.now() - t0}ms (fetch took ${Date.now() - beforeFetch}ms)`);

    if (!response.ok) {
      let errorStatus = '';
      let errorMessage = response.statusText;
      try {
        const errorBody = await response.json();
        errorStatus = errorBody?.error?.status || '';
        errorMessage = errorBody?.error?.message || response.statusText;
      } catch { /* ignore */ }
      const classified = classifyGeminiError(response.status, errorStatus, errorMessage);
      return {
        success: false,
        error: classified.code === GeminiErrorCode.UNKNOWN ? `HTTP ${response.status}` : classified.code,
        errorCode: classified.code,
        userMessage: classified.userMessage,
      };
    }

    if (!response.body) {
      return { success: false, error: 'Response body is not readable' };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';
    let firstChunkReceived = false;

    for await (const chunk of response.body) {
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        if (DEBUG_STREAM_TIMING) console.log(`[GeminiStream] First SSE chunk received: +${Date.now() - t0}ms`);
      }
      const chunkStr = typeof chunk === 'string' ? chunk : decoder.decode(chunk as Buffer, { stream: true });
      buffer += chunkStr;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) {
              accumulatedText += text;
              onChunk(text);
            }
          } catch { /* skip malformed JSON */ }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6).trim();
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) {
              accumulatedText += text;
              onChunk(text);
            }
          } catch { /* skip */ }
        }
      }
    }

    if (!accumulatedText.trim()) {
      return { success: false, error: 'Response không có nội dung' };
    }

    return { success: true, data: accumulatedText.trim() };
  } catch (error) {
    if (abortSignal?.aborted) {
      return { success: false, error: 'REQUEST_ABORTED' };
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { success: false, error: 'REQUEST_TIMEOUT' };
    }
    console.error('[GeminiService] Lỗi gọi API stream:', error);
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
  imageBase64?: string,
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
  let keySwitchCount = 0;
  let currentKey: { apiKey: string; keyInfo: KeyInfo } | null = null;
  let serverOverloadRetries = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage, keySwitchCount };
    }

    let apiKey: string;
    let keyInfo: KeyInfo;

    if (serverOverloadRetries > 0) {
      apiKey = currentKey!.apiKey;
      keyInfo = currentKey!.keyInfo;
      console.log(`[GeminiService] Server overload retry #${serverOverloadRetries} với ${keyInfo.name}`);
    } else {
      const result = manager.getNextApiKey();
      const rawApiKey = result.apiKey;
      const rawKeyInfo = result.keyInfo;
      apiKey = rawApiKey!;
      keyInfo = rawKeyInfo as KeyInfo;

      if (!rawApiKey || !rawKeyInfo) {
        console.warn(`[GeminiService] Không còn key available sau ${attempt} lần thử`);
        break;
      }

      // Bỏ qua key đã thử
      if (triedKeys.has(rawApiKey)) {
        if (triedKeys.size >= stats.available) {
          console.log(`[GeminiService] Đã thử hết tất cả keys (${triedKeys.size} keys)`);
          break;
        }
        continue;
      }

      triedKeys.add(rawApiKey);
      keySwitchCount = triedKeys.size;
      console.log(`[GeminiService] Thử API key #${keySwitchCount} (${rawKeyInfo.name})`);
      currentKey = { apiKey: rawApiKey, keyInfo: rawKeyInfo as KeyInfo };
    }

    const requestAbortController = new AbortController();
    const detachAbortForwarding = bindStopToAbortController(requestAbortController, control);
    const response = await callGeminiApi(
      prompt,
      apiKey,
      resolvedModel,
      useProxySetting,
      requestAbortController.signal,
      getApiRequestTimeoutMs(),
      imageBase64,
    );
    detachAbortForwarding();

    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage, keySwitchCount };
    }

    if (response.success) {
      manager.recordSuccess(apiKey);
      console.log(`[GeminiService] Thành công với ${keyInfo.name}`);
      return { ...response, keyInfo, keySwitchCount };
    }

    const errCode = (response.errorCode || response.error || '') as string;
    const isRateLimitCode = errCode === GeminiErrorCode.RESOURCE_EXHAUSTED || response.error === 'RATE_LIMIT' || response.error === 'RATE_LIMIT_ALL_KEYS';
    const isServerOverload = errCode === GeminiErrorCode.UNAVAILABLE || errCode === GeminiErrorCode.INTERNAL || errCode === GeminiErrorCode.DEADLINE_EXCEEDED;
    const isExhausted = errCode === GeminiErrorCode.RESOURCE_EXHAUSTED && (
      (response.error?.toLowerCase().includes('exhausted') || response.error?.toLowerCase().includes('quota'))
    );

    if (isRateLimitCode && !isExhausted) {
      serverOverloadRetries = 0;
      console.warn(`[GeminiService] Rate limit với ${keyInfo.name}, thử key tiếp theo...`);
      manager.recordRateLimitError(apiKey);
      lastError = 'RATE_LIMIT_ALL_KEYS';
      rateLimitedCount++;

      if (await waitWithControl(300, control)) {
        return { success: false, error: stopErrorMessage, keySwitchCount };
      }
      continue;
    }

    if (isServerOverload) {
      serverOverloadRetries++;
      lastError = 'SERVER_OVERLOADED';
      if (serverOverloadRetries >= 5) {
        console.warn(`[GeminiService] Server overload kéo dài, bỏ qua sau ${serverOverloadRetries} lần thử`);
        break;
      }
      console.warn(`[GeminiService] Server Gemini quá tải với ${keyInfo.name} — retry lần ${serverOverloadRetries}...`);
      if (await waitWithControl(1000 * Math.pow(2, serverOverloadRetries), control)) {
        return { success: false, error: stopErrorMessage, keySwitchCount };
      }
      continue;
    }

    if (isExhausted || response.error?.toLowerCase().includes('exhausted') || response.error?.toLowerCase().includes('quota')) {
      serverOverloadRetries = 0;
      console.warn(`[GeminiService] Hết quota với ${keyInfo.name}`);
      manager.recordQuotaExhausted(apiKey);
      lastError = response.error || 'QUOTA_EXHAUSTED';
      continue;
    }

    // Ghi nhận lỗi khác
    serverOverloadRetries = 0;
    console.error(`[GeminiService] Lỗi với ${keyInfo.name}: ${response.error}`);
    manager.recordError(apiKey, response.error || 'Unknown error', response.errorCode as GeminiErrorCode);
    lastError = response.error || 'Unknown error';
  }

  // Kiểm tra kết quả
  if (rateLimitedCount > 0 && rateLimitedCount >= triedKeys.size) {
    console.warn(`[GeminiService] Tất cả ${rateLimitedCount} keys đã thử đều bị rate limit`);
    return { success: false, error: 'RATE_LIMIT_ALL_KEYS', keySwitchCount };
  }

  return { success: false, error: `Thất bại sau ${triedKeys.size} lần thử: ${lastError}`, keySwitchCount };
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
  imageBase64?: string,
): Promise<GeminiResponse & { keyInfo?: KeyInfo }> {
  const resolvedModel = resolveModelForRuntime(model);
  const manager = getApiManager();
  const stopErrorMessage = getStopErrorMessage(control);
  const maxAssignedRetries = 10;

  if (isControlStopped(control)) {
    return { success: false, error: stopErrorMessage };
  }

  console.log(`[GeminiService] [assigned] Dùng key: ${assignedKey.keyInfo.name}`);

  let lastError = '';
  let serverOverloadRetries = 0;

  for (let attempt = 0; attempt < maxAssignedRetries; attempt++) {
    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage };
    }

    const requestAbortController = new AbortController();
    const detachAbortForwarding = bindStopToAbortController(requestAbortController, control);
    const response = await callGeminiApi(
      prompt,
      assignedKey.apiKey,
      resolvedModel,
      false,
      requestAbortController.signal,
      getApiRequestTimeoutMs(),
      imageBase64,
    );
    detachAbortForwarding();

    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage };
    }

    if (response.success) {
      manager.recordSuccess(assignedKey.apiKey);
      return { ...response, keyInfo: assignedKey.keyInfo, keySwitchCount: 1 };
    }

    // Key được chỉ định bị lỗi — ghi nhận và fallback sang rotation
    const errCode = (response.errorCode || response.error || '') as string;
    const isRateLimitCode = errCode === GeminiErrorCode.RESOURCE_EXHAUSTED || response.error === 'RATE_LIMIT';
    const isServerOverload = errCode === GeminiErrorCode.UNAVAILABLE || errCode === GeminiErrorCode.INTERNAL || errCode === GeminiErrorCode.DEADLINE_EXCEEDED;

    if (isServerOverload) {
      serverOverloadRetries++;
      lastError = 'SERVER_OVERLOADED';
      if (serverOverloadRetries >= 5) {
        console.warn(`[GeminiService] [assigned] Server overload kéo dài, bỏ qua sau ${serverOverloadRetries} lần thử`);
        break;
      }
      console.warn(`[GeminiService] [assigned] Gemini server quá tải — retry lần ${serverOverloadRetries}...`);
      if (await waitWithControl(1000 * Math.pow(2, serverOverloadRetries), control)) {
        return { success: false, error: stopErrorMessage };
      }
      continue;
    }

    if (isRateLimitCode) {
      console.warn(`[GeminiService] [assigned] ${assignedKey.keyInfo.name} bị rate limit — fallback rotation`);
      manager.recordRateLimitError(assignedKey.apiKey);
    } else if (response.error?.toLowerCase().includes('exhausted') || response.error?.toLowerCase().includes('quota')) {
      console.warn(`[GeminiService] [assigned] ${assignedKey.keyInfo.name} hết quota — fallback rotation`);
      manager.recordQuotaExhausted(assignedKey.apiKey);
    } else {
      console.warn(`[GeminiService] [assigned] ${assignedKey.keyInfo.name} lỗi: ${response.error} — fallback rotation`);
      manager.recordError(assignedKey.apiKey, response.error || 'Unknown', response.errorCode as GeminiErrorCode);
    }
    lastError = response.error || 'Unknown error';
    break;
  }

  console.log(`[GeminiService] [assigned] Fallback sang rotation cho ${assignedKey.keyInfo.name} (${lastError})`);
  return callGeminiWithRotation(prompt, resolvedModel, 10, control, imageBase64);
}

/**
 * Gọi Gemini API stream với rotation keys tự động
 */
export async function callGeminiWithRotationStream(
  prompt: string | object,
  onChunk: (text: string) => void,
  model?: string,
  maxRetries: number = 10,
  control?: GeminiCallControlOptions,
  imageBase64?: string,
  onStatus?: (status: string) => void,
): Promise<GeminiResponse & { keyInfo?: KeyInfo }> {
  const resolvedModel = resolveModelForRuntime(model);
  const manager = getApiManager();
  const stats = manager.getStats();
  const stopErrorMessage = getStopErrorMessage(control);

  if (stats.totalProjects === 0) {
    return { success: false, error: 'Không có API key nào trong hệ thống' };
  }

  const useProxySetting = false;

  let lastError = '';
  let rateLimitedCount = 0;
  const triedKeys = new Set<string>();
  let keySwitchCount = 0;
  let currentKey: { apiKey: string; keyInfo: KeyInfo } | null = null;
  let serverOverloadRetries = 0;

  const streamT0 = Date.now();
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage, keySwitchCount };
    }

    let apiKey: string;
    let keyInfo: KeyInfo;

    if (serverOverloadRetries > 0) {
      apiKey = currentKey!.apiKey;
      keyInfo = currentKey!.keyInfo;
      console.log(`[GeminiService] Server overload retry #${serverOverloadRetries} với ${keyInfo.name}`);
    } else {
      const tKey = Date.now();
      const result = manager.getNextApiKey();
      const rawApiKey = result.apiKey;
      const rawKeyInfo = result.keyInfo;
      apiKey = rawApiKey!;
      keyInfo = rawKeyInfo as KeyInfo;
      if (DEBUG_STREAM_TIMING) console.log(`[GeminiStream] getNextApiKey: +${Date.now() - tKey}ms (attempt=${attempt})`);

      if (!rawApiKey || !rawKeyInfo) {
        console.warn(`[GeminiService] Không còn key available sau ${attempt} lần thử`);
        break;
      }

      if (triedKeys.has(rawApiKey)) {
        if (triedKeys.size >= stats.available) {
          console.log(`[GeminiService] Đã thử hết tất cả keys (${triedKeys.size} keys)`);
          break;
        }
        continue;
      }

      triedKeys.add(rawApiKey);
      keySwitchCount = triedKeys.size;
      console.log(`[GeminiService] Thử API key stream #${keySwitchCount} (${rawKeyInfo.name})`);
      currentKey = { apiKey: rawApiKey, keyInfo: rawKeyInfo as KeyInfo };
    }

    const requestAbortController = new AbortController();
    const detachAbortForwarding = bindStopToAbortController(requestAbortController, control);
    const tApi = Date.now();
    const response = await callGeminiApiStream(
      prompt,
      apiKey,
      onChunk,
      resolvedModel,
      useProxySetting,
      requestAbortController.signal,
      getApiRequestTimeoutMs(),
      imageBase64,
    );
    if (DEBUG_STREAM_TIMING) console.log(`[GeminiStream] callGeminiApiStream returned: +${Date.now() - streamT0}ms (call took ${Date.now() - tApi}ms)`);
    detachAbortForwarding();

    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage, keySwitchCount };
    }

    if (response.success) {
      manager.recordSuccess(apiKey);
      console.log(`[GeminiService] Thành công với ${keyInfo.name}`);
      return { ...response, keyInfo, keySwitchCount };
    }

    const errCode = (response.errorCode || response.error || '') as string;
    const isRateLimitCode = errCode === GeminiErrorCode.RESOURCE_EXHAUSTED || response.error === 'RATE_LIMIT' || response.error === 'RATE_LIMIT_ALL_KEYS';
    const isServerOverload = errCode === GeminiErrorCode.UNAVAILABLE || errCode === GeminiErrorCode.INTERNAL || errCode === GeminiErrorCode.DEADLINE_EXCEEDED;

    if (isRateLimitCode) {
      rateLimitedCount++;
      serverOverloadRetries = 0;
      console.warn(`[GeminiService] Key ${keyInfo.name} bị rate limit (lần ${rateLimitedCount}/${maxRetries})`);
      manager.recordRateLimitError(apiKey);
    } else if (isServerOverload) {
      serverOverloadRetries++;
      lastError = 'SERVER_OVERLOADED';
      if (serverOverloadRetries >= 5) {
        console.warn(`[GeminiService] Server overload kéo dài, bỏ qua sau ${serverOverloadRetries} lần thử`);
        break;
      }
      console.warn(`[GeminiService] Gemini server quá tải — retry lần ${serverOverloadRetries}...`);
      onStatus?.(`Server Gemini đang quá tải, thử lại lần ${serverOverloadRetries}...`);
      if (await waitWithControl(1000 * Math.pow(2, serverOverloadRetries), control)) {
        return { success: false, error: stopErrorMessage, keySwitchCount };
      }
      continue;
    } else {
      serverOverloadRetries = 0;
      console.warn(`[GeminiService] Key ${keyInfo.name} lỗi:`, response.error);
      manager.recordError(apiKey, response.error || 'Unknown', response.errorCode as GeminiErrorCode);
    }

    lastError = response.error || 'Unknown error';

    if (!isRateLimitCode) {
      if (rateLimitedCount > 0) {
        console.log(`[GeminiService] Đã thử rate limited key, chuyển sang key khác...`);
        continue;
      }
    }

    await waitWithControl(1000 * Math.pow(2, attempt), control);
  }

  // Kiểm tra tất cả keys bị rate limit
  if (rateLimitedCount > 0 && rateLimitedCount >= triedKeys.size) {
    console.warn(`[GeminiService] Tất cả ${rateLimitedCount} keys đã thử đều bị rate limit`);
    return { success: false, error: 'RATE_LIMIT_ALL_KEYS', keySwitchCount };
  }

  return { success: false, error: lastError || 'All keys failed', keySwitchCount };
}

/**
 * Gọi Gemini API stream với assigned key, fallback rotation nếu lỗi
 */
export async function callGeminiWithAssignedKeyStream(
  prompt: string | object,
  assignedKey: { apiKey: string; keyInfo: KeyInfo },
  onChunk: (text: string) => void,
  model?: string,
  control?: GeminiCallControlOptions,
  imageBase64?: string,
  onStatus?: (status: string) => void,
): Promise<GeminiResponse & { keyInfo?: KeyInfo }> {
  const resolvedModel = resolveModelForRuntime(model);
  const manager = getApiManager();
  const stopErrorMessage = getStopErrorMessage(control);
  const maxAssignedRetries = 10;

  if (isControlStopped(control)) {
    return { success: false, error: stopErrorMessage };
  }

  console.log(`[GeminiService] [assigned] Dùng key stream: ${assignedKey.keyInfo.name}`);

  let lastError = '';
  let serverOverloadRetries = 0;

  for (let attempt = 0; attempt < maxAssignedRetries; attempt++) {
    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage };
    }

    const requestAbortController = new AbortController();
    const detachAbortForwarding = bindStopToAbortController(requestAbortController, control);
    const response = await callGeminiApiStream(
      prompt,
      assignedKey.apiKey,
      onChunk,
      resolvedModel,
      false,
      requestAbortController.signal,
      getApiRequestTimeoutMs(),
      imageBase64,
    );
    detachAbortForwarding();

    if (isControlStopped(control)) {
      return { success: false, error: stopErrorMessage };
    }

    if (response.success) {
      manager.recordSuccess(assignedKey.apiKey);
      return { ...response, keyInfo: assignedKey.keyInfo, keySwitchCount: 1 };
    }

    const errCode = (response.errorCode || response.error || '') as string;
    const isRateLimitCode = errCode === GeminiErrorCode.RESOURCE_EXHAUSTED || response.error === 'RATE_LIMIT';
    const isServerOverload = errCode === GeminiErrorCode.UNAVAILABLE || errCode === GeminiErrorCode.INTERNAL || errCode === GeminiErrorCode.DEADLINE_EXCEEDED;

    if (isServerOverload) {
      serverOverloadRetries++;
      lastError = 'SERVER_OVERLOADED';
      if (serverOverloadRetries >= 5) {
        console.warn(`[GeminiService] [assigned] Server overload kéo dài, bỏ qua sau ${serverOverloadRetries} lần thử`);
        break;
      }
      console.warn(`[GeminiService] [assigned] Gemini server quá tải — retry lần ${serverOverloadRetries}...`);
      onStatus?.(`Server Gemini đang quá tải, thử lại lần ${serverOverloadRetries}...`);
      if (await waitWithControl(1000 * Math.pow(2, serverOverloadRetries), control)) {
        return { success: false, error: stopErrorMessage };
      }
      continue;
    }

    // Rate limit / quota / error khác → fallback rotation
    if (isRateLimitCode) {
      console.warn(`[GeminiService] [assigned] ${assignedKey.keyInfo.name} bị rate limit — fallback rotation stream`);
      manager.recordRateLimitError(assignedKey.apiKey);
    } else if (response.error?.toLowerCase().includes('exhausted') || response.error?.toLowerCase().includes('quota')) {
      console.warn(`[GeminiService] [assigned] ${assignedKey.keyInfo.name} hết quota — fallback rotation stream`);
      manager.recordQuotaExhausted(assignedKey.apiKey);
    } else {
      console.warn(`[GeminiService] [assigned] ${assignedKey.keyInfo.name} lỗi: ${response.error} — fallback rotation stream`);
      manager.recordError(assignedKey.apiKey, response.error || 'Unknown', response.errorCode as GeminiErrorCode);
    }
    lastError = response.error || 'Unknown error';
    break;
  }

  console.log(`[GeminiService] [assigned] Fallback sang rotation stream cho ${assignedKey.keyInfo.name} (${lastError})`);
  return callGeminiWithRotationStream(prompt, onChunk, resolvedModel, 10, control, imageBase64, onStatus);
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
