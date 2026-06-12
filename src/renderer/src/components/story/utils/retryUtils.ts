const BASE_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 60000;

export function getInfiniteRetryDelayMs(retryCount: number): number {
  const normalizedRetryCount = Math.max(1, Math.floor(retryCount));
  const exponentialDelay = BASE_RETRY_DELAY_MS * Math.pow(2, normalizedRetryCount - 1);
  return Math.min(MAX_RETRY_DELAY_MS, exponentialDelay);
}

export function normalizeRetryError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'Unknown retry error');
}
