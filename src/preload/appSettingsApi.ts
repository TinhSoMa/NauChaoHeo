/**
 * App Settings API - Preload API cho cài đặt ứng dụng
 */

import { ipcRenderer } from 'electron';
import type { ASSStyleConfig } from '../shared/types/caption';

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
export interface CaptionTypographyLayoutDefaults {
  style: ASSStyleConfig;
  subtitlePosition: { x: number; y: number } | null;
  thumbnailTextPrimaryFontName: string;
  thumbnailTextPrimaryFontSize: number;
  thumbnailTextSecondaryFontName: string;
  thumbnailTextSecondaryFontSize: number;
  thumbnailLineHeightRatio: number;
  thumbnailTextPrimaryPosition: { x: number; y: number };
  thumbnailTextSecondaryPosition: { x: number; y: number };
}

export interface CaptionTypographyDefaults {
  schemaVersion: 1;
  landscape: CaptionTypographyLayoutDefaults;
  portrait: CaptionTypographyLayoutDefaults;
}

export interface AppSettings {
  projectsBasePath: string | null;
  theme: 'light' | 'dark' | 'system';
  language: 'vi' | 'en';
  recentProjectIds: string[];
  lastActiveProjectId: string | null;
  useProxy: boolean;
  createChatOnWeb: boolean;
  useStoredContextOnFirstSend: boolean;
  translationPromptId: string | null;
  summaryPromptId: string | null;
  captionPromptId: string | null;
  captionLogoPath: string | null;
  captionLogoPosition: { x: number; y: number } | null;
  captionLogoScale: number;
  captionTypographyDefaults: CaptionTypographyDefaults | null;
  capcutTtsSecrets: {
    appKey: string | null;
    token: string | null;
    wsUrl: string | null;
    userAgent: string | null;
    xSsDp: string | null;
    extraHeaders: Record<string, string> | null;
  };
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
  getProjectsBasePath: () => Promise<IpcApiResponse<string | null>>;
  setProjectsBasePath: (basePath: string | null) => Promise<IpcApiResponse<void>>;
  addRecentProject: (projectId: string) => Promise<IpcApiResponse<void>>;
  getRecentProjectIds: () => Promise<IpcApiResponse<string[]>>;
  getLastActiveProjectId: () => Promise<IpcApiResponse<string | null>>;
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
