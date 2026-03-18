import util from 'util';
import type { AppLogLevel } from '../../../shared/types/appLogs';
import { getAppLogStore } from './appLogStore';

type ConsoleMethod = (...args: unknown[]) => void;

let installed = false;

function formatMessage(args: unknown[]): string {
  try {
    return util.format(...args);
  } catch {
    return args.map((item) => String(item)).join(' ');
  }
}

function appendLog(level: AppLogLevel, args: unknown[]): void {
  try {
    getAppLogStore().append({
      level,
      source: 'main',
      message: formatMessage(args)
    });
  } catch {
    // ignore append errors
  }
}

export function installMainConsoleCapture(): void {
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
    appendLog('info', args);
  };
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    appendLog('info', args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    appendLog('warn', args);
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    appendLog('error', args);
  };

  process.on('uncaughtException', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    getAppLogStore().append({
      level: 'error',
      source: 'main',
      message: `UncaughtException: ${message}`,
      meta: {
        stack: error instanceof Error ? error.stack : undefined
      }
    });
    originalError(error);
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    getAppLogStore().append({
      level: 'error',
      source: 'main',
      message: `UnhandledRejection: ${message}`,
      meta: {
        stack: reason instanceof Error ? reason.stack : undefined
      }
    });
    originalError(reason);
  });
}
