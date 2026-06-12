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
import { GrokUiProfileDatabase } from '../../database/grokUiProfileDatabase';

const GROK_UI_DEV_PYTHONPATH = 'D:\\Grok\\Grok3API';

interface WorkerRequestEnvelope {
  requestId: string;
  command: string;
  payload?: Record<string, unknown>;
}

interface WorkerResponseEnvelope<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: unknown;
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

  async shutdown(options?: { hard?: boolean }): Promise<void> {
    if (!this.proc) {
      return;
    }

    const hard = options?.hard === true;

    try {
      if (!hard) {
        await this.request('shutdown', {}, 5000);
      }
    } catch {
      // ignore
    }

    if (hard) {
      this.failAllPending('Grok UI worker shutdown (hard).');
    }

    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill();
      } catch {
        // no-op
      }
    }

    this.cleanupProcess();
    this.startPromise = null;
  }

  async closeDriver(): Promise<void> {
    if (!this.proc) {
      return;
    }
    try {
      await this.request('close_driver', {}, 5000);
    } catch (error) {
      console.warn('[GrokUiPythonBridge] Close driver failed:', error);
    }
  }

  private async startInternal(): Promise<void> {
    const devContext = this.getDevContext();
    const pythonPath = this.buildPythonPath(devContext);
    const availability = await this.withPythonPath(pythonPath, () =>
      checkPythonModuleAvailability(['grok3api', 'undetected_chromedriver'], { preferredVersion: '3.12' })
    );

    if (!availability.success || !availability.runtime) {
      throw new Error(`${availability.errorCode || 'PYTHON_MODULE_MISSING'}: ${availability.error || 'Python runtime unavailable'}`);
    }

    this.runtime = availability.runtime;
    // console.info('[GrokUiPythonBridge] DevContext', {
    //   isPackaged: app.isPackaged,
    //   isDev: devContext.isDev,
    //   appPath: devContext.appPath,
    //   hasAsar: devContext.hasAsar,
    //   hasDevWorker: devContext.hasDevWorker,
    //   hasDevServer: devContext.hasDevServer,
    //   resourcesPath: devContext.resourcesPath,
    // });
    // console.info('[GrokUiPythonBridge] PythonPath', pythonPath);
    // console.info('[GrokUiPythonBridge] PythonRuntime', {
    //   command: availability.runtime.command,
    //   mode: availability.runtime.mode,
    // });

    const workerPath = this.resolveWorkerPath();
    const args = [...availability.runtime.baseArgs, '-u', workerPath];

    const settings = AppSettingsService.getAll();
    const profiles = GrokUiProfileDatabase.getAll();
    const primaryProfile = profiles.find((profile) => profile.enabled === true) || profiles[0];
    const isAnonymous = primaryProfile ? primaryProfile.anonymous === true : settings.grokUiAnonymous === true;
    const profileDir = !isAnonymous
      ? (primaryProfile?.profileDir || settings.grokUiProfileDir || '').trim()
      : '';
    const profileName = !isAnonymous
      ? (primaryProfile?.profileName || settings.grokUiProfileName || '').trim()
      : '';

    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
      PYTHONPATH: pythonPath,
      ...(devContext.isDev ? { GROK_UI_DEV_MODE: '1', GROK_UI_DEV_PYTHONPATH: pythonPath } : {}),
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
      console.warn('[GrokUiPythonBridge]', raw);
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

  private buildPythonPath(devContext: { isDev: boolean }): string {
    const packagedSitePackages = path.join(process.resourcesPath || '', 'python', 'Lib', 'site-packages');
    const existing = process.env.PYTHONPATH?.trim();
    const override = process.env.GROK_UI_PYTHONPATH?.trim();
    const hasDevPath = fs.existsSync(GROK_UI_DEV_PYTHONPATH);
    const isDev = devContext.isDev;

    if (override && override.length > 0) {
      return override;
    }

    if (!isDev) {
      if (existing && existing.length > 0) {
        return `${packagedSitePackages}${path.delimiter}${existing}`;
      }
      return packagedSitePackages;
    }

    if (hasDevPath) {
      return GROK_UI_DEV_PYTHONPATH;
    }

    if (existing && existing.length > 0) {
      const normalized = existing.replace(/\//g, '\\').toLowerCase();
      const packagedHint = `${path.sep}resources${path.sep}python${path.sep}`.toLowerCase();
      if (!normalized.includes(packagedHint)) {
        return existing;
      }
    }

    return GROK_UI_DEV_PYTHONPATH;
  }

  private getDevContext(): {
    isDev: boolean;
    appPath: string;
    resourcesPath: string;
    hasAsar: boolean;
    hasDevWorker: boolean;
    hasRepoWorker: boolean;
    hasDevServer: boolean;
  } {
    const appPath = app.getAppPath();
    const resourcesPath = process.resourcesPath || '';
    const hasAsar = appPath.toLowerCase().endsWith('.asar');
    const devWorkerPath = path.join(appPath, 'src', 'main', 'services', 'grokUi', 'python', 'grok_ui_worker.py');
    const hasDevWorker = fs.existsSync(devWorkerPath);
    const repoWorkerPath = path.join(process.cwd(), 'src', 'main', 'services', 'grokUi', 'python', 'grok_ui_worker.py');
    const hasRepoWorker = fs.existsSync(repoWorkerPath);
    const hasDevServer = Boolean(process.env.VITE_DEV_SERVER_URL) || Boolean(process.env.ELECTRON_RENDERER_URL);
    const isDev = !app.isPackaged || !hasAsar || hasDevWorker || hasRepoWorker || hasDevServer || process.env.NODE_ENV === 'development';

    return {
      isDev,
      appPath,
      resourcesPath,
      hasAsar,
      hasDevWorker,
      hasRepoWorker,
      hasDevServer,
    };
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
