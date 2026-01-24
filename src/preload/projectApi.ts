/**
 * Project API - Preload bridge cho quản lý dự án
 */

import { ipcRenderer } from 'electron';
import { PROJECT_IPC_CHANNELS } from '../shared/types/project';

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProjectAPI {
  getAll: () => Promise<IpcApiResponse<any[]>>;
  getById: (id: string) => Promise<IpcApiResponse<any>>;
  create: (data: any) => Promise<IpcApiResponse<any>>;
  update: (id: string, data: any) => Promise<IpcApiResponse<any>>;
  delete: (id: string) => Promise<IpcApiResponse<boolean>>;
  saveTranslation: (data: any) => Promise<IpcApiResponse<any>>;
  getTranslations: (projectId: string) => Promise<IpcApiResponse<any[]>>;
  getTranslation: (projectId: string, chapterId: string) => Promise<IpcApiResponse<any>>;
  getHistory: (projectId: string, limit?: number) => Promise<IpcApiResponse<any[]>>;
}

export const projectApi: ProjectAPI = {
  getAll: () => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_ALL),
  getById: (id) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_BY_ID, id),
  create: (data) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.CREATE, data),
  update: (id, data) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.UPDATE, id, data),
  delete: (id) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.DELETE, id),
  saveTranslation: (data) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.SAVE_TRANSLATION, data),
  getTranslations: (projectId) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_TRANSLATIONS, projectId),
  getTranslation: (projectId, chapterId) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_TRANSLATION, projectId, chapterId),
  getHistory: (projectId, limit) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_HISTORY, projectId, limit),
};
