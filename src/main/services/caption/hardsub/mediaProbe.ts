import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { ExtractFrameResult, VideoMetadata } from '../../../../shared/types/caption';
import { getFFmpegPath, getFFprobePath } from '../../../utils/ffmpegPath';
import { parseSrtFile } from '../srtParser';
import { MediaProbeResult } from './types';

const METADATA_CACHE_TTL_MS = 45_000;
const METADATA_CACHE_MAX_ENTRIES = 6;

type MetadataCacheEntry = {
  expiresAt: number;
  signature: string | null;
  result: MediaProbeResult;
};

const metadataCache = new Map<string, MetadataCacheEntry>();
const metadataInFlight = new Map<string, Promise<MediaProbeResult>>();

function cloneMetadataResult(result: MediaProbeResult): MediaProbeResult {
  if (!result.success || !result.metadata) {
    return result;
  }
  return {
    success: true,
    metadata: { ...result.metadata },
  };
}

function resolveFileSignature(videoPath: string): string | null {
  try {
    const stats = statSync(videoPath);
    return `${stats.size}:${Math.floor(stats.mtimeMs)}`;
  } catch {
    return null;
  }
}

function pruneMetadataCache(now = Date.now()): void {
  for (const [key, entry] of metadataCache.entries()) {
    if (entry.expiresAt <= now) {
      metadataCache.delete(key);
    }
  }
  while (metadataCache.size > METADATA_CACHE_MAX_ENTRIES) {
    const oldestKey = metadataCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    metadataCache.delete(oldestKey);
  }
}

function readMetadataCache(videoPath: string, signature: string | null): MediaProbeResult | null {
  pruneMetadataCache();
  const cached = metadataCache.get(videoPath);
  if (!cached) {
    return null;
  }
  if (cached.signature !== signature) {
    metadataCache.delete(videoPath);
    return null;
  }
  // refresh insertion order for simple LRU behavior
  metadataCache.delete(videoPath);
  metadataCache.set(videoPath, cached);
  return cloneMetadataResult(cached.result);
}

function writeMetadataCache(videoPath: string, signature: string | null, result: MediaProbeResult): void {
  if (!result.success || !result.metadata) {
    return;
  }
  const now = Date.now();
  pruneMetadataCache(now);
  metadataCache.set(videoPath, {
    expiresAt: now + METADATA_CACHE_TTL_MS,
    signature,
    result: cloneMetadataResult(result),
  });
  pruneMetadataCache(now);
}

export function clearVideoMetadataCache(videoPath?: string): void {
  if (videoPath) {
    metadataCache.delete(videoPath);
    for (const key of metadataInFlight.keys()) {
      if (key.startsWith(`${videoPath}::`)) {
        metadataInFlight.delete(key);
      }
    }
    return;
  }
  metadataCache.clear();
  metadataInFlight.clear();
}

export async function getVideoMetadata(videoPath: string): Promise<MediaProbeResult> {
  if (!existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }

  const ffprobePath = getFFprobePath();
  if (!existsSync(ffprobePath)) {
    return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
  }

  const signature = resolveFileSignature(videoPath);
  const cached = readMetadataCache(videoPath, signature);
  if (cached) {
    return cached;
  }

  const inFlightKey = `${videoPath}::${signature ?? 'na'}`;
  const existingTask = metadataInFlight.get(inFlightKey);
  if (existingTask) {
    return existingTask;
  }

  const task = new Promise<MediaProbeResult>((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ];

    const process = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `ffprobe exit code: ${code}` });
        return;
      }

      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
        const audioStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');

        if (!videoStream && !audioStream) {
          resolve({ success: false, error: 'Không tìm thấy video hay audio stream' });
          return;
        }

        const fpsStr = videoStream?.r_frame_rate || '30/1';
        const fpsParts = fpsStr.split('/');
        const fps = fpsParts.length === 2
          ? parseInt(fpsParts[0]) / parseInt(fpsParts[1])
          : 30;

        const metadata: VideoMetadata = {
          width: videoStream?.width || 1920,
          height: videoStream?.height || 1080,
          actualHeight: videoStream?.height || 1080,
          duration: parseFloat(info.format?.duration || '0'),
          frameCount: parseInt(videoStream?.nb_frames || '0') || Math.floor(parseFloat(info.format?.duration || '0') * fps),
          fps: Math.round(fps * 100) / 100,
          hasAudio: !!audioStream,
        };

        const successResult: MediaProbeResult = { success: true, metadata };
        writeMetadataCache(videoPath, signature, successResult);
        resolve(successResult);
      } catch (error) {
        resolve({ success: false, error: `Lỗi parse metadata: ${error}` });
      }
    });

    process.on('error', (error) => {
      resolve({ success: false, error: `Lỗi ffprobe: ${error.message}` });
    });
  });

  metadataInFlight.set(inFlightKey, task);
  return task.finally(() => {
    metadataInFlight.delete(inFlightKey);
  });
}

export async function extractVideoFrame(
  videoPath: string,
  frameNumber?: number
): Promise<ExtractFrameResult> {
  if (!existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }

  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }

  const metadataResult = await getVideoMetadata(videoPath);
  if (!metadataResult.success || !metadataResult.metadata) {
    return { success: false, error: metadataResult.error || 'Không lấy được metadata' };
  }

  const { duration, width, height, fps } = metadataResult.metadata;
  const seekTime = frameNumber !== undefined
    ? frameNumber / fps
    : duration * (0.1 + Math.random() * 0.8);

  return new Promise((resolve) => {
    const args = [
      '-ss', seekTime.toFixed(2),
      '-i', videoPath,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-',
    ];

    const process = spawn(ffmpegPath, args);
    const chunks: Buffer[] = [];

    process.stdout.on('data', (data) => {
      chunks.push(data);
    });

    process.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve({ success: false, error: 'Không thể extract frame' });
        return;
      }
      const frameBuffer = Buffer.concat(chunks);
      resolve({
        success: true,
        frameData: frameBuffer.toString('base64'),
        width,
        height,
      });
    });

    process.on('error', (error) => {
      resolve({ success: false, error: `Lỗi ffmpeg: ${error.message}` });
    });
  });
}

export async function readMediaDurationSec(mediaPath?: string): Promise<number | null> {
  if (!mediaPath || !existsSync(mediaPath)) {
    return null;
  }
  const meta = await getVideoMetadata(mediaPath);
  if (!meta.success || !meta.metadata) {
    return null;
  }
  return meta.metadata.duration > 0 ? meta.metadata.duration : null;
}

export async function readSrtDurationSec(srtPath?: string): Promise<number | null> {
  if (!srtPath || !existsSync(srtPath)) {
    return null;
  }
  try {
    const parsed = await parseSrtFile(srtPath);
    if (!parsed.success || !parsed.entries.length) {
      return null;
    }
    const lastEndMs = Math.max(...parsed.entries.map((entry) => entry.endMs || 0));
    return lastEndMs > 0 ? lastEndMs / 1000 : null;
  } catch {
    return null;
  }
}

