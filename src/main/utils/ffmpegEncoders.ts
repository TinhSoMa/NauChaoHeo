import { spawnSync } from 'child_process';
import { getFFmpegPath } from './ffmpegPath';

const encoderCache = new Map<string, { nvenc: boolean; qsv: boolean }>();

function parseEncoderList(output: string): { nvenc: boolean; qsv: boolean } {
  const lines = output.split(/\r?\n/);
  let nvenc = false;
  let qsv = false;
  for (const line of lines) {
    if (/h264_nvenc\b/.test(line)) nvenc = true;
    if (/h264_qsv\b/.test(line)) qsv = true;
    if (nvenc && qsv) break;
  }
  return { nvenc, qsv };
}

export function getAvailableHardwareEncoders(ffmpegPath?: string): { nvenc: boolean; qsv: boolean } {
  const resolvedPath = ffmpegPath || getFFmpegPath();
  const cached = encoderCache.get(resolvedPath);
  if (cached) {
    return cached;
  }

  try {
    const result = spawnSync(resolvedPath, ['-encoders'], {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    if (result.status !== 0 || result.error) {
      const empty = { nvenc: false, qsv: false };
      encoderCache.set(resolvedPath, empty);
      return empty;
    }
    const encoders = parseEncoderList(result.stdout || result.stderr || '');
    encoderCache.set(resolvedPath, encoders);
    return encoders;
  } catch {
    const empty = { nvenc: false, qsv: false };
    encoderCache.set(resolvedPath, empty);
    return empty;
  }
}

export function detectBestEncoder(ffmpegPath?: string): 'nvenc' | 'qsv' | 'none' {
  const encoders = getAvailableHardwareEncoders(ffmpegPath);
  if (encoders.nvenc) return 'nvenc';
  if (encoders.qsv) return 'qsv';
  return 'none';
}
