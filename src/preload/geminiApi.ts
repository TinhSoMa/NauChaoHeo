/**
 * Gemini Preload API - Expose Gemini APIs cho Renderer process
 */

import { ipcRenderer } from 'electron';
import {
  GEMINI_IPC_CHANNELS,
  KeyInfo,
  ApiStats,
  GeminiResponse,
  GeminiCatalogModel,
  GeminiCatalogModelInput,
  GeminiCatalogModelUpdate,
  GeminiSyncModelsResult,
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
  disableAccount: (accountId: string) => Promise<IpcApiResponse<boolean>>;
  enableAccount: (accountId: string) => Promise<IpcApiResponse<boolean>>;
  disableProject: (accountId: string, projectIndex: number) => Promise<IpcApiResponse<boolean>>;
  enableProject: (accountId: string, projectIndex: number) => Promise<IpcApiResponse<boolean>>;
  hasKeys: () => Promise<IpcApiResponse<boolean>>;
  getKeysLocation: () => Promise<IpcApiResponse<string>>;
  getAllKeys: () => Promise<IpcApiResponse<any[]>>; // Sử dụng any[] hoặc EmbeddedAccount[] nếu import được
  getAllKeysWithStatus: () => Promise<IpcApiResponse<any[]>>; // Lấy tất cả keys với status chi tiết

  // Model Catalog Management
  getModels: () => Promise<IpcApiResponse<GeminiCatalogModel[]>>;
  createModel: (payload: GeminiCatalogModelInput) => Promise<IpcApiResponse<GeminiCatalogModel>>;
  updateModel: (payload: { modelId: string; patch: GeminiCatalogModelUpdate }) => Promise<IpcApiResponse<GeminiCatalogModel>>;
  deleteModel: (modelId: string) => Promise<IpcApiResponse<boolean>>;
  setModelEnabled: (payload: { modelId: string; enabled: boolean }) => Promise<IpcApiResponse<boolean>>;
  getDefaultModel: () => Promise<IpcApiResponse<string | null>>;
  setDefaultModel: (modelId: string) => Promise<IpcApiResponse<string>>;
  syncModelsFromGoogle: () => Promise<IpcApiResponse<GeminiSyncModelsResult>>;
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
    disableAccount: (accountId: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_DISABLE_ACCOUNT, accountId),
    enableAccount: (accountId: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_ENABLE_ACCOUNT, accountId),
    disableProject: (accountId: string, projectIndex: number) => ipcRenderer.invoke(
      GEMINI_IPC_CHANNELS.KEYS_DISABLE_PROJECT,
      accountId,
      projectIndex
    ),
    enableProject: (accountId: string, projectIndex: number) => ipcRenderer.invoke(
      GEMINI_IPC_CHANNELS.KEYS_ENABLE_PROJECT,
      accountId,
      projectIndex
    ),
    hasKeys: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_HAS_KEYS),
    getKeysLocation: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_LOCATION),
    getAllKeys: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_ALL),
    getAllKeysWithStatus: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.KEYS_GET_ALL_WITH_STATUS),

    // Model Catalog Management
    getModels: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_GET_ALL),
    createModel: (payload: GeminiCatalogModelInput) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_CREATE, payload),
    updateModel: (payload: { modelId: string; patch: GeminiCatalogModelUpdate }) =>
      ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_UPDATE, payload),
    deleteModel: (modelId: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_DELETE, modelId),
    setModelEnabled: (payload: { modelId: string; enabled: boolean }) =>
      ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_SET_ENABLED, payload),
    getDefaultModel: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_GET_DEFAULT),
    setDefaultModel: (modelId: string) => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_SET_DEFAULT, modelId),
    syncModelsFromGoogle: () => ipcRenderer.invoke(GEMINI_IPC_CHANNELS.MODELS_SYNC_GOOGLE),
  };
}
