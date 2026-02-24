/**
 * Audio Merger - Ghép audio files sử dụng FFmpeg
 * Hỗ trợ phân tích và điều chỉnh timeline
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  AudioFile,
  AudioSegmentInfo,
  MergeAnalysis,
  MergeOptions,
  MergeResult,
} from '../../../shared/types/caption';
import { getAudioDuration } from './ttsService';

const BATCH_SIZE = 32; // Số file tối đa mỗi batch FFmpeg

/**
 * Phân tích audio files so với timeline SRT
 */
export async function analyzeAudioFiles(
  audioFiles: AudioFile[],
  srtDuration: number
): Promise<MergeAnalysis> {
  console.log(`[AudioMerger] Phân tích ${audioFiles.length} audio files`);
  
  const segments: AudioSegmentInfo[] = [];
  let maxOverflowRatio = 1.0;
  let overflowCount = 0;
  
  for (const file of audioFiles) {
    if (!file.success) continue;
    
    const actualDuration = await getAudioDuration(file.path);
    const overflow = actualDuration - file.durationMs;
    const overflowPercent = file.durationMs > 0 
      ? (overflow / file.durationMs) * 100 
      : 0;
    
    const segment: AudioSegmentInfo = {
      index: file.index,
      audioPath: file.path,
      srtStartMs: file.startMs,
      srtEndMs: file.startMs + file.durationMs,
      srtDurationMs: file.durationMs,
      actualDurationMs: actualDuration,
      overflowMs: overflow,
      overflowPercent,
    };
    
    segments.push(segment);
    
    if (overflow > 0) {
      overflowCount++;
      const ratio = actualDuration / file.durationMs;
      if (ratio > maxOverflowRatio) {
        maxOverflowRatio = ratio;
      }
    }
  }
  
  // Tính hệ số scale đề xuất
  const recommendedScale = maxOverflowRatio > 1.0 
    ? Math.min(maxOverflowRatio * 1.05, 1.4) // +5% buffer, max 1.4x
    : 1.0;
  
  const analysis: MergeAnalysis = {
    totalSegments: segments.length,
    overflowSegments: overflowCount,
    maxOverflowRatio,
    recommendedTimeScale: recommendedScale,
    originalDurationMs: srtDuration,
    adjustedDurationMs: Math.round(srtDuration * recommendedScale),
    segments,
  };
  
  console.log(`[AudioMerger] Phân tích xong: ${overflowCount} segments vượt thời gian`);
  console.log(`[AudioMerger] Scale đề xuất: ${recommendedScale.toFixed(2)}x`);
  
  return analysis;
}

/**
 * Ghép một batch nhỏ audio files
 */
