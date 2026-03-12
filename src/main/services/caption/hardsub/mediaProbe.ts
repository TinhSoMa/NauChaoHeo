import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { ExtractFrameResult, VideoMetadata } from '../../../../shared/types/caption';
import { getFFmpegPath, getFFprobePath } from '../../../utils/ffmpegPath';
import { parseSrtFile } from '../srtParser';
import { MediaProbeResult } from './types';

export async function getVideoMetadata(videoPath: string): Promise<MediaProbeResult> {
  if (!existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }

  const ffprobePath = getFFprobePath();
  if (!existsSync(ffprobePath)) {
    return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
  }

  return new Promise((resolve) => {
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

        resolve({ success: true, metadata });
      } catch (error) {
        resolve({ success: false, error: `Lỗi parse metadata: ${error}` });
      }
    });

    process.on('error', (error) => {
      resolve({ success: false, error: `Lỗi ffprobe: ${error.message}` });
    });
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

