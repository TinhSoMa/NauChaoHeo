/**
 * Audio Merger - Ghép audio files sử dụng FFmpeg
 * Hỗ trợ phân tích và điều chỉnh timeline
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  AudioFile,
  AudioSegmentInfo,
  CAPTION_PROCESS_STOP_SIGNAL,
  MergeAnalysis,
  MergeOptions,
  MergeResult,
} from '../../../shared/types/caption';
import { getAudioDuration, throwIfTtsStopped } from './ttsService';
import { getFFmpegPath } from '../../utils/ffmpegPath';

const MAX_BATCH_SPAN_MS = 20 * 60 * 1000; // 20 phút
const MAX_BATCH_FILES = 96;
const BATCH_CONCURRENCY = 3;
const DEBUG_AUDIO_MERGER = process.env.AUDIO_MERGER_DEBUG === '1';
const activeAudioMergerProcesses = new Set<ChildProcess>();

function registerActiveAudioMergerProcess(proc: ChildProcess): void {
  activeAudioMergerProcesses.add(proc);
  const cleanup = () => activeAudioMergerProcesses.delete(proc);
  proc.once('close', cleanup);
  proc.once('exit', cleanup);
  proc.once('error', cleanup);
}

export function stopActiveAudioMerger(): { stopped: boolean; message: string } {
  let hadActive = false;
  for (const proc of Array.from(activeAudioMergerProcesses)) {
    if (proc.killed) continue;
    hadActive = true;
    try {
      proc.kill('SIGKILL');
    } catch {
      try {
        proc.kill();
      } catch {}
    }
  }
  return {
    stopped: hadActive || activeAudioMergerProcesses.size > 0,
    message: hadActive ? 'Đã gửi tín hiệu dừng merge/fit audio.' : 'Không có merge/fit audio đang chạy.',
  };
}

function debugLog(message: string, details?: Record<string, unknown>): void {
  if (!DEBUG_AUDIO_MERGER) return;

  if (details) {
    console.log(`[AudioMerger][DEBUG] ${message}`, details);
    return;
  }

  console.log(`[AudioMerger][DEBUG] ${message}`);
}

function resolveFfmpegBinary(): string {
  const ffmpegPath = getFFmpegPath();
  if (ffmpegPath && existsSync(ffmpegPath)) {
    return ffmpegPath;
  }
  console.warn(`[AudioMerger] WARN: Không tìm thấy ffmpeg đóng gói tại ${ffmpegPath}. Fallback PATH.`);
  return 'ffmpeg';
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
  targetDurationMs: number,
  ffmpegBin: string
): Promise<PadTailResult> {
  throwIfTtsStopped();
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
    throwIfTtsStopped();
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

    const proc = spawn(ffmpegBin, args, {
      windowsHide: true,
      shell: false,
    });
    registerActiveAudioMergerProcess(proc);

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
          error: stderr || `Pad tail ffmpeg exit code: ${code}`,
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
  outputPath: string,
  ffmpegBin: string,
  baseStartMs: number = 0
): Promise<BatchMergeResult> {
  throwIfTtsStopped();
  if (files.length === 0) {
    console.warn(`[AudioMerger] mergeSmallBatch nhận batch rỗng: ${outputPath}`);
    return { success: false, error: 'Batch rỗng' };
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
    throwIfTtsStopped();
    const relativeStartMs = Math.max(0, file.startMs - baseStartMs);
    args.push('-i', file.path);
    filterParts.push(`[${idx}:a]adelay=${relativeStartMs}|${relativeStartMs}[a${idx}]`);
  });
  
  // Amix filter
  const mixInputs = files.map((_, idx) => `[a${idx}]`).join('');
  let filterComplex = filterParts.join(';') +
    `;${mixInputs}amix=inputs=${files.length}:duration=longest:dropout_transition=0:normalize=0`;

  filterComplex += `[out]`;

  const outputDir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const scriptPath = path.join(outputDir, `${baseName}_filter_${Date.now()}_${Math.floor(Math.random() * 10000)}.ffscript`);

  const cleanupScript = async () => {
    try { await fs.unlink(scriptPath); } catch {}
  };

  try {
    await fs.writeFile(scriptPath, filterComplex, 'utf8');
    debugLog('Filter script prepared', {
      outputPath,
      scriptPath,
      baseStartMs,
      length: filterComplex.length,
      lines: filterComplex.split(';').length,
    });
  } catch (err) {
    return { success: false, error: `Không thể ghi filter script: ${String(err)}` };
  }

  args.push('-filter_complex_script', scriptPath);
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
    baseStartMs,
    argsPreview: args.join(' '),
  });
  
  return new Promise((resolve) => {
    try {
      throwIfTtsStopped();
    } catch (error) {
      resolve({ success: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const proc = spawn(ffmpegBin, args, {
      windowsHide: true,
      shell: false,
    });
    registerActiveAudioMergerProcess(proc);
    
    let stderr = '';
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      void cleanupScript();
      if (code !== 0) {
        console.error(`[AudioMerger] FFmpeg error: ${stderr}`);
        const errorMessage = stderr || `FFmpeg exit code: ${code}`;
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
      void cleanupScript();
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
  try {
    throwIfTtsStopped();
  } catch (error) {
    return { success: false, outputPath, error: error instanceof Error ? error.message : String(error) };
  }
  const ffmpegBin = resolveFfmpegBinary();
  
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
    throwIfTtsStopped();
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
    throwIfTtsStopped();
    // Nếu chỉ có 1 file, copy trực tiếp
    if (timeline.length === 1) {
      debugLog('Chỉ có 1 file trong timeline, copy trực tiếp', {
        source: timeline[0].path,
        destination: finalOutputPath,
      });
      await fs.copyFile(timeline[0].path, finalOutputPath);
      const padResult = await padTailToTargetDuration(finalOutputPath, lastSubtitleEndMs, ffmpegBin);
      if (!padResult.success) {
        return {
          success: false,
          outputPath: finalOutputPath,
          error: `Lỗi pad tail subtitle cuối: ${padResult.error ?? 'unknown error'}`,
        };
      }
      return { success: true, outputPath: finalOutputPath };
    }
    
    // Chia thành batches theo span timeline
    const batches: Array<Array<{ path: string; startMs: number }>> = [];
    let currentBatch: Array<{ path: string; startMs: number }> = [];
    let batchStartMs = 0;
    for (const item of timeline) {
      throwIfTtsStopped();
      if (currentBatch.length === 0) {
        currentBatch.push(item);
        batchStartMs = item.startMs;
        continue;
      }
      const spanMs = item.startMs - batchStartMs;
      if (spanMs > MAX_BATCH_SPAN_MS || currentBatch.length >= MAX_BATCH_FILES) {
        batches.push(currentBatch);
        currentBatch = [item];
        batchStartMs = item.startMs;
      } else {
        currentBatch.push(item);
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const outputDir = path.dirname(finalOutputPath);
    const baseName = path.basename(finalOutputPath, path.extname(finalOutputPath));
    const ext = path.extname(finalOutputPath);
    const tempFiles: Array<{ path: string; startMs: number }> = new Array(batches.length);

    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
      throwIfTtsStopped();
      const group = batches.slice(i, i + BATCH_CONCURRENCY);
      const results = await Promise.all(group.map(async (batch, offset) => {
        throwIfTtsStopped();
        const batchIdx = i + offset;
        const batchLastItem = batch[batch.length - 1];
        console.log(`[AudioMerger] Ghép batch ${batchIdx + 1}/${batches.length}`);
        const tempPath = path.join(outputDir, `${baseName}_temp_${batchIdx}${ext}`);
        const batchStartMs = batch[0].startMs;
        debugLog('Thông tin batch', {
          batchNumber: batchIdx + 1,
          totalBatches: batches.length,
          segmentCount: batch.length,
          batchStartMs,
          batchEndMs: batchLastItem.startMs,
          tempPath,
          spanMs: batchLastItem.startMs - batch[0].startMs,
        });
        const batchResult = await mergeSmallBatch(batch, tempPath, ffmpegBin, batchStartMs);
        return { batchIdx, tempPath, batchStartMs, batchResult };
      }));

      const failed = results.find(r => !r.batchResult.success);
      if (failed) {
        debugLog('Batch merge thất bại, bắt đầu cleanup temp files', {
          failedBatch: failed.batchIdx + 1,
          tempFilesCount: tempFiles.filter(Boolean).length,
          error: failed.batchResult.error ?? 'unknown',
        });
        for (const res of results) {
          if (res.batchResult.success) {
            tempFiles[res.batchIdx] = { path: res.tempPath, startMs: res.batchStartMs };
          }
        }
        for (const tf of tempFiles.filter((item): item is { path: string; startMs: number } => !!item)) {
          try {
            await fs.unlink(tf.path);
            debugLog('Đã xóa temp file sau lỗi batch', { tempFile: tf.path });
          } catch (cleanupError) {
            debugLog('Không thể xóa temp file sau lỗi batch', {
              tempFile: tf.path,
              error: String(cleanupError),
            });
          }
        }
        return {
          success: false,
          outputPath: finalOutputPath,
          error: `Lỗi ghép batch ${failed.batchIdx + 1}: ${failed.batchResult.error ?? 'unknown error'}`,
        };
      }

      for (const res of results) {
        tempFiles[res.batchIdx] = { path: res.tempPath, startMs: res.batchStartMs };
        debugLog('Batch merge thành công', {
          batchNumber: res.batchIdx + 1,
          tempPath: res.tempPath,
          batchStartMs: res.batchStartMs,
        });
      }
    }
    
    // Nếu chỉ có 1 batch, rename
    if (tempFiles.length === 1) {
      throwIfTtsStopped();
      const onlyTemp = tempFiles[0];
      debugLog('Chỉ có 1 temp file, rename thành output final', {
        from: onlyTemp.path,
        to: finalOutputPath,
        startMs: onlyTemp.startMs,
      });
      if (onlyTemp.startMs <= 0) {
        await fs.rename(onlyTemp.path, finalOutputPath);
      } else {
        const singleFinalResult = await mergeSmallBatch(
          [{ path: onlyTemp.path, startMs: onlyTemp.startMs }],
          finalOutputPath,
          ffmpegBin,
          0
        );
        try {
          await fs.unlink(onlyTemp.path);
        } catch {}
        if (!singleFinalResult.success) {
          return {
            success: false,
            outputPath: finalOutputPath,
            error: `Lỗi ghép final từ 1 batch: ${singleFinalResult.error ?? 'unknown error'}`,
          };
        }
      }
      const padResult = await padTailToTargetDuration(finalOutputPath, lastSubtitleEndMs, ffmpegBin);
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
    
    throwIfTtsStopped();
    const finalTimeline = tempFiles.map((item) => ({ path: item.path, startMs: item.startMs }));
    const finalResult = await mergeSmallBatch(finalTimeline, finalOutputPath, ffmpegBin, 0);
    
    // Cleanup temp files
    for (const tf of tempFiles) {
      try {
        await fs.unlink(tf.path);
        debugLog('Đã xóa temp file sau final merge', { tempFile: tf.path });
      } catch (cleanupError) {
        debugLog('Không thể xóa temp file sau final merge', {
          tempFile: tf.path,
          error: String(cleanupError),
        });
      }
    }
    
    if (finalResult.success) {
      const padResult = await padTailToTargetDuration(finalOutputPath, lastSubtitleEndMs, ffmpegBin);
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
    if (error instanceof Error && error.message === CAPTION_PROCESS_STOP_SIGNAL) {
      return { success: false, outputPath: finalOutputPath, error: CAPTION_PROCESS_STOP_SIGNAL };
    }
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

async function runTrimToPath(
  inputPath: string,
  outputPath: string,
  filter: string
): Promise<boolean> {
  const normalizedInput = inputPath.trim();
  const normalizedOutput = outputPath.trim();
  if (!normalizedInput || !normalizedOutput) {
    return false;
  }
  const samePath = path.resolve(normalizedInput) === path.resolve(normalizedOutput);
  const tempOutput = samePath
    ? (/\.(wav|mp3)$/i.test(normalizedOutput)
      ? normalizedOutput.replace(/\.(wav|mp3)$/i, '_temp.$1')
      : `${normalizedOutput}_temp`)
    : '';

  return new Promise((resolve) => {
    const targetOutput = samePath ? tempOutput : normalizedOutput;
    const isWav = targetOutput.toLowerCase().endsWith('.wav')
      || normalizedInput.toLowerCase().endsWith('.wav');
    const args = [
      '-y',
      '-i', normalizedInput,
      '-af', filter,
    ];

    if (isWav) {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '192k');
    }

    args.push(targetOutput);

    const proc = spawn('ffmpeg', args, {
      windowsHide: true,
      shell: false,
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        if (samePath) {
          try {
            await fs.unlink(normalizedOutput);
            await fs.rename(targetOutput, normalizedOutput);
            resolve(true);
            return;
          } catch {
            try { await fs.unlink(targetOutput); } catch {}
            resolve(false);
            return;
          }
        }
        resolve(true);
        return;
      }
      try { await fs.unlink(targetOutput); } catch {}
      resolve(false);
    });

    proc.on('error', async () => {
      try { await fs.unlink(targetOutput); } catch {}
      resolve(false);
    });
  });
}

/**
 * Cắt khoảng im lặng đầu file audio, ghi ra file mới (không đụng file gốc)
 */
