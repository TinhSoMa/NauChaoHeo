import * as fs from 'fs';
import * as path from 'path';
import { getVideoMetadata } from '../caption/videoRenderer';

export interface ScanFolderResult {
  success: boolean;
  data?: {
    folderPath: string;
    mediaFiles: string[];
    count: number;
  };
  error?: string;
}

// Allowed media extensions
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov',
  '.mp3', '.wav', '.flac', '.aac'
]);

export const cutVideoService = {
  /**
   * Scan a folder and return media file count and paths
   * @param folderPath Path to the directory to scan
   */
  async scanFolderForMedia(folderPath: string): Promise<ScanFolderResult> {
    try {
      if (!fs.existsSync(folderPath)) {
        return { success: false, error: 'Thư mục không tồn tại' };
      }

      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Đường dẫn không phải là thư mục' };
      }

      // Sử dụng readdirSync mà không đệ quy (chỉ quét mức root level)
      const files = fs.readdirSync(folderPath);
      const mediaFiles: string[] = [];

      for (const file of files) {
        const fullPath = path.join(folderPath, file);
        try {
          const fileStats = fs.statSync(fullPath);
          if (fileStats.isFile()) {
            const ext = path.extname(file).toLowerCase();
            if (MEDIA_EXTENSIONS.has(ext)) {
              mediaFiles.push(fullPath);
            }
          }
        } catch (err) {
          console.warn(`Could not stat file: ${fullPath}`, err);
        }
      }

      return {
        success: true,
        data: {
          folderPath,
          mediaFiles,
          count: mediaFiles.length
        }
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Lấy thông tin metadata của một file video (ví dụ: duration, fps, size).
   */
  async getVideoInfo(filePath: string): Promise<{
    success: boolean;
    data?: {
      duration: number;
      fps: number;
      width: number;
      height: number;
      sizeBytes: number;
    };
    error?: string;
  }> {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File không tồn tại' };
      }

      const stats = fs.statSync(filePath);
      
      const metadataResult = await getVideoMetadata(filePath);
      if (!metadataResult.success || !metadataResult.metadata) {
        return { success: false, error: metadataResult.error || 'Lỗi lấy metadata video' };
      }

      return {
        success: true,
        data: {
          duration: metadataResult.metadata.duration,
          fps: metadataResult.metadata.fps,
          width: metadataResult.metadata.width,
          height: metadataResult.metadata.height,
          sizeBytes: stats.size,
        }
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};
