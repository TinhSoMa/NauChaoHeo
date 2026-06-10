import { ipcMain } from 'electron';
import { CAPTION_IPC_CHANNELS } from '../../shared/types/caption';
import { CapcutTtsConfigsDatabase } from '../database/capcutTtsSecretsDatabase';
import type { CapcutTtsVersionRow } from '../database/capcutTtsSecretsDatabase';

type IpcResponse<T = unknown> = { success: boolean; data?: T; error?: string };

export function registerCapcutTtsSecretsHandlers(): void {
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_LIST,
    async (): Promise<IpcResponse<CapcutTtsVersionRow[]>> => {
      try {
        return { success: true, data: CapcutTtsConfigsDatabase.list() };
      } catch (error) {
        console.error('[CapcutTtsConfigs] Lỗi list:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_GET,
    async (_event, version?: string): Promise<IpcResponse<CapcutTtsVersionRow | null>> => {
      try {
        const result = version
          ? CapcutTtsConfigsDatabase.get(version)
          : CapcutTtsConfigsDatabase.getActive();
        return { success: true, data: result };
      } catch (error) {
        console.error('[CapcutTtsConfigs] Lỗi get:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_SAVE,
    async (
      _event,
      version: string,
      label: string,
      payload: {
        appKey?: string | null;
        token?: string | null;
        wsUrl?: string;
        userAgent?: string;
        xSsDp?: string | null;
        extraHeaders?: Record<string, string> | null;
      }
    ): Promise<IpcResponse<CapcutTtsVersionRow>> => {
      try {
        const saved = CapcutTtsConfigsDatabase.upsert(version, label, payload);
        return { success: true, data: saved };
      } catch (error) {
        console.error('[CapcutTtsConfigs] Lỗi save:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_DELETE,
    async (_event, version: string): Promise<IpcResponse<{ deleted: boolean }>> => {
      try {
        const deleted = CapcutTtsConfigsDatabase.delete(version);
        return { success: true, data: { deleted } };
      } catch (error) {
        console.error('[CapcutTtsConfigs] Lỗi delete:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_SET_ACTIVE,
    async (_event, version: string): Promise<IpcResponse<CapcutTtsVersionRow | null>> => {
      try {
        const row = CapcutTtsConfigsDatabase.setActive(version);
        return { success: true, data: row };
      } catch (error) {
        console.error('[CapcutTtsConfigs] Lỗi setActive:', error);
        return { success: false, error: String(error) };
      }
    }
  );
}