async function mergeSmallBatch(
  files: Array<{ path: string; startMs: number }>,
  outputPath: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['-y'];
    const filterParts: string[] = [];
    
    // Input files
    files.forEach((file, idx) => {
      args.push('-i', file.path);
      filterParts.push(`[${idx}:a]adelay=${file.startMs}|${file.startMs}[a${idx}]`);
    });
    
    // Amix filter
    const mixInputs = files.map((_, idx) => `[a${idx}]`).join('');
    let filterComplex = filterParts.join(';') + 
      `;${mixInputs}amix=inputs=${files.length}:duration=longest:dropout_transition=0:normalize=0`;

    filterComplex += `[out]`;

    
    args.push('-filter_complex', filterComplex);
    args.push('-map', '[out]');
    
    // Codec
    if (outputPath.toLowerCase().endsWith('.wav')) {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '192k');
    }
    
    args.push(outputPath);
    
    const proc = spawn('ffmpeg', args, {
      windowsHide: true,
      shell: false,
    });
    
    let stderr = '';
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[AudioMerger] FFmpeg error: ${stderr}`);
      }
      resolve(code === 0);
    });
    
    proc.on('error', (err) => {
      console.error(`[AudioMerger] Spawn error: ${err}`);
      resolve(false);
    });
  });
}

/**
 * Ghép tất cả audio files theo timeline
 */
export async function mergeAudioFiles(
  audioFiles: AudioFile[],
  outputPath: string,
  timeScale: number = 1.0
): Promise<MergeResult> {
  
  // Tự động đẩy file ra ngoài thư mục 'audio' theo yêu cầu
  let finalOutputPath = outputPath;
  const parentDir = path.dirname(outputPath);
  if (path.basename(parentDir) === 'audio') {
    finalOutputPath = path.join(path.dirname(parentDir), path.basename(outputPath));
  }
  
  console.log(`[AudioMerger] Ghép ${audioFiles.length} files, scale: ${timeScale}x -> ${finalOutputPath}`);
  
  // Filter files thành công
  const validFiles = audioFiles.filter((f) => f.success);
  
  if (validFiles.length === 0) {
    return {
      success: false,
      outputPath: finalOutputPath,
      error: 'Không có file audio hợp lệ để ghép',
    };
  }
  
  // Tạo timeline với scale
  const timeline = validFiles.map((file) => ({
    path: file.path,
    startMs: Math.round(file.startMs * timeScale),
  }));
  
  // Sort theo start time
  timeline.sort((a, b) => a.startMs - b.startMs);
  
  // Đảm bảo thư mục output tồn tại
  await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });
  
  try {
    // Nếu chỉ có 1 file, copy trực tiếp
    if (timeline.length === 1) {
      await fs.copyFile(timeline[0].path, finalOutputPath);
      return { success: true, outputPath: finalOutputPath };
    }
    
    // Chia thành batches
    const tempFiles: string[] = [];
    const outputDir = path.dirname(finalOutputPath);
    const baseName = path.basename(finalOutputPath, path.extname(finalOutputPath));
    const ext = path.extname(finalOutputPath);
    
    for (let i = 0; i < timeline.length; i += BATCH_SIZE) {
      const batch = timeline.slice(i, i + BATCH_SIZE);
      const batchIdx = Math.floor(i / BATCH_SIZE);
      
      console.log(`[AudioMerger] Ghép batch ${batchIdx + 1}/${Math.ceil(timeline.length / BATCH_SIZE)}`);
      
      const tempPath = path.join(outputDir, `${baseName}_temp_${batchIdx}${ext}`);
      const success = await mergeSmallBatch(batch, tempPath);
      
      if (!success) {
        // Cleanup temp files
        for (const tf of tempFiles) {
          try { await fs.unlink(tf); } catch {}
        }
        return { success: false, outputPath: finalOutputPath, error: `Lỗi ghép batch ${batchIdx + 1}` };
      }
      
      tempFiles.push(tempPath);
    }
    
    // Nếu chỉ có 1 batch, rename
    if (tempFiles.length === 1) {
      await fs.rename(tempFiles[0], finalOutputPath);
      return { success: true, outputPath: finalOutputPath };
    }
    
    // Ghép các temp files lại
    console.log(`[AudioMerger] Ghép ${tempFiles.length} batch files...`);
    
    const finalTimeline = tempFiles.map((p, idx) => ({ path: p, startMs: 0 }));
    const success = await mergeSmallBatch(finalTimeline, finalOutputPath);
    
    // Cleanup temp files
    for (const tf of tempFiles) {
      try { await fs.unlink(tf); } catch {}
    }
    
    if (success) {
      console.log(`[AudioMerger] Ghép thành công: ${finalOutputPath}`);
      return { success: true, outputPath: finalOutputPath };
    } else {
      return { success: false, outputPath: finalOutputPath, error: 'Lỗi ghép final' };
    }
    
  } catch (error) {
    console.error(`[AudioMerger] Lỗi:`, error);
    return { success: false, outputPath: finalOutputPath, error: String(error) };
  }
}

/**
 * Ghép audio với phân tích và điều chỉnh tự động
 */
export async function smartMerge(options: MergeOptions): Promise<MergeResult> {
  const { audioDir, srtPath, outputPath, autoAdjust = true, customScale } = options;
  
  console.log(`[AudioMerger] Smart merge: ${audioDir} -> ${outputPath}`);
  
  // TODO: Implement full smart merge with SRT parsing
  // Hiện tại chỉ merge các file trong thư mục
  
  try {
    const files = await fs.readdir(audioDir);
    const audioFiles: AudioFile[] = [];
    
    for (const file of files) {
      if (file.endsWith('.wav') || file.endsWith('.mp3')) {
        const match = file.match(/^(\d+)_/);
        const index = match ? parseInt(match[1], 10) : 0;
        
        audioFiles.push({
          index,
          path: path.join(audioDir, file),
          startMs: index * 3000, // Placeholder, cần parse từ SRT
          durationMs: 3000,
          success: true,
        });
      }
    }
    
    const scale = customScale || (autoAdjust ? 1.0 : 1.0);
    return mergeAudioFiles(audioFiles, outputPath, scale);
    
  } catch (error) {
    return { success: false, outputPath, error: String(error) };
  }
}

/**
 * Cắt khoảng im lặng đầu file audio
 */
export async function trimSilence(inputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tempPath = inputPath.replace(/\.(wav|mp3)$/i, '_temp.$1');
    
    const args = [
      '-y',
      '-i', inputPath,
      '-af', 'silenceremove=start_periods=1:start_threshold=-50dB',
    ];
    
    if (inputPath.toLowerCase().endsWith('.wav')) {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '192k');
    }
    
    args.push(tempPath);
    
    const proc = spawn('ffmpeg', args, {
      windowsHide: true,
      shell: false, // Do NOT use shell: true, let spawn handle argument escaping natively
    });
    
    proc.on('close', async (code) => {
      if (code === 0) {
        try {
          await fs.unlink(inputPath);
          await fs.rename(tempPath, inputPath);
          resolve(true);
        } catch {
          resolve(false);
        }
      } else {
        try { await fs.unlink(tempPath); } catch {}
        resolve(false);
      }
    });
    
    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Cắt khoảng im lặng cuối file audio
 */
export async function trimSilenceEnd(inputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tempPath = inputPath.replace(/\.(wav|mp3)$/i, '_temp.$1');
    
    const args = [
      '-y',
      '-i', inputPath,
      // Dùng areverse để đảo ngược audio, cắt khoảng lặng bị coi là "đầu" (thực chất là cuối), rồi đảo ngược lại
      '-af', 'areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    ];
    
    if (inputPath.toLowerCase().endsWith('.wav')) {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '192k');
    }
    
    args.push(tempPath);
    
    const proc = spawn('ffmpeg', args, {
      windowsHide: true,
      shell: false, 
    });
    
    proc.on('close', async (code) => {
      if (code === 0) {
        try {
          await fs.unlink(inputPath);
          await fs.rename(tempPath, inputPath);
          resolve(true);
        } catch {
          resolve(false);
        }
      } else {
        try { await fs.unlink(tempPath); } catch {}
        resolve(false);
      }
    });
    
    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Kết quả fit audio
 */
export interface FitAudioResult {
  scaled: boolean;      // true nếu đã scale, false nếu giữ nguyên
  outputPath: string;   // Đường dẫn file output (scaled hoặc gốc)
}

/**
 * Tự động scale từng audio file để vừa với thời lượng cho phép.
 * Nếu audio thực tế dài hơn durationMs, sẽ tăng tốc bằng atempo filter.
 * File gốc KHÔNG bị thay đổi — bản scale được lưu vào thư mục audio_scaled/
 */
export async function fitAudioToDuration(
  audioPath: string,
  allowedDurationMs: number
): Promise<FitAudioResult> {
  const fileName = path.basename(audioPath);
  
  // Lấy thời lượng thực tế
  const actualDurationMs = await getAudioDuration(audioPath);

  if (actualDurationMs <= 0 || allowedDurationMs <= 0) {
    console.warn(
      `[AudioMerger] fitAudio ERROR: ${fileName} actualDuration=${actualDurationMs}ms, allowed=${allowedDurationMs}ms (bỏ qua)`
    );
    return { scaled: false, outputPath: audioPath };
  }

  // Nếu audio không bị tràn, không cần scale → dùng file gốc
  if (actualDurationMs <= allowedDurationMs) {
    console.log(
      `[AudioMerger] fitAudio SKIP: ${fileName} actual=${actualDurationMs}ms <= allowed=${allowedDurationMs}ms`
    );
    return { scaled: false, outputPath: audioPath };
  }

  const ratio = actualDurationMs / allowedDurationMs; // > 1.0
  console.log(
    `[AudioMerger] fitAudio SCALE: ${fileName} actual=${actualDurationMs}ms, allowed=${allowedDurationMs}ms, speed=${ratio.toFixed(2)}x`
  );

  // Xây dựng chuỗi atempo filters
  // FFmpeg giới hạn mỗi atempo trong khoảng [0.5, 2.0]
  // Nếu ratio > 2.0, cần chain nhiều atempo lại
  const atempoFilters: string[] = [];
  let remaining = ratio;
  while (remaining > 2.0) {
    atempoFilters.push('atempo=2.0');
    remaining /= 2.0;
  }
  atempoFilters.push(`atempo=${remaining.toFixed(4)}`);

  const filterChain = atempoFilters.join(',');

  // Lưu bản scale vào thư mục audio_scaled/ (cùng cấp với audio/)
  const audioDir = path.dirname(audioPath);
  const scaledDir = path.join(path.dirname(audioDir), 'audio_scaled');
  await fs.mkdir(scaledDir, { recursive: true });
  const scaledPath = path.join(scaledDir, fileName);

  return new Promise((resolve) => {
    const args = [
      '-y',
      '-i', audioPath,
      '-af', filterChain,
    ];

    if (audioPath.toLowerCase().endsWith('.wav')) {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '192k');
    }

    args.push(scaledPath);

    const proc = spawn('ffmpeg', args, {
      windowsHide: true,
      shell: false,
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        console.log(`[AudioMerger] fitAudio SAVED: ${scaledPath}`);
        resolve({ scaled: true, outputPath: scaledPath });
      } else {
        try { await fs.unlink(scaledPath); } catch {}
        resolve({ scaled: false, outputPath: audioPath });
      }
    });

    proc.on('error', () => {
      resolve({ scaled: false, outputPath: audioPath });
    });
  });
}
