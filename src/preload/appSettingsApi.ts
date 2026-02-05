/**
 * App Settings API - Preload API cho cài đặt ứng dụng
 */

import { ipcRenderer } from 'electron';

// IPC Channels (phải khớp với appSettingsHandlers.ts)
const APP_SETTINGS_IPC_CHANNELS = {
  GET_ALL: 'appSettings:getAll',
  UPDATE: 'appSettings:update',
  GET_PROJECTS_BASE_PATH: 'appSettings:getProjectsBasePath',
  SET_PROJECTS_BASE_PATH: 'appSettings:setProjectsBasePath',
  ADD_RECENT_PROJECT: 'appSettings:addRecentProject',
  GET_RECENT_PROJECT_IDS: 'appSettings:getRecentProjectIds',
  GET_LAST_ACTIVE_PROJECT_ID: 'appSettings:getLastActiveProjectId',
  REMOVE_FROM_RECENT: 'appSettings:removeFromRecent',
} as const;

// Types
export interface AppSettings {
  projectsBasePath: string | null;
  theme: 'light' | 'dark' | 'system';
  language: 'vi' | 'en';
  recentProjectIds: string[];
  lastActiveProjectId: string | null;
  useProxy: boolean;
  createChatOnWeb: boolean;
  translationPromptId: string | null;
  summaryPromptId: string | null;
}

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// API Interface
export interface AppSettingsAPI {
  getAll: () => Promise<IpcApiResponse<AppSettings>>;
  update: (partial: Partial<AppSettings>) => Promise<IpcApiResponse<AppSettings>>;
  getProjectsBasePath: () => Promise<IpcApiResponse<string>>;
  setProjectsBasePath: (basePath: string | null) => Promise<IpcApiResponse<void>>;
  addRecentProject: (projectId: string) => Promise<IpcApiResponse<void>>;
  getRecentProjectIds: () => Promise<IpcApiResponse<string[]>>;
  getLastActiveProjectId: () => Promise<IpcApiResponse<string | null>>;
  useStoredContextOnFirstSend: boolean;
  removeFromRecent: (projectId: string) => Promise<IpcApiResponse<void>>;
}

// Create API
export function createAppSettingsAPI(): AppSettingsAPI {
  return {
    getAll: () => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_ALL),
    update: (partial) => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.UPDATE, partial),
    getProjectsBasePath: () => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_PROJECTS_BASE_PATH),
    setProjectsBasePath: (basePath) => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.SET_PROJECTS_BASE_PATH, basePath),
    addRecentProject: (projectId) => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.ADD_RECENT_PROJECT, projectId),
    getRecentProjectIds: () => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_RECENT_PROJECT_IDS),
    getLastActiveProjectId: () => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.GET_LAST_ACTIVE_PROJECT_ID),
    removeFromRecent: (projectId) => ipcRenderer.invoke(APP_SETTINGS_IPC_CHANNELS.REMOVE_FROM_RECENT, projectId),
  };
}

// Export singleton
export const appSettingsApi = createAppSettingsAPI();
