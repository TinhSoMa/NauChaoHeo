import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getFFmpegPath, getFFprobePath } from '../../utils/ffmpegPath';

export interface AudioMixMediaInfo {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
}

export interface VideoAudioMixOptions {
  videoPath: string;
  audioPaths: string[];
  videoVolumePercent: number;
  musicVolumePercent: number;
  outputPath?: string;
  onProgress?: (data: {
    percent: number;
    stage: 'preflight' | 'building_playlist' | 'mixing' | 'completed' | 'stopped' | 'error';
    message: string;
    currentFile?: string;
  }) => void;
  onLog?: (data: {
    status: 'info' | 'success' | 'error' | 'processing';
    message: string;
    time: string;
  }) => void;
}

export interface VideoAudioMixResult {
  success: boolean;
  data?: { outputPath: string };
  error?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function toConcatPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''");
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

class VideoAudioMixerService {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private stopRequested = false;

  stop(): void {
    this.stopRequested = true;
    if (this.activeProcess && !this.activeProcess.killed) {
      try {
        this.activeProcess.kill('SIGKILL');
      } catch {}
    }
  }

  async getMediaInfo(filePath: string): Promise<{ success: boolean; data?: AudioMixMediaInfo; error?: string }> {
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
            streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
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
              width: videoStream?.width,
              height: videoStream?.height,
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
    let outputPath = path.join(sourceDir, `${sourceBase}_musicmix${sourceExt}`);
    let suffix = 2;
    while (fsSync.existsSync(outputPath)) {
      outputPath = path.join(sourceDir, `${sourceBase}_musicmix_v${suffix}${sourceExt}`);
      suffix += 1;
    }
    return outputPath;
  }

  private async buildLoopedAudioConcatList(input: {
    audioPaths: string[];
    durationByPath: Map<string, number>;
    videoDurationSec: number;
    workDir: string;
  }): Promise<{ success: boolean; concatListPath?: string; loopedCount?: number; error?: string }> {
    const safeVideoDuration = Math.max(0, input.videoDurationSec);
    if (safeVideoDuration <= 0) {
      return { success: false, error: 'Duration video không hợp lệ.' };
    }

    const totalPlaylistDuration = input.audioPaths.reduce((sum, p) => sum + (input.durationByPath.get(p) || 0), 0);
    if (!Number.isFinite(totalPlaylistDuration) || totalPlaylistDuration <= 0) {
      return { success: false, error: 'Tổng duration playlist không hợp lệ.' };
    }

    const loopedAudioPaths: string[] = [];
    let accumulated = 0;
    let guard = 0;
    while (accumulated < safeVideoDuration) {
      for (const audioPath of input.audioPaths) {
        const duration = input.durationByPath.get(audioPath) || 0;
        if (duration <= 0) {
          continue;
        }
        loopedAudioPaths.push(audioPath);
        accumulated += duration;
        if (accumulated >= safeVideoDuration) {
          break;
        }
      }
      guard += 1;
      if (guard > 100000) {
        return { success: false, error: 'Không thể xây playlist lặp (guard overflow).' };
      }
    }

    const concatListPath = path.join(input.workDir, `_audio_mix_concat_${Date.now()}.txt`);
    const concatBody = loopedAudioPaths.map((p) => `file '${toConcatPath(p)}'`).join('\n');
    await fs.writeFile(concatListPath, `${concatBody}\n`, 'utf-8');
    return { success: true, concatListPath, loopedCount: loopedAudioPaths.length };
  }

