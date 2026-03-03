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
