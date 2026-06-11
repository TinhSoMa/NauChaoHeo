import { spawnSync } from 'child_process';
import { getFFmpegPath } from './ffmpegPath';

let cachedEncoders: { nvenc: boolean; qsv: boolean } | null = null;

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

export function getAvailableHardwareEncoders(): { nvenc: boolean; qsv: boolean } {
  if (cachedEncoders) {
    return cachedEncoders;
  }

  const ffmpegPath = getFFmpegPath();
  try {
    const result = spawnSync(ffmpegPath, ['-encoders'], {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    if (result.status !== 0 || result.error) {
      cachedEncoders = { nvenc: false, qsv: false };
      return cachedEncoders;
    }
    cachedEncoders = parseEncoderList(result.stdout || result.stderr || '');
  } catch {
    cachedEncoders = { nvenc: false, qsv: false };
  }
  return cachedEncoders;
}

export function detectBestEncoder(): 'nvenc' | 'qsv' | 'none' {
  const encoders = getAvailableHardwareEncoders();
  if (encoders.nvenc) return 'nvenc';
  if (encoders.qsv) return 'qsv';
  return 'none';
}
