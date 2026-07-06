import type { Logger } from "../logger/index.js";
import { getPhotoExecutionContext } from "./execution-context.js";
import type { PhotoProcessingLoggers } from "./logger-types.js";

export type { PhotoLogger, PhotoProcessingLoggers } from "./logger-types.js";

/**
 * 创建照片处理 Logger 集合。
 * consola 的 withTag 实例本身就满足 PhotoLogger（info/warn/error/success 同形），
 * 直接使用原实例，无需适配层。
 */
export function createPhotoProcessingLoggers(
  workerId: number,
  baseLogger: Logger,
): PhotoProcessingLoggers {
  const workerLogger = baseLogger.worker(workerId);
  return {
    image: workerLogger.withTag("IMAGE"),
    s3: workerLogger.withTag("S3"),
    thumbnail: workerLogger.withTag("THUMBNAIL"),
    thumbhash: workerLogger.withTag("THUMBHASH"),
    exif: workerLogger.withTag("EXIF"),
    tone: workerLogger.withTag("TONE"),
    location: workerLogger.withTag("LOCATION"),
  };
}

/**
 * 获取当前上下文中的 Logger 集合
 */
export function getPhotoProcessingLoggers(): PhotoProcessingLoggers {
  return getPhotoExecutionContext().loggers;
}
