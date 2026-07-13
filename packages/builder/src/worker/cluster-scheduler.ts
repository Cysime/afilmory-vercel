export interface QueuedClusterTask {
  taskIndex: number;
}

export interface BatchTaskAssignment {
  taskId: string;
  taskIndex: number;
}

function assertInteger(
  name: string,
  value: number,
  options: { allowZero: boolean; max?: number },
): void {
  if (
    !Number.isSafeInteger(value) ||
    (options.allowZero ? value < 0 : value <= 0) ||
    (options.max !== undefined && value > options.max)
  ) {
    throw new Error(
      `${name} must be a ${options.allowZero ? "non-negative" : "positive"} integer${options.max === undefined ? "" : ` <= ${options.max}`}`,
    );
  }
}

export function createInitialTaskQueue(
  totalTasks: number,
): QueuedClusterTask[] {
  assertInteger("totalTasks", totalTasks, {
    allowZero: true,
    max: 10_000_000,
  });
  return Array.from({ length: totalTasks }, (_, taskIndex) => ({
    taskIndex,
  }));
}

export function calculateWorkersToStart({
  concurrency,
  totalTasks,
  workerConcurrency,
}: {
  concurrency: number;
  totalTasks: number;
  workerConcurrency: number;
}): { requiredWorkers: number; workersToStart: number } {
  assertInteger("concurrency", concurrency, { allowZero: false, max: 1024 });
  assertInteger("totalTasks", totalTasks, {
    allowZero: true,
    max: 10_000_000,
  });
  assertInteger("workerConcurrency", workerConcurrency, {
    allowZero: false,
    max: 1024,
  });
  const requiredWorkers = Math.ceil(totalTasks / workerConcurrency);
  return {
    requiredWorkers,
    workersToStart: Math.min(concurrency, requiredWorkers),
  };
}

export function getAvailableWorkerSlots(
  currentTaskCount: number,
  workerConcurrency: number,
): number {
  assertInteger("currentTaskCount", currentTaskCount, { allowZero: true });
  assertInteger("workerConcurrency", workerConcurrency, {
    allowZero: false,
    max: 1024,
  });
  return Math.max(0, workerConcurrency - currentTaskCount);
}

export function createClusterTaskId({
  sequence,
  taskIndex,
  timestamp,
  workerId,
}: {
  sequence: number;
  taskIndex: number;
  timestamp: number;
  workerId: number;
}): string {
  assertInteger("sequence", sequence, { allowZero: true });
  assertInteger("taskIndex", taskIndex, { allowZero: true });
  assertInteger("timestamp", timestamp, { allowZero: true });
  assertInteger("workerId", workerId, { allowZero: false });
  return `${workerId}-${taskIndex}-${timestamp}-${sequence}`;
}

export function selectBatchTaskAssignments({
  availableSlots,
  taskQueue,
  timestamp,
  workerId,
}: {
  availableSlots: number;
  taskQueue: QueuedClusterTask[];
  timestamp: number;
  workerId: number;
}): {
  remainingQueue: QueuedClusterTask[];
  tasks: BatchTaskAssignment[];
} {
  assertInteger("availableSlots", availableSlots, { allowZero: true });
  assertInteger("timestamp", timestamp, { allowZero: true });
  assertInteger("workerId", workerId, { allowZero: false });
  const tasksToAssign = Math.min(availableSlots, taskQueue.length);
  const selected = taskQueue.slice(0, tasksToAssign);

  return {
    remainingQueue: taskQueue.slice(tasksToAssign),
    tasks: selected.map((task, sequence) => ({
      taskId: createClusterTaskId({
        workerId,
        taskIndex: task.taskIndex,
        timestamp,
        sequence,
      }),
      taskIndex: task.taskIndex,
    })),
  };
}
