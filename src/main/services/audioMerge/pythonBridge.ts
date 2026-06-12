import { spawn } from 'child_process';
import { app } from 'electron';
import * as path from 'path';
import { existsSync } from 'fs';
import { getFFmpegPath } from '../../utils/ffmpegPath';
import { resolvePythonRuntime } from '../../utils/pythonRuntime';

export interface BatchMergeResult {
  success: boolean;
  error?: string;
}

export async function runAudioMergeWorker(
  files: Array<{ path: string; startMs: number }>,
  outputPath: string,
  totalDurationMs: number
): Promise<BatchMergeResult> {
  if (files.length === 0) {
    return { success: false, error: 'No files provided' };
  }

  const runtime = resolvePythonRuntime();
  const ffmpegPath = resolveFfmpegForWorker();

  const workerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'audioMerge', 'python', 'audio_merge_worker.py')
    : path.join(app.getAppPath(), 'src', 'main', 'services', 'audioMerge', 'python', 'audio_merge_worker.py');

  if (!existsSync(workerPath)) {
    return { success: false, error: `Worker script not found: ${workerPath}` };
  }

  const ext = path.extname(outputPath).toLowerCase();
  const codecArgs = ext === '.wav'
    ? ['-c:a', 'pcm_s16le']
    : ['-c:a', 'libmp3lame', '-b:a', '192k'];

  const payload = {
    files: files.map(f => ({ path: f.path, startMs: Math.max(0, f.startMs) })),
    outputPath,
    sampleRate: 24000,
    channels: 1,
    codecArgs,
    totalDurationMs: Math.max(1, totalDurationMs),
    ffmpegPath,
  };

  return new Promise((resolve) => {
    const proc = spawn(runtime.command, [...runtime.baseArgs, workerPath], {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    proc.stdin.write(JSON.stringify(payload) + '\n');
    proc.stdin.end();

    let stderr = '';
    let buffer = '';

    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.event === 'error') {
            console.error(`[AudioMerge][Worker] ${event.message}`);
          } else if (event.event === 'progress' && event.error) {
            console.warn(`[AudioMerge][Worker] File error: ${event.error}`);
          }
        } catch {
          // non-JSON output - ignore
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        const errorMsg = stderr.trim() || `Worker exited with code ${code}`;
        resolve({ success: false, error: errorMsg });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: `Failed to spawn worker: ${err.message}` });
    });
  });
}

function resolveFfmpegForWorker(): string {
  const ffmpegPath = getFFmpegPath();
  if (ffmpegPath && existsSync(ffmpegPath)) {
    return ffmpegPath;
  }
  return 'ffmpeg';
}
