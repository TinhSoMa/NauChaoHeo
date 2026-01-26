/**
 * Gemini Module - Export tất cả services
 */

// API Key Management
export { getApiManager, ApiKeyManager } from './apiManager';
export * from './apiConfig';
export * from './apiKeys';

// Session & Configuration Management (NEW)
export { getSessionContextManager, SessionContextManager, type SessionContext } from './sessionContextManager';
export { getConfigurationService, ConfigurationService, type GeminiCookieConfig, type ValidationResult } from './configurationService';
export { getProgressTracker, ProgressTracker, type ChapterMetrics, type TranslationMetrics } from './progressTracker';

// Gemini Service
export {
  callGeminiApi,
  callGeminiWithRotation,
  translateText,
  chat,
  getModelInfo,
  GEMINI_MODELS,
  type GeminiModel,
} from './geminiService';
