/**
 * Cấu hình API Endpoints
 * Tập trung quản lý tất cả các URL API của ứng dụng
 */

// ============================================
// GEMINI API - Re-export từ file tập trung
// ============================================

// Import và re-export từ file gemini.ts (nguồn duy nhất)
export {
  GEMINI_API_BASE,
  GEMINI_MODELS,
  GEMINI_MODEL_LIST,
  DEFAULT_GEMINI_MODEL,
  buildGeminiApiUrl,
  getGeminiModelInfo,
  type GeminiModel,
  type GeminiModelInfo,
} from '../types/gemini';

// ============================================
// THÊM CÁC API KHÁC Ở ĐÂY
// ============================================

// Ví dụ:
// export const OPENAI_API_BASE = 'https://api.openai.com/v1';
// export const CLAUDE_API_BASE = 'https://api.anthropic.com/v1';
