import { ipcMain } from 'electron';
import { getDatabase } from '../database/schema';
import { getGeminiWebApiRuntime } from '../services/geminiWebApi';
import { getGeminiWebApiOpsMonitor } from '../services/geminiWebApi/opsMonitor';
import { GEMINI_WEB_API_IPC_CHANNELS } from '../../shared/types/geminiWebApi';

type GeminiChatAccountRow = {
  id: string;
  name: string;
  is_active: number;
};

export function registerGeminiWebApiHandlers(): void {
  console.log('[GeminiWebApiHandlers] Dang ky handlers...');

  ipcMain.handle(GEMINI_WEB_API_IPC_CHANNELS.GET_HEALTH, async () => {
    try {
      const health = await getGeminiWebApiRuntime().healthCheck();
      return {
        success: true,
        data: getGeminiWebApiOpsMonitor().getLastHealth() ?? {
          checkedAt: Date.now(),
          pythonOk: health.pythonOk,
          modulesOk: health.modulesOk,
          cookieReady: health.cookieReady,
          runtimeMode: health.details.runtimeMode,
          pythonPath: health.details.pythonPath,
          pythonVersion: health.details.pythonVersion,
          modules: health.details.modules,
          error: health.details.error
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(GEMINI_WEB_API_IPC_CHANNELS.GET_ACCOUNT_STATUSES, async () => {
    try {
      const db = getDatabase();
      const rows = db
        .prepare(
          `
            SELECT id, name, is_active
            FROM gemini_chat_config
            ORDER BY is_active DESC, updated_at DESC
          `
        )
        .all() as GeminiChatAccountRow[];

      const runtime = getGeminiWebApiRuntime();
      const baseAccounts = await Promise.all(
        rows.map(async (row) => ({
          accountConfigId: row.id,
          accountName: row.name?.trim() || row.id,
          isActive: row.is_active === 1,
          cookieStatus: await runtime.getCookieStatus(row.id)
        }))
      );

      return {
        success: true,
        data: getGeminiWebApiOpsMonitor().buildOpsSnapshot(baseAccounts)
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    GEMINI_WEB_API_IPC_CHANNELS.GET_LOGS,
    async (_, payload?: { limit?: number }) => {
      try {
        return {
          success: true,
          data: getGeminiWebApiOpsMonitor().getLogs(payload?.limit ?? 200)
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(GEMINI_WEB_API_IPC_CHANNELS.CLEAR_LOGS, async () => {
    try {
      getGeminiWebApiOpsMonitor().clearLogs();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  console.log('[GeminiWebApiHandlers] Da dang ky handlers thanh cong');
}
