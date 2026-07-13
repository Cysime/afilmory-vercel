import type { PhotoTaskRuntime } from "../photo/processor.js";
import type { StorageObject } from "../storage/interfaces.js";
import type {
  BatchTaskMessage,
  BatchTaskResult,
  TaskMessage,
  TaskResult,
} from "./cluster-protocol.js";
import { runWithWatchdog } from "./watchdog.js";

export type WorkerProcessPhoto =
  typeof import("../photo/processor.js").processPhoto;

/**
 * cluster worker 的运行期依赖 = 共用的 PhotoTaskRuntime + worker 进程自身的
 * 身份与任务表。init 消息处理完毕后组装一次，之后所有任务复用。
 */
export interface WorkerTaskRuntime extends PhotoTaskRuntime {
  workerId: number;
  imageObjects: StorageObject[];
  taskTimeoutMs?: number;
}

async function executePhotoTask(
  taskIndex: number,
  runtime: WorkerTaskRuntime,
  processPhoto: WorkerProcessPhoto,
) {
  const obj = runtime.imageObjects[taskIndex];
  if (!obj) {
    throw new Error(`Invalid taskIndex: ${taskIndex}`);
  }

  return await runWithWatchdog(
    async () =>
      await processPhoto(
        {
          obj,
          index: taskIndex,
          workerId: runtime.workerId,
          totalImages: runtime.imageObjects.length,
        },
        runtime,
      ),
    {
      label: `Cluster worker ${runtime.workerId} task ${taskIndex + 1}`,
      timeoutMs: runtime.taskTimeoutMs ?? 300_000,
    },
  );
}

function normalizeWorkerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeWorkerTask(
  message: TaskMessage,
  runtime: WorkerTaskRuntime,
  processPhoto: WorkerProcessPhoto,
): Promise<TaskResult> {
  try {
    return {
      type: "result",
      taskId: message.taskId,
      taskIndex: message.taskIndex,
      result: await executePhotoTask(message.taskIndex, runtime, processPhoto),
    };
  } catch (error) {
    return {
      type: "error",
      taskId: message.taskId,
      taskIndex: message.taskIndex,
      error: normalizeWorkerError(error),
    };
  }
}

export async function executeWorkerBatchTask(
  message: BatchTaskMessage,
  runtime: WorkerTaskRuntime,
  processPhoto: WorkerProcessPhoto,
): Promise<BatchTaskResult> {
  return {
    type: "batch-result",
    results: await Promise.all(
      message.tasks.map((task) =>
        executeWorkerTask(
          {
            type: "task",
            taskId: task.taskId,
            taskIndex: task.taskIndex,
            workerId: message.workerId,
          },
          runtime,
          processPhoto,
        ),
      ),
    ),
  };
}
