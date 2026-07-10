import { app } from 'electron';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { generateSingleAudio, getAudioDuration } from '../tts/ttsService';
import { getFFmpegPath } from '../../utils/ffmpegPath';
import type { StoryGenerateAudioResult } from '../../../shared/types/story';

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
  outputFormat?: 'mp3' | 'wav'
): Promise<StoryGenerateAudioResult> {
  const text = chapterText?.trim();
  if (!text) {
    return { success: false, error: 'Chapter text is empty' };
  }

  const chunks = splitText(text);
  if (chunks.length === 0) {
    return { success: false, error: 'No valid text chunks found' };
  }

  if (chunks.length === 1) {
    const resolvedDir = resolveOutputDir(outputDir, sourceFile, sourceType);
    const outputPath = path.join(
      resolvedDir,
      filename ? `${filename}.mp3` : `chapter_audio_${Date.now()}.mp3`
    );
    const result = await generateSingleAudio(chunks[0], outputPath, voice, rate, volume, outputFormat);
    if (result.success) {
      const durationMs = await getAudioDuration(outputPath);
      return { success: true, filePath: outputPath, durationMs: durationMs || undefined };
    }
    return { success: false, error: result.error || 'TTS generation failed' };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nauchaoheo-story-tts-'));
  const chunkFiles: string[] = [];

  try {
    const errors: string[] = [];

    const processChunk = async (chunk: string, i: number): Promise<string | null> => {
      try {
        const chunkPath = path.join(tmpDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
        const result = await withTimeout(
          generateSingleAudio(chunk, chunkPath, voice, rate, volume, outputFormat),
          TTS_TIMEOUT_MS,
          `chunk ${i}`
        );
        if (result.success) {
          return chunkPath;
        }
        errors.push(`Chunk ${i}: ${result.error || 'unknown error'}`);
        return null;
      } catch (err) {
        errors.push(`Chunk ${i}: ${err instanceof Error ? err.message : String(err)}`);
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
      return {
        success: false,
        error: errors.length > 0
          ? `All TTS chunks failed: ${errors.join('; ')}`
          : 'No audio chunks generated'
      };
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

    const resolvedDir = resolveOutputDir(outputDir, sourceFile, sourceType);
    const outputPath = path.join(
      resolvedDir,
      filename ? `${filename}.mp3` : `chapter_audio_${Date.now()}.mp3`
    );

    const mergeOk = await runFfmpegConcat(concatListPath, outputPath);
    if (!mergeOk) {
      return { success: false, error: 'Failed to merge audio chunks' };
    }

    if (chunkFiles.length < chunks.length && errors.length > 0) {
      console.warn(`[StoryTTS] Partial success: ${chunkFiles.length}/${chunks.length} chunks, errors: ${errors.join('; ')}`);
    }

    const durationMs = await getAudioDuration(outputPath);
    return { success: true, filePath: outputPath, durationMs: durationMs || undefined };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
