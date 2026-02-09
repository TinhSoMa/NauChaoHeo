/**
 * GeminiChat Preload API - Expose Gemini Chat config API to renderer
 */

import { ipcRenderer } from 'electron';

// Interface cho cau hinh
export interface GeminiChatConfig {
  id: string;
  name: string;
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  proxyId?: string;
  convId: string;
  respId: string;
  candId: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateGeminiChatConfigDTO {
  name?: string;
  cookie: string;
  blLabel?: string;
  fSid?: string;
  atToken?: string;
  proxyId?: string;
  convId?: string;
  respId?: string;
  candId?: string;
}

export interface UpdateGeminiChatConfigDTO extends Partial<CreateGeminiChatConfigDTO> {
  isActive?: boolean;
}

// Interface cho cookie config (bảng riêng, chỉ 1 dòng)
export interface GeminiCookieConfig {
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  reqId?: string;
  updatedAt: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// IPC Channel names
const CHANNELS = {
  GET_ALL: 'geminiChat:getAll',
  GET_ACTIVE: 'geminiChat:getActive',
  GET_BY_ID: 'geminiChat:getById',
  CREATE: 'geminiChat:create',
  UPDATE: 'geminiChat:update',
  DELETE: 'geminiChat:delete',
  SEND_MESSAGE: 'geminiChat:sendMessage',
  CHECK_DUPLICATE_TOKEN: 'geminiChat:checkDuplicateToken',
  GET_COOKIE_CONFIG: 'geminiChat:getCookieConfig',
  SAVE_COOKIE_CONFIG: 'geminiChat:saveCookieConfig',
  GET_MAX_IMPIT_BROWSERS: 'geminiChat:getMaxImpitBrowsers',
  RELEASE_ALL_IMPIT_BROWSERS: 'geminiChat:releaseAllImpitBrowsers',
};

// API interface
export interface GeminiChatAPI {
  getAll: () => Promise<ApiResponse<GeminiChatConfig[]>>;
  getActive: () => Promise<ApiResponse<GeminiChatConfig | null>>;
  getById: (id: string) => Promise<ApiResponse<GeminiChatConfig | null>>;
  create: (data: CreateGeminiChatConfigDTO) => Promise<ApiResponse<GeminiChatConfig>>;
  update: (id: string, data: UpdateGeminiChatConfigDTO) => Promise<ApiResponse<GeminiChatConfig | null>>;
  delete: (id: string) => Promise<ApiResponse<boolean>>;
  sendMessage: (message: string, configId: string, context?: { conversationId: string; responseId: string; choiceId: string }) => Promise<ApiResponse<{ text: string; context: { conversationId: string; responseId: string; choiceId: string } }>>;
  checkDuplicateToken: (payload: { cookie: string; atToken: string; excludeId?: string }) => Promise<ApiResponse<{ isDuplicate: boolean; duplicate?: GeminiChatConfig }>>;
  
  // Cookie config methods
  getCookieConfig: () => Promise<ApiResponse<GeminiCookieConfig | null>>;
  saveCookieConfig: (data: { cookie: string; blLabel: string; fSid: string; atToken: string; reqId?: string }) => Promise<ApiResponse<null>>;

  // Impit browser management
  getMaxImpitBrowsers: () => Promise<ApiResponse<number>>;
  releaseAllImpitBrowsers: () => Promise<ApiResponse<void>>;
}

// API implementation
export const geminiChatApi: GeminiChatAPI = {
  getAll: () => ipcRenderer.invoke(CHANNELS.GET_ALL),
  getActive: () => ipcRenderer.invoke(CHANNELS.GET_ACTIVE),
  getById: (id) => ipcRenderer.invoke(CHANNELS.GET_BY_ID, id),
  create: (data) => ipcRenderer.invoke(CHANNELS.CREATE, data),
  update: (id, data) => ipcRenderer.invoke(CHANNELS.UPDATE, id, data),
  delete: (id) => ipcRenderer.invoke(CHANNELS.DELETE, id),
  sendMessage: (message, configId, context) => ipcRenderer.invoke(CHANNELS.SEND_MESSAGE, message, configId, context),
  checkDuplicateToken: (payload) => ipcRenderer.invoke(CHANNELS.CHECK_DUPLICATE_TOKEN, payload),
  
  // Cookie config
  getCookieConfig: () => ipcRenderer.invoke(CHANNELS.GET_COOKIE_CONFIG),
  saveCookieConfig: (data) => ipcRenderer.invoke(CHANNELS.SAVE_COOKIE_CONFIG, data),

  // Impit browser management
  getMaxImpitBrowsers: () => ipcRenderer.invoke(CHANNELS.GET_MAX_IMPIT_BROWSERS),
  releaseAllImpitBrowsers: () => ipcRenderer.invoke(CHANNELS.RELEASE_ALL_IMPIT_BROWSERS),
};
