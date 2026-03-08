/**
 * FFmpeg Path Utilities - Lấy đường dẫn FFmpeg cho cả dev và production
 */

import { app } from 'electron';
import path from 'path';
import { existsSync } from 'fs';

/**
 * Lấy đường dẫn tới ffmpeg.exe
 * - Dev mode: resources/ffmpeg/win32/ffmpeg.exe
 * - Production: resources/ffmpeg/ffmpeg.exe
 */
export function getFFmpegPath(): string {
  const isPackaged = app.isPackaged;
  
  if (isPackaged) {
    // Khi đóng gói: process.resourcesPath/ffmpeg/ffmpeg.exe
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  } else {
    // Dev mode: app root/resources/ffmpeg/win32/ffmpeg.exe
    return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'win32', 'ffmpeg.exe');
  }
}

/**
 * Lấy đường dẫn tới ffprobe.exe
 * - Dev mode: resources/ffmpeg/win32/ffprobe.exe
 * - Production: resources/ffmpeg/ffprobe.exe
 */
export function getFFprobePath(): string {
  const isPackaged = app.isPackaged;
  
  if (isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe');
  } else {
    return path.join(app.getAppPath(), 'resources', 'ffmpeg', 'win32', 'ffprobe.exe');
  }
}

/**
 * Kiểm tra FFmpeg đã được cài đặt chưa
 */
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

/**
 * Lấy thông tin đường dẫn FFmpeg để debug
 */
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
