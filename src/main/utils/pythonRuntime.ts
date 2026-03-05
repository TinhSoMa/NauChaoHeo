import { app } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export interface PythonRuntimeResolution {
  command: string;
  baseArgs: string[];
  mode: 'embedded' | 'system';
  pythonPath: string;
  installHint?: string;
}

export interface PythonRuntimeCheckResult {
  success: boolean;
  runtime?: PythonRuntimeResolution;
  error?: string;
  mode?: 'embedded' | 'system';
}

export interface PythonModuleAvailabilityOptions {
  preferredVersion?: string;
}

export interface PythonModuleAvailabilityResult {
  success: boolean;
  runtime?: PythonRuntimeResolution;
  error?: string;
  mode?: 'embedded' | 'system';
  modules?: Record<string, boolean>;
  errorCode?: 'PYTHON_RUNTIME_MISSING' | 'PYTHON_MODULE_MISSING';
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export function getEmbeddedPythonPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python', 'python.exe');
  }
  return path.join(app.getAppPath(), 'resources', 'python', 'win32-x64', 'runtime', 'python.exe');
}

export function resolvePythonRuntime(): PythonRuntimeResolution {
  const embeddedPath = getEmbeddedPythonPath();
  if (existsSync(embeddedPath)) {
    return {
      command: embeddedPath,
      baseArgs: [],
      mode: 'embedded',
      pythonPath: embeddedPath,
    };
  }

  if (app.isPackaged) {
    return {
      command: embeddedPath,
      baseArgs: [],
      mode: 'embedded',
      pythonPath: embeddedPath,
    };
  }

  return {
    command: 'py',
    baseArgs: ['-3'],
    mode: 'system',
    pythonPath: 'py -3',
    installHint: 'py -3 -m pip install pycapcut',
  };
}

export async function checkPycapcutAvailability(): Promise<PythonRuntimeCheckResult> {
  const preferredRuntime = resolvePythonRuntime();

  if (preferredRuntime.mode === 'embedded') {
    const versionCheck = await runCommand(preferredRuntime.command, ['--version'], preferredRuntime.mode);
    if (versionCheck.code !== 0) {
      return {
        success: false,
        mode: 'embedded',
        error: app.isPackaged
          ? 'Runtime Python nhúng bị thiếu/hỏng, cần cài lại app.'
          : `Không thể chạy Python embedded: ${(versionCheck.stderr || versionCheck.error || versionCheck.stdout || '').trim()}`,
      };
    }

    const pycapcutCheck = await runCommand(
      preferredRuntime.command,
      [...preferredRuntime.baseArgs, '-c', 'import pycapcut'],
      preferredRuntime.mode,
    );
    if (pycapcutCheck.code !== 0) {
      return {
        success: false,
        mode: 'embedded',
        error: app.isPackaged
          ? 'Runtime Python nhúng bị thiếu pycapcut, cần cài lại app.'
          : `Python embedded chưa có pycapcut: ${(pycapcutCheck.stderr || pycapcutCheck.error || pycapcutCheck.stdout || '').trim()}`,
      };
    }

    return {
      success: true,
      runtime: preferredRuntime,
      mode: preferredRuntime.mode,
    };
  }

  const launcherCheck = await runCommand('py', ['-3', '--version'], 'system');
  if (launcherCheck.code === 0) {
    const runtime: PythonRuntimeResolution = {
      command: 'py',
      baseArgs: ['-3'],
      mode: 'system',
      pythonPath: 'py -3',
      installHint: 'py -3 -m pip install pycapcut',
    };
    const pycapcutCheck = await runCommand(runtime.command, [...runtime.baseArgs, '-c', 'import pycapcut'], runtime.mode);
    if (pycapcutCheck.code !== 0) {
      return { success: false, mode: 'system', error: `Thiếu pycapcut. Cài bằng lệnh: ${runtime.installHint}` };
    }
    return { success: true, runtime, mode: runtime.mode };
  }

  const pythonCheck = await runCommand('python', ['--version'], 'system');
  if (pythonCheck.code === 0) {
    const runtime: PythonRuntimeResolution = {
      command: 'python',
      baseArgs: [],
      mode: 'system',
      pythonPath: 'python',
      installHint: 'python -m pip install pycapcut',
    };
    const pycapcutCheck = await runCommand(runtime.command, [...runtime.baseArgs, '-c', 'import pycapcut'], runtime.mode);
    if (pycapcutCheck.code !== 0) {
      return { success: false, mode: 'system', error: `Thiếu pycapcut. Cài bằng lệnh: ${runtime.installHint}` };
    }
    return { success: true, runtime, mode: runtime.mode };
  }

  if (app.isPackaged) {
    return { success: false, mode: 'embedded', error: 'Runtime Python nhúng bị thiếu/hỏng, cần cài lại app.' };
  }
  return { success: false, mode: 'system', error: 'Không tìm thấy Python (py -3 hoặc python) trong PATH.' };
}

