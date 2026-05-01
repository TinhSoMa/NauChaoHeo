import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs/promises';
import { RenderResult } from '../../../../shared/types/caption';
import { getFFmpegPath } from '../../../utils/ffmpegPath';
import { unregisterTempFile } from '../garbageCollector';
import { RunFFmpegProcessOptions } from './types';

const RENDER_STOPPED_MESSAGE = 'Đã dừng render theo yêu cầu.';
let activeRenderProcess: ChildProcessWithoutNullStreams | null = null;
let stopRequested = false;

function summarizeFfmpegError(stderr: string): string {
  const text = (stderr || '').trim();
  if (!text) {
    return 'FFmpeg render thất bại.';
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return 'FFmpeg render thất bại.';
  }
  const important = lines.filter((line) =>
    /(error|failed|invalid|cannot|unable|no such|not found|could not)/i.test(line)
  );
  const source = important.length > 0 ? important : lines;
  const picked = [source[0], ...source.slice(-3)].filter((line, index, arr) => !!line && arr.indexOf(line) === index);
  return picked.join(' | ');
}

export function requestStopCurrentRender(): { requested: boolean; hadActiveProcess: boolean } {
  stopRequested = true;
  const hadActiveProcess = !!activeRenderProcess && !activeRenderProcess.killed;
  if (hadActiveProcess) {
    try {
      activeRenderProcess!.kill('SIGKILL');
    } catch {}
  }
  return { requested: true, hadActiveProcess };
}

export function clearRenderStopRequest(): void {
  stopRequested = false;
}

export function isRenderInProgress(): boolean {
  return !!activeRenderProcess && !activeRenderProcess.killed;
}

export function runFFmpegProcess(options: RunFFmpegProcessOptions): Promise<RenderResult> {
  const ffmpegPath = getFFmpegPath();

  const cleanupTempFiles = async (): Promise<void> => {
    try {
      unregisterTempFile(options.tempAssPath);
      await fs.unlink(options.tempAssPath);
    } catch {}

    for (const extraPath of options.cleanupTempPaths || []) {
      if (!extraPath) {
        continue;
      }
      try {
        await fs.unlink(extraPath);
      } catch {}
    }
  };

  return new Promise((resolve) => {
    const process = spawn(ffmpegPath, options.args);
    activeRenderProcess = process;
    let stderr = '';

    process.stderr.on('data', (data) => {
      const line = data.toString();
      stderr += line;

      const frameMatch = line.match(/frame=\s*(\d+)/);
      if (frameMatch && options.progressCallback) {
        const currentFrame = parseInt(frameMatch[1], 10);
        const percent = Math.min(100, Math.round((currentFrame / options.totalFrames) * 100));
        options.progressCallback({
          currentFrame,
          totalFrames: options.totalFrames,
          fps: options.fps,
          percent,
          status: 'rendering',
          message: `Đang render: ${percent}%`,
        });
      }
    });

    process.on('close', async (code) => {
      const wasStoppedByUser = stopRequested;
      activeRenderProcess = null;
      stopRequested = false;
      await cleanupTempFiles();

      if (wasStoppedByUser) {
        options.progressCallback?.({
          currentFrame: 0,
          totalFrames: options.totalFrames,
          fps: 0,
          percent: 0,
          status: 'stopped',
          message: RENDER_STOPPED_MESSAGE,
        });
        resolve({ success: false, error: RENDER_STOPPED_MESSAGE });
        return;
      }

      if (code === 0) {
        options.progressCallback?.({
          currentFrame: options.totalFrames,
          totalFrames: options.totalFrames,
          fps: options.fps,
          percent: 100,
          status: 'completed',
          message: 'Hoàn thành!',
        });
        resolve({ success: true, outputPath: options.outputPath, duration: options.duration });
        return;
      }

      options.progressCallback?.({
        currentFrame: 0,
        totalFrames: options.totalFrames,
        fps: 0,
        percent: 0,
        status: 'error',
        message: `Lỗi render: ${summarizeFfmpegError(stderr)}`,
      });
      const debugLabel = options.debugLabel || 'render';
      if (stderr.trim()) {
        if (options.includeFullStderrOnError) {
          console.error(`[FFmpeg][${debugLabel}] Command failed`, {
            args: options.args,
            stderr,
          });
        } else {
          console.error(`[FFmpeg][${debugLabel}] Command failed`, {
            args: options.args,
            stderrTail: stderr.slice(-4000),
          });
        }
      } else {
        console.error(`[FFmpeg][${debugLabel}] Command failed with empty stderr`, {
          args: options.args,
        });
      }
      resolve({
        success: false,
        error: summarizeFfmpegError(stderr) || `FFmpeg exit code: ${code}`,
      });
    });

    process.on('error', async (error) => {
      const wasStoppedByUser = stopRequested;
      activeRenderProcess = null;
      stopRequested = false;
      await cleanupTempFiles();
      if (wasStoppedByUser) {
        resolve({ success: false, error: RENDER_STOPPED_MESSAGE });
        return;
      }
      resolve({ success: false, error: `Lỗi FFmpeg: ${error.message}` });
    });
  });
}

