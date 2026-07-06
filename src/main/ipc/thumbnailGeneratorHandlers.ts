import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { THUMBNAIL_IPC_CHANNELS } from '../../shared/types/thumbnailGenerator';
import type { ThumbnailGenerationOptions } from '../../shared/types/thumbnailGenerator';
import { ThumbnailGeneratorService } from '../services/thumbnailGenerator';
import { AppSettingsService } from '../services/appSettings';

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

let service: ThumbnailGeneratorService | null = null;

function getService(): ThumbnailGeneratorService {
  if (!service) {
    const settings = AppSettingsService.getAll();
    const outputDir = settings.thumbnailOutputDir || app.getPath('documents');
    service = new ThumbnailGeneratorService(outputDir);
  }
  return service;
}

export function registerThumbnailGeneratorHandlers(): void {
  ipcMain.handle(
    THUMBNAIL_IPC_CHANNELS.GENERATE,
    async (_event, options: ThumbnailGenerationOptions): Promise<IpcApiResponse<{ imagePaths: string[]; finalPrompt: string; enhanced: boolean }>> => {
      try {
        const result = await getService().generate(options);
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: { imagePaths: result.imagePaths, finalPrompt: result.finalPrompt, enhanced: result.enhanced } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    THUMBNAIL_IPC_CHANNELS.GENERATE_FROM_IMAGE,
    async (_event, imagePath: string, options: ThumbnailGenerationOptions): Promise<IpcApiResponse<{ imagePaths: string[]; finalPrompt: string; enhanced: boolean }>> => {
      try {
        const stat = fs.statSync(imagePath);
        const buffer = fs.readFileSync(imagePath);
        const mimeType = detectMimeTypeSimple(buffer);
        const inputImageInfo = {
          originalName: path.basename(imagePath),
          size: stat.size,
          mimeType,
        };
        const result = await getService().generate({ ...options, imagePath, inputImageInfo });
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: { imagePaths: result.imagePaths, finalPrompt: result.finalPrompt, enhanced: result.enhanced } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    THUMBNAIL_IPC_CHANNELS.GET_HISTORY,
    async (_event, limit?: number, offset?: number): Promise<IpcApiResponse<{ entries: import('../../shared/types/thumbnailGenerator').ThumbnailHistoryEntry[]; total: number; hasMore: boolean }>> => {
      try {
        const result = getService().getHistory(limit, offset);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    THUMBNAIL_IPC_CHANNELS.DELETE_HISTORY_ENTRY,
    async (_event, id: string): Promise<IpcApiResponse<{ deleted: boolean }>> => {
      try {
        const result = getService().deleteEntry(id);
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: { deleted: true } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    THUMBNAIL_IPC_CHANNELS.CLEAR_HISTORY,
    async (): Promise<IpcApiResponse<void>> => {
      try {
        getService().clearHistory();
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    THUMBNAIL_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<IpcApiResponse<{ outputDir: string }>> => {
      try {
        const settings = AppSettingsService.getAll();
        const outputDir = settings.thumbnailOutputDir || app.getPath('documents');
        return { success: true, data: { outputDir } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    THUMBNAIL_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_event, settings: { outputDir: string }): Promise<IpcApiResponse<{ outputDir: string }>> => {
      try {
        AppSettingsService.update({ thumbnailOutputDir: settings.outputDir });
        if (service) service.setOutputDir(settings.outputDir);
        return { success: true, data: { outputDir: settings.outputDir } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
}

function detectMimeTypeSimple(buffer: Buffer): string {
  const signatures: [string, number[]][] = [
    ['image/jpeg', [0xFF, 0xD8, 0xFF]],
    ['image/png', [0x89, 0x50, 0x4E, 0x47]],
    ['image/gif', [0x47, 0x49, 0x46]],
    ['image/webp', [0x52, 0x49, 0x46, 0x46]],
  ];
  for (const [mimeType, signature] of signatures) {
    if (signature.every((byte, i) => buffer[i] === byte)) return mimeType;
  }
  return 'image/jpeg';
}

export { THUMBNAIL_IPC_CHANNELS };
