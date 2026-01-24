/**
 * App Settings Handlers - IPC handlers cho cài đặt ứng dụng
 */

import { ipcMain, dialog } from 'electron';
import { AppSettingsService, AppSettings } from '../services/appSettings';

// IPC Channels
export const APP_SETTINGS_IPC_CHANNELS = {
  GET_ALL: 'appSettings:getAll',
  UPDATE: 'appSettings:update',
  GET_PROJECTS_BASE_PATH: 'appSettings:getProjectsBasePath',
  SET_PROJECTS_BASE_PATH: 'appSettings:setProjectsBasePath',
  ADD_RECENT_PROJECT: 'appSettings:addRecentProject',
  GET_RECENT_PROJECT_IDS: 'appSettings:getRecentProjectIds',
  GET_LAST_ACTIVE_PROJECT_ID: 'appSettings:getLastActiveProjectId',
  REMOVE_FROM_RECENT: 'appSettings:removeFromRecent',
} as const;

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export function registerAppSettingsHandlers(): void {
  console.log('[AppSettingsHandlers] Đăng ký handlers...');

  // ============================================
  // DIALOG OPEN DIRECTORY
  // ============================================
  ipcMain.handle('dialog:openDirectory', async () => {
    console.log('[AppSettingsHandlers] Mở dialog chọn thư mục...');
    
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    
    return result;
  });

  // Get all settings
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_ALL, async (): Promise<IpcApiResponse<AppSettings>> => {
    try {
      const settings = AppSettingsService.getAll();
      return { success: true, data: settings };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error getting settings:', error);
      return { success: false, error: String(error) };
    }
  });

  // Update settings (partial)
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.UPDATE, async (_, partial: Partial<AppSettings>): Promise<IpcApiResponse<AppSettings>> => {
    try {
      const settings = AppSettingsService.update(partial);
      return { success: true, data: settings };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error updating settings:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get projects base path
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_PROJECTS_BASE_PATH, async (): Promise<IpcApiResponse<string>> => {
    try {
      const basePath = AppSettingsService.getProjectsBasePath();
      return { success: true, data: basePath };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error getting projects base path:', error);
      return { success: false, error: String(error) };
    }
  });

  // Set projects base path
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.SET_PROJECTS_BASE_PATH, async (_, basePath: string | null): Promise<IpcApiResponse<void>> => {
    try {
      AppSettingsService.setProjectsBasePath(basePath);
      return { success: true };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error setting projects base path:', error);
      return { success: false, error: String(error) };
    }
  });

  // Add recent project
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.ADD_RECENT_PROJECT, async (_, projectId: string): Promise<IpcApiResponse<void>> => {
    try {
      AppSettingsService.addRecentProject(projectId);
      return { success: true };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error adding recent project:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get recent project IDs
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_RECENT_PROJECT_IDS, async (): Promise<IpcApiResponse<string[]>> => {
    try {
      const ids = AppSettingsService.getRecentProjectIds();
      return { success: true, data: ids };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error getting recent projects:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get last active project ID
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_LAST_ACTIVE_PROJECT_ID, async (): Promise<IpcApiResponse<string | null>> => {
    try {
      const id = AppSettingsService.getLastActiveProjectId();
      return { success: true, data: id };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error getting last active project:', error);
      return { success: false, error: String(error) };
    }
  });

  // Remove from recent
  ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.REMOVE_FROM_RECENT, async (_, projectId: string): Promise<IpcApiResponse<void>> => {
    try {
      AppSettingsService.removeFromRecent(projectId);
      return { success: true };
    } catch (error) {
      console.error('[AppSettingsHandlers] Error removing from recent:', error);
      return { success: false, error: String(error) };
    }
  });

  console.log('[AppSettingsHandlers] Đã đăng ký handlers thành công');
}
