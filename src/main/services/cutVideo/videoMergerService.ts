import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getFFmpegPath, getFFprobePath } from '../../utils/ffmpegPath';

export type MergeAspectMode = '16_9' | '9_16';

export interface MergeVideoProfile {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec?: string;
}

export interface ScanRenderedItem {
  inputFolder: string;
  scanDir: string;
  status: 'ok' | 'missing' | 'invalid' | 'mismatch';
  message?: string;
  matchedFilePath?: string;
  fileName?: string;
  metadata?: MergeVideoProfile;
}

export interface ScanRenderedForMergeResult {
  success: boolean;
  data?: {
    canMerge: boolean;
    outputAspect: MergeAspectMode;
    items: ScanRenderedItem[];
    sortedVideoPaths: string[];
    blockingReason?: string;
  };
  error?: string;
}

export interface MergeRenderedVideosOptions {
  folders: string[];
  mode: MergeAspectMode;
  outputDir: string;
  outputFileName?: string;
  onProgress?: (data: {
    percent: number;
    stage: 'scan' | 'preflight' | 'concat' | 'completed' | 'stopped' | 'error';
    message: string;
    currentFile?: string;
  }) => void;
  onLog?: (data: {
    status: 'info' | 'success' | 'error' | 'processing';
    message: string;
    time: string;
  }) => void;
}

export interface MergeRenderedVideosResult {
  success: boolean;
  data?: {
    outputPath: string;
  };
  error?: string;
}

interface ProbeProfileResult {
  success: boolean;
  profile?: MergeVideoProfile;
  error?: string;
}

const SUPPORTED_EXT = '.mp4';
const NAME_PATTERN_WITH_THUMB = /^nauchaoheo_video_(16_9|9_16)_([a-z0-9_]+)_(\d{6})\.mp4$/i;
const NAME_PATTERN_LEGACY = /^nauchaoheo_video_(16_9|9_16)_(\d{6})\.mp4$/i;
const NATURAL_NAME_COLLATOR = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

function nowIso(): string {
  return new Date().toISOString();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDdMmHh(date: Date): string {
  return `${pad2(date.getDate())}${pad2(date.getMonth() + 1)}${pad2(date.getHours())}`;
}

function parseFps(raw: string | undefined): number {
  if (!raw) return 0;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return num / den;
    }
  }
  const val = Number(raw);
  return Number.isFinite(val) ? val : 0;
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

function compareProfiles(base: MergeVideoProfile, current: MergeVideoProfile): string | null {
  if (base.width !== current.width || base.height !== current.height) {
    return `Độ phân giải lệch (${current.width}x${current.height} != ${base.width}x${base.height})`;
  }
  if (Math.abs(base.fps - current.fps) > 0.05) {
    return `FPS lệch (${current.fps.toFixed(3)} != ${base.fps.toFixed(3)})`;
  }
  if (base.videoCodec !== current.videoCodec) {
    return `Codec video lệch (${current.videoCodec} != ${base.videoCodec})`;
  }
  if (base.hasAudio !== current.hasAudio) {
    return `Audio stream lệch (${current.hasAudio ? 'có' : 'không'} audio)`;
  }
  if (base.hasAudio && (base.audioCodec || '') !== (current.audioCodec || '')) {
    return `Codec audio lệch (${current.audioCodec || 'unknown'} != ${base.audioCodec || 'unknown'})`;
  }
  return null;
}

class VideoMergerService {
  private activeMergeProcess: ChildProcessWithoutNullStreams | null = null;
  private stopRequested = false;

  stop(): void {
    this.stopRequested = true;
    if (this.activeMergeProcess && !this.activeMergeProcess.killed) {
      try {
        this.activeMergeProcess.kill('SIGKILL');
      } catch {}
    }
  }

  private resolveScanDir(inputFolderPath: string): string {
    const normalized = inputFolderPath.replace(/[\\/]+$/, '');
    const baseName = path.basename(normalized).toLowerCase();
    if (baseName === 'caption_output') {
      return normalized;
    }
    return path.join(normalized, 'caption_output');
  }

  private fileMatchesMode(fileName: string, mode: MergeAspectMode): boolean {
    const withThumbMatch = fileName.match(NAME_PATTERN_WITH_THUMB);
    if (withThumbMatch && withThumbMatch[1] === mode) {
      return true;
    }
    const legacyMatch = fileName.match(NAME_PATTERN_LEGACY);
    return !!legacyMatch && legacyMatch[1] === mode;
  }

