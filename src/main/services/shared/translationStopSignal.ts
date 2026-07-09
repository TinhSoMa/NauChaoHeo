const STOP_LABEL = 'STOP_REQUESTED';

const featureState = new Map<string, {
  stopRequested: boolean;
  stopRunId: string | undefined;
  listeners: Set<(runId?: string) => void>;
  activeRunId: string | undefined;
}>();

function getOrCreateFeature(feature: string) {
  let state = featureState.get(feature);
  if (!state) {
    state = { stopRequested: false, stopRunId: undefined, listeners: new Set(), activeRunId: undefined };
    featureState.set(feature, state);
  }
  return state;
}

function normalizeRunId(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function beginFeatureRun(feature: string, runId?: string | null): void {
  const state = getOrCreateFeature(feature);
  state.stopRequested = false;
  state.stopRunId = undefined;
  state.activeRunId = normalizeRunId(runId);
}

export function endFeatureRun(feature: string, runId?: string | null): void {
  const state = getOrCreateFeature(feature);
  const normalized = normalizeRunId(runId);
  if (!normalized || state.activeRunId === normalized) {
    state.activeRunId = undefined;
  }
  if (state.stopRunId && normalized && state.stopRunId === normalized) {
    state.stopRequested = false;
    state.stopRunId = undefined;
  }
}

export function isFeatureActive(feature: string, runId?: string | null): boolean {
  const state = getOrCreateFeature(feature);
  if (!state.activeRunId) return false;
  const normalized = normalizeRunId(runId);
  if (!normalized) return true;
  return state.activeRunId === normalized;
}

function shouldStop(feature: string, runId?: string | null): boolean {
  const state = getOrCreateFeature(feature);
  if (!state.stopRequested) return false;
  if (!state.stopRunId) return true;
  const normalized = normalizeRunId(runId);
  return !!normalized && normalized === state.stopRunId;
}

export function throwIfStopped(feature: string, runId?: string | null): void {
  if (shouldStop(feature, runId)) {
    throw new Error(STOP_LABEL);
  }
}

export function isStopSignal(error: unknown): boolean {
  return error instanceof Error && error.message === STOP_LABEL;
}

export function createStopSignal(
  feature: string,
  runId?: string | null
): { promise: Promise<void>; dispose: () => void } {
  const state = getOrCreateFeature(feature);
  const normalized = normalizeRunId(runId);
  let disposed = false;
  let resolveRef: (() => void) | null = null;
  const listener = (stoppedRunId?: string) => {
    if (disposed) return;
    if (!stoppedRunId || !normalized || stoppedRunId === normalized) {
      disposed = true;
      state.listeners.delete(listener);
      resolveRef?.();
    }
  };
  const promise = new Promise<void>((resolve) => {
    resolveRef = resolve;
    state.listeners.add(listener);
    if (shouldStop(feature, normalized)) {
      listener(normalized);
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    state.listeners.delete(listener);
  };
  return { promise, dispose };
}

export function stopFeatureTranslation(
  feature: string,
  runId?: string | null
): { stopped: boolean; message: string } {
  const state = getOrCreateFeature(feature);
  const normalized = normalizeRunId(runId);
  const targetRunId = normalized || state.activeRunId;
  if (!targetRunId) {
    state.stopRequested = false;
    state.stopRunId = undefined;
    return { stopped: false, message: 'Không có tiến trình dịch đang chạy.' };
  }
  state.stopRequested = true;
  state.stopRunId = targetRunId;
  for (const listener of Array.from(state.listeners)) {
    try {
      listener(targetRunId);
    } catch {
      // ignore listener errors
    }
  }
  return { stopped: true, message: 'Đã gửi tín hiệu dừng dịch.' };
}
