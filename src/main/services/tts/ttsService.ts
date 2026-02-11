/**
 * TTS Service - Tạo audio từ text sử dụng Edge TTS
 * Spawn edge-tts CLI để tạo file audio
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  SubtitleEntry,
  TTSOptions,
  AudioFile,
  TTSResult,
  TTSProgress,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
} from '../../../shared/types/caption';

/**
 * Tạo tên file an toàn từ index và text
 */
export function getSafeFilename(index: number, text: string, ext: string = 'wav'): string {
  // Lấy 30 ký tự đầu, loại bỏ ký tự đặc biệt
  const safeText = text
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s-]/g, '')
    .replace(/\s+/g, '_')
    .trim();
  
  return `${index.toString().padStart(3, '0')}_${safeText || 'audio'}.${ext}`;
}

/**
 * Tạo một file audio từ text sử dụng edge-tts CLI
 */
export async function generateSingleAudio(
  text: string,
  outputPath: string,
  voice: string = DEFAULT_VOICE,
  rate: string = DEFAULT_RATE,
  volume: string = DEFAULT_VOLUME
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      '--voice', voice,
      '--rate', rate,
      '--volume', volume,
      '--text', `"${text.replace(/"/g, '\\"')}"`, // Quote text and escape internal quotes
      '--write-media', outputPath,
    ];
    
    console.log(`[TTS] Tạo audio: ${path.basename(outputPath)}`);
    
    // Spawn edge-tts process
    const proc = spawn('edge-tts', args, {
      windowsHide: true,
      shell: true,
    });
    
    let stderr = '';
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', async (code) => {
      if (code === 0) {
        // Kiểm tra file được tạo và có size > 0
        try {
          const stats = await fs.stat(outputPath);
          if (stats.size > 0) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: 'File created but empty' });
          }
        } catch {
          resolve({ success: false, error: 'File not created' });
        }
      } else {
        resolve({ success: false, error: stderr || `Exit code: ${code}` });
      }
    });
    
    proc.on('error', (err) => {
      resolve({ success: false, error: `Spawn error: ${err.message}` });
    });
    
    // Timeout sau 30 giây
    setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 30000);
  });
}

/**
 * Tạo audio cho nhiều entries với concurrency control
 */
export async function generateBatchAudio(
  entries: SubtitleEntry[],
  options: Partial<TTSOptions>,
  progressCallback?: (progress: TTSProgress) => void
): Promise<TTSResult> {
  const {
    voice = DEFAULT_VOICE,
    rate = DEFAULT_RATE,
    volume = DEFAULT_VOLUME,
    outputFormat = 'wav',
    outputDir,
    maxConcurrent = 5,
  } = options;
  
  if (!outputDir) {
    return {
      success: false,
      audioFiles: [],
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir: '',
      errors: ['outputDir is required'],
    };
  }
  
  console.log(`[TTS] Bắt đầu tạo ${entries.length} audio files`);
  console.log(`[TTS] Voice: ${voice}, Rate: ${rate}, Format: ${outputFormat}`);
  
  // Tạo thư mục output
  await fs.mkdir(outputDir, { recursive: true });
  
  const audioFiles: AudioFile[] = [];
  const errors: string[] = [];
  let completed = 0;
  
  // Xử lý theo batch để kiểm soát concurrency
  for (let i = 0; i < entries.length; i += maxConcurrent) {
    const batch = entries.slice(i, i + maxConcurrent);
    
    const batchPromises = batch.map(async (entry, batchIdx) => {
      const globalIdx = i + batchIdx;
      const text = entry.translatedText || entry.text;
      const filename = getSafeFilename(entry.index, text, outputFormat);
      const outputPath = path.join(outputDir, filename);
      
      // Kiểm tra file đã tồn tại và có size > 0
      try {
        const stats = await fs.stat(outputPath);
        if (stats.size > 0) {
          console.log(`[TTS] Skip (existed): ${filename}`);
          return {
            index: entry.index,
            path: outputPath,
            startMs: entry.startMs,
            durationMs: entry.durationMs,
            success: true,
          } as AudioFile;
        }
      } catch {
        // File không tồn tại, tiếp tục tạo
      }
      
      let result = await generateSingleAudio(text, outputPath, voice, rate, volume);

      // Auto-retry on failure
      let retryCount = 0;
      const MAX_RETRIES = 3;

      while (!result.success && retryCount < MAX_RETRIES) {
        retryCount++;
        console.log(`[TTS] Lỗi ${filename}, thử lại lần ${retryCount}/${MAX_RETRIES}...`);
        
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        result = await generateSingleAudio(text, outputPath, voice, rate, volume);
      }
      
      completed++;
      
      if (progressCallback) {
        progressCallback({
          current: completed,
          total: entries.length,
          status: 'generating',
          currentFile: filename,
          message: result.success ? `Đã tạo: ${filename}` : `Lỗi: ${filename}`,
        });
      }
      
      if (result.success) {
        return {
          index: entry.index,
          path: outputPath,
          startMs: entry.startMs,
          durationMs: entry.durationMs,
          success: true,
        } as AudioFile;
      } else {
        console.error(`[TTS] Lỗi ${filename}: ${result.error}`);
        errors.push(`${filename}: ${result.error}`);
        return {
          index: entry.index,
          path: outputPath,
          startMs: entry.startMs,
          durationMs: entry.durationMs,
          success: false,
          error: result.error,
        } as AudioFile;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    audioFiles.push(...batchResults);
    
    // Delay giữa các batch để tránh overload
    if (i + maxConcurrent < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  
  // Sort theo start time
  audioFiles.sort((a, b) => a.startMs - b.startMs);
  
  const totalGenerated = audioFiles.filter((f) => f.success).length;
  const totalFailed = audioFiles.filter((f) => !f.success).length;
  
  console.log(`[TTS] Hoàn thành: ${totalGenerated} thành công, ${totalFailed} lỗi`);
  
  if (progressCallback) {
    progressCallback({
      current: entries.length,
      total: entries.length,
      status: 'completed',
      currentFile: '',
      message: `Hoàn thành: ${totalGenerated}/${entries.length} files`,
    });
  }
  
  return {
    success: totalFailed === 0,
    audioFiles,
    totalGenerated,
    totalFailed,
    outputDir,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Lấy thời lượng thực tế của file audio (milliseconds)
 * Sử dụng ffprobe
 */
export async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], {
      windowsHide: true,
      shell: true,
    });
    
    let stdout = '';
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.on('close', () => {
      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration)) {
        resolve(Math.round(duration * 1000));
      } else {
        resolve(0);
      }
    });
    
    proc.on('error', () => {
      resolve(0);
    });
  });
}
