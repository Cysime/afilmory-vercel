interface SemaphoreWaiter {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
}

export class Semaphore {
  private permits: number;
  private queue: SemaphoreWaiter[] = [];

  constructor(permits: number) {
    if (!Number.isSafeInteger(permits) || permits <= 0) {
      throw new Error("Semaphore permits must be a positive integer");
    }
    this.permits = permits;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: SemaphoreWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.abortListener = () => {
          const index = this.queue.indexOf(waiter);
          if (index !== -1) this.queue.splice(index, 1);
          reject(signal.reason);
        };
        signal.addEventListener("abort", waiter.abortListener, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private release(): void {
    this.permits++;
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.signal && next.abortListener) {
        next.signal.removeEventListener("abort", next.abortListener);
      }
      if (next.signal?.aborted) {
        next.reject(next.signal.reason);
        continue;
      }
      this.permits--;
      next.resolve(() => this.release());
      break;
    }
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
