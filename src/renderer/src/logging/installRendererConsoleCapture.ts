type ConsoleMethod = (...args: unknown[]) => void;

let installed = false;

function isAppLogsDisabledInBuild(): boolean {
  return import.meta.env.PROD;
}

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
  if (isAppLogsDisabledInBuild()) {
    return;
  }
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
  const shouldPrintToConsole = !isAppLogsDisabledInBuild();

  const originalLog: ConsoleMethod = console.log.bind(console);
  const originalInfo: ConsoleMethod = console.info.bind(console);
  const originalWarn: ConsoleMethod = console.warn.bind(console);
  const originalError: ConsoleMethod = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalLog(...args);
    }
    appendToMain('info', args);
  };
  console.info = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalInfo(...args);
    }
    appendToMain('info', args);
  };
  console.warn = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalWarn(...args);
    }
    appendToMain('warn', args);
  };
  console.error = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalError(...args);
    }
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
