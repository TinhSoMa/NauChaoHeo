/**
 * Caption IPC Handlers - Xử lý các IPC request liên quan đến Caption
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow, dialog } from 'electron';
import {
  CAPTION_IPC_CHANNELS,
  ParseSrtResult,
  TranslationOptions,
  TranslationResult,
  SubtitleEntry,
} from '../../shared/types/caption';
import * as CaptionService from '../services/caption';

/**
 * Response chuẩn cho IPC
 */
interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Đăng ký tất cả IPC handlers cho Caption
 */
export function registerCaptionHandlers(): void {
  console.log('[CaptionHandlers] Đăng ký handlers...');

  // ============================================
  // DIALOG OPEN FILE
  // ============================================
  ipcMain.handle(
    'dialog:openFile',
    async (_event: IpcMainInvokeEvent, options?: { filters?: { name: string; extensions: string[] }[] }) => {
      console.log('[CaptionHandlers] Mở dialog chọn file...');
      
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
      });
      
      return result;
    }
  );

  // ============================================
  // DIALOG SAVE FILE
  // ============================================
  ipcMain.handle(
    'dialog:showSaveDialog',
    async (
      _event: IpcMainInvokeEvent,
      options?: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      }
    ) => {
      console.log('[CaptionHandlers] Mở dialog lưu file...');

      const result = await dialog.showSaveDialog({
        title: options?.title,
        defaultPath: options?.defaultPath,
        filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
      });

      return result;
    }
  );

  // ============================================
  // PARSE SRT
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.PARSE_SRT,
    async (_event: IpcMainInvokeEvent, filePath: string): Promise<IpcResponse<ParseSrtResult>> => {
      console.log(`[CaptionHandlers] Parse SRT: ${filePath}`);

      try {
        const result = await CaptionService.parseSrtFile(filePath);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi parse SRT:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // PARSE DRAFT (draft_content.json từ CapCut)
  // ============================================
  ipcMain.handle(
    'caption:parseDraft',
    async (_event: IpcMainInvokeEvent, filePath: string): Promise<IpcResponse<ParseSrtResult>> => {
      console.log(`[CaptionHandlers] Parse Draft JSON: ${filePath}`);

      try {
        const result = await CaptionService.parseDraftJson(filePath);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi parse Draft:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // TRANSLATE
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TRANSLATE,
    async (
      event: IpcMainInvokeEvent,
      options: TranslationOptions
    ): Promise<IpcResponse<TranslationResult>> => {
      console.log(`[CaptionHandlers] Translate: ${options.entries.length} entries`);

      try {
        // Progress callback - gửi về renderer
        const progressCallback = (progress: unknown) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send(CAPTION_IPC_CHANNELS.TRANSLATE_PROGRESS, progress);
          }
        };

        const result = await CaptionService.translateAll(options, progressCallback);
        return { success: result.success, data: result, error: result.errors?.join(', ') };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi translate:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // EXPORT SRT
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.EXPORT_SRT,
    async (
      _event: IpcMainInvokeEvent,
      entries: SubtitleEntry[],
      outputPath: string
    ): Promise<IpcResponse<string>> => {
      console.log(`[CaptionHandlers] Export SRT: ${entries.length} entries -> ${outputPath}`);

      try {
        const result = await CaptionService.exportToSrt(entries, outputPath, true);
        if (result.success) {
          return { success: true, data: outputPath };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi export SRT:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // SPLIT TEXT
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.SPLIT,
    async (
      _event: IpcMainInvokeEvent,
      options: { entries: SubtitleEntry[]; splitByLines: boolean; value: number; outputDir: string }
    ): Promise<IpcResponse<{ partsCount: number; files: string[] }>> => {
      console.log(`[CaptionHandlers] Split: ${options.entries.length} entries, splitByLines=${options.splitByLines}, value=${options.value}`);

      try {
        const result = await CaptionService.splitText(options);
        return { success: result.success, data: { partsCount: result.partsCount, files: result.files }, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi split:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[CaptionHandlers] Đã đăng ký handlers thành công');
}
