import { app } from 'electron';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { generateSingleAudio, getAudioDuration } from '../tts/ttsService';
import { getFFmpegPath } from '../../utils/ffmpegPath';
import type { StoryGenerateAudioResult, StoryAudioProgressEvent } from '../../../shared/types/story';

const DEFAULT_VOICE = 'vi-VN-HoaiMyNeural';
const CHUNK_MIN_CHARS = 500;
const CHUNK_MAX_CHARS = 800;
const MAX_CONCURRENCY = 3;
const SILENCE_DURATION_MS = 400;
const TTS_TIMEOUT_MS = 60000;

function splitText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + CHUNK_MAX_CHARS, normalized.length);

    if (end >= normalized.length) {
      chunks.push(normalized.slice(start).trim());
      break;
    }

    const searchStart = Math.max(start + CHUNK_MIN_CHARS, end - 100);
    const segment = normalized.slice(searchStart, end);
    const sentenceBoundary = /[.!?\n]\s/.exec(segment);
    const paragraphBoundary = /\n\n/.exec(segment);

    let splitPos = -1;
    if (paragraphBoundary) {
      splitPos = searchStart + paragraphBoundary.index + 2;
    } else if (sentenceBoundary) {
      splitPos = searchStart + sentenceBoundary.index + 1;
    }

    if (splitPos > start && splitPos < end) {
      chunks.push(normalized.slice(start, splitPos).trim());
      start = splitPos;
    } else {
      chunks.push(normalized.slice(start, end).trim());
      start = end;
    }
  }

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
    const resolvedDir = resolveOutputDir(outputDir, sourceFile, sourceType);
    const outputPath = path.join(
      resolvedDir,
      filename ? `${filename}.mp3` : `chapter_audio_${Date.now()}.mp3`
    );
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

    const processChunk = async (chunk: string, i: number): Promise<string | null> => {
      try {
        const chunkPath = path.join(tmpDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
        const chunkLabel = `Chunk ${i + 1}/${totalChunks}`;
        console.log(`[StoryTTS] ${chunkLabel} starting...`);
        onProgress?.({ chapterTitle, status: 'chunk_start', chunkIndex: i + 1, chunkTotal: totalChunks, message: `Đang tạo ${chunkLabel}...` });
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
        errors.push(`Chunk ${i}: ${result.error || 'unknown error'}`);
        onProgress?.({ chapterTitle, status: 'chunk_error', chunkIndex: i + 1, chunkTotal: totalChunks, message: `${chunkLabel} lỗi: ${result.error || 'unknown'}` });
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[StoryTTS] Chunk ${i + 1}/${totalChunks} error: ${msg}`);
        errors.push(`Chunk ${i}: ${msg}`);
        onProgress?.({ chapterTitle, status: 'chunk_error', chunkIndex: i + 1, chunkTotal: totalChunks, message: `Chunk ${i + 1} lỗi: ${msg}` });
        return null;
      }
    };

    for (let i = 0; i < chunks.length; i += MAX_CONCURRENCY) {
      const batch = chunks.slice(i, i + MAX_CONCURRENCY);
      const results = await Promise.all(
        batch.map((chunk, j) => processChunk(chunk, i + j))
      );
      for (const p of results) {
        if (p) chunkFiles.push(p);
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

    const resolvedDir = resolveOutputDir(outputDir, sourceFile, sourceType);
    const outputPath = path.join(
      resolvedDir,
      filename ? `${filename}.mp3` : `chapter_audio_${Date.now()}.mp3`
    );

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
