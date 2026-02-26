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
const DEBUG_AUDIO_MERGER = process.env.AUDIO_MERGER_DEBUG === '1';

function debugLog(message: string, details?: Record<string, unknown>): void {
  if (!DEBUG_AUDIO_MERGER) return;

  if (details) {
    console.log(`[AudioMerger][DEBUG] ${message}`, details);
    return;
  }

  console.log(`[AudioMerger][DEBUG] ${message}`);
}

function compactError(message: string, maxLength: number = 500): string {
  const trimmed = message.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

interface BatchMergeResult {
  success: boolean;
  error?: string;
}

interface PadTailResult {
  success: boolean;
  padded: boolean;
  missingMs: number;
  error?: string;
}

/**
 * Nếu output ngắn hơn mốc kết thúc subtitle cuối, tự động pad thêm silence ở đuôi.
 * Chỉ áp dụng cho phần cuối cùng (subtitle cuối).
 */
async function padTailToTargetDuration(
  outputPath: string,
  targetDurationMs: number
): Promise<PadTailResult> {
  if (targetDurationMs <= 0) {
    return { success: true, padded: false, missingMs: 0 };
  }

  const actualDurationMs = await getAudioDuration(outputPath);
  if (actualDurationMs <= 0) {
    return {
      success: false,
      padded: false,
      missingMs: 0,
      error: `Không đọc được thời lượng output: ${outputPath}`,
    };
  }

  const missingMs = targetDurationMs - actualDurationMs;
  // Dung sai nhỏ để tránh pad do sai số ffprobe/codec.
  if (missingMs <= 20) {
    debugLog('Không cần pad tail', {
      outputPath,
      actualDurationMs,
      targetDurationMs,
      missingMs,
    });
    return { success: true, padded: false, missingMs: 0 };
  }

  const ext = path.extname(outputPath);
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, ext);
  const tempPath = path.join(dir, `${base}_tailpad${ext}`);
  const targetDurationSec = (targetDurationMs / 1000).toFixed(3);
  const missingSec = (missingMs / 1000).toFixed(3);

  debugLog('Pad tail silence cho subtitle cuối', {
    outputPath,
    tempPath,
    actualDurationMs,
    targetDurationMs,
    missingMs,
  });

  return new Promise((resolve) => {
    const args = [
      '-y',
      '-i', outputPath,
      '-af', `apad=pad_dur=${missingSec}`,
      '-t', targetDurationSec,
    ];

    if (outputPath.toLowerCase().endsWith('.wav')) {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '192k');
    }

    args.push(tempPath);

    const proc = spawn('ffmpeg', args, {
      windowsHide: true,
      shell: false,
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        try { await fs.unlink(tempPath); } catch {}
        resolve({
          success: false,
          padded: false,
          missingMs,
          error: compactError(stderr || `Pad tail ffmpeg exit code: ${code}`),
        });
        return;
      }

      try {
        await fs.unlink(outputPath);
        await fs.rename(tempPath, outputPath);
        resolve({ success: true, padded: true, missingMs });
      } catch (e) {
        try { await fs.unlink(tempPath); } catch {}
        resolve({
          success: false,
          padded: false,
          missingMs,
          error: `Lỗi thay thế file sau pad tail: ${String(e)}`,
        });
      }
    });

    proc.on('error', async (err) => {
      try { await fs.unlink(tempPath); } catch {}
      resolve({
        success: false,
        padded: false,
        missingMs,
        error: `Pad tail spawn error: ${String(err)}`,
      });
    });
  });
}

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
): Promise<BatchMergeResult> {
  return new Promise((resolve) => {
    if (files.length === 0) {
      console.warn(`[AudioMerger] mergeSmallBatch nhận batch rỗng: ${outputPath}`);
      resolve({ success: false, error: 'Batch rỗng' });
      return;
    }

    const lastFile = files[files.length - 1];
    debugLog('Bắt đầu mergeSmallBatch', {
      outputPath,
      files: files.length,
      firstStartMs: files[0].startMs,
      lastStartMs: lastFile.startMs,
    });

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

    debugLog('FFmpeg command prepared', {
      outputPath,
      argsPreview: args.join(' '),
    });
    
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
        const errorMessage = compactError(stderr || `FFmpeg exit code: ${code}`);
        debugLog('mergeSmallBatch thất bại', {
          outputPath,
          exitCode: code,
          stderrTail: stderr.split('\n').slice(-20).join('\n'),
        });
        resolve({ success: false, error: errorMessage });
      } else {
        debugLog('mergeSmallBatch thành công', { outputPath });
        resolve({ success: true });
      }
    });
    
    proc.on('error', (err) => {
      console.error(`[AudioMerger] Spawn error: ${err}`);
      const errorMessage = `Spawn error: ${String(err)}`;
      debugLog('mergeSmallBatch spawn error', {
        outputPath,
        error: String(err),
      });
      resolve({ success: false, error: errorMessage });
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
  const candidateFiles = audioFiles.filter((f) => {
    if (!f || typeof f.path !== 'string' || !f.path.trim()) return false;
    if (typeof f.startMs !== 'number' || Number.isNaN(f.startMs)) return false;
    return f.success !== false;
  });

  const validFiles: AudioFile[] = [];
  const missingPathFiles: string[] = [];
  for (let i = 0; i < candidateFiles.length; i++) {
    const file = candidateFiles[i];
    try {
      await fs.access(file.path);
      validFiles.push({
        index: typeof file.index === 'number' ? file.index : i + 1,
        path: file.path,
        startMs: file.startMs,
        durationMs: typeof file.durationMs === 'number' ? file.durationMs : 0,
        success: true,
        error: file.error,
      });
    } catch {
      missingPathFiles.push(file.path);
    }
  }

  debugLog('Input mergeAudioFiles', {
    totalFiles: audioFiles.length,
    candidateFiles: candidateFiles.length,
    validFiles: validFiles.length,
    invalidFiles: audioFiles.length - validFiles.length,
    missingPaths: missingPathFiles.length,
    outputPath,
    finalOutputPath,
    timeScale,
  });
  
  if (validFiles.length === 0) {
    const missingHint = missingPathFiles.length > 0
      ? ` (thiếu ${missingPathFiles.length} file audio trên đĩa)`
      : '';
    return {
      success: false,
      outputPath: finalOutputPath,
      error: `Không có file audio hợp lệ để ghép${missingHint}`,
    };
  }

  // Mốc kết thúc subtitle cuối (chỉ 1 subtitle cuối cùng).
  const lastSubtitleFile = validFiles.reduce((last, current) => {
    if (!last) return current;
    if (current.startMs > last.startMs) return current;
    if (current.startMs === last.startMs && current.durationMs > last.durationMs) return current;
    return last;
  }, validFiles[0]);
  const lastSubtitleEndMs = Math.max(
    0,
    Math.round((lastSubtitleFile.startMs + Math.max(lastSubtitleFile.durationMs, 0)) * timeScale)
  );
  debugLog('Mốc subtitle cuối', {
    index: lastSubtitleFile.index,
    startMs: lastSubtitleFile.startMs,
    durationMs: lastSubtitleFile.durationMs,
    lastSubtitleEndMs,
    timeScale,
  });
  
  // Tạo timeline với scale
  const timeline = validFiles.map((file) => ({
    path: file.path,
    startMs: Math.round(file.startMs * timeScale),
  }));
  
  // Sort theo start time
  timeline.sort((a, b) => a.startMs - b.startMs);
  const lastTimelineItem = timeline[timeline.length - 1];
  debugLog('Timeline sau khi sort', {
    items: timeline.length,
    firstStartMs: timeline[0]?.startMs ?? 0,
    lastStartMs: lastTimelineItem?.startMs ?? 0,
    firstFile: timeline[0] ? path.basename(timeline[0].path) : '',
    lastFile: lastTimelineItem ? path.basename(lastTimelineItem.path) : '',
  });
  
  // Đảm bảo thư mục output tồn tại
  await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });
  
  try {
    // Nếu chỉ có 1 file, copy trực tiếp
    if (timeline.length === 1) {
      debugLog('Chỉ có 1 file trong timeline, copy trực tiếp', {
        source: timeline[0].path,
        destination: finalOutputPath,
      });
      await fs.copyFile(timeline[0].path, finalOutputPath);
      const padResult = await padTailToTargetDuration(finalOutputPath, lastSubtitleEndMs);
      if (!padResult.success) {
        return {
          success: false,
          outputPath: finalOutputPath,
          error: `Lỗi pad tail subtitle cuối: ${padResult.error ?? 'unknown error'}`,
        };
      }
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
      const totalBatches = Math.ceil(timeline.length / BATCH_SIZE);
      const batchLastItem = batch[batch.length - 1];
      
      console.log(`[AudioMerger] Ghép batch ${batchIdx + 1}/${totalBatches}`);
      
      const tempPath = path.join(outputDir, `${baseName}_temp_${batchIdx}${ext}`);
      debugLog('Thông tin batch', {
        batchNumber: batchIdx + 1,
        totalBatches,
        segmentCount: batch.length,
        batchStartMs: batch[0].startMs,
        batchEndMs: batchLastItem.startMs,
        tempPath,
      });
      const batchResult = await mergeSmallBatch(batch, tempPath);
      
      if (!batchResult.success) {
        debugLog('Batch merge thất bại, bắt đầu cleanup temp files', {
          failedBatch: batchIdx + 1,
          tempFilesCount: tempFiles.length,
          error: batchResult.error ?? 'unknown',
        });
        // Cleanup temp files
        for (const tf of tempFiles) {
          try {
            await fs.unlink(tf);
            debugLog('Đã xóa temp file sau lỗi batch', { tempFile: tf });
          } catch (cleanupError) {
            debugLog('Không thể xóa temp file sau lỗi batch', {
              tempFile: tf,
              error: String(cleanupError),
            });
          }
        }
        return {
          success: false,
          outputPath: finalOutputPath,
          error: `Lỗi ghép batch ${batchIdx + 1}: ${batchResult.error ?? 'unknown error'}`,
        };
      }
      
      tempFiles.push(tempPath);
      debugLog('Batch merge thành công', {
        batchNumber: batchIdx + 1,
        tempPath,
      });
    }
    
    // Nếu chỉ có 1 batch, rename
    if (tempFiles.length === 1) {
      debugLog('Chỉ có 1 temp file, rename thành output final', {
        from: tempFiles[0],
        to: finalOutputPath,
      });
      await fs.rename(tempFiles[0], finalOutputPath);
      const padResult = await padTailToTargetDuration(finalOutputPath, lastSubtitleEndMs);
      if (!padResult.success) {
        return {
          success: false,
          outputPath: finalOutputPath,
          error: `Lỗi pad tail subtitle cuối: ${padResult.error ?? 'unknown error'}`,
        };
      }
      return { success: true, outputPath: finalOutputPath };
    }
    
    // Ghép các temp files lại
    console.log(`[AudioMerger] Ghép ${tempFiles.length} batch files...`);
    
    const finalTimeline = tempFiles.map((p) => ({ path: p, startMs: 0 }));
    const finalResult = await mergeSmallBatch(finalTimeline, finalOutputPath);
    
    // Cleanup temp files
    for (const tf of tempFiles) {
      try {
        await fs.unlink(tf);
        debugLog('Đã xóa temp file sau final merge', { tempFile: tf });
      } catch (cleanupError) {
        debugLog('Không thể xóa temp file sau final merge', {
          tempFile: tf,
          error: String(cleanupError),
        });
      }
    }
    
    if (finalResult.success) {
      const padResult = await padTailToTargetDuration(finalOutputPath, lastSubtitleEndMs);
      if (!padResult.success) {
        return {
          success: false,
          outputPath: finalOutputPath,
          error: `Lỗi pad tail subtitle cuối: ${padResult.error ?? 'unknown error'}`,
        };
      }

      console.log(`[AudioMerger] Ghép thành công: ${finalOutputPath}`);
      debugLog('mergeAudioFiles thành công', {
        outputPath: finalOutputPath,
        totalInputFiles: audioFiles.length,
        totalValidFiles: validFiles.length,
        paddedTail: padResult.padded,
        paddedMissingMs: padResult.missingMs,
      });
      return { success: true, outputPath: finalOutputPath };
    } else {
      debugLog('Final merge thất bại', {
        outputPath: finalOutputPath,
        tempFiles: tempFiles.length,
        error: finalResult.error ?? 'unknown',
      });
      return {
        success: false,
        outputPath: finalOutputPath,
        error: `Lỗi ghép final: ${finalResult.error ?? 'unknown error'}`,
      };
    }
    
  } catch (error) {
    console.error(`[AudioMerger] Lỗi:`, error);
    debugLog('mergeAudioFiles catch error', {
      outputPath: finalOutputPath,
      error: String(error),
    });
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
