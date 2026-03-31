/**
 * Caption IPC Handlers - Xử lý các IPC request liên quan đến Caption
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow, dialog } from 'electron';
import {
  CAPTION_IPC_CHANNELS,
  CAPTION_SESSION_IPC_CHANNELS,
  ParseSrtResult,
  RenderAudioPreviewOptions,
  RenderAudioPreviewProgress,
  RenderAudioPreviewResult,
  RenderVideoPreviewFrameOptions,
  RenderVideoPreviewFrameResult,
  RenderThumbnailPreviewFrameOptions,
  RenderThumbnailPreviewFrameResult,
  RenderThumbnailFileOptions,
  RenderThumbnailFileResult,
  TranslationOptions,
  TranslationResult,
  SubtitleEntry,
  VideoMetadata,
  CAPTION_VIDEO_IPC_CHANNELS
} from '../../shared/types/caption';
import * as CaptionService from '../services/caption';
import * as TTSService from '../services/tts';
import { AppSettingsService } from '../services/appSettings';
import { PromptService } from '../services/promptService';
import { getGrokUiRuntime } from '../services/grokUi';

/**
 * Response chuẩn cho IPC
 */
interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const SUPPORTED_CAPTION_FONT_EXTENSIONS = new Set(['.ttf', '.otf']);
const sessionPathLocks = new Map<string, Promise<unknown>>();
const translateAckWaiters = new Map<string, { resolve: () => void; timer: NodeJS.Timeout }>();
const translateAckEarly = new Map<string, number>();
const TRANSLATE_ACK_TIMEOUT_MS = 30_000;

async function withSessionLock<T>(sessionPath: string, task: () => Promise<T>): Promise<T> {
  const key = sessionPath;
  const prev = sessionPathLocks.get(key) || Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  sessionPathLocks.set(key, next);
  next.finally(() => {
    if (sessionPathLocks.get(key) === next) {
      sessionPathLocks.delete(key);
    }
  }).catch(() => undefined);
  return next;
}

function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0) {
    return '';
  }
  return fileName.slice(idx).toLowerCase();
}

function getFileBaseName(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0) {
    return fileName;
  }
  return fileName.slice(0, idx);
}

function isSupportedCaptionFontFile(fileName: string): boolean {
  return SUPPORTED_CAPTION_FONT_EXTENSIONS.has(getFileExtension(fileName));
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

function decodeTextFromBuffer(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) {
    return '';
  }

  if (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    if (b0 === 0xff && b1 === 0xfe) {
      return buffer.slice(2).toString('utf16le');
    }
    if (b0 === 0xfe && b1 === 0xff) {
      const swapped = Buffer.allocUnsafe(buffer.length - 2);
      for (let i = 2; i < buffer.length; i += 2) {
        swapped[i - 2] = buffer[i + 1] || 0;
        swapped[i - 1] = buffer[i] || 0;
      }
      return swapped.toString('utf16le');
    }
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }

  const text = buffer.toString('utf8');
  return maybeFixMojibake(text);
}

function buildTranslateAckKey(payload: { runId?: string; batchIndex: number; eventType: string }): string {
  const runId = (payload.runId || '__default_run__').trim();
  return `${runId}:${payload.eventType}:${payload.batchIndex}`;
}

function recordEarlyTranslateAck(key: string): void {
  translateAckEarly.set(key, Date.now());
  if (translateAckEarly.size > 1000) {
    const threshold = Date.now() - 5 * 60_000;
    for (const [storedKey, ts] of translateAckEarly.entries()) {
      if (ts < threshold) {
        translateAckEarly.delete(storedKey);
      }
    }
  }
}

function flushTranslateAckWaiters(): void {
  for (const [key, waiter] of translateAckWaiters.entries()) {
    clearTimeout(waiter.timer);
    try {
      waiter.resolve();
    } catch {
      // ignore
    }
    translateAckWaiters.delete(key);
  }
  translateAckEarly.clear();
}

