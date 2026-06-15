import { app } from 'electron';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { getNvidiaDriverVersion, isNvencDriverSufficient } from './nvidiaDriver';

const LEGACY_FFMPEG_BUILD_TAG = '2024-06-01';
const LEGACY_FFMPEG_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${LEGACY_FFMPEG_BUILD_TAG}/ffmpeg-master-latest-win64-gpl.zip`;

function getLegacyDir(): string {
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg-nvenc');
  }
  return path.join(app.getAppPath(), 'resources', 'ffmpeg-nvenc', 'win64');
}

export function getLegacyFFmpegPath(): string {
  return path.join(getLegacyDir(), 'ffmpeg.exe');
}

export function getLegacyFFprobePath(): string {
  return path.join(getLegacyDir(), 'ffprobe.exe');
}

export function isLegacyFFmpegReady(): boolean {
  return existsSync(getLegacyFFmpegPath()) && existsSync(getLegacyFFprobePath());
}

function verifyFFmpegWorks(ffmpegPath: string): boolean {
  try {
    const result = spawnSync(ffmpegPath, ['-version'], {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function extractZip(zipPath: string, destDir: string): boolean {
  try {
    const result = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ], {
      encoding: 'utf-8',
      timeout: 60000,
      windowsHide: true,
    });
    if (result.status !== 0) {
      console.warn('[FFmpegSetup] Expand-Archive failed, trying tar fallback');
      const tarResult = spawnSync('tar', ['-xf', zipPath, '-C', destDir], {
        encoding: 'utf-8',
        timeout: 60000,
        windowsHide: true,
      });
      return tarResult.status === 0;
    }
    return true;
  } catch (error) {
    console.error('[FFmpegSetup] Extract failed:', error);
    return false;
  }
}

function findFFmpegInExtracted(baseDir: string): boolean {
  const searchDirs = [
    baseDir,
    path.join(baseDir, 'ffmpeg-master-latest-win64-gpl', 'bin'),
    path.join(baseDir, 'bin'),
  ];
  for (const dir of searchDirs) {
    const ffmpeg = path.join(dir, 'ffmpeg.exe');
    const ffprobe = path.join(dir, 'ffprobe.exe');
    if (existsSync(ffmpeg) && existsSync(ffprobe)) {
      const targetDir = getLegacyDir();
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      try {
        spawnSync('cmd', ['/c', 'copy', '/Y', ffmpeg, path.join(targetDir, 'ffmpeg.exe')]);
        spawnSync('cmd', ['/c', 'copy', '/Y', ffprobe, path.join(targetDir, 'ffprobe.exe')]);
      } catch {}
      return existsSync(getLegacyFFmpegPath());
    }
  }
  return false;
}

let downloadInProgress = false;

export async function ensureLegacyFFmpeg(): Promise<boolean> {
  if (isLegacyFFmpegReady()) {
    if (verifyFFmpegWorks(getLegacyFFmpegPath())) {
      return true;
    }
    console.warn('[FFmpegSetup] Legacy FFmpeg exists but broken, re-downloading');
  }

  if (downloadInProgress) {
    console.log('[FFmpegSetup] Download already in progress, waiting...');
    while (downloadInProgress) {
      await new Promise(r => setTimeout(r, 1000));
    }
    return isLegacyFFmpegReady();
  }

  downloadInProgress = true;
  try {
    const tmpDir = path.join(app.getPath('temp'), 'nauchaoheo-ffmpeg-nvenc');
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }
    const zipPath = path.join(tmpDir, 'ffmpeg.zip');

    console.log(`[FFmpegSetup] Downloading legacy FFmpeg from ${LEGACY_FFMPEG_URL}`);
    const response = await fetch(LEGACY_FFMPEG_URL);
    if (!response.ok || !response.body) {
      console.error(`[FFmpegSetup] Download failed: ${response.status}`);
      return false;
    }

    const fileStream = createWriteStream(zipPath);
    const reader = response.body.getReader();

    let downloaded = 0;
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.length;
        fileStream.write(Buffer.from(value));
      }
      fileStream.end();
    };
    await pump();

    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    if (!existsSync(zipPath)) {
      console.error('[FFmpegSetup] Download failed: zip not found');
      return false;
    }

    const extractDir = path.join(tmpDir, 'extracted');
    if (!existsSync(extractDir)) {
      mkdirSync(extractDir, { recursive: true });
    }

    if (!extractZip(zipPath, extractDir)) {
      console.error('[FFmpegSetup] Extract failed');
      return false;
    }

    if (!findFFmpegInExtracted(extractDir)) {
      console.error('[FFmpegSetup] Could not find ffmpeg.exe in extracted files');
      return false;
    }

    const cleansed = verifyFFmpegWorks(getLegacyFFmpegPath());
    if (!cleansed) {
      console.error('[FFmpegSetup] Downloaded FFmpeg fails verification');
      return false;
    }

    console.log('[FFmpegSetup] Legacy FFmpeg ready');
    return true;
  } catch (error) {
    console.error('[FFmpegSetup] Error:', error);
    return false;
  } finally {
    downloadInProgress = false;
  }
}

export async function initFFmpeg(): Promise<void> {
  const driverVersion = getNvidiaDriverVersion();
  if (driverVersion != null && !isNvencDriverSufficient(driverVersion)) {
    console.log(`[FFmpegSetup] NVIDIA driver ${driverVersion} < ${610}, need legacy FFmpeg`);
    const ready = await ensureLegacyFFmpeg();
    if (ready) {
      console.log('[FFmpegSetup] Legacy FFmpeg ready for NVENC on old driver');
    } else {
      console.warn('[FFmpegSetup] Could not get legacy FFmpeg, NVENC will fallback to software');
    }
  }
}
