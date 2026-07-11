import { app } from 'electron';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  generateSingleAudio,
  getAudioDuration,
  isTtsStopRequested,
  loadCapCutRuntimeConfig,
  requestCapCutBatchAudio,
  resolveVoiceSelection,
} from '../tts/ttsService';
import { getFFmpegPath } from '../../utils/ffmpegPath';
import type { StoryGenerateAudioResult, StoryAudioProgressEvent } from '../../../shared/types/story';

const DEFAULT_VOICE = 'vi-VN-HoaiMyNeural';
const CHUNK_MIN_CHARS = 500;
const CHUNK_MAX_CHARS = 1000;
const CHUNK_HARD_CUT = 4000;
const CAPCUT_CHUNK_MAX_CHARS = 480;
const CAPCUT_TIMEOUT_MS = 120000;
const SILENCE_DURATION_MS = 400;
const TTS_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 8000;
const CHUNK_DELAY_MIN_MS = 5000;
const CHUNK_DELAY_MAX_MS = 12000;

function splitText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (para.length >= CHUNK_HARD_CUT) {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      let remaining = para;
      while (remaining.length > CHUNK_HARD_CUT) {
        const cut = remaining.slice(0, CHUNK_MAX_CHARS);
        const match = /[.!?]\s(?!\S*[.!?])/g[Symbol.match](cut);
        let splitAt = -1;
        if (match) {
          const lastIdx = cut.lastIndexOf(match[match.length - 1]);
          splitAt = lastIdx >= CHUNK_MIN_CHARS ? lastIdx + 1 : -1;
        }
        if (splitAt < 0) {
          splitAt = CHUNK_MAX_CHARS;
        }
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
      }
      if (remaining) {
        buffer = remaining;
      }
      continue;
    }

    const candidate = buffer ? buffer + '\n\n' + para : para;

    if (candidate.length >= CHUNK_MIN_CHARS) {
      if (candidate.length <= CHUNK_MAX_CHARS) {
        chunks.push(candidate);
        buffer = '';
      } else {
        if (buffer) {
          chunks.push(buffer);
        }
        buffer = para;
      }
    } else {
      buffer = candidate;
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks.filter((c) => c.length > 0);
}

function splitTextCapCut(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length === 0) return [normalized.slice(0, CAPCUT_CHUNK_MAX_CHARS)];

  const chunks: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (sentence.length >= CAPCUT_CHUNK_MAX_CHARS) {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      let remaining = sentence;
      while (remaining.length > CAPCUT_CHUNK_MAX_CHARS) {
        chunks.push(remaining.slice(0, CAPCUT_CHUNK_MAX_CHARS));
        remaining = remaining.slice(CAPCUT_CHUNK_MAX_CHARS);
      }
      if (remaining) {
        buffer = remaining;
      }
      continue;
    }

    const candidate = buffer ? buffer + ' ' + sentence : sentence;
    if (candidate.length > CAPCUT_CHUNK_MAX_CHARS) {
      if (buffer) chunks.push(buffer);
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }

  if (buffer) chunks.push(buffer);

  return chunks.filter((c) => c.length > 0);
}

async function generateSilenceFile(
  outputPath: string,
  durationMs: number
): Promise<boolean> {
  const ffmpegBin = getFFmpegPath();
  if (!ffmpegBin || !existsSync(ffmpegBin)) {
    console.warn('[StoryTTS] FFmpeg not found at bundled path, falling back to PATH');
  }
  const ffmpeg = (ffmpegBin && existsSync(ffmpegBin)) ? ffmpegBin : 'ffmpeg';

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, [
      '-f', 'lavfi',
      '-i', `anullsrc=r=24000:cl=mono`,
      '-t', `${durationMs / 1000}`,
      '-acodec', 'libmp3lame',
      '-b:a', '48k',
      outputPath
    ], { windowsHide: true });

    proc.on('close', (code) => {
      resolve(code === 0);
    });
    proc.on('error', () => {
      resolve(false);
    });
  });
}

