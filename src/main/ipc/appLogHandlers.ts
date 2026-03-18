import { BrowserWindow, ipcMain } from 'electron';
import { APP_LOG_IPC_CHANNELS, AppLogAppendPayload } from '../../shared/types/appLogs';
import { getAppLogStore } from '../services/logging/appLogStore';

function broadcastEntry(entry: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (win.isDestroyed()) {
      continue;
    }
    win.webContents.send(APP_LOG_IPC_CHANNELS.ENTRY, entry);
  }
}

export function registerAppLogHandlers(): void {
  const store = getAppLogStore();

  ipcMain.handle(APP_LOG_IPC_CHANNELS.GET_LOGS, async (_, payload?: { limit?: number }) => {
    try {
      return { success: true, data: store.getLogs(payload?.limit ?? 300) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(APP_LOG_IPC_CHANNELS.CLEAR_LOGS, async () => {
    try {
      store.clear();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.on(APP_LOG_IPC_CHANNELS.APPEND, (_event, payload: AppLogAppendPayload) => {
    if (!payload || !payload.message) {
      return;
    }
    store.append({
      level: payload.level,
      source: payload.source ?? 'renderer',
      message: payload.message,
      timestamp: payload.timestamp,
      meta: payload.meta
    });
  });

  store.subscribe((entry) => {
    broadcastEntry(entry);
  });
}
