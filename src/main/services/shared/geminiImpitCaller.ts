/**
 * geminiImpitCaller — Convenience wrapper cho GeminiChatService.sendMessageImpit
 *
 * Cho phép bất kỳ main-process service nào gọi Gemini Web (Impit)
 * chỉ bằng 1-2 dòng, không cần import GeminiChatService trực tiếp.
 *
 * Usage:
 *   import { callGeminiImpit } from '../shared';
 *   const result = await callGeminiImpit(prompt);
 *   if (result.success) console.log(result.text);
 */

import { GeminiChatService } from '../chatGemini/geminiChatService';
import { AppSettingsService } from '../appSettings';

// ─── Types ────────────────────────────────────────────────────────────────

export interface GeminiImpitOptions {
  /** Config ID cụ thể. Nếu không truyền → tự auto-select (round-robin). */
  configId?: string;
  /** Conversation context để tiếp tục hội thoại. */
  context?: { conversationId: string; responseId: string; choiceId: string };
  /** Override proxy setting. Nếu không truyền → đọc từ AppSettings. */
  useProxy?: boolean;
  /** Metadata tùy ý (validationRegex, chapterId, featureId, ...). */
  metadata?: Record<string, any>;
  /** Callback khi retry. */
  onRetry?: (attempt: number, maxRetries: number) => void;
}

export interface GeminiImpitResult {
  success: boolean;
  /** Text response từ Gemini (khi success = true). */
  text?: string;
  /** Conversation context mới để dùng cho request tiếp theo. */
  context?: { conversationId: string; responseId: string; choiceId: string };
  /** ID của config đã dùng. */
  configId?: string;
  /** Error message (khi success = false). */
  error?: string;
  /** Có thể retry không (khi success = false). */
  retryable?: boolean;
  /** Metadata được trả ngược lại từ service (giúp match response với request). */
  metadata?: Record<string, any>;
}

// ─── Main Caller ──────────────────────────────────────────────────────────

/**
 * Gửi prompt đến Gemini Web qua impit.
 * Nếu `options.configId` không được truyền → auto-select config tốt nhất.
 *
 * @param message  Prompt text cần gửi
 * @param options  Tùy chọn (configId, context, useProxy, metadata, onRetry)
 */
export async function callGeminiImpit(
  message: string,
  options: GeminiImpitOptions = {}
): Promise<GeminiImpitResult> {
  const useProxy = options.useProxy ?? AppSettingsService.getAll().useProxy;

  const raw = await GeminiChatService.sendMessageImpit(
    message,
    options.configId ?? '',          // empty string → service tự auto-select
    options.context,
    useProxy,
    options.metadata,
    options.onRetry
  );

  if (raw.success && raw.data) {
    return {
      success: true,
      text: raw.data.text,
      context: raw.data.context,
      configId: raw.configId,
      metadata: raw.metadata,
    };
  }

  return {
    success: false,
    error: raw.error,
    retryable: raw.retryable,
    configId: raw.configId,
    metadata: raw.metadata,
  };
}

/**
 * Giống `callGeminiImpit` nhưng luôn auto-select config (không nhận configId).
 * Phù hợp cho caption, hardsub, và các feature không gắn với tài khoản cụ thể.
 */
export async function callGeminiImpitAutoSelect(
  message: string,
  options: Omit<GeminiImpitOptions, 'configId'> = {}
): Promise<GeminiImpitResult> {
  return callGeminiImpit(message, { ...options, configId: undefined });
}
