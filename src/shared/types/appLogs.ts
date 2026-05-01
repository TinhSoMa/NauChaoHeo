export const APP_LOG_IPC_CHANNELS = {
  GET_LOGS: 'appLogs:getLogs',
  CLEAR_LOGS: 'appLogs:clearLogs',
  APPEND: 'appLogs:append',
  ENTRY: 'appLogs:entry'
} as const;

export type AppLogLevel = 'info' | 'warn' | 'error' | 'success';

export type AppLogSource = 'main' | 'renderer';

export interface AppLogEntry {
  seq: number;
  timestamp: number;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  meta?: Record<string, unknown>;
}

export interface AppLogAppendPayload {
  level: AppLogLevel;
  source?: AppLogSource;
  message: string;
  timestamp?: number;
  meta?: Record<string, unknown>;
}
