/* eslint-disable unicorn/prefer-event-target */
import type { Worker } from "node:cluster";
import cluster from "node:cluster";
import { EventEmitter } from "node:events";
import process from "node:process";

import type { Logger } from "../logger/index.js";
import { logger } from "../logger/index.js";
import type {
  BatchTaskMessage,
  BatchTaskResult,
  ClusterWorkerMessage,
  ClusterWorkerSharedData,
  TaskResult,
  WorkerInitMessage,
  WorkerStats,
} from "./cluster-protocol.js";
import type { QueuedClusterTask } from "./cluster-scheduler.js";
import {
  calculateWorkersToStart,
  createInitialTaskQueue,
  getAvailableWorkerSlots,
  selectBatchTaskAssignments,
} from "./cluster-scheduler.js";
import type { TaskCompletedPayload } from "./pool.js";

export type {
  BatchTaskMessage,
  BatchTaskResult,
  ClusterWorkerMessage,
  ClusterWorkerSharedData,
  TaskMessage,
  TaskResult,
  WorkerInitMessage,
  WorkerReadyMessage,
  WorkerStats,
} from "./cluster-protocol.js";

const WORKER_SHUTDOWN_GRACE_MS = 5_000;

// worker 生命周期（与 runAsWorker 的握手一一对应）：
// starting（进程已 fork，等待首个 ready 消息）
// → initializing（已下发 init 数据，等待 init-complete）
// → ready（初始化完成，可接受任务）
export type WorkerLifecycleState = "starting" | "initializing" | "ready";

// 单个 worker 的全部运行时状态。之前分散在 workers / workerStats / readyWorkers /
// workerTaskCounts / initializedWorkers 等平行 Map/Set 中，清理、失败、关闭路径
// 必须手动保持同步；收敛为单一 handle 后按 worker 原子增删。
interface WorkerHandle {
  worker: Worker;
  state: WorkerLifecycleState;
  processedTasks: number; // 已成功处理的任务数
  activeTaskCount: number; // 当前正在处理的任务数
  activeTaskIds: Set<string>;
  watchdog?: NodeJS.Timeout;
}

export interface ClusterPoolOptions<T> {
  concurrency: number;
  totalTasks: number;
  logger?: Logger;
  workerEnv?: Record<string, string>; // 传递给 worker 的环境变量
  workerConcurrency?: number; // 每个 worker 内部的并发数
  sharedData?: ClusterWorkerSharedData;
  onTaskCompleted?: (payload: TaskCompletedPayload<T>) => void;
  /** Startup/init/task-batch watchdog. */
  timeoutMs?: number;
}

// 基于 Node.js cluster 的 Worker 池管理器
export class ClusterPool<T> extends EventEmitter {
  private concurrency: number;
  private totalTasks: number;
  private workerEnv: Record<string, string>;
  private workerConcurrency: number;
  private logger: Logger;
  private sharedData?: ClusterPoolOptions<T>["sharedData"];
  private onTaskCompleted?: (payload: TaskCompletedPayload<T>) => void;
  private readonly timeoutMs: number;

  private taskQueue: QueuedClusterTask[] = [];
  private workerHandles = new Map<number, WorkerHandle>();
  // 已派发、尚未收到结果的任务 ID，用于过滤重复/未知的结果消息。
  // 任务崩溃不做重入队：任何 worker 异常都会 fail-fast 整个构建。
  private pendingTaskIds = new Set<string>();
  private results: T[] = [];
  private completedTasks = 0;
  private isShuttingDown = false;
  private hasFailed = false;

