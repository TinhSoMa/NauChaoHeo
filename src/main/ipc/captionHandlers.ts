/**
 * Caption IPC Handlers - Xử lý các IPC request liên quan đến Caption
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow, dialog } from 'electron';
import {
  CAPTION_IPC_CHANNELS,
  CAPTION_SESSION_IPC_CHANNELS,
  ParseSrtResult,
  RenderThumbnailPreviewFrameOptions,
  RenderThumbnailPreviewFrameResult,
  TranslationOptions,
  TranslationResult,
  SubtitleEntry,
  VideoMetadata,
  CAPTION_VIDEO_IPC_CHANNELS
} from '../../shared/types/caption';
import * as CaptionService from '../services/caption';
import { AppSettingsService } from '../services/appSettings';
import { PromptService } from '../services/promptService';

/**
 * Response chuẩn cho IPC
 */
interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function decodeUtf16Be(input: Buffer): string {
  if (input.length < 2) {
    return '';
  }
  const le = Buffer.allocUnsafe(input.length);
  for (let i = 0; i + 1 < input.length; i += 2) {
    le[i] = input[i + 1];
    le[i + 1] = input[i];
  }
  return le.toString('utf16le').replace(/\u0000/g, '').trim();
}

async function extractFontFamilyName(fontPath: string): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(fontPath);
    if (buffer.length < 12) {
      return null;
    }

    const numTables = buffer.readUInt16BE(4);
    let nameTableOffset = -1;
    let nameTableLength = 0;
    let recordOffset = 12;

    for (let i = 0; i < numTables; i++) {
      const tag = buffer.toString('ascii', recordOffset, recordOffset + 4);
      const tableOffset = buffer.readUInt32BE(recordOffset + 8);
      const tableLength = buffer.readUInt32BE(recordOffset + 12);
      if (tag === 'name') {
        nameTableOffset = tableOffset;
        nameTableLength = tableLength;
        break;
      }
      recordOffset += 16;
    }

    if (nameTableOffset < 0 || nameTableLength <= 0) {
      return null;
    }

    const count = buffer.readUInt16BE(nameTableOffset + 2);
    const stringOffset = buffer.readUInt16BE(nameTableOffset + 4);
    const recordsStart = nameTableOffset + 6;
    const stringsStart = nameTableOffset + stringOffset;

    const candidates: string[] = [];
    const fallback: string[] = [];

    for (let i = 0; i < count; i++) {
      const rec = recordsStart + i * 12;
      const platformId = buffer.readUInt16BE(rec);
      const encodingId = buffer.readUInt16BE(rec + 2);
      const languageId = buffer.readUInt16BE(rec + 4);
      const nameId = buffer.readUInt16BE(rec + 6);
      const length = buffer.readUInt16BE(rec + 8);
      const offset = buffer.readUInt16BE(rec + 10);

      if (nameId !== 1 || length <= 0) {
        continue;
      }

      const start = stringsStart + offset;
      const end = start + length;
      if (start < 0 || end > buffer.length) {
        continue;
      }

      const raw = buffer.subarray(start, end);
      let decoded = '';
      if (platformId === 3) {
        decoded = decodeUtf16Be(raw);
      } else if (platformId === 1 || encodingId === 0) {
        decoded = raw.toString('latin1').replace(/\u0000/g, '').trim();
      } else {
        decoded = raw.toString('utf8').replace(/\u0000/g, '').trim();
      }

      if (!decoded) {
        continue;
      }

      if (platformId === 3 && languageId === 0x0409) {
        candidates.push(decoded);
      } else {
        fallback.push(decoded);
      }
    }

    return candidates[0] || fallback[0] || null;
  } catch {
    return null;
  }
}