  async mixVideoWithPlaylist(options: VideoAudioMixOptions): Promise<VideoAudioMixResult> {
    if (this.activeProcess) {
      return { success: false, error: 'Đang có một tiến trình ghép nhạc khác chạy.' };
    }

    const emitProgress = (
      percent: number,
      stage: 'preflight' | 'building_playlist' | 'mixing' | 'completed' | 'stopped' | 'error',
      message: string,
      currentFile?: string
    ): void => {
      options.onProgress?.({
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        stage,
        message,
        currentFile,
      });
    };
    const emitLog = (
      status: 'info' | 'success' | 'error' | 'processing',
      message: string
    ): void => {
      options.onLog?.({
        status,
        message,
        time: nowIso(),
      });
    };

    const ffmpegPath = getFFmpegPath();
    if (!fsSync.existsSync(ffmpegPath)) {
      return { success: false, error: `FFmpeg không tìm thấy: ${ffmpegPath}` };
    }

    const ffprobePath = getFFprobePath();
    if (!fsSync.existsSync(ffprobePath)) {
      return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
    }

    const videoPath = options.videoPath;
    const audioPaths = options.audioPaths || [];
    if (!videoPath || !fsSync.existsSync(videoPath)) {
      return { success: false, error: 'Video không tồn tại.' };
    }
    if (!Array.isArray(audioPaths) || audioPaths.length === 0) {
      return { success: false, error: 'Chưa có file audio để ghép.' };
    }

    emitProgress(5, 'preflight', 'Đang kiểm tra metadata video/audio...');
    emitLog('processing', `Preflight: video=${videoPath}, audioCount=${audioPaths.length}`);

    const videoInfo = await this.getMediaInfo(videoPath);
    if (!videoInfo.success || !videoInfo.data) {
      return { success: false, error: videoInfo.error || 'Không đọc được metadata video.' };
    }
    if (!videoInfo.data.hasVideo) {
      return { success: false, error: 'Input video không có video stream.' };
    }

    const durationByPath = new Map<string, number>();
    for (const audioPath of audioPaths) {
      if (!audioPath || !fsSync.existsSync(audioPath)) {
        return { success: false, error: `Audio không tồn tại: ${audioPath}` };
      }
      const audioInfo = await this.getMediaInfo(audioPath);
      if (!audioInfo.success || !audioInfo.data) {
        return { success: false, error: `Không đọc được metadata audio: ${path.basename(audioPath)} - ${audioInfo.error || ''}` };
      }
      if (!audioInfo.data.hasAudio) {
        return { success: false, error: `File không có audio stream: ${path.basename(audioPath)}` };
      }
      if (audioInfo.data.duration <= 0) {
        return { success: false, error: `Duration audio không hợp lệ: ${path.basename(audioPath)}` };
      }
      durationByPath.set(audioPath, audioInfo.data.duration);
    }

    emitProgress(20, 'building_playlist', 'Đang xây playlist lặp theo độ dài video...');
    const workDir = path.dirname(videoPath);
    const concatListResult = await this.buildLoopedAudioConcatList({
      audioPaths,
      durationByPath,
      videoDurationSec: videoInfo.data.duration,
      workDir,
    });
    if (!concatListResult.success || !concatListResult.concatListPath) {
      return { success: false, error: concatListResult.error || 'Không thể tạo concat list audio.' };
    }

    const concatListPath = concatListResult.concatListPath;
    const outputPath = this.resolveUniqueOutputPath(videoPath, options.outputPath);
    const videoVolume = clamp(options.videoVolumePercent, 0, 200) / 100;
    const musicVolume = clamp(options.musicVolumePercent, 0, 200) / 100;
    const videoDurationSec = videoInfo.data.duration;
    const videoDurationStr = videoDurationSec.toFixed(3);

    const musicChain = `[1:a]aresample=48000,volume=${musicVolume.toFixed(3)},atrim=0:${videoDurationStr},asetpts=N/SR/TB[a_music]`;
    const filterComplex = videoInfo.data.hasAudio
      ? `[0:a]volume=${videoVolume.toFixed(3)},aresample=48000[a_video];${musicChain};[a_video][a_music]amix=inputs=2:duration=first:dropout_transition=0[a_out]`
      : `${musicChain};[a_music]anull[a_out]`;

    const args = [
      '-y',
      '-i', videoPath,
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-filter_complex', filterComplex,
      '-map', '0:v:0',
      '-map', '[a_out]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
    ];

    const outExt = path.extname(outputPath).toLowerCase();
    if (outExt === '.mp4' || outExt === '.mov') {
      args.push('-movflags', '+faststart');
    }
    args.push(outputPath);

    emitProgress(35, 'mixing', 'Đang ghép playlist nhạc vào video...');
    emitLog('processing', `FFmpeg bắt đầu: ${path.basename(outputPath)} | loopedAudio=${concatListResult.loopedCount || 0}`);

    this.stopRequested = false;
    return new Promise((resolve) => {
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
        if (timeMatch && videoDurationSec > 0) {
          const sec = toSecondsFromFfmpegTime(timeMatch[1]);
          const ratio = Math.max(0, Math.min(1, sec / videoDurationSec));
          emitProgress(35 + ratio * 60, 'mixing', 'Đang xử lý audio mix...', path.basename(videoPath));
        }
      });

      const finalize = async (result: VideoAudioMixResult): Promise<void> => {
        this.activeProcess = null;
        this.stopRequested = false;
        try {
          await fs.unlink(concatListPath);
        } catch {}
        resolve(result);
      };

      proc.on('close', async (code) => {
        if (this.stopRequested) {
          emitProgress(0, 'stopped', 'Đã dừng ghép nhạc theo yêu cầu.');
          emitLog('info', 'Đã dừng tiến trình ghép nhạc.');
          try {
            if (fsSync.existsSync(outputPath)) {
              await fs.unlink(outputPath);
            }
          } catch {}
          await finalize({ success: false, error: 'Đã dừng ghép nhạc.' });
          return;
        }

        if (code === 0 && fsSync.existsSync(outputPath)) {
          emitProgress(100, 'completed', 'Ghép nhạc thành công.');
          emitLog('success', `Output: ${outputPath}`);
          await finalize({ success: true, data: { outputPath } });
          return;
        }

        const errorMessage = `Ghép nhạc thất bại (exit ${code})\n${stderr.slice(-1200)}`;
        emitProgress(0, 'error', 'Ghép nhạc thất bại.');
        emitLog('error', errorMessage);
        try {
          if (fsSync.existsSync(outputPath)) {
            await fs.unlink(outputPath);
          }
        } catch {}
        await finalize({ success: false, error: errorMessage });
      });

      proc.on('error', async (error) => {
        const msg = `Không thể chạy FFmpeg: ${error.message}`;
        emitProgress(0, 'error', msg);
        emitLog('error', msg);
        try {
          if (fsSync.existsSync(outputPath)) {
            await fs.unlink(outputPath);
          }
        } catch {}
        await finalize({ success: false, error: msg });
      });
    });
  }
}

export const videoAudioMixerService = new VideoAudioMixerService();