  constructor(options: ClusterPoolOptions<T>) {
    super();
    this.concurrency = options.concurrency;
    this.totalTasks = options.totalTasks;
    this.workerEnv = options.workerEnv || {};
    this.workerConcurrency = options.workerConcurrency ?? 5; // 默认每个 worker 同时处理 5 个任务
    this.logger = options.logger ?? logger;
    this.sharedData = options.sharedData;
    this.onTaskCompleted = options.onTaskCompleted;
    this.timeoutMs = options.timeoutMs ?? 300_000;

    if (
      !Number.isSafeInteger(this.concurrency) ||
      this.concurrency <= 0 ||
      this.concurrency > 1024
    ) {
      throw new Error(
        "ClusterPool concurrency must be a positive integer <= 1024",
      );
    }
    if (
      !Number.isSafeInteger(this.totalTasks) ||
      this.totalTasks < 0 ||
      this.totalTasks > 10_000_000
    ) {
      throw new Error(
        "ClusterPool totalTasks must be a non-negative integer <= 10000000",
      );
    }
    if (
      !Number.isSafeInteger(this.workerConcurrency) ||
      this.workerConcurrency <= 0 ||
      this.workerConcurrency > 1024
    ) {
      throw new Error(
        "ClusterPool workerConcurrency must be a positive integer <= 1024",
      );
    }
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 86_400_000
    ) {
      throw new Error(
        "ClusterPool timeoutMs must be a positive integer <= 86400000",
      );
    }

    // 没有 sharedData 的 worker 无法重建 builder，也永远等不到 init-complete——
    // 那是静默死锁。有任务就必须有共享数据，缺了在构造期就大声失败。
    if (this.totalTasks > 0 && !this.sharedData) {
      throw new Error(
        "ClusterPool requires sharedData when totalTasks > 0 (workers cannot initialize without it).",
      );
    }

