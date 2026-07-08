import type { EmitPluginEventFn } from "../core/contracts/execution-context.js";
import type {
  PhotoProcessingContext,
  PhotoProcessorOptions,
} from "../core/contracts/photo-processing.js";
import type { PluginRunState } from "../core/contracts/plugin-ref.js";
import type { BuilderServices } from "../core/contracts/services.js";
import { logger } from "../logger/index.js";
import type { StorageObject } from "../storage/interfaces.js";
import type { BuilderOptions } from "../types/options.js";
import type { PhotoManifestItem, ProcessPhotoResult } from "../types/photo.js";
import {
  createPhotoExecutionContext,
  runWithPhotoExecutionContext,
} from "./execution-context.js";
import { processPhotoWithPipeline } from "./image-pipeline.js";

export type {
  PhotoProcessingContext,
  PhotoProcessorOptions,
} from "../core/contracts/photo-processing.js";

/** 单张任务的可变部分；构建期恒定的依赖都在 PhotoTaskRuntime 里。 */
export interface PhotoTaskInput {
  obj: StorageObject;
  index: number;
  workerId: number;
  totalImages: number;
}

/**
 * 每个进程组装一次的运行期依赖。主进程并发池与 cluster worker 共用同一形状，
 * 两侧的组装差异只剩"依赖从哪来"（BuildSession vs IPC sharedData 重建的 builder）。
 */
export interface PhotoTaskRuntime {
  existingManifestMap: Map<string, PhotoManifestItem>;
  livePhotoMap: Map<string, StorageObject>;
  services: BuilderServices;
  emitPluginEvent: EmitPluginEventFn;
  runState: PluginRunState;
  builderOptions: BuilderOptions;
}

// PhotoProcessorOptions 是 BuilderOptions 的投影；推导只发生在这一处，
// 调用方不再各自手抄三个字段。
export function toProcessorOptions(
  builderOptions: BuilderOptions,
): PhotoProcessorOptions {
  return {
    isForceMode: builderOptions.isForceMode,
    isForceManifest: builderOptions.isForceManifest,
    isForceThumbnails: builderOptions.isForceThumbnails,
  };
}

// 处理单张照片
export async function processPhoto(
  task: PhotoTaskInput,
  runtime: PhotoTaskRuntime,
): Promise<ProcessPhotoResult> {
  const { obj, index, workerId, totalImages } = task;
  const { key } = obj;
  if (!key) {
    logger.image.warn(`Skipping object without a key`);
    return { item: null, type: "failed" };
  }

  const existingItem = runtime.existingManifestMap.get(key);

  // 构建处理上下文
  const context: PhotoProcessingContext = {
    photoKey: key,
    obj,
    existingItem,
    livePhotoMap: runtime.livePhotoMap,
    options: toProcessorOptions(runtime.builderOptions),
    pluginData: {},
  };

  const executionContext = createPhotoExecutionContext(
    runtime.services,
    runtime.emitPluginEvent,
    workerId,
  );

  return await runWithPhotoExecutionContext(executionContext, async () => {
    executionContext.loggers.image.info(
      `📸 [${index + 1}/${totalImages}] ${key}`,
    );
    return await processPhotoWithPipeline(context, {
      runState: runtime.runState,
      builderOptions: runtime.builderOptions,
    });
  });
}