export async function trimSilenceToPath(
  inputPath: string,
  outputPath: string
): Promise<boolean> {
  return runTrimToPath(inputPath, outputPath, 'silenceremove=start_periods=1:start_threshold=-50dB');
}

/**
 * Cắt khoảng im lặng cuối file audio, ghi ra file mới (không đụng file gốc)
 */
export async function trimSilenceEndToPath(
  inputPath: string,
  outputPath: string
): Promise<boolean> {
  return runTrimToPath(
    inputPath,
    outputPath,
    'areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse'
  );
}

/**
 * Kết quả fit audio
 */
export interface FitAudioResult {
  scaled: boolean;      // true nếu đã scale, false nếu giữ nguyên
  outputPath: string;   // Đường dẫn file output (scaled hoặc gốc)
  originalDurationMs: number;
  outputDurationMsEstimate: number;
}

/**
 * Tự động scale từng audio file để vừa với thời lượng cho phép.
 * Nếu audio thực tế dài hơn durationMs, sẽ tăng tốc bằng atempo filter.
 * File gốc KHÔNG bị thay đổi — bản scale được lưu vào thư mục audio_fit/
 */
export async function fitAudioToDuration(
  audioPath: string,
  allowedDurationMs: number,
  speedLabel?: string
): Promise<FitAudioResult> {
  throwIfTtsStopped();
  const fileName = path.basename(audioPath);
  
  // Lấy thời lượng thực tế
  const actualDurationMs = await getAudioDuration(audioPath);

  if (actualDurationMs <= 0 || allowedDurationMs <= 0) {
    console.warn(
      `[AudioMerger] fitAudio ERROR: ${fileName} actualDuration=${actualDurationMs}ms, allowed=${allowedDurationMs}ms (bỏ qua)`
    );
    return {
      scaled: false,
      outputPath: audioPath,
      originalDurationMs: actualDurationMs,
      outputDurationMsEstimate: actualDurationMs,
    };
  }

  // Nếu audio không bị tràn, không cần scale → dùng file gốc
  if (actualDurationMs <= allowedDurationMs) {
    // console.log(
    //   `[AudioMerger] fitAudio SKIP: ${fileName} actual=${actualDurationMs}ms <= allowed=${allowedDurationMs}ms`
    // );
    return {
      scaled: false,
      outputPath: audioPath,
      originalDurationMs: actualDurationMs,
      outputDurationMsEstimate: actualDurationMs,
    };
  }

  // const speedLabelForLog = (typeof speedLabel === 'string' && speedLabel.trim())
  //   ? speedLabel.trim()
  //   : 'unknown';
  // console.log(
  //   `[AudioMerger] fitAudio TARGET: ${fileName} target=${allowedDurationMs}ms (speedLabel=${speedLabelForLog}), actual=${actualDurationMs}ms`
  // );

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

  // Lưu bản scale vào thư mục audio_fit/<speedLabel> (tránh lẫn audio gốc/trim)
  const audioDir = path.dirname(audioPath);
  const audioDirName = path.basename(audioDir);
  const audioParentDir = path.dirname(audioDir);
  const audioParentName = path.basename(audioParentDir);
  let baseFitDir = audioDir;
  if (audioDirName === 'audio_fit') {
    baseFitDir = audioDir;
  } else if (audioParentName === 'audio_fit') {
    baseFitDir = audioParentDir;
  } else if (audioDirName === 'audio' || audioDirName === 'audio_trimmed' || audioDirName === 'audio_scaled') {
    baseFitDir = path.join(audioParentDir, 'audio_fit');
  } else {
    baseFitDir = path.join(audioDir, 'audio_fit');
  }
  const normalizedLabel = typeof speedLabel === 'string' ? speedLabel.trim() : '';
  const safeLabel = normalizedLabel.replace(/[\\/]+/g, '_');
  let fitDir = baseFitDir;
  if (safeLabel) {
    if (audioParentName === 'audio_fit' && audioDirName === safeLabel) {
      fitDir = audioDir;
    } else {
      fitDir = path.join(baseFitDir, safeLabel);
    }
  }
  await fs.mkdir(fitDir, { recursive: true });
  const scaledPath = path.join(fitDir, fileName);

  return new Promise((resolve) => {
    try {
      throwIfTtsStopped();
    } catch {
      resolve({
        scaled: false,
        outputPath: audioPath,
        originalDurationMs: actualDurationMs,
        outputDurationMsEstimate: actualDurationMs,
      });
      return;
    }
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
    registerActiveAudioMergerProcess(proc);

    proc.on('close', async (code) => {
      if (code === 0) {
        const savedName = path.basename(scaledPath);
        // console.log(`[AudioMerger] fitAudio SAVED: ${savedName}`);
        resolve({
          scaled: true,
          outputPath: scaledPath,
          originalDurationMs: actualDurationMs,
          outputDurationMsEstimate: allowedDurationMs,
        });
      } else {
        try { await fs.unlink(scaledPath); } catch {}
        resolve({
          scaled: false,
          outputPath: audioPath,
          originalDurationMs: actualDurationMs,
          outputDurationMsEstimate: actualDurationMs,
        });
      }
    });

    proc.on('error', () => {
      resolve({
        scaled: false,
        outputPath: audioPath,
        originalDurationMs: actualDurationMs,
        outputDurationMsEstimate: actualDurationMs,
      });
    });
  });
}
