import type {
  PhotoProcessorOptions,
  PhotoTaskRuntime,
} from "../../photo/processor.js";
import { processPhoto, toProcessorOptions } from "../../photo/processor.js";
import { createSerializableBuilderConfigForWorker } from "../../plugins/serializable.js";
import type { StorageObject } from "../../storage/interfaces.js";
import type {
  PhotoManifestItem,
  ProcessPhotoResult,
} from "../../types/photo.js";
import { ClusterPool } from "../../worker/cluster-pool.js";
import type { TaskCompletedPayload } from "../../worker/pool.js";
import { WorkerPool } from "../../worker/pool.js";
import type { BuildSession } from "./session.js";

export interface ProcessingStats {
  newCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
}

// processorOptions/mode/concurrency 不在返回值里：它们已经通过
// beforeProcessTasks 插件事件与 progressListener.onStart 载荷对外发布。
export interface PhotoTaskProcessingResult {
  results: ProcessPhotoResult[];
  stats: ProcessingStats;
}

export class PhotoTaskProcessor {
  async process(
    session: BuildSession,
    tasksToProcess: StorageObject[],
    existingManifestMap: Map<string, PhotoManifestItem>,
    livePhotoMap: Map<string, StorageObject>,
  ): Promise<PhotoTaskProcessingResult> {
    const { options } = session;
    const processorOptions: PhotoProcessorOptions = toProcessorOptions(options);

    const concurrency =
      options.concurrencyLimit ??
      session.config.system.processing.defaultConcurrency;
    const { useClusterMode } =
      session.config.system.observability.performance.worker;
    const shouldUseCluster =
      useClusterMode && tasksToProcess.length >= concurrency * 2;
    const mode = shouldUseCluster ? "cluster" : "worker";

    await session.emit("beforeProcessTasks", {
      options,
      tasks: tasksToProcess,
      processorOptions,
      mode,
      concurrency,
    });

    const stats: ProcessingStats = {
      newCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };

    const { progressListener } = options;
    const totalTasks = tasksToProcess.length;
    let completedTaskCount = 0;

    const emitProgress = (currentKey?: string): void => {
      progressListener?.onProgress?.({
        total: totalTasks,
        completed: completedTaskCount,
        ...stats,
        currentKey,
      });
    };

    const handleTaskCompleted = ({
      result,
      taskIndex,
      completed,
    }: TaskCompletedPayload<ProcessPhotoResult>): void => {
      this.applyResultCounters(stats, result);
      completedTaskCount = completed;
      emitProgress(tasksToProcess[taskIndex]?.key);
    };

    progressListener?.onStart?.({
      total: totalTasks,
      mode,
      concurrency,
    });
    emitProgress();

    session.services.logger.main.info(
      `Starting ${shouldUseCluster ? "multi-process" : "concurrent"} task processing, ${shouldUseCluster ? "processes" : "workers"}: ${concurrency}${shouldUseCluster ? `, concurrency per process: ${session.config.system.observability.performance.worker.workerConcurrency}` : ""}`,
    );

    const results = shouldUseCluster
      ? await this.processWithCluster(
          session,
          tasksToProcess,
          existingManifestMap,
          livePhotoMap,
          handleTaskCompleted,
          concurrency,
        )
      : await this.processWithWorkers(
          session,
          tasksToProcess,
          existingManifestMap,
          livePhotoMap,
          handleTaskCompleted,
          concurrency,
        );

    completedTaskCount = Math.max(completedTaskCount, totalTasks);
    emitProgress();
    progressListener?.onComplete?.({
      total: totalTasks,
      completed: completedTaskCount,
      ...stats,
    });

    return {
      results,
      stats,
    };
  }

  completeEmptyRun(session: BuildSession, stats: ProcessingStats): void {
    session.options.progressListener?.onComplete?.({
      total: 0,
      completed: 0,
      ...stats,
    });
  }

  private async processWithCluster(
    session: BuildSession,
    tasksToProcess: StorageObject[],
    existingManifestMap: Map<string, PhotoManifestItem>,
    livePhotoMap: Map<string, StorageObject>,
    onTaskCompleted: (
      payload: TaskCompletedPayload<ProcessPhotoResult>,
    ) => void,
    concurrency: number,
  ): Promise<ProcessPhotoResult[]> {
    // 进度回调是函数，进 IPC 会让 worker.send() 抛 DataCloneError；
    // 进度已由主进程的 onTaskCompleted 汇聚，传给 worker 前剥离。
    const { progressListener, ...builderOptions } = session.options;
    // Workers only need manifest/live-photo entries for tasks that can be
    // assigned in this run. Filtering here avoids cloning the entire gallery
    // state into every cluster process during IPC initialization.
    const taskKeys = new Set(tasksToProcess.map((task) => task.key));
    const workerExistingManifestMap = new Map(
      [...existingManifestMap].filter(([key]) => taskKeys.has(key)),
    );
    const workerLivePhotoMap = new Map(
      [...livePhotoMap].filter(([key]) => taskKeys.has(key)),
    );
    const clusterPool = new ClusterPool<ProcessPhotoResult>({
      concurrency,
      totalTasks: tasksToProcess.length,
      logger: session.services.logger,
      workerConcurrency:
        session.config.system.observability.performance.worker
          .workerConcurrency,
      sharedData: {
        existingManifestMap: workerExistingManifestMap,
        livePhotoMap: workerLivePhotoMap,
        imageObjects: tasksToProcess,
        builderConfig: createSerializableBuilderConfigForWorker(
          session.getConfig(),
        ),
        builderOptions,
        photoIdCollisionKeys: Array.from(session.getPhotoIdCollisionKeys()),
      },
      timeoutMs: session.config.system.observability.performance.worker.timeout,
      onTaskCompleted,
    });

    return await clusterPool.execute();
  }

  private async processWithWorkers(
    session: BuildSession,
    tasksToProcess: StorageObject[],
    existingManifestMap: Map<string, PhotoManifestItem>,
    livePhotoMap: Map<string, StorageObject>,
    onTaskCompleted: (
      payload: TaskCompletedPayload<ProcessPhotoResult>,
    ) => void,
    concurrency: number,
  ): Promise<ProcessPhotoResult[]> {
    const workerPool = new WorkerPool<ProcessPhotoResult>({
      concurrency,
      drainTimedOutTasks: true,
      totalTasks: tasksToProcess.length,
      logger: session.services.logger,
      onTaskCompleted,
      timeoutMs: session.config.system.observability.performance.worker.timeout,
    });

    // 构建期恒定的依赖只组装一次；每个任务只带自己的可变部分。
    const runtime: PhotoTaskRuntime = {
      existingManifestMap,
      livePhotoMap,
      services: session.services,
      emitPluginEvent: (runState, event, payload) =>
        session.emitPluginEvent(runState, event, payload),
      runState: session.runState,
      builderOptions: session.options,
    };

    return await workerPool.execute(async (taskIndex, workerId, signal) => {
      return await processPhoto(
        {
          obj: tasksToProcess[taskIndex],
          index: taskIndex,
          workerId,
          totalImages: tasksToProcess.length,
          signal,
        },
        runtime,
      );
    });
  }

  private applyResultCounters(
    stats: ProcessingStats,
    result: ProcessPhotoResult | null | undefined,
  ): void {
    if (!result) return;

    switch (result.type) {
      case "new": {
        stats.newCount++;
        stats.processedCount++;
        break;
      }
      case "processed": {
        stats.processedCount++;
        break;
      }
      case "skipped": {
        stats.skippedCount++;
        break;
      }
      case "failed": {
        stats.failedCount++;
        break;
      }
    }
  }
}
