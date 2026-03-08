import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getFFmpegPath } from '../../utils/ffmpegPath';

export interface AudioExtractionOptions {
  inputPath: string;
  outputFormat: 'mp3' | 'aac' | 'wav' | 'flac';
  keepStructure: boolean;
  overwrite: boolean;
  onProgress?: (percent: number) => void;
  onLog?: (log: string) => void;
}

export const audioExtractorService = {
  /**
   * Trích xuất audio từ file media sử dụng FFmpeg
   */
  async extractAudio(options: AudioExtractionOptions): Promise<{ success: boolean; outputPath: string; error?: string }> {
    const { inputPath, outputFormat, overwrite, onProgress, onLog } = options;

    try {
      const sourceDir = path.dirname(inputPath);
      const fileName = path.basename(inputPath, path.extname(inputPath));
      // Lưu trực tiếp vào thư mục gốc chứa file video
      const outputDir = sourceDir;

      const outputPath = path.join(outputDir, `${fileName}.${outputFormat}`);

      // Kiểm tra file đã tồn tại nếu không cho phép ghi đè
      if (!overwrite) {
        try {
          await fs.access(outputPath);
          return { success: false, outputPath, error: 'File đã tồn tại và không được phép ghi đè' };
        } catch {
          // File không tồn tại, có thể tiếp tục
        }
      }

      const ffmpegPath = getFFmpegPath();
      const args = ['-y', '-i', inputPath, '-vn']; // -y: ghi đè, -vn: bỏ qua video

      switch (outputFormat) {
        case 'mp3':
          args.push('-acodec', 'libmp3lame', '-q:a', '2');
          break;
        case 'wav':
          args.push('-acodec', 'pcm_s16le');
          break;
        case 'aac':
          args.push('-acodec', 'aac', '-b:a', '192k');
          break;
        case 'flac':
          args.push('-acodec', 'flac');
          break;
        default:
          args.push('-acodec', 'libmp3lame', '-q:a', '2');
          break;
      }

      args.push(outputPath);

      if (onLog) {
        onLog(`[FFmpeg] Executing: ${ffmpegPath} ${args.join(' ')}`);
      }

      return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args, {
          windowsHide: true,
          shell: false,
        });

        let stderr = '';

        // Phân tích tiến trình từ stderr của FFmpeg
        proc.stderr?.on('data', (data) => {
          const out = data.toString();
          stderr += out;
          if (onLog) {
            // Optional: You could pipe this out to the log UI but might be noisy.
          }
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, outputPath });
          } else {
            console.error(`[AudioExtractor] FFmpeg error: ${stderr}`);
            if (onLog) onLog(`[AudioExtractor] FFmpeg error: ${stderr}`);
            resolve({ success: false, outputPath, error: 'Lỗi trong quá trình xử lý FFmpeg' });
          }
        });

        proc.on('error', (err) => {
          console.error(`[AudioExtractor] Spawn error:`, err);
          if (onLog) onLog(`[AudioExtractor] Spawn error: ${err.message}`);
          resolve({ success: false, outputPath, error: `Không thể chạy FFmpeg: ${err.message}` });
        });
      });
    } catch (error: any) {
      console.error(`[AudioExtractor] General error:`, error);
      if (options.onLog) options.onLog(`[AudioExtractor] Lỗi: ${error.message}`);
      return { success: false, outputPath: '', error: error.message };
    }
  }
};
