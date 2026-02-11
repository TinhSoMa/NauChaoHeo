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

  // ============================================
  // CAPTION VIDEO - CONVERT SRT TO ASS
  // ============================================
  ipcMain.handle(
    'captionVideo:convertToAss',
    async (
      _event: IpcMainInvokeEvent,
      options: {
        srtPath: string;
        assPath: string;
        videoResolution?: { width: number; height: number };
        style: {
          fontName: string;
          fontSize: number;
          fontColor: string;
          shadow: number;
          marginV: number;
          alignment: number;
        };
        position?: { x: number; y: number };
      }
    ): Promise<IpcResponse<{ assPath: string; entriesCount: number }>> => {
      console.log(`[CaptionHandlers] Convert SRT to ASS: ${options.srtPath}`);

      try {
        const result = await CaptionService.convertSrtToAss(options);
        if (result.success && result.assPath) {
          return {
            success: true,
            data: { assPath: result.assPath, entriesCount: result.entriesCount || 0 }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi convert ASS:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // CAPTION VIDEO - RENDER VIDEO
  // ============================================
  ipcMain.handle(
    'captionVideo:renderVideo',
    async (
      event: IpcMainInvokeEvent,
      options: {
        assPath: string;
        outputPath: string;
        width: number;
        height: number;
        useGpu: boolean;
      }
    ): Promise<IpcResponse<{ outputPath: string; duration: number }>> => {
      console.log(`[CaptionHandlers] Render video: ${options.assPath} -> ${options.outputPath}`);

      try {
        // Progress callback - gửi về renderer
        const progressCallback = (progress: unknown) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send('captionVideo:renderProgress', progress);
          }
        };

        const result = await CaptionService.renderAssToVideo(options, progressCallback);
        if (result.success && result.outputPath) {
          return {
            success: true,
            data: { outputPath: result.outputPath, duration: result.duration || 0 }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi render video:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // CAPTION VIDEO - GET VIDEO METADATA
  // ============================================
  ipcMain.handle(
    'captionVideo:getVideoMetadata',
    async (
      _event: IpcMainInvokeEvent,
      videoPath: string
    ): Promise<IpcResponse<{
      width: number;
      height: number;
      duration: number;
      frameCount: number;
      fps: number;
    }>> => {
      console.log(`[CaptionHandlers] Get video metadata: ${videoPath}`);

      try {
        const result = await CaptionService.getVideoMetadata(videoPath);
        if (result.success && result.metadata) {
          return { success: true, data: result.metadata };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi get metadata:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // CAPTION VIDEO - EXTRACT FRAME
  // ============================================
  ipcMain.handle(
    'captionVideo:extractFrame',
    async (
      _event: IpcMainInvokeEvent,
      videoPath: string,
      frameNumber?: number
    ): Promise<IpcResponse<{
      frameData: string;
      width: number;
      height: number;
    }>> => {
      console.log(`[CaptionHandlers] Extract frame: ${videoPath}, frame=${frameNumber || 'random'}`);

      try {
        const result = await CaptionService.extractVideoFrame(videoPath, frameNumber);
        if (result.success && result.frameData) {
          return {
            success: true,
            data: {
              frameData: result.frameData,
              width: result.width || 0,
              height: result.height || 0
            }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi extract frame:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // CAPTION - SAVE JSON (Lưu tọa độ vùng chọn)
  // ============================================
  ipcMain.handle(
    'caption:saveJson',
    async (
      _event: IpcMainInvokeEvent,
      options: { filePath: string; data: unknown }
    ): Promise<IpcResponse<string>> => {
      console.log(`[CaptionHandlers] Lưu JSON: ${options.filePath}`);

      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        // Đảm bảo thư mục tồn tại
        const dir = path.dirname(options.filePath);
        await fs.mkdir(dir, { recursive: true });
        
        await fs.writeFile(
          options.filePath,
          JSON.stringify(options.data, null, 2),
          'utf-8'
        );
        
        return { success: true, data: options.filePath };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi lưu JSON:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[CaptionHandlers] Đã đăng ký handlers thành công');
}
