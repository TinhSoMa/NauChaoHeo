import { ipcRenderer } from 'electron';
import {
  ROTATION_QUEUE_IPC_CHANNELS,
  RotationQueueClearHistoryRequest,
  RotationQueueEventRecord,
  RotationQueueHistoryRequest,
  RotationQueueInspectorStatus,
  RotationQueueInspectorSnapshot,
  RotationQueueRuntimeInfo,
  RotationQueueSnapshotRequest,
  RotationQueueStreamRequest,
  RotationQueueViewOptions
} from '../shared/types/rotationQueue';

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface RotationQueueAPI {
  getStatus: () => Promise<IpcApiResponse<RotationQueueInspectorStatus>>;
  listRuntimes: () => Promise<IpcApiResponse<RotationQueueRuntimeInfo[]>>;
  getSnapshot: (
    options?: RotationQueueViewOptions,
    runtimeKey?: string
  ) => Promise<IpcApiResponse<RotationQueueInspectorSnapshot>>;
  getHistory: (limit?: number, runtimeKey?: string) => Promise<IpcApiResponse<RotationQueueEventRecord[]>>;
  clearHistory: (options?: RotationQueueClearHistoryRequest) => Promise<IpcApiResponse<void>>;
  startStream: (options?: RotationQueueViewOptions, runtimeKey?: string) => Promise<IpcApiResponse<void>>;
  stopStream: () => Promise<IpcApiResponse<void>>;
  onEvent: (callback: (event: RotationQueueEventRecord) => void) => () => void;
  onSnapshot: (callback: (snapshot: RotationQueueInspectorSnapshot) => void) => () => void;
}

export function createRotationQueueApi(): RotationQueueAPI {
  return {
    getStatus: () => ipcRenderer.invoke(ROTATION_QUEUE_IPC_CHANNELS.GET_STATUS),

    listRuntimes: () => ipcRenderer.invoke(ROTATION_QUEUE_IPC_CHANNELS.LIST_RUNTIMES),

    getSnapshot: (options?: RotationQueueViewOptions, runtimeKey?: string) => {
      const payload: RotationQueueSnapshotRequest = {
        runtimeKey,
        viewOptions: options
      };
      return ipcRenderer.invoke(ROTATION_QUEUE_IPC_CHANNELS.GET_SNAPSHOT, payload);
    },

    getHistory: (limit?: number, runtimeKey?: string) => {
      const payload: RotationQueueHistoryRequest = { runtimeKey, limit };
      return ipcRenderer.invoke(ROTATION_QUEUE_IPC_CHANNELS.GET_HISTORY, payload);
    },

    clearHistory: (options?: RotationQueueClearHistoryRequest) =>
      ipcRenderer.invoke(ROTATION_QUEUE_IPC_CHANNELS.CLEAR_HISTORY, options),

    startStream: (options?: RotationQueueViewOptions, runtimeKey?: string) => {
      const payload: RotationQueueStreamRequest = { runtimeKey, viewOptions: options };
      return ipcRenderer.invoke(ROTATION_QUEUE_IPC_CHANNELS.START_STREAM, payload);
    },

    stopStream: () => ipcRenderer.invoke(ROTATION_QUEUE_IPC_CHANNELS.STOP_STREAM),

    onEvent: (callback: (event: RotationQueueEventRecord) => void) => {
      const listener = (_event: unknown, eventRecord: RotationQueueEventRecord) => {
        callback(eventRecord);
      };
      ipcRenderer.on(ROTATION_QUEUE_IPC_CHANNELS.STREAM_EVENT, listener);
      return () => {
        ipcRenderer.removeListener(ROTATION_QUEUE_IPC_CHANNELS.STREAM_EVENT, listener);
      };
    },

    onSnapshot: (callback: (snapshot: RotationQueueInspectorSnapshot) => void) => {
      const listener = (_event: unknown, snapshot: RotationQueueInspectorSnapshot) => {
        callback(snapshot);
      };
      ipcRenderer.on(ROTATION_QUEUE_IPC_CHANNELS.STREAM_SNAPSHOT, listener);
      return () => {
        ipcRenderer.removeListener(ROTATION_QUEUE_IPC_CHANNELS.STREAM_SNAPSHOT, listener);
      };
    }
  };
}
