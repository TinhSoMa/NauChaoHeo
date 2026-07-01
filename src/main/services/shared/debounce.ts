/**
 * Promise-based debounce for IPC handlers
 */
export function debounce<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { resolve: (value: Awaited<ReturnType<T>>) => void; reject: (err: unknown) => void } | null = null;
  return (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    if (timer) clearTimeout(timer);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      timer = setTimeout(async () => {
        timer = null;
        pending = null;
        try {
          const result: Awaited<ReturnType<T>> = await fn(...args) as Awaited<ReturnType<T>>;
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }, ms);
    });
  };
}
