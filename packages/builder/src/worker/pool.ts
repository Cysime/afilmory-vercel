import type { Logger } from "../logger/index.js";
import { logger } from "../logger/index.js";
import { runWithWatchdog } from "./watchdog.js";

export interface TaskCompletedPayload<T> {
  taskIndex: number;
  completed: number;
  total: number;
  result: T;
}

export interface WorkerPoolOptions<T> {
  concurrency: number;
  drainTimedOutTasks?: boolean;
  totalTasks: number;
  logger?: Logger;
  onTaskCompleted?: (payload: TaskCompletedPayload<T>) => void;
  timeoutMs?: number;
}

export type TaskFunction<T> = (
  taskIndex: number,
  workerId: number,
  signal?: AbortSignal,
) => Promise<T>;

// Worker 池管理器
export class WorkerPool<T> {
  private concurrency: number;
  private totalTasks: number;
  private taskIndex = 0;
  private logger: Logger;
  private completedTasks = 0;
  private onTaskCompleted?: (payload: TaskCompletedPayload<T>) => void;
  private readonly timeoutMs: number;
  private readonly drainTimedOutTasks: boolean;

  constructor(options: WorkerPoolOptions<T>) {
    this.concurrency = options.concurrency;
    this.totalTasks = options.totalTasks;
    this.logger = options.logger ?? logger;
    this.onTaskCompleted = options.onTaskCompleted;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.drainTimedOutTasks = options.drainTimedOutTasks ?? false;
    if (
      !Number.isSafeInteger(this.concurrency) ||
      this.concurrency <= 0 ||
      this.concurrency > 1024
    ) {
      throw new Error(
        "WorkerPool concurrency must be a positive integer <= 1024",
      );
    }
    if (
      !Number.isSafeInteger(this.totalTasks) ||
      this.totalTasks < 0 ||
      this.totalTasks > 10_000_000
    ) {
      throw new Error(
        "WorkerPool totalTasks must be a non-negative integer <= 10000000",
      );
    }
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 86_400_000
    ) {
      throw new Error(
        "WorkerPool timeoutMs must be a positive integer <= 86400000",
      );
    }
  }

  async execute(taskFunction: TaskFunction<T>): Promise<T[]> {
    const results: T[] = Array.from({ length: this.totalTasks });
    let firstError: Error | undefined;

    this.logger.main.info(
      `Starting task processing (worker pool mode), concurrency: ${this.concurrency}`,
    );

    // Worker 函数
    const worker = async (workerId: number): Promise<void> => {
      const workerLogger = this.logger.worker(workerId);
      workerLogger.start(`Worker ${workerId} starting`);

      let processedByWorker = 0;

      while (!firstError && this.taskIndex < this.totalTasks) {
        const currentIndex = this.taskIndex++;
        if (currentIndex >= this.totalTasks) break;

        workerLogger.info(
          `Processing task ${currentIndex + 1}/${this.totalTasks}`,
        );

        const startTime = Date.now();
        let result: T;
        try {
          result = await runWithWatchdog(
            async (signal) =>
              await taskFunction(currentIndex, workerId, signal),
            {
              label: `Worker ${workerId} task ${currentIndex + 1}`,
              timeoutMs: this.timeoutMs,
              waitForAbort: this.drainTimedOutTasks,
            },
          );
        } catch (error) {
          firstError ??=
            error instanceof Error ? error : new Error(String(error));
          workerLogger.error(
            `Task ${currentIndex + 1}/${this.totalTasks} failed`,
            firstError,
          );
          break;
        }
        const duration = Date.now() - startTime;

        results[currentIndex] = result;
        processedByWorker++;
        this.completedTasks++;

        try {
          this.onTaskCompleted?.({
            taskIndex: currentIndex,
            completed: this.completedTasks,
            total: this.totalTasks,
            result,
          });
        } catch (error) {
          // Progress callbacks are user code. Route their failure through the
          // same coordinated drain path as task failures; allowing the worker
          // promise to reject directly would make Promise.all return while
          // sibling tasks are still using shared storage/plugin resources.
          firstError ??=
            error instanceof Error ? error : new Error(String(error));
          workerLogger.error("Task completion callback failed", firstError);
          break;
        }

        workerLogger.info(
          `Completed task ${currentIndex + 1}/${this.totalTasks} - ${duration}ms`,
        );
      }

      workerLogger.success(
        `Worker ${workerId} finished, processed ${processedByWorker} tasks`,
      );
    };

    // 启动工作池
    const workers = Array.from(
      { length: Math.min(this.concurrency, this.totalTasks) },
      (_, i) => worker(i + 1),
    );
    // Every worker observes firstError before taking another task. Waiting for
    // all worker loops here lets already-started work settle before the caller
    // tears down shared services.
    await Promise.all(workers);

    if (firstError) throw firstError;

    return results;
  }
}
