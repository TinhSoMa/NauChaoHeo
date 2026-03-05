import { UniversalRotationQueueService } from './universalRotationQueueService';
import { RemoveQueueRuntimeOptions, UniversalRotationQueueServiceOptions } from './rotationTypes';

const DEFAULT_RUNTIME_KEY = 'default';
const runtimes = new Map<string, UniversalRotationQueueService>();
const shutdownInFlightByKey = new Map<string, Promise<boolean>>();

function normalizeRuntimeKey(featureKey: string): string {
  const trimmed = featureKey?.trim();
  return trimmed || DEFAULT_RUNTIME_KEY;
}

export function isRotationQueueInspectorEnabled(): boolean {
  return process.env.ENABLE_ROTATION_QUEUE_INSPECTOR === '1';
}

export function isRotationQueuePayloadDebugEnabled(): boolean {
  if (process.env.ENABLE_ROTATION_QUEUE_PAYLOAD_DEBUG === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

function buildDefaultRuntimeOptions(): UniversalRotationQueueServiceOptions {
  return {
    enableServiceAllocator: true,
    enableRotationQueueInspector: isRotationQueueInspectorEnabled(),
    inspectorHistoryCapacity: 1_000,
    allowInspectorPayloadRaw: isRotationQueuePayloadDebugEnabled()
  };
}

export function getQueueRuntime(featureKey: string): UniversalRotationQueueService {
  const key = normalizeRuntimeKey(featureKey);
  const runtime = runtimes.get(key);
  if (!runtime) {
    throw new Error(`UniversalRotationQueue runtime "${key}" does not exist.`);
  }
  return runtime;
}

export function getQueueRuntimeOrCreate(
  featureKey: string,
  options?: UniversalRotationQueueServiceOptions
): UniversalRotationQueueService {
  const key = normalizeRuntimeKey(featureKey);
  const existing = runtimes.get(key);
  if (existing) return existing;

  const runtime = new UniversalRotationQueueService({
    ...buildDefaultRuntimeOptions(),
    ...(options ?? {})
  });
  runtimes.set(key, runtime);
  return runtime;
}

export function removeQueueRuntime(featureKey: string): boolean;
export function removeQueueRuntime(
  featureKey: string,
  options: RemoveQueueRuntimeOptions & { shutdown?: false }
): boolean;
export function removeQueueRuntime(
  featureKey: string,
  options: RemoveQueueRuntimeOptions & { shutdown: true }
): Promise<boolean>;
export function removeQueueRuntime(
  featureKey: string,
  options: RemoveQueueRuntimeOptions = {}
): boolean | Promise<boolean> {
  return removeQueueRuntimeInternal(featureKey, options);
}

export async function removeAllQueueRuntimes(
  options: RemoveQueueRuntimeOptions = {}
): Promise<number> {
  const keys = [...runtimes.keys()];
  if (keys.length === 0) return 0;

  if (!options.shutdown) {
    for (const key of keys) {
      runtimes.delete(key);
    }
    return keys.length;
  }

  const results = await Promise.all(
    keys.map((key) =>
      removeQueueRuntime(key, {
        shutdown: true,
        force: options.force,
        reason: options.reason,
        timeoutMs: options.timeoutMs
      })
    )
  );

  return results.filter(Boolean).length;
}

export function listQueueRuntimeKeys(): string[] {
  return [...runtimes.keys()];
}

export function setQueueRuntimeForTesting(
  featureKey: string,
  runtime: UniversalRotationQueueService | null
): void {
  const key = normalizeRuntimeKey(featureKey);
  if (runtime) {
    runtimes.set(key, runtime);
    return;
  }
  runtimes.delete(key);
}

function removeQueueRuntimeInternal(
  featureKey: string,
  options: RemoveQueueRuntimeOptions
): boolean | Promise<boolean> {
  const key = normalizeRuntimeKey(featureKey);

  if (!options.shutdown) {
    return runtimes.delete(key);
  }

  const inFlight = shutdownInFlightByKey.get(key);
  if (inFlight) return inFlight;

  const removal = (async (): Promise<boolean> => {
    const runtime = runtimes.get(key);
    if (!runtime) return false;

    try {
      await shutdownRuntimeSafely(runtime, options);
      return true;
    } finally {
      runtimes.delete(key);
      shutdownInFlightByKey.delete(key);
    }
  })();

  shutdownInFlightByKey.set(key, removal);
  return removal;
}

async function shutdownRuntimeSafely(
  runtime: UniversalRotationQueueService,
  options: RemoveQueueRuntimeOptions
): Promise<void> {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 30_000));
  const reason = options.reason ?? 'Runtime removed';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Runtime shutdown timeout after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    await Promise.race([runtime.shutdown({ force: options.force, reason }), timeoutPromise]);
  } catch (error) {
    // Fallback to forced shutdown to avoid dangling jobs/resources.
    await runtime.shutdown({
      force: true,
      reason: `${reason}; fallback forced shutdown`
    });
    if (options.force !== true) {
      console.warn('[UniversalRotationQueue] graceful shutdown fallback to force:', error);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
