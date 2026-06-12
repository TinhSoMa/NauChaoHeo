import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getFFmpegPath, getFFprobePath } from '../../utils/ffmpegPath';

interface MediaInfo {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface VideoAudioReplaceItem {
  videoPath: string;
  audioPath: string;
  outputPath?: string;
}

export interface VideoAudioReplaceBatchProgress {
  total: number;
  current: number;
  percent: number;
  currentVideo?: string;
  currentVideoPath?: string;
  stage: 'preflight' | 'processing' | 'completed' | 'stopped' | 'error';
  message: string;
}

export interface VideoAudioReplaceBatchLog {
  status: 'info' | 'success' | 'error' | 'processing';
  message: string;
  time: string;
  videoPath?: string;
  audioPath?: string;
  outputPath?: string;
}

export interface VideoAudioReplaceBatchItemResult {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  status: 'success' | 'error';
  error?: string;
}

export interface VideoAudioReplaceBatchResult {
  success: boolean;
  data?: {
    total: number;
    successCount: number;
    failedCount: number;
    stopped: boolean;
    results: VideoAudioReplaceBatchItemResult[];
  };
  error?: string;
}

export interface VideoAudioReplaceBatchOptions {
  items: VideoAudioReplaceItem[];
  keepOriginalAudioPercent?: number;
  onProgress?: (data: VideoAudioReplaceBatchProgress) => void;
  onLog?: (data: VideoAudioReplaceBatchLog) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return minValue;
  return Math.min(maxValue, Math.max(minValue, value));
}

function toSecondsFromFfmpegTime(raw: string): number {
  const match = raw.match(/(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return h * 3600 + m * 60 + s;
}

class VideoAudioReplaceBatchService {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private stopRequested = false;

  stop(): void {
    this.stopRequested = true;
    if (this.activeProcess && !this.activeProcess.killed) {
      try {
        this.activeProcess.kill('SIGKILL');
      } catch {
        // noop
      }
    }
  }

  private resolveUniqueOutputPath(videoPath: string, preferredOutputPath?: string): string {
    if (preferredOutputPath?.trim()) {
      const ext = path.extname(preferredOutputPath);
      const base = path.basename(preferredOutputPath, ext);
      const dir = path.dirname(preferredOutputPath);
      let candidate = preferredOutputPath;
      let idx = 2;
      while (fsSync.existsSync(candidate)) {
        candidate = path.join(dir, `${base}_v${idx}${ext}`);
        idx += 1;
      }
      return candidate;
    }

    const sourceDir = path.dirname(videoPath);
    const sourceExt = path.extname(videoPath) || '.mp4';
    const sourceBase = path.basename(videoPath, sourceExt);
    let outputPath = path.join(sourceDir, `${sourceBase}_audio_replaced${sourceExt}`);
    let suffix = 2;
    while (fsSync.existsSync(outputPath)) {
      outputPath = path.join(sourceDir, `${sourceBase}_audio_replaced_v${suffix}${sourceExt}`);
      suffix += 1;
    }
    return outputPath;
  }

  private async getMediaInfo(filePath: string): Promise<{ success: boolean; data?: MediaInfo; error?: string }> {
    if (!filePath || !fsSync.existsSync(filePath)) {
      return { success: false, error: 'File không tồn tại.' };
    }
    const ffprobePath = getFFprobePath();
    if (!fsSync.existsSync(ffprobePath)) {
      return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
    }

    return new Promise((resolve) => {
      const args = ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath];
      const proc = spawn(ffprobePath, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ success: false, error: stderr || `ffprobe exit code ${code}` });
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as {
            streams?: Array<{ codec_type?: string }>;
            format?: { duration?: string };
          };
          const streams = parsed.streams || [];
          const videoStream = streams.find((s) => s.codec_type === 'video');
          const audioStream = streams.find((s) => s.codec_type === 'audio');
          const duration = Number(parsed.format?.duration || 0);

          if (!Number.isFinite(duration) || duration <= 0) {
            resolve({ success: false, error: 'Không đọc được duration hợp lệ.' });
            return;
          }

          resolve({
            success: true,
            data: {
              duration,
              hasVideo: !!videoStream,
              hasAudio: !!audioStream,
            },
          });
        } catch (error) {
          resolve({ success: false, error: `Lỗi parse ffprobe json: ${String(error)}` });
        }
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: `Lỗi ffprobe: ${error.message}` });
      });
    });
  }

  private async replaceSingleItem(input: {
    item: VideoAudioReplaceItem;
    keepOriginalAudioPercent: number;
    onProgress?: (percent: number, message: string) => void;
    onLog?: (status: VideoAudioReplaceBatchLog['status'], message: string) => void;
  }): Promise<VideoAudioReplaceBatchItemResult> {
    const { item, keepOriginalAudioPercent } = input;
    const ffmpegPath = getFFmpegPath();
    if (!fsSync.existsSync(ffmpegPath)) {
      return {
        videoPath: item.videoPath,
        audioPath: item.audioPath,
        outputPath: item.outputPath || '',
        status: 'error',
        error: `FFmpeg không tìm thấy: ${ffmpegPath}`,
      };
    }

    const videoInfo = await this.getMediaInfo(item.videoPath);
    if (!videoInfo.success || !videoInfo.data) {
      return {
        videoPath: item.videoPath,
        audioPath: item.audioPath,
        outputPath: item.outputPath || '',
        status: 'error',
        error: videoInfo.error || 'Không đọc được metadata video.',
      };
    }
    if (!videoInfo.data.hasVideo) {
      return {
        videoPath: item.videoPath,
        audioPath: item.audioPath,
        outputPath: item.outputPath || '',
        status: 'error',
        error: 'Input video không có video stream.',
      };
    }

    const audioInfo = await this.getMediaInfo(item.audioPath);
    if (!audioInfo.success || !audioInfo.data) {
      return {
        videoPath: item.videoPath,
        audioPath: item.audioPath,
        outputPath: item.outputPath || '',
        status: 'error',
        error: audioInfo.error || 'Không đọc được metadata audio.',
      };
    }
    if (!audioInfo.data.hasAudio) {
      return {
        videoPath: item.videoPath,
        audioPath: item.audioPath,
        outputPath: item.outputPath || '',
        status: 'error',
        error: 'Input audio không có audio stream.',
      };
    }

    const resolvedOutputPath = this.resolveUniqueOutputPath(item.videoPath, item.outputPath);
    const keepOriginal = clamp(keepOriginalAudioPercent, 0, 100);
    const useMix = keepOriginal > 0 && videoInfo.data.hasAudio;

    const args = ['-y', '-i', item.videoPath, '-i', item.audioPath];
    if (useMix) {
      const originalGain = (keepOriginal / 100).toFixed(3);
      const filterComplex = `[0:a]volume=${originalGain},aresample=48000[a_org];[1:a]aresample=48000,volume=1.000[a_new];[a_org][a_new]amix=inputs=2:duration=first:dropout_transition=0[a_out]`;
      args.push(
        '-filter_complex', filterComplex,
        '-map', '0:v:0',
        '-map', '[a_out]',
      );
    } else {
      args.push(
        '-map', '0:v:0',
        '-map', '1:a:0',
      );
    }

    args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    const outExt = path.extname(resolvedOutputPath).toLowerCase();
    if (outExt === '.mp4' || outExt === '.mov') {
      args.push('-movflags', '+faststart');
    }
    args.push(resolvedOutputPath);

    input.onLog?.('processing', `Bắt đầu ghép audio cho ${path.basename(item.videoPath)}...`);
    input.onProgress?.(10, 'Đang ghép audio...');

    this.stopRequested = false;
    return await new Promise((resolve) => {
      let stderr = '';
      const proc = spawn(ffmpegPath, args, { windowsHide: true });
      this.activeProcess = proc;

      proc.stderr.on('data', (data) => {
        const line = data.toString();
        stderr += line;
        if (stderr.length > 30000) {
          stderr = stderr.slice(-30000);
        }
        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
        if (timeMatch && videoInfo.data && videoInfo.data.duration > 0) {
          const sec = toSecondsFromFfmpegTime(timeMatch[1]);
          const ratio = Math.max(0, Math.min(1, sec / videoInfo.data.duration));
          input.onProgress?.(10 + ratio * 85, 'Đang xử lý ffmpeg...');
        }
      });

      const finalize = async (result: VideoAudioReplaceBatchItemResult): Promise<void> => {
        this.activeProcess = null;
        this.stopRequested = false;
        resolve(result);
      };

      proc.on('close', async (code) => {
        if (this.stopRequested) {
          try {
            if (fsSync.existsSync(resolvedOutputPath)) {
              await fs.unlink(resolvedOutputPath);
            }
          } catch {
            // noop
          }
          await finalize({
            videoPath: item.videoPath,
            audioPath: item.audioPath,
            outputPath: resolvedOutputPath,
            status: 'error',
            error: 'Đã dừng theo yêu cầu.',
          });
          return;
        }

        if (code === 0 && fsSync.existsSync(resolvedOutputPath)) {
          input.onProgress?.(100, 'Ghép thành công.');
          await finalize({
            videoPath: item.videoPath,
            audioPath: item.audioPath,
            outputPath: resolvedOutputPath,
            status: 'success',
          });
          return;
        }

        const errorMessage = `FFmpeg thất bại (exit ${code})\n${stderr.slice(-1200)}`;
        try {
          if (fsSync.existsSync(resolvedOutputPath)) {
            await fs.unlink(resolvedOutputPath);
          }
        } catch {
          // noop
        }
        await finalize({
          videoPath: item.videoPath,
          audioPath: item.audioPath,
          outputPath: resolvedOutputPath,
          status: 'error',
          error: errorMessage,
        });
      });

      proc.on('error', async (error) => {
        try {
          if (fsSync.existsSync(resolvedOutputPath)) {
            await fs.unlink(resolvedOutputPath);
          }
        } catch {
          // noop
        }
        await finalize({
          videoPath: item.videoPath,
          audioPath: item.audioPath,
          outputPath: resolvedOutputPath,
          status: 'error',
          error: `Không thể chạy FFmpeg: ${error.message}`,
        });
      });
    });
  }

  async startBatch(options: VideoAudioReplaceBatchOptions): Promise<VideoAudioReplaceBatchResult> {
    const emitProgress = (data: VideoAudioReplaceBatchProgress): void => options.onProgress?.(data);
    const emitLog = (data: VideoAudioReplaceBatchLog): void => options.onLog?.(data);
    this.stopRequested = false;

    const items = Array.isArray(options.items) ? options.items : [];
    if (items.length === 0) {
      return { success: false, error: 'Không có item nào để xử lý.' };
    }

    emitProgress({
      total: items.length,
      current: 0,
      percent: 0,
      stage: 'preflight',
      message: 'Đang kiểm tra danh sách video/audio...',
    });

    const keepOriginalAudioPercent = clamp(options.keepOriginalAudioPercent ?? 0, 0, 100);
    const results: VideoAudioReplaceBatchItemResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (let index = 0; index < items.length; index += 1) {
      if (this.stopRequested) {
        emitProgress({
          total: items.length,
          current: index,
          percent: Math.round((index / items.length) * 100),
          stage: 'stopped',
          message: 'Đã dừng theo yêu cầu.',
        });
        break;
      }

      const item = items[index];
      const currentVideo = path.basename(item.videoPath || '');
      emitProgress({
        total: items.length,
        current: index + 1,
        percent: Math.round((index / items.length) * 100),
        currentVideo,
        currentVideoPath: item.videoPath,
        stage: 'processing',
        message: `Đang xử lý ${index + 1}/${items.length}: ${currentVideo}`,
      });
      emitLog({
        status: 'processing',
        message: `Đang ghép item ${index + 1}/${items.length}.`,
        time: nowIso(),
        videoPath: item.videoPath,
        audioPath: item.audioPath,
      });

      if (!item.videoPath || !item.audioPath) {
        const result: VideoAudioReplaceBatchItemResult = {
          videoPath: item.videoPath,
          audioPath: item.audioPath,
          outputPath: '',
          status: 'error',
          error: 'Thiếu videoPath hoặc audioPath.',
        };
        results.push(result);
        failedCount += 1;
        emitLog({
          status: 'error',
          message: result.error || 'Item không hợp lệ.',
          time: nowIso(),
          videoPath: item.videoPath,
          audioPath: item.audioPath,
        });
        continue;
      }

      const result = await this.replaceSingleItem({
        item,
        keepOriginalAudioPercent,
        onProgress: (percent, message) => {
          emitProgress({
            total: items.length,
            current: index + 1,
            percent: Math.round((index / items.length) * 100 + (percent / Math.max(items.length, 1))),
            currentVideo,
            currentVideoPath: item.videoPath,
            stage: 'processing',
            message,
          });
        },
        onLog: (status, message) => {
          emitLog({
            status,
            message,
            time: nowIso(),
            videoPath: item.videoPath,
            audioPath: item.audioPath,
          });
        },
      });

      results.push(result);
      if (result.status === 'success') {
        successCount += 1;
        emitLog({
          status: 'success',
          message: `Hoàn tất: ${path.basename(result.outputPath)}`,
          time: nowIso(),
          videoPath: result.videoPath,
          audioPath: result.audioPath,
          outputPath: result.outputPath,
        });
      } else {
        failedCount += 1;
        emitLog({
          status: 'error',
          message: result.error || 'Ghép audio thất bại.',
          time: nowIso(),
          videoPath: result.videoPath,
          audioPath: result.audioPath,
          outputPath: result.outputPath,
        });
      }
    }

    const stopped = this.stopRequested;
    this.stopRequested = false;

    if (stopped) {
      return {
        success: false,
        data: {
          total: items.length,
          successCount,
          failedCount,
          stopped: true,
          results,
        },
        error: 'Đã dừng theo yêu cầu.',
      };
    }

    emitProgress({
      total: items.length,
      current: items.length,
      percent: 100,
      stage: failedCount > 0 ? 'error' : 'completed',
      message:
        failedCount > 0
          ? `Hoàn tất có lỗi: ${successCount} thành công, ${failedCount} lỗi.`
          : `Hoàn tất ${successCount}/${items.length} item.`,
    });

    if (failedCount > 0) {
      return {
        success: false,
        data: {
          total: items.length,
          successCount,
          failedCount,
          stopped: false,
          results,
        },
        error: `Có ${failedCount} item lỗi.`,
      };
    }

    return {
      success: true,
      data: {
        total: items.length,
        successCount,
        failedCount,
        stopped: false,
        results,
      },
    };
  }
}

export const videoAudioReplaceBatchService = new VideoAudioReplaceBatchService();
