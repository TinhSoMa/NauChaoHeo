import {
  CaptionSessionV1,
  CaptionProjectSettingsValues,
  CaptionStepState,
  SubtitleEntry,
} from '@shared/types/caption';
import {
  createDefaultCaptionSession,
  getCaptionSessionPathFromInput,
  nowIso,
} from '@shared/utils/captionSession';

export type CaptionInputType = 'srt' | 'draft';
const sessionWriteQueue = new Map<string, Promise<void>>();
const sessionSyncRetryTimers = new Map<string, number>();

export function getInputPaths(inputType: CaptionInputType, filePath: string): string[] {
  if (!filePath) return [];
  if (inputType === 'draft') {
    return filePath.split('; ').map((p) => p.trim()).filter(Boolean);
  }
  return [filePath];
}

export function getSessionPathForInputPath(inputType: CaptionInputType, inputPath: string): string {
  return getCaptionSessionPathFromInput(inputType, inputPath);
}

export async function readCaptionSession(
  sessionPath: string,
  fallback?: { projectId?: string | null; inputType?: CaptionInputType; sourcePath?: string; folderPath?: string }
): Promise<CaptionSessionV1> {
  const res = await window.electronAPI.caption.readSession(sessionPath);
  if (res?.success && res.data) {
    const parsed = res.data as CaptionSessionV1;
    return {
      ...createDefaultCaptionSession(fallback),
      ...parsed,
      projectContext: {
        ...createDefaultCaptionSession(fallback).projectContext,
        ...(parsed.projectContext || {}),
      },
      settings: {
        ...(parsed.settings || {}),
      },
      steps: {
        ...createDefaultCaptionSession(fallback).steps,
        ...(parsed.steps || {}),
      },
      data: {
        ...(parsed.data || {}),
      },
      artifacts: {
        ...(parsed.artifacts || {}),
      },
      timing: {
        ...(parsed.timing || {}),
      },
      runtime: {
        ...(parsed.runtime || {}),
      },
    };
  }
  return createDefaultCaptionSession(fallback);
}

export async function writeCaptionSession(sessionPath: string, session: CaptionSessionV1): Promise<void> {
  const payload: CaptionSessionV1 = {
    ...session,
    updatedAt: nowIso(),
  };
  await window.electronAPI.caption.writeSessionAtomic(sessionPath, payload);
}

export async function updateCaptionSession(
  sessionPath: string,
  updater: (current: CaptionSessionV1) => CaptionSessionV1,
  fallback?: { projectId?: string | null; inputType?: CaptionInputType; sourcePath?: string; folderPath?: string }
): Promise<CaptionSessionV1> {
  const prevQueue = sessionWriteQueue.get(sessionPath) || Promise.resolve();
  let nextSession: CaptionSessionV1 | null = null;
  const queued = prevQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readCaptionSession(sessionPath, fallback);
      const next = updater(current);
      await writeCaptionSession(sessionPath, next);
      nextSession = next;
    });
  sessionWriteQueue.set(sessionPath, queued);
  await queued;
  return nextSession as CaptionSessionV1;
}

export function toStepKey(step: number): 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7' {
  if (step < 1 || step > 7) {
    return 'step1';
  }
  return `step${step}` as 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7';
}

export function makeStepRunning(prev?: CaptionStepState, settingsSnapshot?: Record<string, unknown>): CaptionStepState {
  return {
    ...prev,
    status: 'running',
    startedAt: nowIso(),
    endedAt: undefined,
    error: undefined,
    settingsSnapshot: settingsSnapshot || prev?.settingsSnapshot,
  };
}

export function makeStepSuccess(
  prev?: CaptionStepState,
  metrics?: Record<string, unknown>
): CaptionStepState {
  return {
    ...prev,
    status: 'success',
    endedAt: nowIso(),
    error: undefined,
    metrics: metrics || prev?.metrics,
  };
}

export function makeStepError(prev: CaptionStepState | undefined, error: string): CaptionStepState {
  return {
    ...prev,
    status: 'error',
    endedAt: nowIso(),
    error,
  };
}

export function markFollowingStepsStale(session: CaptionSessionV1, step: number): CaptionSessionV1 {
  const next = { ...session, steps: { ...session.steps } };
  for (let i = step + 1; i <= 7; i++) {
    const k = toStepKey(i);
    next.steps[k] = {
      ...next.steps[k],
      status: 'stale',
      error: undefined,
      metrics: undefined,
    };
  }
  return next;
}

export function compactEntries(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function buildProjectSettingsMirror(settings: CaptionProjectSettingsValues): Record<string, unknown> {
  return {
    step2Split: {
      splitByLines: settings.splitByLines,
      linesPerFile: settings.linesPerFile,
      numberOfParts: settings.numberOfParts,
    },
    step3Translate: {
      geminiModel: settings.geminiModel,
      translateMethod: settings.translateMethod,
    },
    step4Tts: {
      voice: settings.voice,
      rate: settings.rate,
      volume: settings.volume,
      srtSpeed: settings.srtSpeed,
      autoFitAudio: settings.autoFitAudio,
    },
    step7Render: {
      style: settings.style,
      renderMode: settings.renderMode,
      renderResolution: settings.renderResolution,
      hardwareAcceleration: settings.hardwareAcceleration,
      renderAudioSpeed: settings.renderAudioSpeed,
      videoVolume: settings.videoVolume,
      audioVolume: settings.audioVolume,
      thumbnailFontName: settings.thumbnailFontName,
      blackoutTop: settings.blackoutTop,
      audioSpeed: settings.audioSpeed,
    },
  };
}

export async function syncSessionWithProjectSettings(
  sessionPath: string,
  payload: {
    projectSettings: CaptionProjectSettingsValues;
    revision: number;
    updatedAt: string;
    source?: 'project_default' | 'session_runtime';
  },
  fallback?: { projectId?: string | null; inputType?: CaptionInputType; sourcePath?: string; folderPath?: string }
): Promise<void> {
  await updateCaptionSession(
    sessionPath,
    (session) => ({
      ...session,
      settings: {
        ...session.settings,
        ...buildProjectSettingsMirror(payload.projectSettings),
      },
      effectiveSettingsRevision: payload.revision,
      effectiveSettingsUpdatedAt: payload.updatedAt,
      effectiveSettingsSource: payload.source || 'project_default',
      syncState: 'synced',
    }),
    fallback
  );
}

export function scheduleSessionSettingsRetry(
  sessionPath: string,
  task: () => Promise<void>,
  attempt = 1
) {
  if (attempt > 3) {
    return;
  }
  const oldTimer = sessionSyncRetryTimers.get(sessionPath);
  if (oldTimer != null) {
    window.clearTimeout(oldTimer);
  }
  const delay = attempt * 1200;
  const timer = window.setTimeout(async () => {
    try {
      await task();
      sessionSyncRetryTimers.delete(sessionPath);
    } catch {
      scheduleSessionSettingsRetry(sessionPath, task, attempt + 1);
    }
  }, delay);
  sessionSyncRetryTimers.set(sessionPath, timer);
}
