import { ipcMain } from 'electron';
import { CAPTION_IPC_CHANNELS } from '../../shared/types/caption';
import { CapcutTtsTokensDatabase } from '../database/capcutTtsTokensDatabase';
import type { CapcutTtsTokenRow } from '../database/capcutTtsTokensDatabase';

type IpcResponse<T = unknown> = { success: boolean; data?: T; error?: string };

export function registerCapcutTtsSecretsHandlers(): void {
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_LIST,
    async (): Promise<IpcResponse<CapcutTtsTokenRow[]>> => {
      try {
        return { success: true, data: CapcutTtsTokensDatabase.list() };
      } catch (error) {
        console.error('[CapcutTtsTokens] Lỗi list:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_GET,
    async (_event, version?: string): Promise<IpcResponse<CapcutTtsTokenRow | null>> => {
      try {
        const result = version
          ? CapcutTtsTokensDatabase.get(version)
          : CapcutTtsTokensDatabase.getActive();
        return { success: true, data: result };
      } catch (error) {
        console.error('[CapcutTtsTokens] Lỗi get:', error);
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
      payload: { token?: string | null }
    ): Promise<IpcResponse<CapcutTtsTokenRow>> => {
      try {
        const saved = CapcutTtsTokensDatabase.upsert(version, label, payload);
        return { success: true, data: saved };
      } catch (error) {
        console.error('[CapcutTtsTokens] Lỗi save:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_DELETE,
    async (_event, version: string): Promise<IpcResponse<{ deleted: boolean }>> => {
      try {
        const deleted = CapcutTtsTokensDatabase.delete(version);
        return { success: true, data: { deleted } };
      } catch (error) {
        console.error('[CapcutTtsTokens] Lỗi delete:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.CAPCUT_TTS_CONFIGS_SET_ACTIVE,
    async (_event, version: string): Promise<IpcResponse<CapcutTtsTokenRow | null>> => {
      try {
        const row = CapcutTtsTokensDatabase.setActive(version);
        return { success: true, data: row };
      } catch (error) {
        console.error('[CapcutTtsTokens] Lỗi setActive:', error);
        return { success: false, error: String(error) };
      }
    }
  );
}