  private async probeVideoProfile(videoPath: string): Promise<ProbeProfileResult> {
    if (!fsSync.existsSync(videoPath)) {
      return { success: false, error: `File không tồn tại: ${videoPath}` };
    }
    const ffprobePath = getFFprobePath();
    if (!fsSync.existsSync(ffprobePath)) {
      return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
    }

    return new Promise((resolve) => {
      const args = ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', videoPath];
      const proc = spawn(ffprobePath, args);
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
          resolve({ success: false, error: stderr || `ffprobe exit code: ${code}` });
          return;
        }
        try {
          const info = JSON.parse(stdout) as {
            streams?: Array<{
              codec_type?: string;
              codec_name?: string;
              width?: number;
              height?: number;
              avg_frame_rate?: string;
              r_frame_rate?: string;
            }>;
            format?: { duration?: string };
          };
          const streams = info.streams || [];
          const videoStream = streams.find((s) => s.codec_type === 'video');
          const audioStream = streams.find((s) => s.codec_type === 'audio');

          if (!videoStream) {
            resolve({ success: false, error: 'Không tìm thấy video stream' });
            return;
          }

          const fpsRaw = videoStream.avg_frame_rate || videoStream.r_frame_rate || '0';
          const fps = parseFps(fpsRaw);
          const duration = Number(info.format?.duration || 0);

          const profile: MergeVideoProfile = {
            duration: Number.isFinite(duration) ? duration : 0,
            width: Number(videoStream.width || 0),
            height: Number(videoStream.height || 0),
            fps: Number.isFinite(fps) ? fps : 0,
            hasAudio: !!audioStream,
            videoCodec: String(videoStream.codec_name || 'unknown'),
            audioCodec: audioStream?.codec_name ? String(audioStream.codec_name) : undefined,
          };

          if (profile.width <= 0 || profile.height <= 0) {
            resolve({ success: false, error: 'Metadata width/height không hợp lệ' });
            return;
          }
          resolve({ success: true, profile });
        } catch (error) {
          resolve({ success: false, error: `Lỗi parse ffprobe json: ${String(error)}` });
        }
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: `Lỗi ffprobe: ${error.message}` });
      });
    });
  }

  async scanFoldersForRenderedVideos(options: {
    folders: string[];
    mode: MergeAspectMode;
  }): Promise<ScanRenderedForMergeResult> {
    const { folders, mode } = options;
    if (!Array.isArray(folders) || folders.length === 0) {
      return { success: false, error: 'Chưa có folder để quét' };
    }

    const items: ScanRenderedItem[] = [];

    for (const inputFolder of folders) {
      const scanDir = this.resolveScanDir(inputFolder);
      if (!fsSync.existsSync(scanDir)) {
        items.push({
          inputFolder,
          scanDir,
          status: 'missing',
          message: 'Không tìm thấy thư mục caption_output',
        });
        continue;
      }

      try {
        const dirEntries = await fs.readdir(scanDir);
        const candidates = dirEntries
          .filter((name) => path.extname(name).toLowerCase() === SUPPORTED_EXT)
          .filter((name) => this.fileMatchesMode(name, mode));

        if (candidates.length === 0) {
          items.push({
            inputFolder,
            scanDir,
            status: 'missing',
            message: `Không có file ${mode === '9_16' ? '9:16' : '16:9'} khớp pattern`,
          });
          continue;
        }

        const candidateStats = await Promise.all(
          candidates.map(async (name) => {
            const fullPath = path.join(scanDir, name);
            const stat = await fs.stat(fullPath);
            return { name, fullPath, mtimeMs: stat.mtimeMs };
          })
        );

        candidateStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const selected = candidateStats[0];

        const probe = await this.probeVideoProfile(selected.fullPath);
        if (!probe.success || !probe.profile) {
          items.push({
            inputFolder,
            scanDir,
            status: 'invalid',
            message: probe.error || 'Không đọc được metadata video',
            matchedFilePath: selected.fullPath,
            fileName: selected.name,
          });
          continue;
        }

        items.push({
          inputFolder,
          scanDir,
          status: 'ok',
          matchedFilePath: selected.fullPath,
          fileName: selected.name,
          metadata: probe.profile,
        });
      } catch (error) {
        items.push({
          inputFolder,
          scanDir,
          status: 'invalid',
          message: `Lỗi quét folder: ${String(error)}`,
        });
      }
    }

    const okItemsBeforeValidation = items.filter((item) => item.status === 'ok' && item.metadata);
    const baseline = okItemsBeforeValidation[0]?.metadata;
    if (baseline) {
      for (const item of okItemsBeforeValidation) {
        const reason = compareProfiles(baseline, item.metadata as MergeVideoProfile);
        if (reason) {
          item.status = 'mismatch';
          item.message = reason;
        }
      }
    }

    const okItems = items.filter((item) => item.status === 'ok' && item.matchedFilePath);
    okItems.sort((a, b) => {
      const aName = path.basename(a.matchedFilePath as string, path.extname(a.matchedFilePath as string));
      const bName = path.basename(b.matchedFilePath as string, path.extname(b.matchedFilePath as string));
      const nameCmp = NATURAL_NAME_COLLATOR.compare(aName, bName);
      if (nameCmp !== 0) return nameCmp;
      return NATURAL_NAME_COLLATOR.compare(a.matchedFilePath as string, b.matchedFilePath as string);
    });

    const sortedVideoPaths = okItems.map((item) => item.matchedFilePath as string);
    const allFoldersValid = items.length > 0 && items.every((item) => item.status === 'ok');
    const canMerge = allFoldersValid && sortedVideoPaths.length >= 2;

    let blockingReason: string | undefined;
    if (items.length < 2) {
      blockingReason = 'Cần ít nhất 2 folder để nối video nhiều tập.';
    } else if (!allFoldersValid) {
      const firstBad = items.find((item) => item.status !== 'ok');
      blockingReason = `Folder lỗi: ${path.basename(firstBad?.inputFolder || 'unknown')} - ${firstBad?.message || firstBad?.status}`;
    } else if (sortedVideoPaths.length < 2) {
      blockingReason = 'Cần ít nhất 2 video hợp lệ để nối.';
    }

    return {
      success: true,
      data: {
        canMerge,
        outputAspect: mode,
        items,
        sortedVideoPaths,
        blockingReason,
      },
    };
  }

  async mergeRenderedVideos(options: MergeRenderedVideosOptions): Promise<MergeRenderedVideosResult> {
    const { folders, mode, outputDir, onProgress, onLog } = options;
    if (this.activeMergeProcess) {
      return { success: false, error: 'Đang có tiến trình nối video khác chạy.' };
    }
    if (!outputDir?.trim()) {
      return { success: false, error: 'Thiếu outputDir để lưu file nối.' };
    }

    const emitLog = (status: 'info' | 'success' | 'error' | 'processing', message: string): void => {
      onLog?.({ status, message, time: nowIso() });
    };
    const emitProgress = (
      percent: number,
      stage: 'scan' | 'preflight' | 'concat' | 'completed' | 'stopped' | 'error',
      message: string,
      currentFile?: string
    ): void => {
      onProgress?.({ percent: Math.max(0, Math.min(100, Math.round(percent))), stage, message, currentFile });
    };

    emitProgress(2, 'scan', 'Đang quét video render theo mode...');
    emitLog('processing', `Bắt đầu quét ${folders.length} folder theo mode ${mode === '9_16' ? '9:16' : '16:9'}.`);
    const scanResult = await this.scanFoldersForRenderedVideos({ folders, mode });
    if (!scanResult.success || !scanResult.data) {
      emitProgress(0, 'error', scanResult.error || 'Quét video thất bại');
      emitLog('error', scanResult.error || 'Quét video thất bại');
      return { success: false, error: scanResult.error || 'Quét video thất bại' };
    }

    if (!scanResult.data.canMerge) {
      const reason = scanResult.data.blockingReason || 'Danh sách video chưa hợp lệ để nối.';
      emitProgress(0, 'error', reason);
      emitLog('error', reason);
      return { success: false, error: reason };
    }

    const sortedVideoPaths = scanResult.data.sortedVideoPaths;
    const items = scanResult.data.items;
    const totalDuration = items
      .filter((item) => item.status === 'ok')
      .reduce((sum, item) => sum + (item.metadata?.duration || 0), 0);

    emitProgress(20, 'preflight', `Đã quét xong ${sortedVideoPaths.length} video, đang chuẩn bị concat...`);
    emitLog('info', `Danh sách nối (natural sort): ${sortedVideoPaths.map((p) => path.basename(p)).join(' | ')}`);

    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      const message = `Không thể tạo thư mục output: ${String(error)}`;
      emitProgress(0, 'error', message);
      emitLog('error', message);
      return { success: false, error: message };
    }

    const ffmpegPath = getFFmpegPath();
    if (!fsSync.existsSync(ffmpegPath)) {
      const message = `FFmpeg không tìm thấy: ${ffmpegPath}`;
      emitProgress(0, 'error', message);
      emitLog('error', message);
      return { success: false, error: message };
    }

    const now = new Date();
    const defaultFileName = `nauchaoheo_series_${mode}_${formatDdMmHh(now)}.mp4`;
    const desiredName = options.outputFileName?.trim() || defaultFileName;
    const ext = path.extname(desiredName) || '.mp4';
    const baseWithoutExt = path.basename(desiredName, ext);

    let outputPath = path.join(outputDir, ext ? `${baseWithoutExt}${ext}` : `${baseWithoutExt}.mp4`);
    let suffix = 2;
    while (fsSync.existsSync(outputPath)) {
      outputPath = path.join(outputDir, `${baseWithoutExt}_v${suffix}${ext}`);
      suffix += 1;
    }

    const concatListPath = path.join(outputDir, `_merge_concat_list_${Date.now()}.txt`);
    const concatContent = sortedVideoPaths.map((p) => `file '${toConcatPath(p)}'`).join('\n');
    try {
      await fs.writeFile(concatListPath, `${concatContent}\n`, 'utf-8');
    } catch (error) {
      const message = `Không thể tạo concat list: ${String(error)}`;
      emitProgress(0, 'error', message);
      emitLog('error', message);
      return { success: false, error: message };
    }

    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-movflags', '+faststart', outputPath];
    this.stopRequested = false;
    emitProgress(35, 'concat', 'Đang nối video bằng concat copy...');
    emitLog('processing', `FFmpeg concat bắt đầu -> ${outputPath}`);

    return new Promise((resolve) => {
      let stderr = '';
      const proc = spawn(ffmpegPath, args, { windowsHide: true });
      this.activeMergeProcess = proc;

      proc.stderr.on('data', (data) => {
        const line = data.toString();
        stderr += line;
        if (stderr.length > 20000) {
          stderr = stderr.slice(-20000);
        }

        const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
        if (timeMatch && totalDuration > 0) {
          const currentSec = toSecondsFromFfmpegTime(timeMatch[1]);
          const ratio = Math.max(0, Math.min(1, currentSec / totalDuration));
          emitProgress(35 + ratio * 60, 'concat', 'Đang nối video...', path.basename(sortedVideoPaths[0] || ''));
        }
      });

      const finalize = async (result: MergeRenderedVideosResult): Promise<void> => {
        this.activeMergeProcess = null;
        this.stopRequested = false;
        try { await fs.unlink(concatListPath); } catch {}
        resolve(result);
      };

      proc.on('close', async (code) => {
        if (this.stopRequested) {
          emitProgress(0, 'stopped', 'Đã dừng nối video theo yêu cầu.');
          emitLog('info', 'Đã dừng nối video.');
          try {
            if (fsSync.existsSync(outputPath)) {
              await fs.unlink(outputPath);
            }
          } catch {}
          await finalize({ success: false, error: 'Đã dừng nối video.' });
          return;
        }

        if (code === 0 && fsSync.existsSync(outputPath)) {
          emitProgress(100, 'completed', 'Nối video thành công.');
          emitLog('success', `Nối video thành công: ${outputPath}`);
          await finalize({
            success: true,
            data: { outputPath },
          });
          return;
        }

        const errorMessage = `Nối video thất bại (exit ${code})\n${stderr.slice(-800)}`;
        emitProgress(0, 'error', 'Nối video thất bại.');
        emitLog('error', errorMessage);
        try {
          if (fsSync.existsSync(outputPath)) {
            await fs.unlink(outputPath);
          }
        } catch {}
        await finalize({
          success: false,
          error: errorMessage,
        });
      });

      proc.on('error', async (error) => {
        const message = `Không thể chạy FFmpeg concat: ${error.message}`;
        emitProgress(0, 'error', message);
        emitLog('error', message);
        await finalize({
          success: false,
          error: message,
        });
      });
    });
  }
}

export const videoMergerService = new VideoMergerService();