export async function checkPythonModuleAvailability(
  modules: string[],
  options: PythonModuleAvailabilityOptions = {},
): Promise<PythonModuleAvailabilityResult> {
  const normalizedModules = Array.from(new Set(modules.map((value) => value.trim()).filter(Boolean)));
  if (normalizedModules.length === 0) {
    return {
      success: false,
      errorCode: 'PYTHON_MODULE_MISSING',
      error: 'No Python modules were provided for availability check.',
    };
  }

  const runtimes = await resolvePythonRuntimeCandidates(options.preferredVersion ?? '3.12');
  if (runtimes.length === 0) {
    return {
      success: false,
      mode: app.isPackaged ? 'embedded' : 'system',
      errorCode: 'PYTHON_RUNTIME_MISSING',
      error: app.isPackaged
        ? 'Runtime Python nhúng bị thiếu/hỏng, cần cài lại app.'
        : 'Không tìm thấy Python runtime phù hợp (ưu tiên py -3.12).',
    };
  }

  const importScript = normalizedModules.map((name) => `import ${name}`).join('; ');
  let lastModuleFailure: { runtime: PythonRuntimeResolution; modules: Record<string, boolean>; detail: string } | null = null;

  for (const runtime of runtimes) {
    const result = await runCommand(runtime.command, [...runtime.baseArgs, '-c', importScript], runtime.mode);
    if (result.code === 0) {
      const okModules: Record<string, boolean> = {};
      for (const name of normalizedModules) {
        okModules[name] = true;
      }
      return {
        success: true,
        runtime,
        mode: runtime.mode,
        modules: okModules,
      };
    }

    const moduleFlags: Record<string, boolean> = {};
    const detailText = `${result.stderr || result.error || result.stdout || ''}`.toLowerCase();
    for (const name of normalizedModules) {
      moduleFlags[name] = !detailText.includes(`no module named '${name.toLowerCase()}'`);
    }
    lastModuleFailure = {
      runtime,
      modules: moduleFlags,
      detail: (result.stderr || result.error || result.stdout || '').trim(),
    };
  }

  return {
    success: false,
    runtime: lastModuleFailure?.runtime,
    mode: lastModuleFailure?.runtime.mode ?? 'system',
    modules: lastModuleFailure?.modules,
    errorCode: 'PYTHON_MODULE_MISSING',
    error:
      lastModuleFailure?.detail ||
      `Thiếu module Python: ${normalizedModules.join(', ')}. Hãy cài lại bằng pip theo runtime đang dùng.`,
  };
}

async function resolvePythonRuntimeCandidates(preferredVersion: string): Promise<PythonRuntimeResolution[]> {
  const candidates: PythonRuntimeResolution[] = [];
  const embeddedPath = getEmbeddedPythonPath();

  if (existsSync(embeddedPath)) {
    candidates.push({
      command: embeddedPath,
      baseArgs: [],
      mode: 'embedded',
      pythonPath: embeddedPath,
      installHint: `${embeddedPath} -m pip install`,
    });
  } else if (app.isPackaged) {
    return [];
  }

  const preferred = preferredVersion.trim() || '3.12';
  const systemCandidates: PythonRuntimeResolution[] = [
    {
      command: 'py',
      baseArgs: [`-${preferred}`],
      mode: 'system',
      pythonPath: `py -${preferred}`,
      installHint: `py -${preferred} -m pip install`,
    },
    {
      command: 'py',
      baseArgs: ['-3'],
      mode: 'system',
      pythonPath: 'py -3',
      installHint: 'py -3 -m pip install',
    },
    {
      command: 'python',
      baseArgs: [],
      mode: 'system',
      pythonPath: 'python',
      installHint: 'python -m pip install',
    },
  ];

  for (const candidate of systemCandidates) {
    const check = await runCommand(candidate.command, [...candidate.baseArgs, '--version'], 'system');
    if (check.code === 0) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function runCommand(command: string, args: string[], mode: 'embedded' | 'system'): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const env =
      mode === 'embedded'
        ? {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONUTF8: '1',
          }
        : process.env;

    try {
      const proc = spawn(command, args, { windowsHide: true, env });
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      proc.on('error', (error) => {
        if (settled) return;
        settled = true;
        resolve({ code: -1, stdout, stderr, error: error.message });
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        resolve({ code, stdout, stderr });
      });
    } catch (error) {
      resolve({ code: -1, stdout, stderr, error: String(error) });
    }
  });
}
