import { app } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  checkPythonModuleAvailability,
  type PythonModuleAvailabilityResult,
  type PythonRuntimeResolution,
} from '../../utils/pythonRuntime';
import { AppSettingsService } from '../appSettings';

const GROK_UI_PYTHONPATH = 'D:\\Grok\\Grok3API';

interface WorkerRequestEnvelope {
  requestId: string;
  command: string;
  payload?: Record<string, unknown>;
}

interface WorkerResponseEnvelope<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: string;
}

interface PendingRequest {
  resolve: (value: WorkerResponseEnvelope) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export class GrokUiPythonBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private lineReader: readline.Interface | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private startPromise: Promise<void> | null = null;
  private runtime: PythonRuntimeResolution | null = null;

  async ensureStarted(): Promise<void> {
    if (this.proc) {
      return;
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async request<T = unknown>(
    command: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<WorkerResponseEnvelope<T>> {
    await this.ensureStarted();

    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error('Grok UI worker is not writable');
    }

    const requestId = `${Date.now()}-${++this.requestCounter}`;
    const envelope: WorkerRequestEnvelope = { requestId, command, payload };

    return new Promise<WorkerResponseEnvelope<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request timeout (${command}) after ${timeoutMs}ms`));
      }, Math.max(1, timeoutMs));

      this.pending.set(requestId, { resolve: resolve as any, reject, timer });

      try {
        this.proc!.stdin.write(`${JSON.stringify(envelope)}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  getRuntimeInfo(): PythonModuleAvailabilityResult | null {
    if (!this.runtime) {
      return null;
    }
    return {
      success: true,
      runtime: this.runtime,
      mode: this.runtime.mode,
      modules: {
        grok3api: true,
        undetected_chromedriver: true,
      },
    };
  }

  async shutdown(): Promise<void> {
    if (!this.proc) {
      return;
    }

    try {
      await this.request('shutdown', {}, 5000);
    } catch {
      // ignore
    }

    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill();
      } catch {
        // no-op
      }
    }

    this.cleanupProcess();
  }

  private async startInternal(): Promise<void> {
    const pythonPath = this.buildPythonPath();
    const availability = await this.withPythonPath(pythonPath, () =>
      checkPythonModuleAvailability(['grok3api', 'undetected_chromedriver'], { preferredVersion: '3.12' })
    );

    if (!availability.success || !availability.runtime) {
      throw new Error(`${availability.errorCode || 'PYTHON_MODULE_MISSING'}: ${availability.error || 'Python runtime unavailable'}`);
    }

    this.runtime = availability.runtime;

    const workerPath = this.resolveWorkerPath();
    const args = [...availability.runtime.baseArgs, '-u', workerPath];

    const settings = AppSettingsService.getAll();
    const isAnonymous = settings.grokUiAnonymous === true;
    const profileDir = !isAnonymous ? settings.grokUiProfileDir?.trim() : '';
    const profileName = !isAnonymous ? settings.grokUiProfileName?.trim() : '';

    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
      PYTHONPATH: pythonPath,
      ...(profileDir ? { GROK_CHROME_PROFILE_DIR: profileDir } : {}),
      ...(profileName ? { GROK_CHROME_PROFILE_NAME: profileName } : {}),
    };

    this.proc = spawn(availability.runtime.command, args, { windowsHide: true, env });
    this.lineReader = readline.createInterface({ input: this.proc.stdout });

    this.lineReader.on('line', (line) => this.onStdoutLine(line));
    this.proc.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        console.warn('[GrokUiPythonBridge][stderr]', line);
      }
    });

    this.proc.on('error', (error) => {
      this.failAllPending(`Worker process error: ${String(error)}`);
      this.cleanupProcess();
    });

    this.proc.on('close', (code) => {
      this.failAllPending(`Worker process closed unexpectedly (code=${code ?? 'null'})`);
      this.cleanupProcess();
    });
  }

  private onStdoutLine(line: string): void {
    const raw = line.trim();
    if (!raw) {
      return;
    }

    let parsed: WorkerResponseEnvelope;
    try {
      parsed = JSON.parse(raw) as WorkerResponseEnvelope;
    } catch {
      console.warn('[GrokUiPythonBridge] Non-JSON output from worker:', raw);
      return;
    }

    if (!parsed.requestId) {
      return;
    }

    const pending = this.pending.get(parsed.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(parsed.requestId);
    pending.resolve(parsed);
  }

  private resolveWorkerPath(): string {
    const appPath = app.getAppPath();
    const candidates = [
      path.join(process.resourcesPath || '', 'grokUi', 'python', 'grok_ui_worker.py'),
      path.join(process.resourcesPath || '', 'python', 'grok_ui_worker.py'),
      path.join(appPath, 'src', 'main', 'services', 'grokUi', 'python', 'grok_ui_worker.py'),
      path.join(process.cwd(), 'src', 'main', 'services', 'grokUi', 'python', 'grok_ui_worker.py'),
      path.join(appPath, 'out', 'main', 'services', 'grokUi', 'python', 'grok_ui_worker.py'),
      path.join(appPath, 'dist', 'main', 'src', 'main', 'services', 'grokUi', 'python', 'grok_ui_worker.py'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Grok UI worker script not found. Checked: ${candidates.join(' | ')}`);
  }

  private buildPythonPath(): string {
    const existing = process.env.PYTHONPATH;
    if (existing && existing.trim().length > 0) {
      return `${GROK_UI_PYTHONPATH}${path.delimiter}${existing}`;
    }
    return GROK_UI_PYTHONPATH;
  }

  private async withPythonPath<T>(pythonPath: string, task: () => Promise<T>): Promise<T> {
    const prev = process.env.PYTHONPATH;
    process.env.PYTHONPATH = pythonPath;
    try {
      return await task();
    } finally {
      if (prev === undefined) {
        delete process.env.PYTHONPATH;
      } else {
        process.env.PYTHONPATH = prev;
      }
    }
  }

  private failAllPending(message: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private cleanupProcess(): void {
    if (this.lineReader) {
      this.lineReader.close();
      this.lineReader = null;
    }
    this.proc = null;
  }
}
