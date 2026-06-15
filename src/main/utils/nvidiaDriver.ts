import { spawnSync } from 'child_process';

const NVIDIA_SMI_MIN_DRIVER = 610;

let cachedDriverVersion: number | null | undefined = undefined;

function parseNvidiaSmiVersion(output: string): number | null {
  const lines = output.trim().split(/\r?\n/);
  for (const line of lines) {
    const cleaned = line.trim();
    const match = cleaned.match(/^(\d+\.\d+)/);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  return null;
}

function parseWmiDriverVersion(version: string): number | null {
  const parts = version.split('.');
  if (parts.length >= 4) {
    const build = parseInt(parts[3], 10);
    if (!isNaN(build) && build > 0) {
      return build / 100;
    }
    const variant = parseInt(parts[2], 10);
    if (!isNaN(variant) && variant > 0) {
      return variant;
    }
  }
  return null;
}

function getDriverVersionFromNvidiaSmi(): number | null {
  try {
    const result = spawnSync('nvidia-smi', ['--query-gpu=driver_version', '--format=csv,noheader'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      return parseNvidiaSmiVersion(result.stdout);
    }
  } catch {}
  return null;
}

function getDriverVersionFromWmi(): number | null {
  try {
    const result = spawnSync('wmic', ['path', 'win32_VideoController', 'get', 'DriverVersion'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const lines = result.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (/^\d/.test(line)) {
          return parseWmiDriverVersion(line);
        }
      }
    }
  } catch {}
  return null;
}

export function getNvidiaDriverVersion(): number | null {
  if (cachedDriverVersion !== undefined) {
    return cachedDriverVersion;
  }

  let version = getDriverVersionFromNvidiaSmi();
  if (version == null) {
    version = getDriverVersionFromWmi();
  }

  cachedDriverVersion = version;
  return version;
}

export function isNvencDriverSufficient(driverVersion?: number): boolean {
  const dv = driverVersion ?? getNvidiaDriverVersion();
  if (dv == null) return true;
  return dv >= NVIDIA_SMI_MIN_DRIVER;
}

export function getRequiredDriverVersion(): number {
  return NVIDIA_SMI_MIN_DRIVER;
}
