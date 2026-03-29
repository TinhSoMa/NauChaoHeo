import { ipcRenderer, IpcRendererEvent } from 'electron';

type ShutdownScheduleReason = 'pipeline_success' | 'pipeline_error' | 'manual' | 'unknown';

interface ShutdownStatus {
  active: boolean;
  delayMinutes: number;
  scheduledAt: number | null;
  deadlineAt: number | null;
  secondsRemaining: number;
  reason: string;
  source: ShutdownScheduleReason;
}

const SHUTDOWN_IPC_CHANNELS = {
  SCHEDULE: 'shutdown:schedule',
  CANCEL: 'shutdown:cancel',
  STATUS: 'shutdown:status',
} as const;

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ShutdownSchedulePayload {
  delayMinutes?: number;
  reason?: string;
  source?: ShutdownScheduleReason;
}

export interface ShutdownAPI {
  schedule: (payload: ShutdownSchedulePayload) => Promise<IpcApiResponse<ShutdownStatus>>;
  cancel: () => Promise<IpcApiResponse<ShutdownStatus>>;
  getStatus: () => Promise<IpcApiResponse<ShutdownStatus>>;
  onCountdown: (callback: (payload: ShutdownStatus) => void) => () => void;
}

const COUNTDOWN_CHANNEL = 'shutdown:countdown';

export function createShutdownApi(): ShutdownAPI {
  return {
    schedule: (payload) => ipcRenderer.invoke(SHUTDOWN_IPC_CHANNELS.SCHEDULE, payload),
    cancel: () => ipcRenderer.invoke(SHUTDOWN_IPC_CHANNELS.CANCEL),
    getStatus: () => ipcRenderer.invoke(SHUTDOWN_IPC_CHANNELS.STATUS),
    onCountdown: (callback) => {
      const listener = (_event: IpcRendererEvent, payload: ShutdownStatus) => callback(payload);
      ipcRenderer.on(COUNTDOWN_CHANNEL, listener);
      return () => {
        ipcRenderer.removeListener(COUNTDOWN_CHANNEL, listener);
      };
    },
  };
}

export const shutdownApi = createShutdownApi();
