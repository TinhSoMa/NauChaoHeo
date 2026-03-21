import { app, ipcMain } from 'electron';
import * as path from 'path';
import { GROK_UI_IPC_CHANNELS, type GrokUiProfileCreateResult } from '../../shared/types/grokUi';
import { getGrokUiRuntime } from '../services/grokUi';

export function registerGrokUiHandlers(): void {
  console.log('[GrokUiHandlers] Dang ky handlers...');

  ipcMain.handle(GROK_UI_IPC_CHANNELS.GET_HEALTH, async () => {
    try {
      const health = await getGrokUiRuntime().getHealth();
      return { success: true, data: health };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    GROK_UI_IPC_CHANNELS.TEST_ASK,
    async (_event, payload?: { prompt?: string; timeoutMs?: number }) => {
      try {
        const prompt = payload?.prompt ?? '';
        const timeoutMs = payload?.timeoutMs;
        const result = await getGrokUiRuntime().ask({ prompt, timeoutMs });
        if (!result.success) {
          return { success: false, error: result.error || 'Grok UI ask failed' };
        }
        return { success: true, data: { text: result.text || '' } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(GROK_UI_IPC_CHANNELS.SHUTDOWN, async () => {
    try {
      await getGrokUiRuntime().shutdown();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    GROK_UI_IPC_CHANNELS.CREATE_PROFILE,
    async (_event, payload?: { profileDir?: string | null; profileName?: string | null; anonymous?: boolean }) => {
      try {
        if (payload?.anonymous) {
          return { success: false, error: 'ANONYMOUS_MODE_NO_PROFILE' };
        }
        const cleanDir = (payload?.profileDir || '').trim();
        const cleanName = (payload?.profileName || '').trim();
        const profileDir = cleanDir || path.join(app.getPath('userData'), 'grok3_profile');
        const profileName = cleanName || 'Default';
        const profilePath = path.join(profileDir, profileName);
        const fs = await import('fs/promises');
        await fs.mkdir(profilePath, { recursive: true });
        const result: GrokUiProfileCreateResult = {
          profileDir,
          profileName,
          profilePath,
        };
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[GrokUiHandlers] Da dang ky handlers thanh cong');
}
