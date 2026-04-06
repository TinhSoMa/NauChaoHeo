/**
 * TTS IPC Handlers - Xử lý các IPC request liên quan đến Text-to-Speech
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  CAPTION_PROCESS_STOP_SIGNAL,
  CAPTION_IPC_CHANNELS,
  CaptionSessionV1,
  FitAudioAuditItem,
  FitAudioAuditFromSessionsRequest,
  FitAudioAuditResponse,
  FitAudioAuditRow,
  FitAudioAuditSummary,
  SubtitleEntry,
  TTSTestVoiceRequest,
  TTSTestVoiceResponse,
  TTSOptions,
  TTSResult,
  MergeResult,
  TrimSilencePathItem,
  TrimSilenceResult,
  VoiceInfo,
} from '../../shared/types/caption';
import * as TTSService from '../services/tts';
import { getCaptionSessionPathFromInput } from '../../shared/utils/captionSession';

/**
 * Response chuẩn cho IPC
 */
interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const FIT_AUDIO_SPEED_WARNING_THRESHOLD = 1.35;
const FIT_AUDIO_DEFAULT_TOP_FASTEST = 20;
const FIT_AUDIO_MAX_TOP_FASTEST = 100;
const FIT_AUDIO_AUDIT_WORKERS = 6;
const FIT_AUDIO_MAX_ROWS_IN_RESPONSE = 500;
const DEFAULT_TRIM_AUDIO_CONCURRENCY = 4;
const MIN_TRIM_AUDIO_CONCURRENCY = 1;
const MAX_TRIM_AUDIO_CONCURRENCY = 16;

function toFinitePositive(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function roundTo(value: number, digits: number): number {
  const safeDigits = Number.isFinite(digits) ? Math.max(0, Math.min(6, Math.floor(digits))) : 3;
  const pow = 10 ** safeDigits;
  return Math.round(value * pow) / pow;
}

function normalizePathKey(value: string): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function isSamePath(a: string, b: string): boolean {
  return normalizePathKey(a) === normalizePathKey(b);
}

function clampTopFastest(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    if (normalized > 0) {
      return Math.min(FIT_AUDIO_MAX_TOP_FASTEST, normalized);
    }
  }
  return FIT_AUDIO_DEFAULT_TOP_FASTEST;
}

function clampTrimConcurrency(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded < MIN_TRIM_AUDIO_CONCURRENCY) {
      return DEFAULT_TRIM_AUDIO_CONCURRENCY;
    }
    return Math.min(MAX_TRIM_AUDIO_CONCURRENCY, rounded);
  }
  return DEFAULT_TRIM_AUDIO_CONCURRENCY;
}

