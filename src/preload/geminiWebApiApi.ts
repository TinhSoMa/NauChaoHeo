import { ipcRenderer } from 'electron';
import type {
  GeminiWebApiHealthSnapshot,
  GeminiWebApiLogEntry,
  GeminiWebApiOpsSnapshot
} from '../shared/types/geminiWebApi';
import { GEMINI_WEB_API_IPC_CHANNELS } from '../shared/types/geminiWebApi';

export interface GeminiWebApiApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface GeminiWebApiAPI {
  getHealth: () => Promise<GeminiWebApiApiResponse<GeminiWebApiHealthSnapshot>>;
  getAccountStatuses: () => Promise<GeminiWebApiApiResponse<GeminiWebApiOpsSnapshot>>;
  getLogs: (limit?: number) => Promise<GeminiWebApiApiResponse<GeminiWebApiLogEntry[]>>;
  clearLogs: () => Promise<GeminiWebApiApiResponse<void>>;
}

export const geminiWebApiApi: GeminiWebApiAPI = {
  getHealth: () => ipcRenderer.invoke(GEMINI_WEB_API_IPC_CHANNELS.GET_HEALTH),
  getAccountStatuses: () => ipcRenderer.invoke(GEMINI_WEB_API_IPC_CHANNELS.GET_ACCOUNT_STATUSES),
  getLogs: (limit) => ipcRenderer.invoke(GEMINI_WEB_API_IPC_CHANNELS.GET_LOGS, { limit }),
  clearLogs: () => ipcRenderer.invoke(GEMINI_WEB_API_IPC_CHANNELS.CLEAR_LOGS)
};
