import { ipcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import {
  ClearEventHistoryOptions,
  QueueEventRecord,
  QueueInspectorSnapshot,
  QueueInspectorViewOptions
} from '../services/shared/universalRotationQueue/rotationTypes';
import {
  getQueueRuntimeOrCreate,
  isRotationQueueInspectorEnabled
} from '../services/shared/universalRotationQueue/runtimeRegistry';
import { UniversalRotationQueueService } from '../services/shared/universalRotationQueue/universalRotationQueueService';
import { ROTATION_QUEUE_IPC_CHANNELS } from '../../shared/types/rotationQueue';

interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface SnapshotRequestPayload {
  runtimeKey?: string;
  viewOptions?: QueueInspectorViewOptions;
}

interface HistoryRequestPayload {
  runtimeKey?: string;
  limit?: number;
}

interface ClearHistoryRequestPayload extends ClearEventHistoryOptions {
  runtimeKey?: string;
}

interface StreamStartPayload {
  runtimeKey?: string;
  viewOptions?: QueueInspectorViewOptions;
}

interface StreamSession {
  runtimeKey: string;
  queue: UniversalRotationQueueService;
  unsubscribe: () => void;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  viewOptions: QueueInspectorViewOptions;
  snapshotDirty: boolean;
  detached: boolean;
}

const sessions = new Map<number, StreamSession>();
const SNAPSHOT_PUSH_THROTTLE_MS = 500;

function normalizeRuntimeKey(runtimeKey?: string): string {
  const normalized = runtimeKey?.trim();
  return normalized || 'default';
}

function parseSnapshotPayload(
  payload?: QueueInspectorViewOptions | SnapshotRequestPayload
): SnapshotRequestPayload {
  if (!payload) return {};
  if ('viewOptions' in payload || 'runtimeKey' in payload) {
    return payload as SnapshotRequestPayload;
  }
  return { viewOptions: payload as QueueInspectorViewOptions };
}

function parseHistoryPayload(payload?: number | HistoryRequestPayload): HistoryRequestPayload {
  if (typeof payload === 'number') {
    return { limit: payload };
  }
  return payload ?? {};
}

function stopSession(webContentsId: number): void {
  const session = sessions.get(webContentsId);
  if (!session) return;

  session.detached = true;
  session.unsubscribe();
  if (session.snapshotTimer) {
    clearTimeout(session.snapshotTimer);
  }
  sessions.delete(webContentsId);
}

function scheduleSnapshotFlush(webContents: WebContents, session: StreamSession): void {
  if (session.snapshotTimer) return;

  session.snapshotTimer = setTimeout(() => {
    session.snapshotTimer = null;
    if (session.detached || webContents.isDestroyed()) return;
    if (!session.snapshotDirty) return;

    try {
      const snapshot = session.queue.getInspectorSnapshot(session.viewOptions);
      webContents.send(ROTATION_QUEUE_IPC_CHANNELS.STREAM_SNAPSHOT, snapshot);
      session.snapshotDirty = false;
    } catch (error) {
      console.error('[RotationQueueHandlers] snapshot flush failed:', error);
    }
  }, SNAPSHOT_PUSH_THROTTLE_MS);
}

function markSnapshotDirty(webContents: WebContents, session: StreamSession): void {
  session.snapshotDirty = true;
  scheduleSnapshotFlush(webContents, session);
}

export function registerRotationQueueHandlers(): void {
  const enabled = isRotationQueueInspectorEnabled();
  if (!enabled) {
    console.log('[RotationQueueHandlers] Inspector disabled by feature flag.');
    return;
  }

  console.log('[RotationQueueHandlers] Registering rotation queue inspector handlers...');

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.GET_SNAPSHOT,
    async (
      _event: IpcMainInvokeEvent,
      payload?: QueueInspectorViewOptions | SnapshotRequestPayload
    ): Promise<IpcResponse<QueueInspectorSnapshot>> => {
      try {
        const parsed = parseSnapshotPayload(payload);
        const queue = getQueueRuntimeOrCreate(normalizeRuntimeKey(parsed.runtimeKey));
        const snapshot = queue.getInspectorSnapshot(parsed.viewOptions);
        return { success: true, data: snapshot };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.GET_HISTORY,
    async (
      _event: IpcMainInvokeEvent,
      payload?: number | HistoryRequestPayload
    ): Promise<IpcResponse<QueueEventRecord[]>> => {
      try {
        const parsed = parseHistoryPayload(payload);
        const queue = getQueueRuntimeOrCreate(normalizeRuntimeKey(parsed.runtimeKey));
        const events = queue.getEventHistory(parsed.limit);
        return { success: true, data: events };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.CLEAR_HISTORY,
    async (
      _event: IpcMainInvokeEvent,
      payload?: ClearHistoryRequestPayload
    ): Promise<IpcResponse<void>> => {
      try {
        const runtimeKey = normalizeRuntimeKey(payload?.runtimeKey);
        const queue = getQueueRuntimeOrCreate(runtimeKey);
        queue.clearEventHistory({ resetDroppedCounter: payload?.resetDroppedCounter ?? true });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.START_STREAM,
    async (
      event: IpcMainInvokeEvent,
      payload?: StreamStartPayload
    ): Promise<IpcResponse<void>> => {
      try {
        const webContents = event.sender;
        stopSession(webContents.id);

        const runtimeKey = normalizeRuntimeKey(payload?.runtimeKey);
        const queue = getQueueRuntimeOrCreate(runtimeKey);
        const viewOptions = payload?.viewOptions ?? {};

        const unsubscribe = queue.subscribeEventRecords((eventRecord) => {
          if (webContents.isDestroyed()) {
            stopSession(webContents.id);
            return;
          }

          webContents.send(ROTATION_QUEUE_IPC_CHANNELS.STREAM_EVENT, eventRecord);
          const session = sessions.get(webContents.id);
          if (!session) return;
          markSnapshotDirty(webContents, session);
        });

        const session: StreamSession = {
          runtimeKey,
          queue,
          unsubscribe,
          snapshotTimer: null,
          viewOptions,
          snapshotDirty: false,
          detached: false
        };
        sessions.set(webContents.id, session);

        const initialSnapshot = queue.getInspectorSnapshot(viewOptions);
        webContents.send(ROTATION_QUEUE_IPC_CHANNELS.STREAM_SNAPSHOT, initialSnapshot);

        webContents.once('destroyed', () => {
          stopSession(webContents.id);
        });

        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.STOP_STREAM,
    async (event: IpcMainInvokeEvent): Promise<IpcResponse<void>> => {
      try {
        stopSession(event.sender.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
}
