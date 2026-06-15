/**
 * FFmpeg Path Utilities - Lấy đường dẫn FFmpeg cho cả dev và production
 */

import { app } from 'electron';
import path from 'path';
import { existsSync } from 'fs';

/**
 * Lấy đường dẫn tới ffmpeg.exe
 * - Dev mode: resources/ffmpeg/win64/ffmpeg.exe
 * - Production: resources/ffmpeg/ffmpeg.exe
 */
export function getFFmpegPath(): string {
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  } else {
    return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'win64', 'ffmpeg.exe');
  }
}

/**
 * Lấy đường dẫn tới ffprobe.exe
 */
export function getFFprobePath(): string {
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe');
  } else {
    return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'win64', 'ffprobe.exe');
  }
}

export function getNvencFFmpegPath(): string {
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg-nvenc', 'ffmpeg.exe');
  }
  return path.join(app.getAppPath(), 'resources', 'ffmpeg-nvenc', 'win64', 'ffmpeg.exe');
}

export function getNvencFFprobePath(): string {
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg-nvenc', 'ffprobe.exe');
  }
  return path.join(app.getAppPath(), 'resources', 'ffmpeg-nvenc', 'win64', 'ffprobe.exe');
}

export function getBestFFmpegPath(useNvencFFmpeg?: boolean): string {
  if (useNvencFFmpeg) {
    const nvencPath = getNvencFFmpegPath();
    if (existsSync(nvencPath)) return nvencPath;
  }
  return getFFmpegPath();
}

export function getBestFFprobePath(useNvencFFmpeg?: boolean): string {
  if (useNvencFFmpeg) {
    const nvencPath = getNvencFFprobePath();
    if (existsSync(nvencPath)) return nvencPath;
  }
  return getFFprobePath();
}

export function isFFmpegAvailable(): boolean {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = getFFprobePath();

  const ffmpegExists = existsSync(ffmpegPath);
  const ffprobeExists = existsSync(ffprobePath);

  if (!ffmpegExists) {
    console.warn(`[FFmpeg] Không tìm thấy ffmpeg tại: ${ffmpegPath}`);
  }
  if (!ffprobeExists) {
    console.warn(`[FFmpeg] Không tìm thấy ffprobe tại: ${ffprobePath}`);
  }

  return ffmpegExists && ffprobeExists;
}

export function getFFmpegInfo(): {
  ffmpegPath: string;
  ffprobePath: string;
  isPackaged: boolean;
  ffmpegExists: boolean;
  ffprobeExists: boolean;
} {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = getFFprobePath();

  return {
    ffmpegPath,
    ffprobePath,
    isPackaged: app.isPackaged,
    ffmpegExists: existsSync(ffmpegPath),
    ffprobeExists: existsSync(ffprobePath),
  };
}