function resolveCaptionFontsDir(
  pathMod: typeof import('path'),
  fsMod: typeof import('fs')
): string | null {
  const candidates = [
    pathMod.join(process.resourcesPath || '', 'fonts'),
    pathMod.join(process.cwd(), 'resources', 'fonts'),
    pathMod.join(__dirname, '../../resources/fonts'),
    pathMod.resolve(__dirname, '../../../resources/fonts'),
    pathMod.resolve('resources', 'fonts'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fsMod.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function deepMergeRecord(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target };
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = output[key];
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMergeRecord(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
      continue;
    }
    output[key] = sourceValue;
  }
  return output;
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
    async (_event: IpcMainInvokeEvent, options?: { filters?: { name: string; extensions: string[] }[]; properties?: any[] }) => {
      console.log('[CaptionHandlers] Mở dialog chọn file...');
      
      const result = await dialog.showOpenDialog({
        properties: options?.properties || ['openFile'],
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
        // Inject prompt from DB if captionPromptId is set and no client override
        if (!options.promptTemplate) {
          const appSettings = AppSettingsService.getAll();
          if (appSettings.captionPromptId) {
            const prompt = PromptService.getById(appSettings.captionPromptId);
            if (prompt?.content) {
              options.promptTemplate = prompt.content;
              console.log(`[CaptionHandlers] Sử dụng caption prompt: ${prompt.name}`);
            }
          }
        }

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
  // CAPTION VIDEO - RENDER VIDEO
  // ============================================
  ipcMain.handle(
    'captionVideo:renderVideo',
    async (
      event: IpcMainInvokeEvent,
      options: {
        srtPath: string;
        outputPath: string;
        width: number;
        height: number;
        videoPath?: string;
        targetDuration?: number;
        hardwareAcceleration?: 'none' | 'qsv' | 'nvenc';
        style?: any;
        renderMode?: 'hardsub' | 'black_bg' | 'hardsub_portrait_9_16';
        renderResolution?: 'original' | '1080p' | '720p' | '540p' | '360p';
        position?: { x: number; y: number };
        blackoutTop?: number;
        coverMode?: 'blackout_bottom' | 'copy_from_above';
        coverQuad?: {
          tl: { x: number; y: number };
          tr: { x: number; y: number };
          br: { x: number; y: number };
          bl: { x: number; y: number };
        };
        audioSpeed?: number;
        step7AudioSpeedInput?: number;
        srtTimeScale?: number;
        step4SrtScale?: number;
        timingContextPath?: string;
        audioSpeedModel?: 'step4_minus_step7_delta';
        ttsRate?: string;
        audioPath?: string;
        videoVolume?: number;
        audioVolume?: number;
        logoPath?: string;
        logoPosition?: { x: number; y: number };
        logoScale?: number;
        portraitForegroundCropPercent?: number;
        thumbnailEnabled?: boolean;
        thumbnailDurationSec?: number;
        thumbnailTimeSec?: number;
        thumbnailText?: string;
        thumbnailTextSecondary?: string;
        thumbnailFontName?: string;
        thumbnailFontSize?: number;
        thumbnailTextPrimaryPosition?: { x: number; y: number };
        thumbnailTextSecondaryPosition?: { x: number; y: number };
        step7SubtitleSource?: 'session_translated_entries';
        step7AudioSource?: 'session_merged_audio';
      }
    ): Promise<IpcResponse<{ outputPath: string; duration: number; timingPayload?: Record<string, unknown> }>> => {
      console.log(`[CaptionHandlers] Render video: ${options.srtPath} -> ${options.outputPath}`);

      try {
        // Progress callback - gửi về renderer
        const progressCallback = (progress: unknown) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send('captionVideo:renderProgress', progress);
          }
        };

        const result = await CaptionService.renderVideo(options, progressCallback);
        if (result.success && result.outputPath) {
          return {
            success: true,
            data: {
              outputPath: result.outputPath,
              duration: result.duration || 0,
              timingPayload: result.timingPayload,
            }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi render video:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.STOP_RENDER,
    async (): Promise<IpcResponse<{ stopped: boolean; message: string }>> => {
      try {
        const stopResult = CaptionService.stopActiveRender();
        return {
          success: stopResult.success,
          data: {
            stopped: stopResult.stopped,
            message: stopResult.message,
          },
          error: stopResult.success ? undefined : stopResult.message,
        };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi stop render video:', error);
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
      // console.log(`[CaptionHandlers] Get video metadata: ${videoPath}`);

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
  // CAPTION VIDEO - FONTS (GET AVAILABLE FONTS AND DATA)
  // ============================================
  ipcMain.handle(
    'captionVideo:getAvailableFonts',
    async (): Promise<IpcResponse<string[]>> => {
      try {
        const fs = await import('fs');
        const path = await import('path');

        const fontsDir = resolveCaptionFontsDir(path, fs);
        
        if (!fontsDir || !fs.existsSync(fontsDir)) {
          return { success: true, data: ['ZYVNA Fairy', 'Be Vietnam Pro', 'Roboto'] }; // fallback
        }

        const files = await fs.promises.readdir(fontsDir);
        const fontFiles = files.filter(f => f.toLowerCase().endsWith('.ttf') || f.toLowerCase().endsWith('.otf'));
        const fonts: string[] = [];
        for (const file of fontFiles) {
          const familyName = await extractFontFamilyName(path.join(fontsDir, file));
          const fallbackName = file.substring(0, file.lastIndexOf('.'));
          fonts.push((familyName || fallbackName).trim());
        }
        const deduped = Array.from(new Set(fonts)).filter(Boolean);
        
        // Add defaults if missing
        if (!deduped.includes('Be Vietnam Pro')) deduped.push('Be Vietnam Pro');
        if (!deduped.includes('Roboto')) deduped.push('Roboto');

        console.log('[CaptionHandlers][Font] getAvailableFonts', {
          fontsDir,
          count: deduped.length,
          fonts: deduped,
        });

        return { success: true, data: deduped };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi đọc thư mục fonts:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'captionVideo:getFontData',
    async (_event: IpcMainInvokeEvent, fontName: string): Promise<IpcResponse<string>> => {
      try {
        const fs = await import('fs');
        const path = await import('path');

        const fontsDir = resolveCaptionFontsDir(path, fs);
        if (!fontsDir || !fs.existsSync(fontsDir)) {
          return { success: false, error: 'Fonts dir not found' };
        }

        const files = await fs.promises.readdir(fontsDir);
        const fontFiles = files.filter(f => f.toLowerCase().endsWith('.ttf') || f.toLowerCase().endsWith('.otf'));

        let matchedPath: string | null = null;
        for (const file of fontFiles) {
          const fullPath = path.join(fontsDir, file);
          const familyName = await extractFontFamilyName(fullPath);
          const fallbackName = file.substring(0, file.lastIndexOf('.'));
          if (
            (familyName && familyName.toLowerCase() === fontName.toLowerCase()) ||
            fallbackName.toLowerCase() === fontName.toLowerCase()
          ) {
            matchedPath = fullPath;
            break;
          }
        }

        if (!matchedPath) {
          return { success: false, error: `Font not found: ${fontName}` };
        }

        const ext = path.extname(matchedPath).toLowerCase();
        const mime = ext === '.otf' ? 'font/otf' : 'font/truetype';
        const buffer = await fs.promises.readFile(matchedPath);
        const base64 = buffer.toString('base64');
        return { success: true, data: `data:${mime};charset=utf-8;base64,${base64}` };
      } catch (error) {
        console.error(`[CaptionHandlers] Lỗi đọc font ${fontName}:`, error);
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
  // CAPTION VIDEO - RENDER THUMBNAIL PREVIEW FRAME
  // ============================================
  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.RENDER_THUMBNAIL_PREVIEW_FRAME,
    async (
      _event: IpcMainInvokeEvent,
      options: RenderThumbnailPreviewFrameOptions
    ): Promise<IpcResponse<RenderThumbnailPreviewFrameResult>> => {
      const safeVideoPath = typeof options?.videoPath === 'string' ? options.videoPath : '';
      console.log(`[CaptionHandlers] Render thumbnail preview frame: ${safeVideoPath || '(empty)'}`);
      try {
        const result = await CaptionService.renderThumbnailPreviewFrame(options);
        if (result.success) {
          return { success: true, data: result };
        }
        return { success: false, error: result.error || 'Không thể render thumbnail preview frame' };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi render thumbnail preview frame:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // CAPTION VIDEO - FIND BEST VIDEO
  // ============================================
  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.FIND_BEST_VIDEO,
    async (
      _event: IpcMainInvokeEvent,
      folderPaths: string[]
    ): Promise<IpcResponse<{ videoPath?: string; metadata?: VideoMetadata }>> => {
      console.log(`[CaptionHandlers] Find best video in ${folderPaths.length} folders`);

      try {
        const result = await CaptionService.findBestVideoInFolders(folderPaths);
        if (result.success && result.videoPath) {
          return {
            success: true,
            data: { videoPath: result.videoPath, metadata: result.metadata }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi find best video:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // CAPTION SESSION - SINGLE JSON PER FOLDER
  // ============================================
  ipcMain.handle(
    CAPTION_SESSION_IPC_CHANNELS.READ,
    async (
      _event: IpcMainInvokeEvent,
      payload: { sessionPath: string }
    ): Promise<IpcResponse<unknown | null>> => {
      try {
        const fs = await import('fs/promises');
        const sessionPath = payload?.sessionPath;
        if (!sessionPath || typeof sessionPath !== 'string') {
          return { success: false, error: 'SESSION_INVALID_INPUT: Thiếu sessionPath' };
        }
        try {
          const raw = await fs.readFile(sessionPath, 'utf-8');
          return { success: true, data: JSON.parse(raw) };
        } catch (error) {
          const err = String(error);
          if (err.includes('ENOENT')) {
            return { success: true, data: null };
          }
          return { success: false, error: `SESSION_READ_FAILED: ${err}` };
        }
      } catch (error) {
        return { success: false, error: `SESSION_READ_FAILED: ${String(error)}` };
      }
    }
  );

  ipcMain.handle(
    CAPTION_SESSION_IPC_CHANNELS.WRITE_ATOMIC,
    async (
      _event: IpcMainInvokeEvent,
      payload: { sessionPath: string; data: unknown }
    ): Promise<IpcResponse<string>> => {
      try {
        const fs = await import('fs/promises');
        const fsSync = await import('fs');
        const path = await import('path');
        const sessionPath = payload?.sessionPath;
        if (!sessionPath || typeof sessionPath !== 'string') {
          return { success: false, error: 'SESSION_INVALID_INPUT: Thiếu sessionPath' };
        }
        const dir = path.dirname(sessionPath);
        await fs.mkdir(dir, { recursive: true });
        const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
        await fs.writeFile(tmpPath, JSON.stringify(payload?.data ?? {}, null, 2), 'utf-8');
        if (fsSync.existsSync(sessionPath)) {
          await fs.unlink(sessionPath);
        }
        await fs.rename(tmpPath, sessionPath);
        return { success: true, data: sessionPath };
      } catch (error) {
        return { success: false, error: `SESSION_WRITE_FAILED: ${String(error)}` };
      }
    }
  );

  ipcMain.handle(
    CAPTION_SESSION_IPC_CHANNELS.PATCH,
    async (
      _event: IpcMainInvokeEvent,
      payload: { sessionPath: string; patch: Record<string, unknown> }
    ): Promise<IpcResponse<unknown>> => {
      try {
        const fs = await import('fs/promises');
        const fsSync = await import('fs');
        const path = await import('path');
        const sessionPath = payload?.sessionPath;
        const patch = payload?.patch;
        if (!sessionPath || typeof sessionPath !== 'string') {
          return { success: false, error: 'SESSION_INVALID_INPUT: Thiếu sessionPath' };
        }
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          return { success: false, error: 'SESSION_INVALID_INPUT: Patch không hợp lệ' };
        }

        let current: Record<string, unknown> = {};
        if (fsSync.existsSync(sessionPath)) {
          try {
            const raw = await fs.readFile(sessionPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              current = parsed as Record<string, unknown>;
            }
          } catch {
            current = {};
          }
        }
        const merged = deepMergeRecord(current, patch);
        const dir = path.dirname(sessionPath);
        await fs.mkdir(dir, { recursive: true });
        const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
        await fs.writeFile(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
        if (fsSync.existsSync(sessionPath)) {
          await fs.unlink(sessionPath);
        }
        await fs.rename(tmpPath, sessionPath);
        return { success: true, data: merged };
      } catch (error) {
        return { success: false, error: `SESSION_PATCH_FAILED: ${String(error)}` };
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

  // ============================================
  // CAPTION VIDEO - READ LOCAL IMAGE
  // ============================================
  ipcMain.handle(
    'captionVideo:readLocalImage',
    async (_event: IpcMainInvokeEvent, imagePath: string): Promise<IpcResponse<string>> => {
      try {
        const fs = await import('fs');
        const path = await import('path');
        if (!fs.existsSync(imagePath)) {
          return { success: false, error: 'File ảnh không tồn tại' };
        }
        
        const ext = path.extname(imagePath).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.gif') mimeType = 'image/gif';
        
        const buffer = await fs.promises.readFile(imagePath);
        const base64 = buffer.toString('base64');
        return { success: true, data: `data:${mimeType};base64,${base64}` };
      } catch (error) {
        console.error(`[CaptionHandlers] Lỗi đọc ảnh ${imagePath}:`, error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // WRITE TEXT FILE (dùng cho preview prompt download)
  // ============================================
  ipcMain.handle(
    'fs:writeFile',
    async (_event: IpcMainInvokeEvent, args: { filePath: string; content: string }): Promise<IpcResponse<void>> => {
      try {
        const { filePath, content } = args;
        const fsPromises = await import('fs/promises');
        await fsPromises.writeFile(filePath, content, 'utf-8');
        console.log(`[CaptionHandlers] fs:writeFile → ${filePath}`);
        return { success: true };
      } catch (error) {
        console.error('[CaptionHandlers] fs:writeFile error:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // WRITE BASE64 FILE (dùng cho thumbnail download)
  // ============================================
  ipcMain.handle(
    'fs:writeBase64File',
    async (
      _event: IpcMainInvokeEvent,
      args: { filePath: string; base64Data: string }
    ): Promise<IpcResponse<void>> => {
      try {
        const { filePath, base64Data } = args;
        const sanitizedBase64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
        if (!filePath || sanitizedBase64.length === 0) {
          return { success: false, error: 'Thiếu filePath hoặc base64Data.' };
        }
        const fsPromises = await import('fs/promises');
        const buffer = Buffer.from(sanitizedBase64, 'base64');
        await fsPromises.writeFile(filePath, buffer);
        console.log(`[CaptionHandlers] fs:writeBase64File -> ${filePath}`);
        return { success: true };
      } catch (error) {
        console.error('[CaptionHandlers] fs:writeBase64File error:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[CaptionHandlers] Đã đăng ký handlers thành công');
}


