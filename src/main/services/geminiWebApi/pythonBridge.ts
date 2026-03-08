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
import { GeminiErrorCode } from './types';
import { getGeminiWebApiOpsMonitor } from './opsMonitor';

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
  errorCode?: GeminiErrorCode;
}

interface PendingRequest {
  resolve: (value: WorkerResponseEnvelope) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export class GeminiWebApiPythonBridge {
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

  private async startInternal(): Promise<void> {
    const availability = await checkPythonModuleAvailability(['gemini_webapi', 'browser_cookie3'], {
      preferredVersion: '3.12',
    });

    if (!availability.success || !availability.runtime) {
      const code: GeminiErrorCode = availability.errorCode === 'PYTHON_MODULE_MISSING'
        ? 'PYTHON_MODULE_MISSING'
        : 'PYTHON_RUNTIME_MISSING';
      throw new Error(`${code}: ${availability.error || 'Python runtime unavailable'}`);
    }

    this.runtime = availability.runtime;

    const workerPath = this.resolveWorkerPath();
    const args = [...availability.runtime.baseArgs, '-u', workerPath];

    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
    };

    this.proc = spawn(availability.runtime.command, args, { windowsHide: true, env });
    this.lineReader = readline.createInterface({ input: this.proc.stdout });
    getGeminiWebApiOpsMonitor().recordWorkerStarted({
      pythonPath: availability.runtime.pythonPath,
      runtimeMode: availability.runtime.mode,
      workerPath,
    });

    this.lineReader.on('line', (line) => this.onStdoutLine(line));
    this.proc.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        const sanitized = this.sanitize(line);
        const parsed = this.parseWorkerStderrLine(sanitized);
        console.warn('[GeminiWebApiPythonBridge][stderr]', sanitized);
        if (parsed.level === 'error') {
          getGeminiWebApiOpsMonitor().recordWorkerError({
            error: parsed.text,
            metadata: { source: 'stderr', workerLogLevel: parsed.workerLogLevel }
          });
        } else {
          getGeminiWebApiOpsMonitor().recordWorkerLog({
            level: parsed.level,
            message: parsed.text,
            metadata: { source: 'stderr', workerLogLevel: parsed.workerLogLevel }
          });
        }
      }
    });

    this.proc.on('error', (error) => {
      getGeminiWebApiOpsMonitor().recordWorkerError({
        error: String(error),
        metadata: { source: 'process_error' }
      });
      this.failAllPending(`Worker process error: ${String(error)}`);
      this.cleanupProcess();
    });

    this.proc.on('close', (code) => {
      getGeminiWebApiOpsMonitor().recordWorkerError({
        error: `Worker process closed unexpectedly (code=${code ?? 'null'})`,
        metadata: { source: 'process_close', code: code ?? null }
      });
      this.failAllPending(`Worker process closed unexpectedly (code=${code ?? 'null'})`);
      this.cleanupProcess();
    });
  }

  async request<T = unknown>(
    command: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<WorkerResponseEnvelope<T>> {
    await this.ensureStarted();

    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error('Python worker is not writable');
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
        gemini_webapi: true,
        browser_cookie3: true,
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
      // Ignore worker shutdown command failure; process may already be down.
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

  private onStdoutLine(line: string): void {
    const raw = line.trim();
    if (!raw) {
      return;
    }

    let parsed: WorkerResponseEnvelope;
    try {
      parsed = JSON.parse(raw) as WorkerResponseEnvelope;
    } catch {
      console.warn('[GeminiWebApiPythonBridge] Non-JSON output from worker:', this.sanitize(raw));
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
      path.join(process.resourcesPath || '', 'geminiWebApi', 'python', 'gemini_webapi_worker.py'),
      path.join(process.resourcesPath || '', 'python', 'gemini_webapi_worker.py'),
      path.join(appPath, 'src', 'main', 'services', 'geminiWebApi', 'python', 'gemini_webapi_worker.py'),
      path.join(process.cwd(), 'src', 'main', 'services', 'geminiWebApi', 'python', 'gemini_webapi_worker.py'),
      path.join(appPath, 'out', 'main', 'services', 'geminiWebApi', 'python', 'gemini_webapi_worker.py'),
      path.join(appPath, 'dist', 'main', 'src', 'main', 'services', 'geminiWebApi', 'python', 'gemini_webapi_worker.py'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Gemini worker script not found. Checked: ${candidates.join(' | ')}`);
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
      this.lineReader.removeAllListeners();
      this.lineReader.close();
      this.lineReader = null;
    }

    if (this.proc) {
      this.proc.removeAllListeners();
      this.proc = null;
    }
  }

  private sanitize(text: string): string {
    return text
      .replace(/__Secure-1PSID=[^;\s]+/gi, '__Secure-1PSID=<masked>')
      .replace(/__Secure-1PSIDTS=[^;\s]+/gi, '__Secure-1PSIDTS=<masked>');
  }

  private parseWorkerStderrLine(text: string): {
    level: 'info' | 'success' | 'warning' | 'error';
    workerLogLevel?: string;
    text: string;
  } {
    const match = text.match(/\|\s*(DEBUG|INFO|SUCCESS|WARNING|ERROR|CRITICAL)\s*\|/i);
    const workerLogLevel = match?.[1]?.toUpperCase();

    if (workerLogLevel === 'SUCCESS') {
      return { level: 'success', workerLogLevel, text };
    }
    if (workerLogLevel === 'WARNING') {
      return { level: 'warning', workerLogLevel, text };
    }
    if (workerLogLevel === 'ERROR' || workerLogLevel === 'CRITICAL') {
      return { level: 'error', workerLogLevel, text };
    }
    if (workerLogLevel === 'DEBUG' || workerLogLevel === 'INFO') {
      return { level: 'info', workerLogLevel, text };
    }

    if (/traceback|exception|permission denied|failed|error/i.test(text)) {
      return { level: 'error', text };
    }

    return { level: 'info', text };
  }
}
