import { spawn } from 'child_process';
import * as fsSync from 'fs';
import { getFFmpegPath } from '../../utils/ffmpegPath';

export interface SilenceInterval {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface DetectSilenceOptions {
  inputPath: string;
  noiseDb?: number;
  minDurationSec?: number;
  durationSec?: number;
}

export interface DetectSilenceResult {
  success: boolean;
  data?: {
    durationSec: number;
    silences: SilenceInterval[];
  };
  error?: string;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

export async function detectSilences(options: DetectSilenceOptions): Promise<DetectSilenceResult> {
  const inputPath = options.inputPath;
  if (!inputPath || !fsSync.existsSync(inputPath)) {
    return { success: false, error: 'File không tồn tại.' };
  }

  const ffmpegPath = getFFmpegPath();
  if (!fsSync.existsSync(ffmpegPath)) {
    return { success: false, error: `FFmpeg không tìm thấy: ${ffmpegPath}` };
  }

  const noiseDb = Number.isFinite(options.noiseDb) ? (options.noiseDb as number) : -35;
  const minDurationSec = Number.isFinite(options.minDurationSec) ? (options.minDurationSec as number) : 0.4;
  const durationSec = options.durationSec && options.durationSec > 0 ? options.durationSec : 0;

  const noiseArg = clamp(noiseDb, -80, -10);
  const minDurArg = clamp(minDurationSec, 0.1, 10);

  const args = [
    '-hide_banner',
    '-nostats',
    '-i', inputPath,
    '-vn',
    '-sn',
    '-af', `silencedetect=noise=${noiseArg}dB:d=${minDurArg}`,
    '-f', 'null',
    '-'
  ];

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    const silences: Array<{ startSec: number; endSec?: number; durationSec?: number }> = [];

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
      if (startMatch) {
        const startSec = Number(startMatch[1]);
        if (Number.isFinite(startSec)) {
          silences.push({ startSec });
        }
        return;
      }

      const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
      if (endMatch) {
        const endSec = Number(endMatch[1]);
        const durSec = Number(endMatch[2]);
        if (Number.isFinite(endSec)) {
          const lastOpen = [...silences].reverse().find((s) => s.endSec == null);
          if (lastOpen) {
            lastOpen.endSec = endSec;
            if (Number.isFinite(durSec)) {
              lastOpen.durationSec = durSec;
            }
          } else {
            silences.push({ startSec: Math.max(0, endSec - (Number.isFinite(durSec) ? durSec : 0)), endSec, durationSec: durSec });
          }
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: `FFmpeg exit code ${code}` });
        return;
      }

      const finalized: SilenceInterval[] = [];
      for (const item of silences) {
        const startSec = item.startSec;
        const endSecCandidate = item.endSec ?? (durationSec > 0 ? durationSec : null);
        if (!Number.isFinite(startSec) || typeof endSecCandidate !== 'number' || !Number.isFinite(endSecCandidate)) {
          continue;
        }
        const endSec = endSecCandidate;
        if (endSec <= startSec) {
          continue;
        }
        finalized.push({
          startSec,
          endSec,
          durationSec: Number.isFinite(item.durationSec) ? (item.durationSec as number) : endSec - startSec,
        });
      }

      finalized.sort((a, b) => a.startSec - b.startSec);
      resolve({ success: true, data: { durationSec, silences: finalized } });
    });

    proc.on('error', (error) => {
      resolve({ success: false, error: `Không thể chạy FFmpeg: ${error.message}` });
    });
  });
}
