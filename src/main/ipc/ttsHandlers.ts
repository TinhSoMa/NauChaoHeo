/**
 * TTS IPC Handlers - Xử lý các IPC request liên quan đến Text-to-Speech
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import {
  CAPTION_IPC_CHANNELS,
  SubtitleEntry,
  TTSOptions,
  TTSResult,
  MergeOptions,
  MergeResult,
  TrimSilenceResult,
  VIETNAMESE_VOICES,
  VoiceInfo,
} from '../../shared/types/caption';
import * as TTSService from '../services/tts';

/**
 * Response chuẩn cho IPC
 */
interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
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
      return { success: true, data: VIETNAMESE_VOICES };
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
      console.log(`[TTSHandlers] Merge audio: ${audioFiles.length} files -> ${outputPath}`);

      try {
        const result = await TTSService.mergeAudioFiles(audioFiles, outputPath, timeScale);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
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

  console.log('[TTSHandlers] Đã đăng ký handlers thành công');
}
