import { app } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  checkPythonModuleAvailability,
  type PythonModuleAvailabilityResult,
  type PythonRuntimeResolution
} from '../../utils/pythonRuntime';

type MemoryPreflightErrorCode =
  | 'EMBEDDED_PYTHON_MISSING'
  | 'EMBEDDED_WORKER_MISSING'
  | 'EMBEDDED_MEM0_MISSING'
  | 'EMBEDDED_SPACY_MISSING'
  | 'EMBEDDED_SPACY_MODEL_MISSING'
  | 'EMBEDDED_UNDERTHESEA_MISSING'
  | 'EMBEDDED_RUNTIME_BROKEN'
  | 'PYTHON_RUNTIME_MISSING'
  | 'PYTHON_MODULE_MISSING';

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

interface MemoryContextBuildStamp {
  generatedAt?: string;
  pythonVersion?: string;
  mem0Version?: string;
  spacyVersion?: string;
  spacyModelName?: string;
  undertheseaVersion?: string;
  runtimeDir?: string;
}

interface MemoryContextDependencyCheck {
  sqlite3: boolean;
  mem0: boolean;
  spacy: boolean;
  spacyModel: boolean;
  underthesea: boolean;
}

interface MemoryContextRuntimeDiagnostics {
  runtime: PythonRuntimeResolution | null;
  workerPath?: string;
  storePath: string;
  buildStamp?: MemoryContextBuildStamp | null;
  dependencyCheck?: MemoryContextDependencyCheck;
  errorCode?: MemoryPreflightErrorCode;
  error?: string;
}