    this.results = Array.from({ length: this.totalTasks });
  }

  async execute(): Promise<T[]> {
    this.logger.main.info(
      `Starting task processing (cluster mode), process count: ${this.concurrency}, total tasks: ${this.totalTasks}`,
    );

    if (this.totalTasks === 0) {
      this.taskQueue = [];
      return [];
    }

    this.taskQueue = createInitialTaskQueue(this.totalTasks);

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanupListeners = () => {
        this.removeListener("allTasksCompleted", handleAllTasksCompleted);
        this.removeListener("error", handleError);
      };
      const settleWithError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        void this.shutdown()
          .catch((shutdownError: unknown) => {
            this.logger.main.warn(
              `Error while shutting down the process pool: ${
                shutdownError instanceof Error
                  ? shutdownError.message
                  : String(shutdownError)
              }`,
            );
          })
          .finally(() => {
            reject(error);
          });
      };
      const handleAllTasksCompleted = () => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        this.logger.main.success(
          `All tasks completed, shutting down the process pool`,
        );
        this.shutdown()
          .then(() => {
            resolve(this.results);
          })
          .catch(reject);
      };
      const handleError = (error: Error) => {
        settleWithError(error);
      };

      this.once("allTasksCompleted", handleAllTasksCompleted);
      this.once("error", handleError);

      void this.startWorkers().catch((error: unknown) => {
        this.fail(this.normalizeTaskError("cluster-startup", error));
      });
    });
  }

  private async startWorkers(): Promise<void> {
    // 设置 cluster 环境变量以启用 worker 模式
    cluster.setupPrimary({
      exec: process.argv[1], // 使用当前脚本 (CLI) 作为 worker
      args: ["--cluster-worker"], // 传递 worker 标识参数
      silent: false,
      // advanced = v8 结构化克隆序列化：Map/Date/Buffer 等可直接通过 IPC 传输，
      // 共享数据无需手动 v8.serialize -> Array.from(buffer) -> JSON 的逐字节中转。
      serialization: "advanced",
    });

    const { requiredWorkers, workersToStart } = calculateWorkersToStart({
      concurrency: this.concurrency,
      totalTasks: this.totalTasks,
      workerConcurrency: this.workerConcurrency,
    });

    this.logger.main.info(
      `Computing worker count: total tasks ${this.totalTasks}, per-worker concurrency ${this.workerConcurrency}, ${requiredWorkers} required, ${workersToStart} actually started`,
    );

    const starts: Array<Promise<void>> = [];
    for (let i = 1; i <= workersToStart; i++) {
      starts.push(this.createWorker(i));
    }
    await Promise.all(starts);
  }

  private async createWorker(workerId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = cluster.fork({
        WORKER_ID: workerId.toString(),
        CLUSTER_WORKER: "true",
        WORKER_CONCURRENCY: this.workerConcurrency.toString(),
        ...this.workerEnv, // 传递自定义环境变量
      });

      this.workerHandles.set(workerId, {
        worker,
        state: "starting",
        processedTasks: 0,
        activeTaskCount: 0,
        activeTaskIds: new Set(),
      });

      const workerLogger = this.logger.worker(workerId);

      const startupTimer = setTimeout(() => {
        reject(new Error(`Worker ${workerId} startup timed out`));
      }, this.timeoutMs);

      worker.on("online", () => {
        workerLogger.start(
          `Worker ${workerId} process started (PID: ${worker.process?.pid})`,
        );
        clearTimeout(startupTimer);
        this.armWorkerWatchdog(workerId, "ready handshake");
        resolve();
      });

      worker.on("message", (message: ClusterWorkerMessage) => {
        switch (message.type) {
          case "ready": {
            this.handleWorkerReady(workerId);

            break;
          }
          case "init-complete": {
            this.handleWorkerInitComplete(workerId);

            break;
          }
          case "batch-result": {
            this.handleWorkerBatchResult(workerId, message as BatchTaskResult);

            break;
          }
          default: {
            this.handleWorkerMessage(workerId, message as TaskResult);
          }
        }
      });

      worker.on("error", (error) => {
        workerLogger.error(`Worker ${workerId} process error:`, error);
        this.fail(error);
      });

      worker.on("exit", (code, signal) => {
        if (!this.isShuttingDown && !this.hasFailed) {
          workerLogger.error(
            `Worker ${workerId} exited unexpectedly (code: ${code}, signal: ${signal})`,
          );
          clearTimeout(startupTimer);
          this.workerHandles.delete(workerId);
          this.fail(
            new Error(
              `Worker ${workerId} exited unexpectedly (code: ${code ?? "null"}, signal: ${signal ?? "null"})`,
            ),
          );
        } else {
          workerLogger.info(`Worker ${workerId} exited normally`);
        }
      });
    });
  }

  private handleWorkerReady(workerId: number): void {
    const handle = this.workerHandles.get(workerId);
    if (!handle) return;

    const workerLogger = this.logger.worker(workerId);

    // 生命周期是严格线性的 starting → initializing → ready；ready 消息只在
    // starting 阶段有意义，其余状态一律忽略（绝不能把未完成 init 握手的
    // worker 标记为可接任务）。
    if (handle.state !== "starting") {
      workerLogger.warn(
        `Worker ${workerId} sent "ready" while in "${handle.state}" state; ignoring (ready is only expected once, before init).`,
      );
      return;
    }

    this.clearWorkerWatchdog(handle);

    // 首次 ready：发送初始化数据，等待 init-complete 后才算真正就绪
    if (this.sharedData) {
      // IPC 通道已启用 advanced（v8）序列化，existingManifestMap / livePhotoMap
      // 等 Map 结构可原生传输并在 worker 侧还原类型，直接发送共享数据本体。
      const initMessage: WorkerInitMessage = {
        type: "init",
        sharedData: this.sharedData,
      };
      handle.worker.send(initMessage);
      workerLogger.info(`Sending init data to Worker ${workerId}`);
    }

    handle.state = "initializing";
    this.armWorkerWatchdog(workerId, "initialization");
    workerLogger.info(
      `Worker ${workerId} received init request, waiting for initialization to complete`,
    );
  }

  private handleWorkerInitComplete(workerId: number): void {
    const handle = this.workerHandles.get(workerId);
    if (!handle) return;

    if (handle.state !== "initializing") {
      this.logger
        .worker(workerId)
        .warn(
          `Worker ${workerId} sent init-complete while in ${handle.state}; ignoring`,
        );
      return;
    }

    this.clearWorkerWatchdog(handle);
    handle.state = "ready";
    this.logger
      .worker(workerId)
      .info(`Worker ${workerId} initialized, ready to accept tasks`);
    this.emit("workerReady", workerId);

    // 立即为这个 worker 分配任务
    this.assignBatchTasksToWorker(workerId);
  }

  private assignBatchTasksToWorker(workerId: number): void {
    if (this.hasFailed || this.isShuttingDown || this.taskQueue.length === 0)
      return;

    const handle = this.workerHandles.get(workerId);

    // 只有完成初始化握手（state === "ready"）的 worker 才能接任务
    if (!handle || handle.state !== "ready") return;

    const availableSlots = getAvailableWorkerSlots(
      handle.activeTaskCount,
      this.workerConcurrency,
    );
    if (availableSlots === 0) return;

    const { remainingQueue, tasks } = selectBatchTaskAssignments({
      availableSlots,
      taskQueue: this.taskQueue,
      timestamp: Date.now(),
      workerId,
    });
    this.taskQueue = remainingQueue;
    if (tasks.length === 0) return;

    for (const task of tasks) {
      this.pendingTaskIds.add(task.taskId);
      handle.activeTaskIds.add(task.taskId);
    }
    handle.activeTaskCount += tasks.length;

    // 发送批量任务
    const message: BatchTaskMessage = {
      type: "batch-task",
      tasks,
      workerId,
    };

    handle.worker.send(message);
    this.armWorkerWatchdog(
      workerId,
      `batch (${tasks.map((task) => task.taskIndex + 1).join(", ")})`,
    );

    this.logger
      .worker(workerId)
      .info(
        `Assigned ${tasks.length} tasks (in progress: ${handle.activeTaskCount}/${this.workerConcurrency})`,
      );
  }

  private handleWorkerBatchResult(
    workerId: number,
    message: BatchTaskResult,
  ): void {
    const handle = this.workerHandles.get(workerId);
    if (!handle) return;

    this.clearWorkerWatchdog(handle);

    const workerLogger = this.logger.worker(workerId);

    let completedInBatch = 0;
    let successfulInBatch = 0;

    // 处理批量结果中的每个任务
    for (const taskResult of message.results) {
      if (!this.pendingTaskIds.has(taskResult.taskId)) {
        workerLogger.warn(`Received unknown task result: ${taskResult.taskId}`);
        continue;
      }

      this.pendingTaskIds.delete(taskResult.taskId);
      handle.activeTaskIds.delete(taskResult.taskId);
      completedInBatch++;

      if (taskResult.type === "result" && taskResult.result !== undefined) {
        const { taskIndex } = taskResult;
        const result = taskResult.result as T;
        this.results[taskIndex] = result;
        successfulInBatch++;

        this.completedTasks++;

        this.onTaskCompleted?.({
          taskIndex,
          completed: this.completedTasks,
          total: this.totalTasks,
          result,
        });
      } else if (taskResult.type === "error") {
        const taskError = this.normalizeTaskError(
          taskResult.taskId,
          taskResult.error,
        );
        workerLogger.error(
          `Task execution failed: ${taskResult.taskId}`,
          taskResult.error,
        );
        this.fail(taskError);
        return;
      }
    }

    // 更新 worker 状态
    handle.activeTaskCount = Math.max(
      0,
      handle.activeTaskCount - completedInBatch,
    );
    handle.processedTasks += successfulInBatch;

    if (handle.activeTaskIds.size > 0) {
      this.armWorkerWatchdog(workerId, "remaining batch results");
    }

    workerLogger.info(
      `Completed batch: ${successfulInBatch}/${completedInBatch} succeeded (total completed: ${this.completedTasks}/${this.totalTasks}, in progress: ${handle.activeTaskCount})`,
    );

    // 检查是否所有任务都已完成
    if (this.completedTasks >= this.totalTasks) {
      this.emit("allTasksCompleted");
      return;
    }

    // 为该 worker 分配下一批任务
    this.assignBatchTasksToWorker(workerId);
  }

  private handleWorkerMessage(workerId: number, message: TaskResult): void {
    const handle = this.workerHandles.get(workerId);
    if (!handle) return;

    this.clearWorkerWatchdog(handle);

    const workerLogger = this.logger.worker(workerId);

    if (!this.pendingTaskIds.has(message.taskId)) {
      workerLogger.warn(`Received unknown task result: ${message.taskId}`);
      if (handle.activeTaskIds.size > 0) {
        this.armWorkerWatchdog(workerId, "task results");
      }
      return;
    }

    this.pendingTaskIds.delete(message.taskId);
    handle.activeTaskIds.delete(message.taskId);

    // 更新任务计数
    handle.activeTaskCount = Math.max(0, handle.activeTaskCount - 1);

    if (message.type === "result" && message.result !== undefined) {
      const { taskIndex } = message;
      const result = message.result as T;
      this.results[taskIndex] = result;
      handle.processedTasks++;

      this.completedTasks++;
      this.onTaskCompleted?.({
        taskIndex,
        completed: this.completedTasks,
        total: this.totalTasks,
        result,
      });
      workerLogger.info(
        `Completed task ${taskIndex + 1}/${this.totalTasks} (completed: ${this.completedTasks}, in progress: ${handle.activeTaskCount})`,
      );

      // 检查是否所有任务都已完成
      if (this.completedTasks >= this.totalTasks) {
        this.emit("allTasksCompleted");
        return;
      }
    } else if (message.type === "error") {
      const taskError = this.normalizeTaskError(message.taskId, message.error);
      workerLogger.error(
        `Task execution failed: ${message.taskId}`,
        message.error,
      );
      this.fail(taskError);
      return;
    }

    if (handle.activeTaskIds.size > 0) {
      this.armWorkerWatchdog(workerId, "remaining task results");
    }

    // 为该 worker 分配下一批任务
    this.assignBatchTasksToWorker(workerId);
  }

  private normalizeTaskError(taskId: string, error: unknown): Error {
    if (error instanceof Error) return error;
    const message =
      typeof error === "string" && error.length > 0
        ? error
        : "Unknown worker task error";
    return new Error(`Worker task ${taskId} failed: ${message}`);
  }

  private fail(error: Error): void {
    if (this.hasFailed || this.isShuttingDown) return;

    this.hasFailed = true;
    this.taskQueue = [];
    this.pendingTaskIds.clear();

    if (this.listenerCount("error") > 0) {
      this.emit("error", error);
      return;
    }

    this.logger.main.error(
      "Process pool error with no active execution listener",
      error,
    );
  }

  private armWorkerWatchdog(workerId: number, phase: string): void {
    const handle = this.workerHandles.get(workerId);
    if (!handle || this.hasFailed || this.isShuttingDown) return;
    this.clearWorkerWatchdog(handle);
    handle.watchdog = setTimeout(() => {
      this.fail(
        new Error(
          `Worker ${workerId} ${phase} timed out after ${this.timeoutMs}ms`,
        ),
      );
    }, this.timeoutMs);
  }

  private clearWorkerWatchdog(handle: WorkerHandle): void {
    if (!handle.watchdog) return;
    clearTimeout(handle.watchdog);
    handle.watchdog = undefined;
  }

  private async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const shutdownPromises: Promise<void>[] = [];

    for (const handle of this.workerHandles.values()) {
      this.clearWorkerWatchdog(handle);
      const { worker } = handle;
      shutdownPromises.push(
        new Promise((resolve) => {
          const timeout = setTimeout(() => {
            worker.kill("SIGKILL");
            resolve();
          }, WORKER_SHUTDOWN_GRACE_MS);

          worker.on("exit", () => {
            clearTimeout(timeout);
            resolve();
          });

          // 发送关闭信号
          if (worker.isConnected()) {
            worker.send({ type: "shutdown" });
          } else {
            worker.kill("SIGTERM");
          }
        }),
      );
    }

    await Promise.all(shutdownPromises);
    this.workerHandles.clear();
    this.pendingTaskIds.clear();
  }

  // 获取 worker 统计信息（从 WorkerHandle 派生）
  getWorkerStats(): WorkerStats[] {
    return Array.from(
      this.workerHandles.entries(),
      ([workerId, handle]): WorkerStats => ({
        workerId,
        processedTasks: handle.processedTasks,
        isIdle: handle.activeTaskCount === 0,
        isReady: handle.state === "ready",
      }),
    );
  }
}
