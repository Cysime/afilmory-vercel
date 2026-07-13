export function backoffDelay(
  attempt: number,
  baseMs = 300,
  maxMs = 4000,
): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  const jitter = Math.random() * 0.3 * exp;
  return Math.floor(exp + jitter);
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