export class MemoryContextPythonBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private lineReader: readline.Interface | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private startPromise: Promise<void> | null = null;
  private runtime: PythonRuntimeResolution | null = null;
  private readonly storePath = path.join(app.getPath('userData'), 'memoryContext', 'memory_context.sqlite3');
  private diagnostics: MemoryContextRuntimeDiagnostics = {
    runtime: null,
    storePath: this.storePath,
    buildStamp: null
  };

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
    if (app.isPackaged) {
      const embeddedPythonPath = path.join(process.resourcesPath || '', 'python', 'python.exe');
      if (!fs.existsSync(embeddedPythonPath)) {
        this.diagnostics = {
          runtime: null,
          workerPath: path.join(process.resourcesPath || '', 'memoryContext', 'python', 'mem0_context_worker.py'),
          storePath: this.storePath,
          buildStamp: this.readBuildStamp(),
          errorCode: 'EMBEDDED_PYTHON_MISSING',
          error: `Embedded Python not found: ${embeddedPythonPath}`
        };
        this.logDiagnostics('preflight', this.diagnostics);
        throw new Error(`EMBEDDED_PYTHON_MISSING: Embedded Python not found: ${embeddedPythonPath}`);
      }
    }

    const workerPath = this.resolveWorkerPath();
    const availability = await checkPythonModuleAvailability(['sqlite3', 'mem0', 'spacy', 'underthesea'], {
      preferredVersion: '3.12',
      postCheckScript: 'import spacy; spacy.load("xx_ent_wiki_sm")',
      postCheckDescription: 'Không thể load spaCy model xx_ent_wiki_sm.',
      postCheckErrorCode: 'EMBEDDED_SPACY_MODEL_MISSING'
    });

    this.runtime = availability.runtime || null;
    this.diagnostics = {
      runtime: availability.runtime || this.runtime,
      workerPath,
      storePath: this.storePath,
      buildStamp: this.readBuildStamp(),
      dependencyCheck: {
        sqlite3: availability.modules?.sqlite3 !== false,
        mem0: availability.modules?.mem0 !== false,
        spacy: availability.modules?.spacy !== false,
        spacyModel: availability.success,
        underthesea: availability.modules?.underthesea !== false
      },
      errorCode: availability.success ? undefined : (availability.errorCode as MemoryPreflightErrorCode | undefined),
      error: availability.success ? undefined : availability.error
    };

    this.logDiagnostics('preflight', this.diagnostics);

    if (!availability.success || !availability.runtime) {
      throw new Error(`${availability.errorCode || 'PYTHON_RUNTIME_MISSING'}: ${availability.error || 'Python runtime unavailable'}`);
    }

    this.runtime = availability.runtime;
    const args = [...availability.runtime.baseArgs, '-u', workerPath];
    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
      PYTHONNOUSERSITE: '1',
      MEMORY_CONTEXT_STORE_PATH: this.storePath
    };

    this.proc = spawn(availability.runtime.command, args, { windowsHide: true, env });
    this.lineReader = readline.createInterface({ input: this.proc.stdout });
    this.lineReader.on('line', (line) => this.onStdoutLine(line));
    this.proc.stderr.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) {
        console.warn('[MemoryContextPythonBridge][stderr]', text);
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

  async request<T = unknown>(
    command: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30000
  ): Promise<WorkerResponseEnvelope<T>> {
    await this.ensureStarted();

    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error('Memory context Python worker is not writable');
    }

    const requestId = `${Date.now()}-${++this.requestCounter}`;
    const envelope: WorkerRequestEnvelope = { requestId, command, payload };

    return new Promise<WorkerResponseEnvelope<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request timeout (${command}) after ${timeoutMs}ms`));
      }, Math.max(1, timeoutMs));

      this.pending.set(requestId, {
        resolve: resolve as unknown as (value: WorkerResponseEnvelope) => void,
        reject,
        timer
      });

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
    if (!this.diagnostics.runtime && !this.runtime) {
      return null;
    }
    return {
      success: !this.diagnostics.errorCode,
      runtime: this.runtime || this.diagnostics.runtime || undefined,
      mode: (this.runtime || this.diagnostics.runtime)?.mode,
      modules: {
        sqlite3: this.diagnostics.dependencyCheck?.sqlite3 ?? true,
        mem0: this.diagnostics.dependencyCheck?.mem0 ?? false,
        spacy: this.diagnostics.dependencyCheck?.spacy ?? false,
        underthesea: this.diagnostics.dependencyCheck?.underthesea ?? false
      },
      errorCode: this.diagnostics.errorCode,
      error: this.diagnostics.error
    };
  }

  getStorePath(): string {
    return this.storePath;
  }

  getDiagnostics(): MemoryContextRuntimeDiagnostics {
    return this.diagnostics;
  }

  async shutdown(): Promise<void> {
    if (!this.proc) {
      return;
    }

    try {
      await this.request('shutdown', {}, 5000);
    } catch {
      // Ignore shutdown request failure.
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
      console.warn('[MemoryContextPythonBridge][stdout]', raw);
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
    const packagedPath = path.join(process.resourcesPath || '', 'memoryContext', 'python', 'mem0_context_worker.py');
    if (app.isPackaged) {
      if (fs.existsSync(packagedPath)) {
        return packagedPath;
      }
      this.diagnostics = {
        runtime: this.runtime,
        workerPath: packagedPath,
        storePath: this.storePath,
        buildStamp: this.readBuildStamp(),
        errorCode: 'EMBEDDED_WORKER_MISSING',
        error: `Memory context worker script not found at packaged path: ${packagedPath}`
      };
      throw new Error(`EMBEDDED_WORKER_MISSING: Memory context worker script not found at packaged path: ${packagedPath}`);
    }

    const appPath = app.getAppPath();
    const candidates = [
      packagedPath,
      path.join(process.resourcesPath || '', 'python', 'mem0_context_worker.py'),
      path.join(appPath, 'src', 'main', 'services', 'memoryContext', 'python', 'mem0_context_worker.py'),
      path.join(process.cwd(), 'src', 'main', 'services', 'memoryContext', 'python', 'mem0_context_worker.py'),
      path.join(appPath, 'out', 'main', 'services', 'memoryContext', 'python', 'mem0_context_worker.py'),
      path.join(appPath, 'dist', 'main', 'src', 'main', 'services', 'memoryContext', 'python', 'mem0_context_worker.py')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Memory context worker script not found. Checked: ${candidates.join(' | ')}`);
  }

  private readBuildStamp(): MemoryContextBuildStamp | null {
    const runtimeDir = this.runtime?.pythonPath
      ? path.dirname(this.runtime.pythonPath)
      : path.join(process.resourcesPath || '', 'python');
    const candidates = [
      path.join(runtimeDir, 'memory-context-build.json'),
      path.join(path.dirname(runtimeDir), 'memory-context-build.json')
    ];
    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) {
          continue;
        }
        return JSON.parse(fs.readFileSync(candidate, 'utf8')) as MemoryContextBuildStamp;
      } catch {
        continue;
      }
    }
    return null;
  }

  private logDiagnostics(stage: string, diagnostics: MemoryContextRuntimeDiagnostics): void {
    console.info('[MemoryContextPythonBridge][diagnostic]', {
      stage,
      packaged: app.isPackaged,
      runtimePath: diagnostics.runtime?.pythonPath,
      workerPath: diagnostics.workerPath,
      storePath: diagnostics.storePath,
      runtimeMode: diagnostics.runtime?.mode,
      dependencyCheck: diagnostics.dependencyCheck,
      buildStamp: diagnostics.buildStamp,
      errorCode: diagnostics.errorCode,
      error: diagnostics.error
    });
  }

  private failAllPending(message: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private cleanupProcess(): void {
    this.lineReader?.close();
    this.lineReader = null;
    this.proc = null;
  }
}
