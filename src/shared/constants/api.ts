/**
 * Cấu hình API Endpoints
 * Tập trung quản lý tất cả các URL API của ứng dụng
 */

// ============================================
// GEMINI API
// ============================================

/**
 * Base URL của Gemini API
 */
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Các model Gemini hỗ trợ
 */
export const GEMINI_MODELS = {
  FLASH_2_5: 'gemini-2.5-flash',
  FLASH_2_0: 'gemini-2.0-flash',
  FLASH_1_5: 'gemini-1.5-flash',
  PRO_1_5: 'gemini-1.5-pro',
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

/**
 * Tạo URL đầy đủ để gọi Gemini API
 * @param model - Tên model Gemini
 * @param apiKey - API key
 * @returns URL đầy đủ
 */
export function buildGeminiApiUrl(model: GeminiModel, apiKey: string): string {
  return `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
}

// ============================================
// THÊM CÁC API KHÁC Ở ĐÂY
// ============================================

// Ví dụ:
// export const OPENAI_API_BASE = 'https://api.openai.com/v1';
// export const CLAUDE_API_BASE = 'https://api.anthropic.com/v1';
