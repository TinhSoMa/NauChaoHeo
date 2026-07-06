import { ipcRenderer } from 'electron';
import { THUMBNAIL_IPC_CHANNELS } from '../shared/types/thumbnailGenerator';
import type { ThumbnailGenerationOptions, ThumbnailHistoryEntry } from '../shared/types/thumbnailGenerator';

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ThumbnailGeneratorAPI {
  generate: (options: ThumbnailGenerationOptions) => Promise<IpcApiResponse<{ imagePaths: string[]; finalPrompt: string; enhanced: boolean }>>;
  generateFromImage: (imagePath: string, options: ThumbnailGenerationOptions) => Promise<IpcApiResponse<{ imagePaths: string[]; finalPrompt: string; enhanced: boolean }>>;
  getHistory: (limit?: number, offset?: number) => Promise<IpcApiResponse<{ entries: ThumbnailHistoryEntry[]; total: number; hasMore: boolean }>>;
  deleteHistoryEntry: (id: string) => Promise<IpcApiResponse<{ deleted: boolean }>>;
  clearHistory: () => Promise<IpcApiResponse<void>>;
  getSettings: () => Promise<IpcApiResponse<{ outputDir: string }>>;
  updateSettings: (settings: { outputDir: string }) => Promise<IpcApiResponse<{ outputDir: string }>>;
}

export function createThumbnailGeneratorAPI(): ThumbnailGeneratorAPI {
  return {
    generate: (options) => ipcRenderer.invoke(THUMBNAIL_IPC_CHANNELS.GENERATE, options),
    generateFromImage: (imagePath, options) => ipcRenderer.invoke(THUMBNAIL_IPC_CHANNELS.GENERATE_FROM_IMAGE, imagePath, options),
    getHistory: (limit, offset) => ipcRenderer.invoke(THUMBNAIL_IPC_CHANNELS.GET_HISTORY, limit, offset),
    deleteHistoryEntry: (id) => ipcRenderer.invoke(THUMBNAIL_IPC_CHANNELS.DELETE_HISTORY_ENTRY, id),
    clearHistory: () => ipcRenderer.invoke(THUMBNAIL_IPC_CHANNELS.CLEAR_HISTORY),
    getSettings: () => ipcRenderer.invoke(THUMBNAIL_IPC_CHANNELS.GET_SETTINGS),
    updateSettings: (settings) => ipcRenderer.invoke(THUMBNAIL_IPC_CHANNELS.UPDATE_SETTINGS, settings),
  };
}
