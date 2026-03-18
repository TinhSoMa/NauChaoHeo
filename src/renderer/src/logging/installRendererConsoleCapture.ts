type ConsoleMethod = (...args: unknown[]) => void;

let installed = false;

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return String(value);
  }

  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return '[Circular]';
          }
          seen.add(val);
        }
        return val;
      },
      2
    );
  } catch {
    return String(value);
  }
}

function formatMessage(args: unknown[]): string {
  return args.map((item) => safeStringify(item)).join(' ');
}

function appendToMain(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const api = window.electronAPI?.appLogs;
  if (!api) {
    return;
  }
  api.append({
    level,
    source: 'renderer',
    message: formatMessage(args),
    timestamp: Date.now()
  });
}

export function installRendererConsoleCapture(): void {
  if (installed) {
    return;
  }
  installed = true;

  const originalLog: ConsoleMethod = console.log.bind(console);
  const originalInfo: ConsoleMethod = console.info.bind(console);
  const originalWarn: ConsoleMethod = console.warn.bind(console);
  const originalError: ConsoleMethod = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    originalLog(...args);
    appendToMain('info', args);
  };
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    appendToMain('info', args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    appendToMain('warn', args);
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    appendToMain('error', args);
  };

  window.addEventListener('error', (event) => {
    appendToMain('error', [
      'Uncaught error:',
      event.message,
      event.error instanceof Error ? event.error.stack || event.error.message : event.error
    ]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : event.reason;
    appendToMain('error', ['Unhandled rejection:', reason]);
  });
}
