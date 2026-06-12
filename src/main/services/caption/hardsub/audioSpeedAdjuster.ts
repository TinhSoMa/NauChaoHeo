import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { getFFmpegPath } from '../../../utils/ffmpegPath';
import { SpeedAdjustedAudioResult } from './types';

export function buildAtempoFilter(speed: number): string {
  let s = speed;
  const filters: string[] = [];
  while (s < 0.5) {
    filters.push('atempo=0.5');
    s /= 0.5;
  }
  while (s > 100.0) {
    filters.push('atempo=100.0');
    s /= 100.0;
  }
  if (Math.abs(s - 1.0) > 0.0001) {
    filters.push(`atempo=${s.toFixed(4)}`);
  }
  return filters.join(',');
}

function getAudioCodecArgs(audioPath: string): string[] {
  if (audioPath.toLowerCase().endsWith('.wav')) {
    return ['-c:a', 'pcm_s16le'];
  }
  return ['-c:a', 'libmp3lame', '-b:a', '192k'];
}

export async function buildSpeedAdjustedAudioFile(
  audioPath: string | undefined,
  audioSpeed: number
): Promise<SpeedAdjustedAudioResult> {
  if (!audioPath || !existsSync(audioPath)) {
    return { success: true, audioPath, generated: false };
  }

  if (!audioSpeed || Math.abs(audioSpeed - 1.0) < 0.0001) {
    return { success: true, audioPath, generated: false };
  }

  const atempo = buildAtempoFilter(audioSpeed);
  if (!atempo) {
    return { success: true, audioPath, generated: false };
  }

  const ffmpegPath = getFFmpegPath();
  if (!existsSync(ffmpegPath)) {
    return { success: false, generated: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }

  const ext = path.extname(audioPath) || '.wav';
  const speedLabel = audioSpeed.toFixed(2).replace('.', '_');
  const adjustedAudioPath = path.join(path.dirname(audioPath), `audio_${speedLabel}${ext}`);

  return new Promise((resolve) => {
    const args = [
      '-y',
      '-i', audioPath,
      '-af', atempo,
      ...getAudioCodecArgs(adjustedAudioPath),
      adjustedAudioPath,
    ];

    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      shell: false,
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[VideoRenderer] Đã tạo audio speed-adjusted: ${adjustedAudioPath} (speed=${audioSpeed})`);
        resolve({ success: true, audioPath: adjustedAudioPath, generated: true });
      } else {
        resolve({
          success: false,
          generated: false,
          error: stderr || `FFmpeg exit code: ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      resolve({ success: false, generated: false, error: `Lỗi ffmpeg speed-adjust: ${error.message}` });
    });
  });
}

