import util from 'util';
import { app } from 'electron';
import type { AppLogLevel } from '../../../shared/types/appLogs';
import { getAppLogStore } from './appLogStore';

type ConsoleMethod = (...args: unknown[]) => void;

let installed = false;

function isAppLogsDisabledInPackagedBuild(): boolean {
  return app.isPackaged && process.env.NODE_ENV === 'production';
}

function formatMessage(args: unknown[]): string {
  try {
    return util.format(...args);
  } catch {
    return args.map((item) => String(item)).join(' ');
  }
}

function appendLog(level: AppLogLevel, args: unknown[]): void {
  if (isAppLogsDisabledInPackagedBuild()) {
    return;
  }
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
  const shouldPrintToConsole = !isAppLogsDisabledInPackagedBuild();

  const originalLog: ConsoleMethod = console.log.bind(console);
  const originalInfo: ConsoleMethod = console.info.bind(console);
  const originalWarn: ConsoleMethod = console.warn.bind(console);
  const originalError: ConsoleMethod = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalLog(...args);
    }
    appendLog('info', args);
  };
  console.info = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalInfo(...args);
    }
    appendLog('info', args);
  };
  console.warn = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalWarn(...args);
    }
    appendLog('warn', args);
  };
  console.error = (...args: unknown[]) => {
    if (shouldPrintToConsole) {
      originalError(...args);
    }
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
    if (shouldPrintToConsole) {
      originalError(error);
    }
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
    if (shouldPrintToConsole) {
      originalError(reason);
    }
  });
}