async function waitForTranslateAck(payload: { runId?: string; batchIndex: number; eventType: 'batch_completed' | 'batch_failed' }): Promise<boolean> {
  const key = buildTranslateAckKey(payload);
  if (translateAckEarly.has(key)) {
    translateAckEarly.delete(key);
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      translateAckWaiters.delete(key);
      resolve(false);
    }, TRANSLATE_ACK_TIMEOUT_MS);
    translateAckWaiters.set(key, {
      resolve: () => {
        clearTimeout(timer);
        resolve(true);
      },
      timer,
    });
  });
}

function decodeJsonTextFromBuffer(buffer: Buffer): string {
  if (!buffer || buffer.length === 0) {
    return '';
  }

  if (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    if (b0 === 0xff && b1 === 0xfe) {
      return buffer.slice(2).toString('utf16le');
    }
    if (b0 === 0xfe && b1 === 0xff) {
      const swapped = Buffer.allocUnsafe(buffer.length - 2);
      for (let i = 2; i < buffer.length; i += 2) {
        swapped[i - 2] = buffer[i + 1] || 0;
        swapped[i - 1] = buffer[i] || 0;
      }
      return swapped.toString('utf16le');
    }
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }

  return buffer.toString('utf8');
}

function maybeFixMojibake(text: string): string {
  if (!text) return text;
  const suspect = /Ã|Â/;
  if (!suspect.test(text)) {
    return text;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0xff) {
      return text;
    }
  }
  const fixed = Buffer.from(text, 'latin1').toString('utf8');
  if (!suspect.test(fixed)) {
    return fixed;
  }
  return text;
}

function fixMojibakeDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return maybeFixMojibake(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => fixMojibakeDeep(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      next[key] = fixMojibakeDeep(val);
    }
    return next;
  }
  return value;
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
  // FIND SRT IN FOLDERS
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.FIND_SRT_IN_FOLDERS,
    async (_event: IpcMainInvokeEvent, folderPaths: string[]): Promise<IpcResponse<Record<string, string>>> => {
      const result: Record<string, string> = {};
      if (!Array.isArray(folderPaths) || folderPaths.length === 0) {
        return { success: true, data: result };
      }
      try {
        const path = await import('path');
        const fs = await import('fs/promises');
        const fsSync = await import('fs');

        for (const rawPath of folderPaths) {
          const trimmed = typeof rawPath === 'string' ? rawPath.trim().replace(/[\\/]+$/, '') : '';
          if (!trimmed) continue;
          try {
            if (!fsSync.existsSync(trimmed)) {
              result[trimmed] = '';
              continue;
            }
            const entries = await fs.readdir(trimmed, { withFileTypes: true });
            const srtFiles = entries
              .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.srt'))
              .map((entry) => entry.name);

            let picked = '';
            const lowerMap = new Map(srtFiles.map((name) => [name.toLowerCase(), name]));
            if (lowerMap.has('translated.srt')) {
              picked = lowerMap.get('translated.srt') || '';
            } else {
              const subtitleCandidates = srtFiles
                .filter((name) => name.toLowerCase().startsWith('subtitle') && name.toLowerCase().endsWith('.srt'))
                .sort((a, b) => a.localeCompare(b));
              if (subtitleCandidates.length > 0) {
                picked = subtitleCandidates[0];
              } else if (srtFiles.length > 0) {
                const sorted = [...srtFiles].sort((a, b) => a.localeCompare(b));
                picked = sorted[0];
              }
            }
            const pickedPath = picked ? path.join(trimmed, picked) : '';
            // guard: chỉ nhận file nằm trực tiếp trong folder
            const parentDir = pickedPath ? path.dirname(pickedPath).replace(/[\\/]+$/, '') : '';
            result[trimmed] = pickedPath && parentDir === trimmed ? pickedPath : '';
          } catch (error) {
            console.warn('[CaptionHandlers] Không thể quét SRT trong folder:', trimmed, error);
            result[trimmed] = '';
          }
        }
        return { success: true, data: result };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi find SRT in folders:', error);
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
    CAPTION_IPC_CHANNELS.TRANSLATE_PROGRESS_ACK,
    async (_event: IpcMainInvokeEvent, payload?: { runId?: string; batchIndex?: number; eventType?: string }): Promise<IpcResponse<void>> => {
      try {
        if (!payload || typeof payload.batchIndex !== 'number' || !payload.eventType) {
          return { success: false, error: 'INVALID_ACK_PAYLOAD' };
        }
        const key = buildTranslateAckKey({
          runId: payload.runId,
          batchIndex: payload.batchIndex,
          eventType: payload.eventType,
        });
        const waiter = translateAckWaiters.get(key);
        if (waiter) {
          waiter.resolve();
          translateAckWaiters.delete(key);
        } else {
          recordEarlyTranslateAck(key);
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TRANSLATE,
    async (
      event: IpcMainInvokeEvent,
      options: TranslationOptions
    ): Promise<IpcResponse<TranslationResult>> => {
      console.log(`[CaptionHandlers] Translate: ${options.entries.length} entries`);

      try {
        const runId = typeof options.runId === 'string' ? options.runId : undefined;
        if (CaptionService.isTranslationActive()) {
          return { success: false, error: 'TRANSLATION_ALREADY_RUNNING' };
        }
        CaptionService.beginTranslationRun(runId);
        // Inject prompt from DB if captionPromptId is set and no client override
        if (!options.promptTemplate) {
          const appSettings = AppSettingsService.getAll();
          if (appSettings.captionPromptFamilyId) {
            const familyPrompt = PromptService.resolveLatestByFamily(appSettings.captionPromptFamilyId);
            if (familyPrompt?.content) {
              options.promptTemplate = familyPrompt.content;
              console.log(`[CaptionHandlers] Sử dụng caption prompt family latest: ${familyPrompt.name} v${familyPrompt.version}`);
            } else {
              console.warn(`[CaptionHandlers] Không tìm thấy caption prompt family: ${appSettings.captionPromptFamilyId}`);
            }
          }
          if (!options.promptTemplate && appSettings.captionPromptId) {
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

        const progressAck = async (payload: { runId?: string; batchIndex: number; eventType: 'batch_completed' | 'batch_failed' }) => {
          if (options.translateMethod !== 'grok_ui') {
            return;
          }
          const startedAt = Date.now();
          console.log(
            `[CaptionHandlers] Grok UI chờ ACK (runId=${payload.runId || 'n/a'}, batch=${payload.batchIndex}, event=${payload.eventType})`
          );
          const ok = await waitForTranslateAck(payload);
          if (!ok) {
            console.warn(
              `[CaptionHandlers] Grok UI ACK timeout (runId=${payload.runId || 'n/a'}, batch=${payload.batchIndex}, event=${payload.eventType})`
            );
            return;
          }
          console.log(
            `[CaptionHandlers] Grok UI đã nhận ACK sau ${Date.now() - startedAt}ms (runId=${payload.runId || 'n/a'}, batch=${payload.batchIndex})`
          );
        };

        const result = await CaptionService.translateAll(options, progressCallback, progressAck);
        return { success: result.success, data: result, error: result.errors?.join(', ') };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi translate:', error);
        return { success: false, error: String(error) };
      } finally {
        if (options.translateMethod === 'grok_ui') {
          try {
            await getGrokUiRuntime().closeDriver();
            console.log('[CaptionHandlers] Grok UI: close driver after translate.');
          } catch (error) {
            console.warn('[CaptionHandlers] Không thể close Grok UI driver:', error);
          }
        }
        const runId = typeof options.runId === 'string' ? options.runId : undefined;
        CaptionService.endTranslationRun(runId);
      }
    }
  );

  // ============================================
  // STOP ALL CAPTION PROCESSES
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.STOP_ALL,
    async (
      _event: IpcMainInvokeEvent,
      payload?: { runId?: string }
    ): Promise<IpcResponse<{ stopped: boolean; message?: string }>> => {
      try {
        const runId = typeof payload?.runId === 'string' ? payload.runId : undefined;
        const translateStop = CaptionService.stopActiveTranslation(runId);
        flushTranslateAckWaiters();
        try {
          await getGrokUiRuntime().shutdown({ hard: true });
        } catch (error) {
          console.warn('[CaptionHandlers] Không thể shutdown Grok UI:', error);
        }
        const renderStop = CaptionService.stopActiveRender();
        const audioPreviewStop = CaptionService.stopActiveAudioPreview();
        const videoPreviewStop = CaptionService.stopActiveVideoPreviewFrame();
        const ttsStop = TTSService.stopActiveTts();
        const stopped = Boolean(
          translateStop.stopped
          || renderStop.stopped
          || audioPreviewStop.stopped
          || videoPreviewStop.stopped
          || ttsStop.stopped
        );
        return {
          success: true,
          data: {
            stopped,
            message: stopped ? 'Đã gửi tín hiệu dừng.' : 'Không có tiến trình đang chạy.',
          },
        };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi stopAll:', error);
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
        coverFeatherPx?: number;
        coverFeatherHorizontalPx?: number;
        coverFeatherVerticalPx?: number;
        coverFeatherHorizontalPercent?: number;
        coverFeatherVerticalPercent?: number;
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
        renderSubtitle?: boolean;
        renderMark?: boolean;
        thumbnailDurationSec?: number;
        thumbnailTimeSec?: number;
        thumbnailText?: string;
        thumbnailTextSecondary?: string;
        thumbnailFontName?: string;
        thumbnailFontSize?: number;
        thumbnailTextPrimaryFontName?: string;
        thumbnailTextPrimaryFontSize?: number;
        thumbnailTextPrimaryColor?: string;
        thumbnailTextSecondaryFontName?: string;
        thumbnailTextSecondaryFontSize?: number;
        thumbnailTextSecondaryColor?: string;
        thumbnailLineHeightRatio?: number;
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
  // EXPORT PLAIN TEXT
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.EXPORT_PLAIN_TEXT,
    async (
      _event: IpcMainInvokeEvent,
      content: string,
      outputPath: string
    ): Promise<IpcResponse<string>> => {
      console.log(`[CaptionHandlers] Export plain text -> ${outputPath}`);

      try {
        const result = await CaptionService.exportPlainText(content, outputPath);
        if (result.success) {
          return { success: true, data: outputPath };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi export text thuần:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.RENDER_VIDEO_PREVIEW_FRAME,
    async (
      _event: IpcMainInvokeEvent,
      options: RenderVideoPreviewFrameOptions
    ): Promise<IpcResponse<RenderVideoPreviewFrameResult>> => {
      const safeVideoPath = typeof options?.videoPath === 'string' ? options.videoPath : '';
      console.log(`[CaptionHandlers] Render video preview frame: ${safeVideoPath || '(empty)'}`);
      try {
        const result = await CaptionService.renderVideoPreviewFrame(options);
        if (result.success) {
          return { success: true, data: result };
        }
        return { success: false, error: result.error || 'Không thể render video preview frame.' };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi render video preview frame:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.STOP_VIDEO_PREVIEW_FRAME,
    async (
      _event: IpcMainInvokeEvent,
      requestToken?: string
    ): Promise<IpcResponse<{ stopped: boolean; message: string }>> => {
      try {
        const stopResult = CaptionService.stopActiveVideoPreviewFrame(requestToken);
        return {
          success: stopResult.success,
          data: {
            stopped: stopResult.stopped,
            message: stopResult.message,
          },
          error: stopResult.success ? undefined : stopResult.message,
        };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi stop video preview frame:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.MIX_AUDIO_PREVIEW,
    async (
      event: IpcMainInvokeEvent,
      options: RenderAudioPreviewOptions
    ): Promise<IpcResponse<RenderAudioPreviewResult>> => {
      console.log(`[CaptionHandlers] Mix audio preview: ${options.outputPath}`);
      try {
        const progressCallback = (progress: RenderAudioPreviewProgress) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send(CAPTION_VIDEO_IPC_CHANNELS.AUDIO_PREVIEW_PROGRESS, progress);
          }
        };

        const result = await CaptionService.renderStep7AudioPreview(options, progressCallback);
        if (result.success) {
          return { success: true, data: result };
        }
        return { success: false, error: result.error || 'Không thể mix audio preview.' };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi mix audio preview:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.STOP_AUDIO_PREVIEW,
    async (): Promise<IpcResponse<{ stopped: boolean; message: string }>> => {
      try {
        const stopResult = CaptionService.stopActiveAudioPreview();
        return {
          success: stopResult.success,
          data: {
            stopped: stopResult.stopped,
            message: stopResult.message,
          },
          error: stopResult.success ? undefined : stopResult.message,
        };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi stop audio preview:', error);
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
          return { success: true, data: [] };
        }

        const files = await fs.promises.readdir(fontsDir);
        const fontFiles = files.filter((f) => isSupportedCaptionFontFile(f));
        const fonts: string[] = [];
        for (const file of fontFiles) {
          const familyName = await extractFontFamilyName(path.join(fontsDir, file));
          const fallbackName = getFileBaseName(file);
          fonts.push((familyName || fallbackName).trim());
        }
        const deduped = Array.from(new Set(fonts)).filter(Boolean);

        // console.log('[CaptionHandlers][Font] getAvailableFonts', {
        //   fontsDir,
        //   count: deduped.length,
        //   fonts: deduped,
        // });

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
        const fontFiles = files.filter((f) => isSupportedCaptionFontFile(f));
        const normalizedRequest = fontName.toLowerCase().trim();

        let matchedPath: string | null = null;
        for (const file of fontFiles) {
          const fullPath = path.join(fontsDir, file);
          const familyName = await extractFontFamilyName(fullPath);
          const fallbackName = getFileBaseName(file);
          const lowerFile = file.toLowerCase();
          if (
            (familyName && familyName.toLowerCase() === normalizedRequest) ||
            fallbackName.toLowerCase() === normalizedRequest ||
            lowerFile === normalizedRequest
          ) {
            matchedPath = fullPath;
            break;
          }
        }

        if (!matchedPath) {
          return { success: false, error: `Font not found: ${fontName}` };
        }

        const ext = path.extname(matchedPath).toLowerCase();
        const mime = ext === '.otf' ? 'font/otf' : 'font/ttf';
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
  // CAPTION VIDEO - RENDER THUMBNAIL FILE
  // ============================================
  ipcMain.handle(
    CAPTION_VIDEO_IPC_CHANNELS.RENDER_THUMBNAIL_FILE,
    async (
      _event: IpcMainInvokeEvent,
      options: RenderThumbnailFileOptions
    ): Promise<IpcResponse<RenderThumbnailFileResult>> => {
      const safeVideoPath = typeof options?.videoPath === 'string' ? options.videoPath : '';
      const safeFileName = typeof options?.fileName === 'string' ? options.fileName.trim() : '';
      if (!safeVideoPath || !safeFileName) {
        return { success: false, error: 'Thiếu videoPath hoặc fileName.' };
      }
      try {
        const path = await import('path');
        const fs = await import('fs/promises');
        const outputPath = path.join(path.dirname(safeVideoPath), path.basename(safeFileName));
        const { fileName, ...renderOptions } = options;
        const result = await CaptionService.renderThumbnailPreviewFrame(renderOptions);
        if (!result.success || !result.frameData) {
          return { success: false, error: result.error || 'Không thể render thumbnail.' };
        }
        const sanitizedBase64 = String(result.frameData || '').replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(sanitizedBase64, 'base64');
        await fs.writeFile(outputPath, buffer);
        console.log(`[CaptionHandlers] Render thumbnail file -> ${outputPath}`);
        return { success: true, data: { success: true, outputPath } };
      } catch (error) {
        console.error('[CaptionHandlers] Lỗi render thumbnail file:', error);
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
        const fsSync = await import('fs');
        const sessionPath = payload?.sessionPath;
        if (!sessionPath || typeof sessionPath !== 'string') {
          return { success: false, error: 'SESSION_INVALID_INPUT: Thiếu sessionPath' };
        }
        return await withSessionLock(sessionPath, async () => {
          const isDev = process?.env?.NODE_ENV !== 'production';
          const exists = fsSync.existsSync(sessionPath);
          // if (isDev) {
          //   console.log('[CaptionSession][READ] start', { sessionPath, exists });
          // }
          try {
            const buffer = await fs.readFile(sessionPath);
            const raw = decodeJsonTextFromBuffer(buffer);
            const parsed = JSON.parse(raw);
            const fixed = fixMojibakeDeep(parsed);
            // if (isDev) {
            //   console.log('[CaptionSession][READ] success', { sessionPath });
            // }
            return { success: true, data: fixed };
          } catch (error) {
            const err = String(error);
            if (err.includes('ENOENT')) {
              // if (isDev) {
              //   console.log('[CaptionSession][READ] not_found', { sessionPath });
              // }
              return { success: true, data: null };
            }
            // if (isDev) {
            //   console.warn('[CaptionSession][READ] failed', { sessionPath, error: err });
            // }
            return { success: false, error: `SESSION_READ_FAILED: ${err}` };
          }
        });
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
        return await withSessionLock(sessionPath, async () => {
          const isDev = process?.env?.NODE_ENV !== 'production';
          const outputDir = path.dirname(sessionPath);
          if (path.basename(outputDir).toLowerCase() === 'caption_output') {
            const baseDir = path.dirname(outputDir);
            if (!fsSync.existsSync(baseDir)) {
              return { success: false, error: `SESSION_BASE_DIR_MISSING: ${baseDir}` };
            }
          }
          const dir = path.dirname(sessionPath);
          await fs.mkdir(dir, { recursive: true });
          const tmpPath = `${sessionPath}.tmp-${Date.now()}`;
          const jsonPayload = JSON.stringify(payload?.data ?? {}, null, 2);
          await fs.writeFile(tmpPath, jsonPayload, 'utf-8');
          try {
            if (!fsSync.existsSync(sessionPath)) {
              await fs.rename(tmpPath, sessionPath);
            } else {
              await fs.copyFile(tmpPath, sessionPath);
              await fs.unlink(tmpPath);
            }
          } catch (error) {
            // Fallback: direct write when replace fails (e.g. locked file on Windows)
            try {
              await fs.copyFile(tmpPath, sessionPath);
              await fs.unlink(tmpPath);
            } catch (fallbackError) {
              if (isDev) {
                console.warn('[CaptionSession][WRITE] failed', {
                  sessionPath,
                  error: String(error),
                  fallback: String(fallbackError),
                });
              }
              return { success: false, error: `SESSION_WRITE_FAILED: ${String(error)} | fallback: ${String(fallbackError)}` };
            }
          }
          return { success: true, data: sessionPath };
        });
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
        return await withSessionLock(sessionPath, async () => {
          const isDev = process?.env?.NODE_ENV !== 'production';
          const outputDir = path.dirname(sessionPath);
          if (path.basename(outputDir).toLowerCase() === 'caption_output') {
            const baseDir = path.dirname(outputDir);
            if (!fsSync.existsSync(baseDir)) {
              return { success: false, error: `SESSION_BASE_DIR_MISSING: ${baseDir}` };
            }
          }
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            return { success: false, error: 'SESSION_INVALID_INPUT: Patch không hợp lệ' };
          }

          let current: Record<string, unknown> = {};
          if (fsSync.existsSync(sessionPath)) {
            try {
              const buffer = await fs.readFile(sessionPath);
            const raw = decodeJsonTextFromBuffer(buffer);
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              current = fixMojibakeDeep(parsed) as Record<string, unknown>;
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
          try {
            if (!fsSync.existsSync(sessionPath)) {
              await fs.rename(tmpPath, sessionPath);
            } else {
              await fs.copyFile(tmpPath, sessionPath);
              await fs.unlink(tmpPath);
            }
          } catch (error) {
            try {
              await fs.copyFile(tmpPath, sessionPath);
              await fs.unlink(tmpPath);
            } catch (fallbackError) {
              if (isDev) {
                console.warn('[CaptionSession][PATCH] failed', {
                  sessionPath,
                  error: String(error),
                  fallback: String(fallbackError),
                });
              }
              return { success: false, error: `SESSION_PATCH_FAILED: ${String(error)} | fallback: ${String(fallbackError)}` };
            }
          }
          return { success: true, data: merged };
        });
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


