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
  convId?: string;
  respId?: string;
  candId?: string;
}

export interface UpdateGeminiChatConfigDTO extends Partial<CreateGeminiChatConfigDTO> {
  isActive?: boolean;
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
};
