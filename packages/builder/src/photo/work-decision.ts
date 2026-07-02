import type { PhotoProcessorOptions } from "../core/contracts/photo-processing.js";
import { needsUpdate } from "../manifest/manager.js";
import type { StorageObject } from "../storage/interfaces.js";
import type { PhotoManifestItem } from "../types/photo.js";

export interface PhotoWorkDecision {
  shouldProcess: boolean;
  reason: string;
}

/**
 * 判断一张照片是否需要重新处理（new / needsUpdate / 缩略图缺失 / force 级联）。
 *
 * 这是 DiffPlanner（基于存储列表做任务过滤）和 worker 侧
 * shouldProcessPhoto（按任务重新检查）共享的唯一判定实现：
 * 两处必须使用同一谓词，否则 same-timestamp 的 size/etag 变更
 * 会进入 worker 后又被跳过（或反过来永远不进队列）。
 *
 * @param hasThumbnail 惰性提供缩略图存在性；只有在前置检查都未命中时才会被调用，
 *                     调用方因此可以把 photoId 计算和存储探测都推迟到这里。
 */
export async function decidePhotoWork(
  existingItem: PhotoManifestItem | undefined,
  obj: StorageObject,
  options: PhotoProcessorOptions,
  hasThumbnail: () => boolean | Promise<boolean>,
): Promise<PhotoWorkDecision> {
  // 强制模式下总是处理
  if (options.isForceMode) {
    return { shouldProcess: true, reason: "强制模式" };
  }

  // 新照片总是需要处理
  if (!existingItem) {
    return { shouldProcess: true, reason: "新照片" };
  }

  const fileNeedsUpdate = needsUpdate(existingItem, obj);

  if (fileNeedsUpdate || options.isForceManifest) {
    return {
      shouldProcess: true,
      reason: fileNeedsUpdate ? "文件已更新" : "强制更新清单",
    };
  }

  // 检查缩略图是否存在
  const thumbnailPresent = await hasThumbnail();
  if (!thumbnailPresent || options.isForceThumbnails) {
    return {
      shouldProcess: true,
      reason: options.isForceThumbnails ? "强制重新生成缩略图" : "缩略图缺失",
    };
  }

  return { shouldProcess: false, reason: "无需处理" };
}