async function runFfmpegConcat(
  concatListPath: string,
  outputPath: string
): Promise<boolean> {
  const ffmpegBin = getFFmpegPath();
  const ffmpeg = (ffmpegBin && existsSync(ffmpegBin)) ? ffmpegBin : 'ffmpeg';

  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      outputPath
    ], { windowsHide: true });

    let stderr = '';
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[StoryTTS] FFmpeg concat failed: ${stderr.slice(-200)}`);
      }
      resolve(code === 0);
    });
    proc.on('error', (err) => {
      console.error('[StoryTTS] FFmpeg concat error:', err.message);
      resolve(false);
    });
  });
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[StoryTTS] Timeout after ${ms}ms: ${label}`)), ms)
    ) as Promise<T>
  ]);
}

function resolveOutputDir(
  outputDir: string | undefined,
  sourceFile: string | undefined,
  sourceType: 'translation' | 'summary' | undefined
): string {
  if (outputDir) return outputDir;
  const downloads = app.getPath('downloads');
  if (sourceFile) {
    const epubName = path.basename(sourceFile, path.extname(sourceFile));
    const subDir = path.join(downloads, epubName, sourceType || 'audio');
    try {
      mkdirSync(subDir, { recursive: true });
    } catch {}
    return subDir;
  }
  return downloads;
}

