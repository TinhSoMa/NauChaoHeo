/**
 * Gemini Preload API - Expose Gemini APIs cho Renderer process
 */

import { ipcRenderer } from 'electron';
import {
  GEMINI_IPC_CHANNELS,
  KeyInfo,
  ApiStats,
  GeminiResponse,
} from '../shared/types/gemini';

// Response type từ IPC
interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Gemini API interface cho Renderer process
 */
export interface GeminiAPI {
  // API Key Management
  getNextApiKey: () => Promise<IpcApiResponse<{ apiKey: string | null; keyInfo: KeyInfo | null }>>;
  getAllAvailableKeys: () => Promise<IpcApiResponse<KeyInfo[]>>;
  getStats: () => Promise<IpcApiResponse<ApiStats>>;
  recordSuccess: (apiKey: string) => Promise<IpcApiResponse<boolean>>;
  recordRateLimit: (apiKey: string) => Promise<IpcApiResponse<boolean>>;
  recordExhausted: (apiKey: string) => Promise<IpcApiResponse<boolean>>;
  recordError: (apiKey: string, errorMessage: string) => Promise<IpcApiResponse<boolean>>;
  resetAllStatus: () => Promise<IpcApiResponse<boolean>>;
  reloadConfig: () => Promise<IpcApiResponse<boolean>>;

  // Gemini API calls
  callGemini: (prompt: string | object, model?: string) => Promise<IpcApiResponse<GeminiResponse>>;
  translateText: (text: string, targetLanguage?: string, model?: string) => Promise<IpcApiResponse<GeminiResponse>>;
  
  // Key Storage Management
  importKeys: (jsonString: string) => Promise<IpcApiResponse<{ count: number }>>;
  exportKeys: () => Promise<IpcApiResponse<string>>;
  hasKeys: () => Promise<IpcApiResponse<boolean>>;
  getKeysLocation: () => Promise<IpcApiResponse<string>>;
  getAllKeys: () => Promise<IpcApiResponse<any[]>>; // Sử dụng any[] hoặc EmbeddedAccount[] nếu import được
  getAllKeysWithStatus: () => Promise<IpcApiResponse<any[]>>; // Lấy tất cả keys với status chi tiết
}

/**
 * Tạo Gemini API object
 */
export function createGeminiAPI(): GeminiAPI {
  return {
    // API Key Management
    getNextApiKey: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.GET_NEXT_API_KEY),

    getAllAvailableKeys: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.GET_ALL_AVAILABLE_KEYS),

    getStats: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.GET_STATS),

    recordSuccess: (apiKey: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_SUCCESS, apiKey),

    recordRateLimit: (apiKey: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_RATE_LIMIT, apiKey),

    recordExhausted: (apiKey: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_EXHAUSTED, apiKey),

    recordError: (apiKey: string, errorMessage: string) =>
      ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RECORD_ERROR, apiKey, errorMessage),

    resetAllStatus: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RESET_ALL_STATUS),

    reloadConfig: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.RELOAD_CONFIG),

    // Gemini API calls
    callGemini: (prompt: string | object, model?: string) =>
      ipcRenderer.invoke(GEMINI_IPC_CHANNELS.CALL_GEMINI, prompt, model),

    translateText: (text: string, targetLanguage?: string, model?: string) =>
      ipcRenderer.invoke(GEMINI_IPC_CHANNELS.TRANSLATE_TEXT, text, targetLanguage, model),

    // Key Storage Management
    importKeys: (jsonString: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_IMPORT, jsonString),
    exportKeys: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_EXPORT),
    hasKeys: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_HAS_KEYS),
    getKeysLocation: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_LOCATION),
    getAllKeys: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_ALL),
    getAllKeysWithStatus: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_ALL_WITH_STATUS),
  };
}
