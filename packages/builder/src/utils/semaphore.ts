interface SemaphoreWaiter {
  weight: number;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
}

export interface SemaphoreAcquireOptions {
  /** Number of permits to reserve. Defaults to 1. */
  weight?: number;
  signal?: AbortSignal;
}

/**
 * Counting semaphore with weighted permits and strict FIFO fairness: when the
 * waiter at the head of the queue does not fit, lighter waiters behind it are
 * not granted first, so a large reservation can never be starved.
 */
export class Semaphore {
  private available: number;
  private readonly queue: SemaphoreWaiter[] = [];

  constructor(private readonly permits: number) {
    if (!Number.isSafeInteger(permits) || permits <= 0) {
      throw new Error("Semaphore permits must be a positive integer");
    }
    this.available = permits;
  }

  async acquire(options: SemaphoreAcquireOptions = {}): Promise<() => void> {
    const weight = options.weight ?? 1;
    const { signal } = options;
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new Error("Semaphore weight must be a positive integer");
    }
    if (weight > this.permits) {
      throw new Error(
        `Semaphore weight ${weight} exceeds the total permit count ${this.permits}`,
      );
    }
    signal?.throwIfAborted();
    // The queue-empty check preserves FIFO: available permits may be nonzero
    // while a heavier waiter is still parked at the head of the queue.
    if (this.queue.length === 0 && this.available >= weight) {
      this.available -= weight;
      return this.createRelease(weight);
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: SemaphoreWaiter = { weight, resolve, reject, signal };
      if (signal) {
        waiter.abortListener = () => {
          const index = this.queue.indexOf(waiter);
          if (index !== -1) this.queue.splice(index, 1);
          reject(signal.reason);
          // Removing a heavy waiter from the head can unblock lighter
          // waiters queued behind it without any release happening.
          this.drain();
        };
        signal.addEventListener("abort", waiter.abortListener, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private createRelease(weight: number): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.available += weight;
      this.drain();
    };
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (head.signal?.aborted) {
        this.queue.shift();
        if (head.abortListener) {
          head.signal.removeEventListener("abort", head.abortListener);
        }
        head.reject(head.signal.reason);
        continue;
      }
      if (head.weight > this.available) return;
      this.queue.shift();
      if (head.signal && head.abortListener) {
        head.signal.removeEventListener("abort", head.abortListener);
      }
      this.available -= head.weight;
      head.resolve(this.createRelease(head.weight));
    }
  }

  async run<T>(
    fn: () => Promise<T>,
    options: SemaphoreAcquireOptions = {},
  ): Promise<T> {
    const release = await this.acquire(options);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
