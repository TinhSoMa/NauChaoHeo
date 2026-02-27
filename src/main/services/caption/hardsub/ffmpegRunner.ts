import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { RenderResult } from '../../../../shared/types/caption';
import { getFFmpegPath } from '../../../utils/ffmpegPath';
import { unregisterTempFile } from '../garbageCollector';
import { RunFFmpegProcessOptions } from './types';

export function runFFmpegProcess(options: RunFFmpegProcessOptions): Promise<RenderResult> {
  const ffmpegPath = getFFmpegPath();

  return new Promise((resolve) => {
    const process = spawn(ffmpegPath, options.args);
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
      try {
        unregisterTempFile(options.tempAssPath);
        await fs.unlink(options.tempAssPath);
      } catch {}

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
        message: `Lỗi render: ${stderr.substring(0, 200)}`,
      });
      resolve({ success: false, error: stderr || `FFmpeg exit code: ${code}` });
    });

    process.on('error', async (error) => {
      try {
        unregisterTempFile(options.tempAssPath);
        await fs.unlink(options.tempAssPath);
      } catch {}
      resolve({ success: false, error: `Lỗi FFmpeg: ${error.message}` });
    });
  });
}

