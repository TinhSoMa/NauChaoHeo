import { ipcMain } from 'electron';
import { GROK_UI_IPC_CHANNELS, type GrokUiProfileCreateResult, type GrokUiProfileConfig } from '../../shared/types/grokUi';
import { getGrokUiRuntime } from '../services/grokUi';
import { GrokUiProfileDatabase } from '../database/grokUiProfileDatabase';
import { AppSettingsService } from '../services/appSettings';

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

  ipcMain.handle(GROK_UI_IPC_CHANNELS.GET_PROFILE_STATUSES, async () => {
    try {
      const data = await getGrokUiRuntime().getProfileStatuses();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(GROK_UI_IPC_CHANNELS.RESET_PROFILE_STATUSES, async () => {
    try {
      await getGrokUiRuntime().resetProfileStatuses();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(GROK_UI_IPC_CHANNELS.GET_PROFILES, async () => {
    try {
      const profiles = GrokUiProfileDatabase.getAll();
      return { success: true, data: profiles };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    GROK_UI_IPC_CHANNELS.SAVE_PROFILES,
    async (_event, payload?: { profiles?: GrokUiProfileConfig[] }) => {
      try {
        const profiles = Array.isArray(payload?.profiles) ? payload?.profiles : [];
        GrokUiProfileDatabase.replaceAll(profiles);
        AppSettingsService.update({ grokUiProfiles: profiles });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    GROK_UI_IPC_CHANNELS.SET_PROFILE_ENABLED,
    async (_event, payload?: { id?: string; enabled?: boolean }) => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : '';
        if (!id) {
          return { success: false, error: 'INVALID_PROFILE_ID' };
        }
        const enabled = payload?.enabled === true;
        const ok = GrokUiProfileDatabase.setEnabled(id, enabled);
        AppSettingsService.update({ grokUiProfiles: GrokUiProfileDatabase.getAll() });
        return { success: ok };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    GROK_UI_IPC_CHANNELS.DELETE_PROFILE,
    async (_event, payload?: { id?: string }) => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : '';
        if (!id) {
          return { success: false, error: 'INVALID_PROFILE_ID' };
        }
        const ok = GrokUiProfileDatabase.delete(id);
        AppSettingsService.update({ grokUiProfiles: GrokUiProfileDatabase.getAll() });
        return { success: ok };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    GROK_UI_IPC_CHANNELS.CREATE_PROFILE,
    async (
      _event,
      payload?: { id?: string; profileDir?: string | null; profileName?: string | null; anonymous?: boolean }
    ) => {
      try {
        if (payload?.anonymous) {
          return { success: false, error: 'ANONYMOUS_MODE_NO_PROFILE' };
        }
        const cleanId = typeof payload?.id === 'string' ? payload.id.trim() : '';
        const cleanDir = (payload?.profileDir || '').trim();
        const cleanName = (payload?.profileName || '').trim();
        const profileDir = cleanDir.length > 0 ? cleanDir : undefined;
        const profileName = cleanName.length > 0 ? cleanName : undefined;
        const result = await getGrokUiRuntime().createProfile({
          profileDir,
          profileName,
          allowExisting: true,
        });
        if (!result.success || !result.profileDir || !result.profileName || !result.profilePath) {
          return { success: false, error: result.error || 'CREATE_PROFILE_FAILED' };
        }
        const profileId = cleanId || `grok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const profileConfig: GrokUiProfileConfig = {
          id: profileId,
          profileDir: result.profileDir,
          profileName: result.profileName,
          anonymous: false,
          enabled: true,
        };
        const sortOrder = GrokUiProfileDatabase.getNextSortOrder();
        GrokUiProfileDatabase.upsert(profileConfig, sortOrder);
        AppSettingsService.update({ grokUiProfiles: GrokUiProfileDatabase.getAll() });
        const payloadResult: GrokUiProfileCreateResult = {
          id: profileId,
          profileDir: result.profileDir,
          profileName: result.profileName,
          profilePath: result.profilePath,
        };
        return { success: true, data: payloadResult };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[GrokUiHandlers] Da dang ky handlers thanh cong');
}
