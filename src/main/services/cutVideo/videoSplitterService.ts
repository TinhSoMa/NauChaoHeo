import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getFFmpegPath } from '../../utils/ffmpegPath';

export interface VideoSplitOptions {
  inputPath: string;
  clips: {
    name: string;
    startStr: string;
    durationStr: string;
  }[];
  onProgress?: (progressData: { 
    totalPercent: number; 
    currentClipName: string; 
    currentPercent: number;
  }) => void;
  onLog?: (log: { clipName: string; status: string; time: string }) => void;
}

export interface VideoSplitResult {
  success: boolean;
  error?: string;
}

export class VideoSplitterService {
  private isStopped = false;

  stop() {
    this.isStopped = true;
  }

  private runFFmpegCommand(args: string[], onStdout?: (data: string) => void, onStderr?: (data: string) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      const ffmpegPath = getFFmpegPath();
      const proc = spawn(ffmpegPath, args, { windowsHide: true });

      proc.stdout?.on('data', (data) => {
        if (onStdout) onStdout(data.toString());
      });

      proc.stderr?.on('data', (data) => {
        if (onStderr) onStderr(data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });
  }

  async splitVideo(options: VideoSplitOptions): Promise<VideoSplitResult> {
    this.isStopped = false;
    const { inputPath, clips, onProgress, onLog } = options;

    if (!fs.existsSync(inputPath)) {
      return { success: false, error: 'File không tồn tại' };
    }

    try {
      const sourceDir = path.dirname(inputPath);
      const outputDir = path.join(sourceDir, 'cut_video');

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const totalClips = clips.length;

      for (let i = 0; i < totalClips; i++) {
        if (this.isStopped) {
            if (onLog) onLog({ clipName: '---', status: 'error', time: '--:--' });
            break;
        }

        const clip = clips[i];
        
        // Report starting
        if (onProgress) {
          onProgress({
            totalPercent: Math.round(((i) / totalClips) * 100),
            currentClipName: clip.name,
            currentPercent: 0
          });
        }
        if (onLog) {
           onLog({ clipName: clip.name, status: 'processing', time: '--:--' });
        }

        // e.g. .mp4
        const ext = path.extname(inputPath);
        // Ensure standard clean filename
        const safeName = clip.name.replace(/[^a-z0-9_\-\.]/gi, '_');

        const outputPath = path.join(outputDir, `${safeName}${ext}`);

        // Example FFmpeg: ffmpeg -y -ss 00:00:10 -i input.mp4 -t 00:01:00 -c copy output.mp4
        // Use very fast exact stream copy
        const args = [
          '-y',
          '-ss', clip.startStr,
          '-i', inputPath,
          '-t', clip.durationStr,
          '-c', 'copy',
          outputPath
        ];

        try {
          await this.runFFmpegCommand(args, undefined, (stderr) => {
             // For copy, things are so fast we might not catch fine-grained progress. 
             // Just letting it run silently for progress.
          });
          
          if (onLog) {
            onLog({ clipName: clip.name, status: 'completed', time: new Date().toISOString() });
          }
        } catch (err: any) {
          console.error(`Clip extract error for ${clip.name}:`, err);
          if (onLog) {
             onLog({ clipName: clip.name, status: 'error', time: new Date().toISOString() });
          }
        }

        if (onProgress) {
          onProgress({
            totalPercent: Math.round(((i + 1) / totalClips) * 100),
            currentClipName: clip.name,
            currentPercent: 100
          });
        }
      }

      this.isStopped = false;
      return { success: true };
    } catch (err: any) {
      this.isStopped = false;
      return { success: false, error: err.message };
    }
  }
}

export const videoSplitterService = new VideoSplitterService();
