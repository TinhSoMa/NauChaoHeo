import { BrowserWindow, Notification } from 'electron';
import { spawn } from 'child_process';

const COUNTDOWN_CHANNEL = 'shutdown:countdown';
const DEFAULT_DELAY_MINUTES = 5;
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 30;

const MILESTONE_SECONDS = [300, 120, 60, 30, 10, 5, 1];

export type ShutdownScheduleReason =
  | 'pipeline_success'
  | 'pipeline_error'
  | 'manual'
  | 'unknown';

export interface ShutdownScheduleRequest {
  delayMinutes?: number;
  reason?: string;
  source?: ShutdownScheduleReason;
}

export interface ShutdownStatus {
  active: boolean;
  delayMinutes: number;
  scheduledAt: number | null;
  deadlineAt: number | null;
  secondsRemaining: number;
  reason: string;
  source: ShutdownScheduleReason;
}

type ShutdownState = {
  active: boolean;
  delayMinutes: number;
  scheduledAt: number | null;
  deadlineAt: number | null;
  reason: string;
  source: ShutdownScheduleReason;
};

class ShutdownScheduler {
  private state: ShutdownState = {
    active: false,
    delayMinutes: DEFAULT_DELAY_MINUTES,
    scheduledAt: null,
    deadlineAt: null,
    reason: '',
    source: 'unknown',
  };

  private countdownTimer: NodeJS.Timeout | null = null;
  private notifiedMilestones = new Set<number>();

  schedule(input: ShutdownScheduleRequest = {}): ShutdownStatus {
    this.ensureWindows();

    const delayMinutes = this.normalizeDelayMinutes(input.delayMinutes);
    const reason = this.normalizeReason(input.reason);
    const source = this.normalizeSource(input.source);

    this.cancelInternal(false);

    const totalSeconds = Math.max(0, Math.round(delayMinutes * 60));
    this.execWindowsShutdown(['/s', '/f', '/t', String(totalSeconds), '/c', reason]);

    const now = Date.now();
    this.state = {
      active: true,
      delayMinutes,
      scheduledAt: now,
      deadlineAt: now + totalSeconds * 1000,
      reason,
      source,
    };
    this.notifiedMilestones.clear();

    this.showNotification(
      'Auto shutdown đã bật',
      `Máy sẽ tắt sau ${delayMinutes} phút. Bạn có thể hủy trong app.`
    );

    this.startCountdownTicker();
    this.emitCountdown();

    return this.getStatus();
  }

  cancel(): ShutdownStatus {
    return this.cancelInternal(true);
  }

  getStatus(): ShutdownStatus {
    const secondsRemaining = this.getSecondsRemaining();
    return {
      active: this.state.active,
      delayMinutes: this.state.delayMinutes,
      scheduledAt: this.state.scheduledAt,
      deadlineAt: this.state.deadlineAt,
      secondsRemaining,
      reason: this.state.reason,
      source: this.state.source,
    };
  }

  dispose(): void {
    this.stopCountdownTicker();
  }

  private cancelInternal(showToast: boolean): ShutdownStatus {
    this.stopCountdownTicker();
    this.notifiedMilestones.clear();

    if (this.state.active && process.platform === 'win32') {
      try {
        this.execWindowsShutdown(['/a']);
      } catch (error) {
        // /a can fail when there is no pending shutdown. Ignore.
        console.warn('[ShutdownScheduler] abort shutdown warning:', error);
      }
    }

    const wasActive = this.state.active;
    this.state = {
      active: false,
      delayMinutes: this.state.delayMinutes || DEFAULT_DELAY_MINUTES,
      scheduledAt: null,
      deadlineAt: null,
      reason: '',
      source: 'unknown',
    };

    if (showToast && wasActive) {
      this.showNotification('Đã hủy auto shutdown', 'Hệ thống sẽ không tắt máy nữa.');
    }

    this.emitCountdown();
    return this.getStatus();
  }

  private startCountdownTicker(): void {
    this.stopCountdownTicker();
    this.countdownTimer = setInterval(() => {
      if (!this.state.active) {
        this.stopCountdownTicker();
        return;
      }

      const remaining = this.getSecondsRemaining();
      this.emitCountdown();
      this.maybeNotifyMilestone(remaining);

      if (remaining <= 0) {
        this.state.active = false;
        this.stopCountdownTicker();
        this.emitCountdown();
      }
    }, 1000);
  }

  private stopCountdownTicker(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private getSecondsRemaining(): number {
    if (!this.state.active || !this.state.deadlineAt) {
      return 0;
    }
    return Math.max(0, Math.ceil((this.state.deadlineAt - Date.now()) / 1000));
  }

  private emitCountdown(): void {
    const payload = this.getStatus();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(COUNTDOWN_CHANNEL, payload);
      }
    }
  }

  private maybeNotifyMilestone(secondsRemaining: number): void {
    if (!this.state.active || secondsRemaining <= 0) {
      return;
    }
    if (!MILESTONE_SECONDS.includes(secondsRemaining)) {
      return;
    }
    if (this.notifiedMilestones.has(secondsRemaining)) {
      return;
    }
    this.notifiedMilestones.add(secondsRemaining);

    if (secondsRemaining >= 60) {
      const min = Math.ceil(secondsRemaining / 60);
      this.showNotification('Auto shutdown countdown', `Máy sẽ tắt sau khoảng ${min} phút.`);
      return;
    }

    this.showNotification('Auto shutdown countdown', `Máy sẽ tắt sau ${secondsRemaining} giây.`);
  }

  private showNotification(title: string, body: string): void {
    if (!Notification.isSupported()) {
      return;
    }
    try {
      new Notification({ title, body, silent: false }).show();
    } catch (error) {
      console.warn('[ShutdownScheduler] notification error:', error);
    }
  }

  private ensureWindows(): void {
    if (process.platform !== 'win32') {
      throw new Error('Auto shutdown hiện chỉ hỗ trợ Windows.');
    }
  }

  private normalizeDelayMinutes(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_DELAY_MINUTES;
    }
    const rounded = Math.round(numeric);
    return Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, rounded));
  }

  private normalizeReason(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
      return 'NauChaoHeo auto shutdown';
    }
    return text.slice(0, 128);
  }

  private normalizeSource(value: unknown): ShutdownScheduleReason {
    return value === 'pipeline_success'
      || value === 'pipeline_error'
      || value === 'manual'
      ? value
      : 'unknown';
  }

  private execWindowsShutdown(args: string[]): void {
    const child = spawn('shutdown', args, {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      console.error('[ShutdownScheduler] shutdown command failed:', error);
    });
  }
}

export const shutdownScheduler = new ShutdownScheduler();

export const SHUTDOWN_COUNTDOWN_CHANNEL = COUNTDOWN_CHANNEL;
