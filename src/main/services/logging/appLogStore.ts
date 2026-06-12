import type { AppLogEntry, AppLogAppendPayload } from '../../../shared/types/appLogs';

const MAX_LOG_ENTRIES = 1500;

type LogSubscriber = (entry: AppLogEntry) => void;

class AppLogStore {
  private readonly logs: AppLogEntry[] = [];
  private readonly subscribers = new Set<LogSubscriber>();
  private seq = 0;

  append(payload: AppLogAppendPayload): AppLogEntry {
    const entry: AppLogEntry = {
      seq: ++this.seq,
      timestamp: payload.timestamp ?? Date.now(),
      level: payload.level,
      source: payload.source ?? 'main',
      message: payload.message,
      meta: payload.meta
    };

    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.length = MAX_LOG_ENTRIES;
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(entry);
      } catch {
        // ignore subscriber failures
      }
    }

    return entry;
  }

  getLogs(limit = 200): AppLogEntry[] {
    const normalizedLimit = Math.max(1, Math.min(limit, MAX_LOG_ENTRIES));
    return this.logs.slice(0, normalizedLimit);
  }

  clear(): void {
    this.logs.length = 0;
  }

  subscribe(callback: LogSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
}

let storeInstance: AppLogStore | null = null;

export function getAppLogStore(): AppLogStore {
  if (!storeInstance) {
    storeInstance = new AppLogStore();
  }
  return storeInstance;
}