async function handleCapCutBatch(
  text: string,
  outputPath: string,
  voice: string,
  outputFormat?: 'mp3' | 'wav',
  chapterTitle?: string,
  filename?: string,
  onProgress?: (event: StoryAudioProgressEvent) => void,
  rate?: string,
  volume?: string,
): Promise<StoryGenerateAudioResult> {
  const resolvedVoice = resolveVoiceSelection({ voice });
  if (resolvedVoice.provider !== 'capcut') {
    return { success: false, error: 'Voice is not a CapCut voice' };
  }

  const voiceId = resolvedVoice.voiceId;
  const chunks = splitTextCapCut(text);
  if (chunks.length === 0) {
    return { success: false, error: 'No valid text chunks found' };
  }

  const label = chapterTitle || filename || 'unknown';
  const totalChunks = chunks.length;
  console.log(`[StoryTTS] CapCut batch — ${text.length} chars, ${totalChunks} chunk(s), voice=${voiceId}`);

  if (totalChunks === 1) {
    onProgress?.({ chapterTitle, status: 'chunk_start', chunkIndex: 1, chunkTotal: 1, message: 'Đang tạo audio...' });
    const t0 = Date.now();
    const result = await generateSingleAudio(chunks[0], outputPath, voice, rate, volume, outputFormat);
    const elapsed = Date.now() - t0;
    if (result.success) {
      const durationMs = await getAudioDuration(outputPath);
      console.log(`[StoryTTS] CapCut single-chunk done in ${elapsed}ms, duration=${durationMs}ms`);
      onProgress?.({ chapterTitle, status: 'done', message: 'Hoàn thành', durationMs: durationMs || undefined });
      return { success: true, filePath: outputPath, durationMs: durationMs || undefined };
    }
    console.log(`[StoryTTS] CapCut single-chunk failed: ${result.error}`);
    onProgress?.({ chapterTitle, status: 'error', message: result.error || 'TTS generation failed' });
    return { success: false, error: result.error || 'TTS generation failed' };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nauchaoheo-story-capcut-'));
  const chunkFiles: string[] = [];

  try {
    onProgress?.({ chapterTitle, status: 'chunk_start', chunkIndex: 1, chunkTotal: totalChunks, message: `Đang tạo ${totalChunks} đoạn qua WebSocket...` });

    const cfgResult = loadCapCutRuntimeConfig();
    if (!cfgResult.ok) {
      onProgress?.({ chapterTitle, status: 'error', message: cfgResult.error });
      return { success: false, error: cfgResult.error };
    }

    const batchResult = await withTimeout(
      requestCapCutBatchAudio({
        texts: chunks,
        voiceId,
        outputFormat: outputFormat || 'mp3',
        config: cfgResult.config,
      }),
      CAPCUT_TIMEOUT_MS,
      'CapCut batch generation'
    );

    if (batchResult.taskFailed) {
      console.log(`[StoryTTS] CapCut batch failed: ${batchResult.lastError}`);
      onProgress?.({ chapterTitle, status: 'error', message: batchResult.lastError || 'CapCut batch failed' });
      return { success: false, error: batchResult.lastError || 'CapCut batch failed' };
    }

    if (isTtsStopRequested()) {
      console.log(`[StoryTTS] Stop requested during CapCut batch`);
      onProgress?.({ chapterTitle, status: 'error', message: 'Đã dừng theo yêu cầu người dùng' });
      return { success: false, error: 'TTS generation stopped by user' };
    }

    for (let i = 0; i < batchResult.audioBuffers.length; i++) {
      const buf = batchResult.audioBuffers[i];
      if (!buf || buf.length === 0) continue;
      const chunkPath = path.join(tmpDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
      await fs.writeFile(chunkPath, buf);
      chunkFiles.push(chunkPath);
      onProgress?.({ chapterTitle, status: 'chunk_done', chunkIndex: i + 1, chunkTotal: totalChunks, message: `Đoạn ${i + 1}/${totalChunks} hoàn thành` });
    }

    if (chunkFiles.length === 0) {
      const errMsg = 'No audio chunks generated from CapCut batch';
      console.log(`[StoryTTS] ${errMsg}`);
      onProgress?.({ chapterTitle, status: 'error', message: errMsg });
      return { success: false, error: errMsg };
    }

    if (chunkFiles.length < totalChunks) {
      console.warn(`[StoryTTS] CapCut partial: ${chunkFiles.length}/${totalChunks} chunks had audio`);
    }

    const silencePath = path.join(tmpDir, 'silence.mp3');
    const silenceOk = await generateSilenceFile(silencePath, SILENCE_DURATION_MS);

    const concatListPath = path.join(tmpDir, 'concat.txt');
    const concatLines: string[] = [];

    chunkFiles.sort((a, b) => {
      const ai = parseInt(path.basename(a).replace('chunk_', '').replace('.mp3', ''), 10);
      const bi = parseInt(path.basename(b).replace('chunk_', '').replace('.mp3', ''), 10);
      return ai - bi;
    });

    for (let i = 0; i < chunkFiles.length; i++) {
      concatLines.push(`file '${chunkFiles[i].replace(/'/g, "'\\''")}'`);
      if (silenceOk && i < chunkFiles.length - 1) {
        concatLines.push(`file '${silencePath.replace(/'/g, "'\\''")}'`);
      }
    }

    await fs.writeFile(concatListPath, concatLines.join('\n'), 'utf-8');

    console.log(`[StoryTTS] Merging ${chunkFiles.length} chunk(s)...`);
    onProgress?.({ chapterTitle, status: 'merging', message: `Đang ghép ${chunkFiles.length} file audio...` });
    const mergeOk = await runFfmpegConcat(concatListPath, outputPath);
    if (!mergeOk) {
      console.log(`[StoryTTS] Merge failed`);
      onProgress?.({ chapterTitle, status: 'error', message: 'Ghép audio thất bại' });
      return { success: false, error: 'Failed to merge audio chunks' };
    }

    onProgress?.({ chapterTitle, status: 'saving', message: 'Đang lưu file...' });
    const durationMs = await getAudioDuration(outputPath);
    console.log(`[StoryTTS] CapCut batch done: ${outputPath} (${durationMs}ms)`);
    onProgress?.({ chapterTitle, status: 'done', message: 'Hoàn thành', durationMs: durationMs || undefined });
    return { success: true, filePath: outputPath, durationMs: durationMs || undefined };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function generateChapterAudio(
  chapterText: string,
  voice: string = DEFAULT_VOICE,
  outputDir?: string,
  filename?: string,
  sourceFile?: string,
  sourceType?: 'translation' | 'summary',
  rate?: string,
  volume?: string,
  outputFormat?: 'mp3' | 'wav',
  chapterTitle?: string,
  onProgress?: (event: StoryAudioProgressEvent) => void
): Promise<StoryGenerateAudioResult> {
  const text = chapterText?.trim();
  if (!text) {
    console.log(`[StoryTTS] Empty chapter text received`);
    return { success: false, error: 'Chapter text is empty' };
  }

  const resolvedDir = resolveOutputDir(outputDir, sourceFile, sourceType);
  const outputPath = path.join(
    resolvedDir,
    filename ? `${filename}.mp3` : `chapter_audio_${Date.now()}.mp3`
  );

  if (existsSync(outputPath)) {
    const stats = await fs.stat(outputPath);
    if (stats.size > 0) {
      const label = chapterTitle || filename || 'unknown';
      const durationMs = await getAudioDuration(outputPath);
      console.log(`[StoryTTS] File already exists for "${label}": ${outputPath} (${durationMs}ms)`);
      onProgress?.({ chapterTitle, status: 'done', message: 'Đã có file audio', durationMs: durationMs || undefined });
      return { success: true, filePath: outputPath, durationMs: durationMs || undefined };
    }
  }

  const resolvedVoice = resolveVoiceSelection({ voice });

  if (resolvedVoice.provider === 'capcut') {
    return handleCapCutBatch(text, outputPath, voice, outputFormat, chapterTitle, filename, onProgress, rate, volume);
  }

  const chunks = splitText(text);
  if (chunks.length === 0) {
    console.log(`[StoryTTS] No text chunks after splitting`);
    return { success: false, error: 'No valid text chunks found' };
  }

  const label = chapterTitle || filename || 'unknown';
  const totalChunks = chunks.length;
  console.log(`[StoryTTS] Generating audio for "${label}" — ${text.length} chars, ${totalChunks} chunk(s), voice=${voice}`);

  if (totalChunks === 1) {
    onProgress?.({ chapterTitle, status: 'chunk_start', chunkIndex: 1, chunkTotal: 1, message: 'Đang tạo audio...' });
    const t0 = Date.now();
    const result = await generateSingleAudio(chunks[0], outputPath, voice, rate, volume, outputFormat);
    const elapsed = Date.now() - t0;
    if (result.success) {
      const durationMs = await getAudioDuration(outputPath);
      console.log(`[StoryTTS] Single-chunk done in ${elapsed}ms, duration=${durationMs}ms`);
      onProgress?.({ chapterTitle, status: 'done', message: 'Hoàn thành', durationMs: durationMs || undefined });
      return { success: true, filePath: outputPath, durationMs: durationMs || undefined };
    }
    console.log(`[StoryTTS] Single-chunk failed in ${elapsed}ms: ${result.error}`);
    onProgress?.({ chapterTitle, status: 'error', message: result.error || 'TTS generation failed' });
    return { success: false, error: result.error || 'TTS generation failed' };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nauchaoheo-story-tts-'));
  const chunkFiles: string[] = [];

  try {
    const errors: string[] = [];

    const processChunk = async (chunk: string, i: number, retries: number = MAX_RETRIES): Promise<string | null> => {
      const chunkPath = path.join(tmpDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
      const chunkLabel = `Chunk ${i + 1}/${totalChunks}`;

      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          if (isTtsStopRequested()) return null;
          console.log(`[StoryTTS] ${chunkLabel} retry ${attempt}/${retries} after ${RETRY_DELAY_MS}ms delay...`);
          await sleep(RETRY_DELAY_MS);
          if (isTtsStopRequested()) return null;
        }
        try {
          console.log(`[StoryTTS] ${chunkLabel} starting...`);
          onProgress?.({ chapterTitle, status: 'chunk_start', chunkIndex: i + 1, chunkTotal: totalChunks, message: `Đang tạo ${chunkLabel}${attempt > 0 ? ` (lần ${attempt + 1})` : ''}...` });
          const t0 = Date.now();
          const result = await withTimeout(
            generateSingleAudio(chunk, chunkPath, voice, rate, volume, outputFormat),
            TTS_TIMEOUT_MS,
            `chunk ${i}`
          );
          const elapsed = Date.now() - t0;
          if (result.success) {
            console.log(`[StoryTTS] ${chunkLabel} done in ${elapsed}ms`);
            onProgress?.({ chapterTitle, status: 'chunk_done', chunkIndex: i + 1, chunkTotal: totalChunks, message: `${chunkLabel} hoàn thành (${elapsed}ms)` });
            return chunkPath;
          }
          console.log(`[StoryTTS] ${chunkLabel} failed: ${result.error}`);
          if (attempt < retries) {
            console.log(`[StoryTTS] ${chunkLabel} will retry (${attempt + 1}/${retries})`);
            continue;
          }
          errors.push(`Chunk ${i}: ${result.error || 'unknown error'}`);
          onProgress?.({ chapterTitle, status: 'chunk_error', chunkIndex: i + 1, chunkTotal: totalChunks, message: `${chunkLabel} lỗi: ${result.error || 'unknown'}` });
          return null;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[StoryTTS] Chunk ${i + 1}/${totalChunks} error: ${msg}`);
          if (attempt < retries) {
            console.log(`[StoryTTS] ${chunkLabel} will retry (${attempt + 1}/${retries})`);
            continue;
          }
          errors.push(`Chunk ${i}: ${msg}`);
          onProgress?.({ chapterTitle, status: 'chunk_error', chunkIndex: i + 1, chunkTotal: totalChunks, message: `Chunk ${i + 1} lỗi: ${msg}` });
          return null;
        }
      }
      return null;
    };

    for (let i = 0; i < chunks.length; i++) {
      if (isTtsStopRequested()) {
        console.log(`[StoryTTS] Stop requested, stopping chunk processing after ${chunkFiles.length} chunks`);
        onProgress?.({ chapterTitle, status: 'error', message: 'Đã dừng theo yêu cầu người dùng' });
        break;
      }

      const result = await processChunk(chunks[i], i);
      if (result) chunkFiles.push(result);

      if (i < chunks.length - 1 && !isTtsStopRequested()) {
        const delay = CHUNK_DELAY_MIN_MS + Math.random() * (CHUNK_DELAY_MAX_MS - CHUNK_DELAY_MIN_MS);
        await sleep(delay);
      }
    }

    if (chunkFiles.length === 0) {
      const errMsg = errors.length > 0
        ? `All TTS chunks failed: ${errors.join('; ')}`
        : 'No audio chunks generated';
      console.log(`[StoryTTS] All chunks failed for "${label}": ${errMsg}`);
      onProgress?.({ chapterTitle, status: 'error', message: errMsg });
      return { success: false, error: errMsg };
    }

    const silencePath = path.join(tmpDir, 'silence.mp3');
    console.log(`[StoryTTS] Generating silence file...`);
    const silenceOk = await generateSilenceFile(silencePath, SILENCE_DURATION_MS);
    console.log(`[StoryTTS] Silence file ${silenceOk ? 'OK' : 'failed (continuing without)'}`);

    const concatListPath = path.join(tmpDir, 'concat.txt');
    const concatLines: string[] = [];

    chunkFiles.sort((a, b) => {
      const ai = parseInt(path.basename(a).replace('chunk_', '').replace('.mp3', ''), 10);
      const bi = parseInt(path.basename(b).replace('chunk_', '').replace('.mp3', ''), 10);
      return ai - bi;
    });

    for (let i = 0; i < chunkFiles.length; i++) {
      concatLines.push(`file '${chunkFiles[i].replace(/'/g, "'\\''")}'`);
      if (silenceOk && i < chunkFiles.length - 1) {
        concatLines.push(`file '${silencePath.replace(/'/g, "'\\''")}'`);
      }
    }

    await fs.writeFile(concatListPath, concatLines.join('\n'), 'utf-8');

    console.log(`[StoryTTS] Merging ${chunkFiles.length} chunk(s)...`);
    onProgress?.({ chapterTitle, status: 'merging', message: `Đang ghép ${chunkFiles.length} file audio...` });
    const tMerge = Date.now();
    const mergeOk = await runFfmpegConcat(concatListPath, outputPath);
    const mergeElapsed = Date.now() - tMerge;
    if (!mergeOk) {
      console.log(`[StoryTTS] Merge failed after ${mergeElapsed}ms`);
      onProgress?.({ chapterTitle, status: 'error', message: 'Ghép audio thất bại' });
      return { success: false, error: 'Failed to merge audio chunks' };
    }
    console.log(`[StoryTTS] Merge done in ${mergeElapsed}ms`);

    if (chunkFiles.length < chunks.length && errors.length > 0) {
      console.warn(`[StoryTTS] Partial success: ${chunkFiles.length}/${chunks.length} chunks, errors: ${errors.join('; ')}`);
    }

    onProgress?.({ chapterTitle, status: 'saving', message: 'Đang lưu file...' });
    const durationMs = await getAudioDuration(outputPath);
    console.log(`[StoryTTS] Done: ${outputPath} (${durationMs}ms)`);
    onProgress?.({ chapterTitle, status: 'done', message: 'Hoàn thành', durationMs: durationMs || undefined });
    return { success: true, filePath: outputPath, durationMs: durationMs || undefined };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
