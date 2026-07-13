export class WorkerWatchdogTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "WorkerWatchdogTimeoutError";
  }
}

export async function runWithWatchdog<T>(
  callback: (signal: AbortSignal) => Promise<T>,
  options: { label: string; timeoutMs: number; waitForAbort?: boolean },
): Promise<T> {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 86_400_000
  ) {
    throw new Error(
      "watchdog timeoutMs must be a positive integer <= 86400000",
    );
  }
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WorkerWatchdogTimeoutError(options.label, options.timeoutMs));
    }, options.timeoutMs);
  });

  const task = Promise.resolve().then(
    async () => await callback(controller.signal),
  );
  try {
    return await Promise.race([task, timeout]);
  } catch (error) {
    if (options.waitForAbort && error instanceof WorkerWatchdogTimeoutError) {
      // In-process tasks cannot be force-killed safely. Wait for cooperative
      // cancellation before the caller disposes shared storage/plugin services,
      // otherwise a timed-out task can keep writing artifacts after failure.
      await task.catch(() => {});
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
