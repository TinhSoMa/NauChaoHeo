import { ipcMain } from 'electron';
import { DEEPSEEK_IPC_CHANNELS } from '../../shared/types/deepseek';
import type { DeepSeekConfig } from '../../shared/types/deepseek';
import { getConfig, setConfig, listDeepSeekModels } from '../services/deepseek/deepseekService.js';

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export function registerDeepSeekHandlers(): void {
  ipcMain.handle(
    DEEPSEEK_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<IpcApiResponse<DeepSeekConfig>> => {
      try {
        const config = getConfig();
        return { success: true, data: config };
      } catch (error) {
        console.error('[IPC] Lỗi deepseek:getConfig:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    DEEPSEEK_IPC_CHANNELS.SET_CONFIG,
    async (_event, partial: Partial<DeepSeekConfig>): Promise<IpcApiResponse<DeepSeekConfig>> => {
      try {
        setConfig(partial);
        return { success: true, data: getConfig() };
      } catch (error) {
        console.error('[IPC] Lỗi deepseek:setConfig:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    DEEPSEEK_IPC_CHANNELS.LIST_MODELS,
    async (_event, apiKey: string): Promise<IpcApiResponse<Array<{ id: string }>>> => {
      try {
        const result = await listDeepSeekModels(apiKey);
        if (!result.success) {
          return { success: false, error: result.error };
        }
        const models = result.data.map((m) => ({ id: m.id }));
        return { success: true, data: models };
      } catch (error) {
        console.error('[IPC] Lỗi deepseek:listModels:', error);
        return { success: false, error: String(error) };
      }
    }
  );
}
