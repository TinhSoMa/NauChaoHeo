import { ipcMain } from 'electron';
import {
  shutdownScheduler,
  type ShutdownScheduleReason,
  type ShutdownStatus,
} from '../services/shutdownScheduler';

export const SHUTDOWN_IPC_CHANNELS = {
  SCHEDULE: 'shutdown:schedule',
  CANCEL: 'shutdown:cancel',
  STATUS: 'shutdown:status',
} as const;

interface IpcApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ShutdownSchedulePayload {
  delayMinutes?: number;
  reason?: string;
  source?: ShutdownScheduleReason;
}

export function registerShutdownHandlers(): void {
  console.log('[ShutdownHandlers] Đăng ký handlers...');

  ipcMain.handle(
    SHUTDOWN_IPC_CHANNELS.SCHEDULE,
    async (_, payload: ShutdownSchedulePayload = {}): Promise<IpcApiResponse<ShutdownStatus>> => {
      try {
        const status = shutdownScheduler.schedule(payload);
        return { success: true, data: status };
      } catch (error) {
        console.error('[ShutdownHandlers] schedule error:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    SHUTDOWN_IPC_CHANNELS.CANCEL,
    async (): Promise<IpcApiResponse<ShutdownStatus>> => {
      try {
        const status = shutdownScheduler.cancel();
        return { success: true, data: status };
      } catch (error) {
        console.error('[ShutdownHandlers] cancel error:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    SHUTDOWN_IPC_CHANNELS.STATUS,
    async (): Promise<IpcApiResponse<ShutdownStatus>> => {
      try {
        const status = shutdownScheduler.getStatus();
        return { success: true, data: status };
      } catch (error) {
        console.error('[ShutdownHandlers] status error:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  console.log('[ShutdownHandlers] Đã đăng ký handlers thành công');
}
