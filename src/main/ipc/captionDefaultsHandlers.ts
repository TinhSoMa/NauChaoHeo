import { ipcMain } from 'electron';
import { CAPTION_DEFAULTS_IPC_CHANNELS, CaptionProjectSettingsValues } from '../../shared/types/caption';
import { CaptionDefaultSettingsDatabase } from '../database/captionDefaultSettingsDatabase';

type IpcResponse<T = unknown> = { success: boolean; data?: T; error?: string };

export function registerCaptionDefaultsHandlers(): void {
  ipcMain.handle(
    CAPTION_DEFAULTS_IPC_CHANNELS.GET,
    async (): Promise<IpcResponse<{ schemaVersion: 1; settings: CaptionProjectSettingsValues; updatedAt: number } | null>> => {
      try {
        const row = CaptionDefaultSettingsDatabase.get();
        return { success: true, data: row };
      } catch (error) {
        console.error('[CaptionDefaults] Lỗi get default settings:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_DEFAULTS_IPC_CHANNELS.SAVE,
    async (_event, settings: CaptionProjectSettingsValues): Promise<IpcResponse<{ updatedAt: number }>> => {
      try {
        const saved = CaptionDefaultSettingsDatabase.upsert(settings || {});
        return { success: true, data: { updatedAt: saved.updatedAt } };
      } catch (error) {
        console.error('[CaptionDefaults] Lỗi save default settings:', error);
        return { success: false, error: String(error) };
      }
    }
  );
}

