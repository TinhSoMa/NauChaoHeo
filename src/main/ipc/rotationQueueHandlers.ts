import { ipcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import {
  ClearEventHistoryOptions,
  QueueEventRecord,
  QueueInspectorSnapshot,
  QueueInspectorViewOptions
} from '../services/shared/universalRotationQueue/rotationTypes';
import {
  getQueueRuntimeOrCreate,
  isRotationQueueInspectorEnabled,
  isRotationQueuePayloadDebugEnabled,
  listQueueRuntimeKeys
} from '../services/shared/universalRotationQueue/runtimeRegistry';
import { UniversalRotationQueueService } from '../services/shared/universalRotationQueue/universalRotationQueueService';
import {
  ROTATION_QUEUE_IPC_CHANNELS,
  RotationQueueInspectorStatus,
  RotationQueueRuntimeInfo
} from '../../shared/types/rotationQueue';

interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
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
const DEFAULT_HISTORY_CAPACITY = 1000;
const INSPECTOR_DISABLED_ERROR_CODE = 'INSPECTOR_DISABLED';
const INSPECTOR_DISABLED_MESSAGE =
  'Rotation queue inspector is disabled. Set ENABLE_ROTATION_QUEUE_INSPECTOR=1.';

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

function getInspectorStatus(): RotationQueueInspectorStatus {
  const enabled = isRotationQueueInspectorEnabled();
  return {
    enabled,
    reason: enabled ? undefined : INSPECTOR_DISABLED_MESSAGE,
    snapshotThrottleMs: SNAPSHOT_PUSH_THROTTLE_MS,
    historyCapacity: DEFAULT_HISTORY_CAPACITY,
    payloadDebugEnabled: isRotationQueuePayloadDebugEnabled()
  };
}

function inspectorDisabledResponse<T>(): IpcResponse<T> {
  return {
    success: false,
    error: INSPECTOR_DISABLED_MESSAGE,
    errorCode: INSPECTOR_DISABLED_ERROR_CODE
  };
}

export function registerRotationQueueHandlers(): void {
  console.log('[RotationQueueHandlers] Registering rotation queue inspector handlers...');

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.GET_STATUS,
    async (): Promise<IpcResponse<RotationQueueInspectorStatus>> => {
      return {
        success: true,
        data: getInspectorStatus()
      };
    }
  );

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.LIST_RUNTIMES,
    async (): Promise<IpcResponse<RotationQueueRuntimeInfo[]>> => {
      const keys = listQueueRuntimeKeys();
      const runtimeInfos: RotationQueueRuntimeInfo[] = keys.map((key) => {
        try {
          const queue = getQueueRuntimeOrCreate(key);
          const snapshot = queue.getSnapshot();
          return {
            key,
            jobCounts: {
              queued: snapshot.totalQueued,
              running: snapshot.totalRunning
            }
          };
        } catch {
          return { key };
        }
      });
      return {
        success: true,
        data: runtimeInfos
      };
    }
  );

  ipcMain.handle(
    ROTATION_QUEUE_IPC_CHANNELS.GET_SNAPSHOT,
    async (
      _event: IpcMainInvokeEvent,
      payload?: QueueInspectorViewOptions | SnapshotRequestPayload
    ): Promise<IpcResponse<QueueInspectorSnapshot>> => {
      try {
        if (!isRotationQueueInspectorEnabled()) {
          return inspectorDisabledResponse<QueueInspectorSnapshot>();
        }
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
        if (!isRotationQueueInspectorEnabled()) {
          return inspectorDisabledResponse<QueueEventRecord[]>();
        }
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
        if (!isRotationQueueInspectorEnabled()) {
          return inspectorDisabledResponse<void>();
        }
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
        if (!isRotationQueueInspectorEnabled()) {
          return inspectorDisabledResponse<void>();
        }
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
