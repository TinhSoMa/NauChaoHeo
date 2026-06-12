import { ipcRenderer } from 'electron';
import type { AppLogEntry, AppLogAppendPayload } from '../shared/types/appLogs';
import { APP_LOG_IPC_CHANNELS } from '../shared/types/appLogs';

export interface AppLogsApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AppLogsAPI {
  getLogs: (limit?: number) => Promise<AppLogsApiResponse<AppLogEntry[]>>;
  clearLogs: () => Promise<AppLogsApiResponse<void>>;
  append: (payload: AppLogAppendPayload) => void;
  onLog: (callback: (entry: AppLogEntry) => void) => () => void;
}

export const appLogsApi: AppLogsAPI = {
  getLogs: (limit) => ipcRenderer.invoke(APP_LOG_IPC_CHANNELS.GET_LOGS, { limit }),
  clearLogs: () => ipcRenderer.invoke(APP_LOG_IPC_CHANNELS.CLEAR_LOGS),
  append: (payload) => ipcRenderer.send(APP_LOG_IPC_CHANNELS.APPEND, payload),
  onLog: (callback) => {
    const subscription = (_event: unknown, entry: AppLogEntry) => callback(entry);
    ipcRenderer.on(APP_LOG_IPC_CHANNELS.ENTRY, subscription);
    return () => {
      ipcRenderer.removeListener(APP_LOG_IPC_CHANNELS.ENTRY, subscription);
    };
  }
};