async function processTrimTargetsInParallel(
  trimTargets: TrimSilencePathItem[],
  options: { concurrency?: number } | undefined,
  trimAction: (inputPath: string, outputPath: string) => Promise<boolean>,
  invalidPathError: string,
  failedPrefix: string
): Promise<TrimSilenceResult> {
  const safeTargets = Array.isArray(trimTargets) ? trimTargets : [];
  const workerCount = Math.max(1, Math.min(safeTargets.length || 1, clampTrimConcurrency(options?.concurrency)));

  let trimmedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= safeTargets.length) {
        return;
      }

      const target = safeTargets[currentIndex];
      const inputPath = (target?.inputPath || '').trim();
      const outputPath = (target?.outputPath || '').trim();
      if (!inputPath || !outputPath) {
        failedCount++;
        errors.push(invalidPathError);
        continue;
      }
      try {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
      } catch {
        failedCount++;
        errors.push(`Không tạo được thư mục output: ${outputPath}`);
        continue;
      }

      const success = await trimAction(inputPath, outputPath);
      if (success) {
        trimmedCount++;
      } else {
        failedCount++;
        errors.push(`${failedPrefix}: ${inputPath}`);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return {
    success: failedCount === 0,
    trimmedCount,
    failedCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function toAuditSummary(rows: FitAudioAuditRow[]): FitAudioAuditSummary {
  const totalItems = rows.length;
  const validRows = rows.filter((row) => !row.error);
  const validItems = validRows.length;
  const scaledRows = validRows.filter((row) => row.isScaled);
  const scaledCount = scaledRows.length;
  const skippedCount = Math.max(0, validItems - scaledCount);
  const tooFastCount = validRows.filter((row) => row.isTooFast).length;
  const withinAllowedCount = validRows.filter((row) => row.withinAllowed).length;

  const speedRows = scaledRows.length > 0 ? scaledRows : validRows;
  const speedRatios = speedRows.map((row) => row.speedRatio).filter((value) => Number.isFinite(value) && value > 0);

  const minSpeedRatio = speedRatios.length > 0 ? Math.min(...speedRatios) : 1;
  const maxSpeedRatio = speedRatios.length > 0 ? Math.max(...speedRatios) : 1;
  const avgSpeedRatio = speedRatios.length > 0
    ? (speedRatios.reduce((sum, value) => sum + value, 0) / speedRatios.length)
    : 1;

  const basePercent = validItems > 0 ? validItems : 1;

  return {
    totalItems,
    validItems,
    scaledCount,
    skippedCount,
    tooFastCount,
    withinAllowedCount,
    scaledPercent: roundTo((scaledCount / basePercent) * 100, 2),
    tooFastPercent: roundTo((tooFastCount / basePercent) * 100, 2),
    withinAllowedPercent: roundTo((withinAllowedCount / basePercent) * 100, 2),
    minSpeedRatio: roundTo(minSpeedRatio, 4),
    avgSpeedRatio: roundTo(avgSpeedRatio, 4),
    maxSpeedRatio: roundTo(maxSpeedRatio, 4),
    speedWarningThreshold: FIT_AUDIO_SPEED_WARNING_THRESHOLD,
  };
}

function trimPathTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function normalizePathSegments(value: string): string[] {
  return value.replace(/\\/g, '/').split('/').filter(Boolean);
}

function isAbsoluteFsPath(value: string): boolean {
  if (!value) return false;
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('//') || value.startsWith('/');
}

function joinBaseAndRelative(basePath: string, relativePath: string): string {
  const normalizedBase = trimPathTrailingSeparators(basePath.trim());
  const normalizedRelative = relativePath.trim().replace(/^[./\\]+/, '').replace(/[\\/]+/g, '/');
  if (!normalizedBase) {
    return normalizedRelative;
  }
  if (!normalizedRelative) {
    return normalizedBase;
  }
  const separator = normalizedBase.includes('\\') ? '\\' : '/';
  return `${normalizedBase}${separator}${normalizedRelative.split('/').join(separator)}`;
}

function rebaseCaptionOutputPath(pathValue: string, folderPath: string): string {
  const normalizedFolderPath = trimPathTrailingSeparators(folderPath.trim());
  if (!normalizedFolderPath) {
    return pathValue;
  }
  const segments = normalizePathSegments(pathValue);
  if (segments.length === 0) {
    return pathValue;
  }
  const captionOutputIndex = segments.findIndex((segment) => segment.toLowerCase() === 'caption_output');
  if (captionOutputIndex < 0) {
    return pathValue;
  }
  const relativeFromCaptionOutput = segments.slice(captionOutputIndex).join('/');
  return joinBaseAndRelative(normalizedFolderPath, relativeFromCaptionOutput);
}

function resolveSessionStoredPath(pathValue?: string | null, folderPath?: string): string {
  const rawPath = typeof pathValue === 'string' ? pathValue.trim() : '';
  if (!rawPath) {
    return '';
  }
  const normalizedFolderPath = typeof folderPath === 'string' ? folderPath.trim() : '';
  if (isAbsoluteFsPath(rawPath)) {
    if (!normalizedFolderPath) {
      return rawPath;
    }
    return rebaseCaptionOutputPath(rawPath, normalizedFolderPath);
  }
  if (!normalizedFolderPath) {
    return rawPath;
  }
  if (rawPath === '.') {
    return trimPathTrailingSeparators(normalizedFolderPath);
  }
  return joinBaseAndRelative(normalizedFolderPath, rawPath);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function runFitAudioAudit(
  audioItems: FitAudioAuditItem[],
  topFastestHint?: number
): Promise<FitAudioAuditResponse> {
  const safeItems = Array.isArray(audioItems) ? audioItems : [];
  const topFastestCount = clampTopFastest(topFastestHint);
  const durationCache = new Map<string, Promise<number>>();

  const readDuration = (audioPath: string): Promise<number> => {
    const safePath = String(audioPath || '').trim();
    if (!safePath) {
      return Promise.resolve(0);
    }
    const cacheKey = normalizePathKey(safePath);
    const cached = durationCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const pending = TTSService.getAudioDuration(safePath)
      .then((value) => (Number.isFinite(value) && value > 0 ? value : 0))
      .catch(() => 0);
    durationCache.set(cacheKey, pending);
    return pending;
  };

  const buildAuditRow = async (item: FitAudioAuditItem): Promise<FitAudioAuditRow> => {
      const originalPath = String(item?.originalPath || '').trim();
      const outputPath = String(item?.outputPath || '').trim();
      const allowedDurationMs = Math.max(1, Math.round(toFinitePositive(item?.allowedDurationMs, 0)));
      const originalDurationHintMs = Math.max(0, Math.round(toFinitePositive(item?.originalDurationMsHint, 0)));
      const outputDurationHintMs = Math.max(0, Math.round(toFinitePositive(item?.outputDurationMsHint, 0)));
    const scaledHint = typeof item?.isScaledHint === 'boolean' ? item.isScaledHint : undefined;
      const folderPath = typeof item?.folderPath === 'string' ? item.folderPath : undefined;
      const folderLabel = typeof item?.folderLabel === 'string' ? item.folderLabel : undefined;
    const scaled = typeof scaledHint === 'boolean'
      ? scaledHint
      : (!!originalPath && !!outputPath && !isSamePath(originalPath, outputPath));

      if (!originalPath || !outputPath || allowedDurationMs <= 0) {
        return {
          folderPath,
          folderLabel,
          originalPath,
          outputPath,
          allowedDurationMs,
          originalDurationMs: 0,
          outputDurationMs: 0,
          speedRatio: 1,
          outputVsAllowedRatio: 0,
          isScaled: scaled,
          withinAllowed: false,
          isTooFast: false,
          error: 'INVALID_INPUT',
        };
      }

      const hasDurationHints = originalDurationHintMs > 0 && outputDurationHintMs > 0;
      const hasSuspiciousScaledHints = scaled && hasDurationHints && outputDurationHintMs > (originalDurationHintMs + 20);
      const outputDurationMs = (outputDurationHintMs > 0 && !hasSuspiciousScaledHints)
        ? outputDurationHintMs
        : await readDuration(outputPath);
      const originalDurationMs = scaled
        ? (originalDurationHintMs > 0 ? originalDurationHintMs : await readDuration(originalPath))
        : (originalDurationHintMs > 0 ? originalDurationHintMs : outputDurationMs);

      if (originalDurationMs <= 0 || outputDurationMs <= 0) {
        return {
          folderPath,
          folderLabel,
          originalPath,
          outputPath,
          allowedDurationMs,
          originalDurationMs,
          outputDurationMs,
          speedRatio: 1,
          outputVsAllowedRatio: outputDurationMs > 0 ? roundTo(outputDurationMs / allowedDurationMs, 4) : 0,
          isScaled: scaled,
          withinAllowed: false,
          isTooFast: false,
          error: 'READ_DURATION_FAILED',
        };
      }

      const speedRatio = roundTo(originalDurationMs / outputDurationMs, 4);
      const outputVsAllowedRatio = roundTo(outputDurationMs / allowedDurationMs, 4);
      const withinAllowed = outputDurationMs <= allowedDurationMs + 20;
      const isTooFast = scaled && speedRatio >= FIT_AUDIO_SPEED_WARNING_THRESHOLD;

      return {
        folderPath,
        folderLabel,
        originalPath,
        outputPath,
        allowedDurationMs,
        originalDurationMs,
        outputDurationMs,
        speedRatio,
        outputVsAllowedRatio,
        isScaled: scaled,
        withinAllowed,
        isTooFast,
      };
  };

  const rows: FitAudioAuditRow[] = new Array(safeItems.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(FIT_AUDIO_AUDIT_WORKERS, safeItems.length || 1));

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= safeItems.length) {
        return;
      }
      rows[currentIndex] = await buildAuditRow(safeItems[currentIndex]);
      if ((currentIndex + 1) % 25 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const summary = toAuditSummary(rows);
  const topFastest = rows
    .filter((row) => !row.error && row.isScaled)
    .sort((a, b) => b.speedRatio - a.speedRatio)
    .slice(0, topFastestCount);

  return {
    summary,
    rows: rows.slice(0, FIT_AUDIO_MAX_ROWS_IN_RESPONSE),
    topFastest,
  };
}

async function collectFitAudioAuditItemsFromSessions(
  request: FitAudioAuditFromSessionsRequest
): Promise<FitAudioAuditItem[]> {
  const inputType = request?.inputType === 'srt' ? 'srt' : 'draft';
  const safeInputPaths = Array.isArray(request?.inputPaths)
    ? request.inputPaths.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : [];
  const items: FitAudioAuditItem[] = [];

  for (const rawPath of safeInputPaths) {
    const folderPath = String(rawPath).trim();
    const sessionPath = getCaptionSessionPathFromInput(inputType, folderPath);
    if (!sessionPath) {
      continue;
    }

    let session: CaptionSessionV1 | null = null;
    try {
      const raw = await fs.readFile(sessionPath, 'utf-8');
      session = JSON.parse(raw) as CaptionSessionV1;
    } catch {
      continue;
    }

    const fitResults = toRecord(session?.data?.fitResults);
    const fitAuditRows = Array.isArray(fitResults.fitAuditRows)
      ? fitResults.fitAuditRows as Array<Record<string, unknown>>
      : [];
    if (fitAuditRows.length > 0) {
      for (const row of fitAuditRows) {
        const originalRaw = typeof row?.originalPath === 'string' ? row.originalPath : '';
        const outputRaw = typeof row?.outputPath === 'string' ? row.outputPath : '';
        const originalPath = resolveSessionStoredPath(originalRaw, folderPath);
        const outputPath = resolveSessionStoredPath(outputRaw, folderPath);
        const allowedDurationMs = Math.max(1, Math.round(toFinitePositive(row?.allowedDurationMs, 0)));
        const originalDurationMsHint = Math.max(0, Math.round(toFinitePositive(row?.originalDurationMs, 0)));
        const outputDurationMsHint = Math.max(0, Math.round(toFinitePositive(row?.outputDurationMs, 0)));
        if (!originalPath || !outputPath || allowedDurationMs <= 0) {
          continue;
        }
        items.push({
          folderPath,
          folderLabel: path.basename(folderPath) || folderPath,
          originalPath,
          outputPath,
          allowedDurationMs,
          originalDurationMsHint,
          outputDurationMsHint,
          isScaledHint: typeof row?.isScaled === 'boolean' ? row.isScaled : undefined,
        });
      }
      continue;
    }

    const pathMapping = Array.isArray(fitResults.pathMapping)
      ? fitResults.pathMapping as Array<Record<string, unknown>>
      : [];
    if (pathMapping.length === 0) {
      continue;
    }

    const srtSpeedRaw = readNumber(fitResults, 'srtSpeed');
    const srtSpeed = Number.isFinite(srtSpeedRaw) && (srtSpeedRaw as number) > 0
      ? (srtSpeedRaw as number)
      : 1;

    const sourceFiles = Array.isArray(fitResults.sourceFiles)
      ? fitResults.sourceFiles
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .map((value) => resolveSessionStoredPath(String(value), folderPath))
      : [];

    const ttsAudioFiles = Array.isArray(session?.data?.ttsAudioFiles)
      ? session.data.ttsAudioFiles
      : [];

    const durationBySourcePath = new Map<string, number>();
    const durationByAudioPath = new Map<string, number>();

    for (let index = 0; index < ttsAudioFiles.length; index += 1) {
      const file = ttsAudioFiles[index] as Record<string, unknown>;
      if (!file || typeof file !== 'object') {
        continue;
      }

      const durationMs = typeof file.durationMs === 'number' ? Number(file.durationMs) : 0;
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        continue;
      }

      const audioPathRaw = typeof file.path === 'string' ? String(file.path) : '';
      const audioPath = resolveSessionStoredPath(audioPathRaw, folderPath);
      if (audioPath) {
        durationByAudioPath.set(normalizePathKey(audioPath), durationMs);
      }

      if (index < sourceFiles.length) {
        const sourcePath = sourceFiles[index];
        durationBySourcePath.set(normalizePathKey(sourcePath), durationMs);
      }
    }

    const folderLabel = path.basename(folderPath) || folderPath;

    for (const mapping of pathMapping) {
      const originalRaw = typeof mapping?.originalPath === 'string' ? mapping.originalPath : '';
      const outputRaw = typeof mapping?.outputPath === 'string' ? mapping.outputPath : '';
      const originalPath = resolveSessionStoredPath(originalRaw, folderPath);
      const outputPath = resolveSessionStoredPath(outputRaw, folderPath);

      if (!originalPath || !outputPath) {
        continue;
      }

      const normalizedOriginal = normalizePathKey(originalPath);
      const baseDurationMs = durationBySourcePath.get(normalizedOriginal)
        ?? durationByAudioPath.get(normalizedOriginal)
        ?? 0;
      if (!Number.isFinite(baseDurationMs) || baseDurationMs <= 0) {
        continue;
      }

      const allowedDurationMs = Math.max(1, Math.round(baseDurationMs * srtSpeed));
      items.push({
        folderPath,
        folderLabel,
        originalPath,
        outputPath,
        allowedDurationMs,
        originalDurationMsHint: baseDurationMs,
      });
    }
  }

  return items;
}

/**
 * Đăng ký tất cả IPC handlers cho TTS
 */
export function registerTTSHandlers(): void {
  console.log('[TTSHandlers] Đăng ký handlers...');

  // ============================================
  // GET VOICES
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_GET_VOICES,
    async (): Promise<IpcResponse<VoiceInfo[]>> => {
      console.log('[TTSHandlers] Get voices');
      return { success: true, data: TTSService.getAvailableVoices() };
    }
  );

  // ============================================
  // TEST VOICE SAMPLE
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_TEST_VOICE,
    async (
      _event: IpcMainInvokeEvent,
      request: TTSTestVoiceRequest
    ): Promise<IpcResponse<TTSTestVoiceResponse>> => {
      try {
        const sampleText = (request?.text || '').trim();
        const sampleVoice = (request?.voice || '').trim();
        if (!sampleText) {
          return { success: false, error: 'Text test giọng không được để trống.' };
        }
        if (!sampleVoice) {
          return { success: false, error: 'Voice test giọng không hợp lệ.' };
        }
        console.log(`[TTSHandlers] Test voice: ${sampleVoice}`);
        const data = await TTSService.testVoiceSample({
          text: sampleText,
          voice: sampleVoice,
          rate: request?.rate,
          volume: request?.volume,
          outputFormat: request?.outputFormat,
        });
        return { success: true, data };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi test voice:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // ============================================
  // GENERATE TTS
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_GENERATE,
    async (
      event: IpcMainInvokeEvent,
      entries: SubtitleEntry[],
      options: Partial<TTSOptions>
    ): Promise<IpcResponse<TTSResult>> => {
      console.log(`[TTSHandlers] Generate TTS: ${entries.length} entries`);

      try {
        // Progress callback - gửi về renderer
        const progressCallback = (progress: unknown) => {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send(CAPTION_IPC_CHANNELS.TTS_PROGRESS, progress);
          }
        };

        const result = await TTSService.generateBatchAudio(entries, options, progressCallback);
        return { success: result.success, data: result, error: result.errors?.join(', ') };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi generate TTS:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // STOP TTS
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_STOP,
    async (): Promise<IpcResponse<{ stopped: boolean; message?: string }>> => {
      try {
        const ttsResult = TTSService.stopActiveTts();
        const mergeResult = TTSService.stopActiveAudioMerger();
        const stopped = !!ttsResult.stopped || !!mergeResult.stopped;
        return {
          success: true,
          data: {
            stopped,
            message: stopped
              ? 'Đã gửi tín hiệu dừng TTS và merge/fit audio.'
              : 'Không có TTS hoặc merge/fit audio đang chạy.',
          },
        };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi stop TTS:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // ============================================
  // ANALYZE AUDIO
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.AUDIO_ANALYZE,
    async (
      _event: IpcMainInvokeEvent,
      audioFiles: TTSResult['audioFiles'],
      srtDuration: number
    ): Promise<IpcResponse<unknown>> => {
      console.log(`[TTSHandlers] Analyze audio: ${audioFiles.length} files`);

      try {
        const analysis = await TTSService.analyzeAudioFiles(audioFiles, srtDuration);
        return { success: true, data: analysis };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi analyze audio:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // MERGE AUDIO
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.AUDIO_MERGE,
    async (
      event: IpcMainInvokeEvent,
      audioFiles: TTSResult['audioFiles'],
      outputPath: string,
      timeScale: number = 1.0
    ): Promise<IpcResponse<MergeResult>> => {
      console.log(`[TTSHandlers] Merge audio: ${audioFiles.length} files -> ${outputPath}, scale: ${timeScale}`);

      try {
        TTSService.resetTtsStopRequest();
        const result = await TTSService.mergeAudioFiles(audioFiles, outputPath, timeScale);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        if (error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL) {
          return { success: false, error: CAPTION_PROCESS_STOP_SIGNAL };
        }
        console.error('[TTSHandlers] Lỗi merge audio:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // TRIM SILENCE
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE,
    async (
      _event: IpcMainInvokeEvent,
      audioPaths: string[]
    ): Promise<IpcResponse<TrimSilenceResult>> => {
      console.log(`[TTSHandlers] Trim silence: ${audioPaths.length} files`);

      try {
        let trimmedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        for (const audioPath of audioPaths) {
          const success = await TTSService.trimSilence(audioPath);
          if (success) {
            trimmedCount++;
          } else {
            failedCount++;
            errors.push(`Không thể trim: ${audioPath}`);
          }
        }

        const result: TrimSilenceResult = {
          success: failedCount === 0,
          trimmedCount,
          failedCount,
          errors: errors.length > 0 ? errors : undefined,
        };

        return { success: result.success, data: result, error: result.errors?.join(', ') };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi trim silence:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // TRIM SILENCE END
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE_END,
    async (
      _event: IpcMainInvokeEvent,
      audioPaths: string[]
    ): Promise<IpcResponse<TrimSilenceResult>> => {
      console.log(`[TTSHandlers] Trim silence end: ${audioPaths.length} files`);

      try {
        let trimmedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        for (const audioPath of audioPaths) {
          const success = await TTSService.trimSilenceEnd(audioPath);
          if (success) {
            trimmedCount++;
          } else {
            failedCount++;
            errors.push(`Không thể trim end: ${audioPath}`);
          }
        }

        const result: TrimSilenceResult = {
          success: failedCount === 0,
          trimmedCount,
          failedCount,
          errors: errors.length > 0 ? errors : undefined,
        };

        return { success: result.success, data: result, error: result.errors?.join(', ') };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi trim silence end:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // TRIM SILENCE TO PATHS
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE_TO_PATHS,
    async (
      _event: IpcMainInvokeEvent,
      trimTargets: TrimSilencePathItem[],
      options?: { concurrency?: number }
    ): Promise<IpcResponse<TrimSilenceResult>> => {
      const safeTargets = Array.isArray(trimTargets) ? trimTargets : [];
      const workerCount = Math.max(1, Math.min(safeTargets.length || 1, clampTrimConcurrency(options?.concurrency)));
      console.log(`[TTSHandlers] Trim silence to paths: ${safeTargets.length} files (${workerCount} workers)`);

      try {
        const result = await processTrimTargetsInParallel(
          safeTargets,
          { concurrency: workerCount },
          TTSService.trimSilenceToPath,
          'Thiếu input/output path khi trim.',
          'Không thể trim'
        );

        return { success: result.success, data: result, error: result.errors?.join(', ') };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi trim silence to paths:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // TRIM SILENCE END TO PATHS
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE_END_TO_PATHS,
    async (
      _event: IpcMainInvokeEvent,
      trimTargets: TrimSilencePathItem[],
      options?: { concurrency?: number }
    ): Promise<IpcResponse<TrimSilenceResult>> => {
      const safeTargets = Array.isArray(trimTargets) ? trimTargets : [];
      const workerCount = Math.max(1, Math.min(safeTargets.length || 1, clampTrimConcurrency(options?.concurrency)));
      console.log(`[TTSHandlers] Trim silence end to paths: ${safeTargets.length} files (${workerCount} workers)`);

      try {
        const result = await processTrimTargetsInParallel(
          safeTargets,
          { concurrency: workerCount },
          TTSService.trimSilenceEndToPath,
          'Thiếu input/output path khi trim end.',
          'Không thể trim end'
        );

        return { success: result.success, data: result, error: result.errors?.join(', ') };
      } catch (error) {
        console.error('[TTSHandlers] Lỗi trim silence end to paths:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================
  // FIT AUDIO TO DURATION
  // ============================================
  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_FIT_AUDIO,
    async (
      _event: IpcMainInvokeEvent,
      audioItems: Array<{ path: string; durationMs: number; speedLabel?: string }>
    ): Promise<IpcResponse<{
      scaledCount: number;
      skippedCount: number;
      pathMapping: Array<{ originalPath: string; outputPath: string }>;
      auditRows: Array<{
        originalPath: string;
        outputPath: string;
        allowedDurationMs: number;
        originalDurationMs: number;
        outputDurationMs: number;
        isScaled: boolean;
      }>;
    }>> => {
      try {
        TTSService.resetTtsStopRequest();
        let scaledCount = 0;
        let skippedCount = 0;
        const pathMapping: Array<{ originalPath: string; outputPath: string }> = [];
        const auditRows: Array<{
          originalPath: string;
          outputPath: string;
          allowedDurationMs: number;
          originalDurationMs: number;
          outputDurationMs: number;
          isScaled: boolean;
        }> = [];

        for (const item of audioItems) {
          const result = await TTSService.fitAudioToDuration(item.path, item.durationMs, item.speedLabel);
          pathMapping.push({ originalPath: item.path, outputPath: result.outputPath });
          auditRows.push({
            originalPath: item.path,
            outputPath: result.outputPath,
            allowedDurationMs: Math.max(1, Math.round(toFinitePositive(item.durationMs, 0))),
            originalDurationMs: Math.max(0, Math.round(toFinitePositive(result.originalDurationMs, 0))),
            outputDurationMs: Math.max(0, Math.round(toFinitePositive(result.outputDurationMsEstimate, 0))),
            isScaled: !!result.scaled,
          });
          if (result.scaled) {
            scaledCount++;
          } else {
            skippedCount++;
          }
        }

        return {
          success: true,
          data: { scaledCount, skippedCount, pathMapping, auditRows },
        };
      } catch (error) {
        if (error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL) {
          return { success: false, error: CAPTION_PROCESS_STOP_SIGNAL };
        }
        console.error('[TTSHandlers] Lỗi fit audio:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_AUDIT_FIT_AUDIO,
    async (
      _event: IpcMainInvokeEvent,
      audioItems: FitAudioAuditItem[],
      options?: { topFastest?: number }
    ): Promise<IpcResponse<FitAudioAuditResponse>> => {
      try {
        const data = await runFitAudioAudit(audioItems, options?.topFastest);
        return {
          success: true,
          data,
        };
      } catch (error) {
        if (error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL) {
          return { success: false, error: CAPTION_PROCESS_STOP_SIGNAL };
        }
        console.error('[TTSHandlers] Lỗi audit fit audio:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_AUDIT_FIT_AUDIO_FROM_SESSIONS,
    async (
      _event: IpcMainInvokeEvent,
      request: FitAudioAuditFromSessionsRequest
    ): Promise<IpcResponse<FitAudioAuditResponse>> => {
      try {
        const auditItems = await collectFitAudioAuditItemsFromSessions(request);
        const data = await runFitAudioAudit(auditItems, request?.topFastest);
        return { success: true, data };
      } catch (error) {
        if (error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL) {
          return { success: false, error: CAPTION_PROCESS_STOP_SIGNAL };
        }
        console.error('[TTSHandlers] Lỗi audit fit audio from sessions:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_CHECK_FILES,
    async (
      _event: IpcMainInvokeEvent,
      paths: string[]
    ): Promise<IpcResponse<{ missingPaths: string[] }>> => {
      try {
        const missingPaths: string[] = [];
        for (const rawPath of paths || []) {
          if (typeof rawPath !== 'string' || !rawPath.trim()) {
            continue;
          }
          try {
            await fs.access(rawPath);
          } catch {
            missingPaths.push(rawPath);
          }
        }
        return { success: true, data: { missingPaths } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[TTSHandlers] Đã đăng ký handlers thành công');
}
