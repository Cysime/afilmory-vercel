import type { PhotoProcessorOptions } from "../core/contracts/photo-processing.js";
import { thumbnailExists } from "../image/thumbnail.js";
import type { StorageObject } from "../storage/interfaces.js";
import type { PhotoManifestItem } from "../types/photo.js";
import { decidePhotoWork } from "./work-decision.js";

export interface CacheableData {
  thumbnail?: {
    thumbnailUrl: string;
    thumbnailBuffer: Buffer;
    thumbHash: string;
  };
  exif?: any;
  toneAnalysis?: any;
}

/**
 * 检查是否需要处理照片
 * 考虑文件更新状态和缓存存在性
 *
 * 判定逻辑与 DiffPlanner 的任务过滤共享同一实现（decidePhotoWork），
 * 保证 same-timestamp 的 size/etag 变更不会进入 worker 后又被跳过。
 */
export async function shouldProcessPhoto(
  photoId: string,
  existingItem: PhotoManifestItem | undefined,
  obj: StorageObject,
  options: PhotoProcessorOptions,
): Promise<{ shouldProcess: boolean; reason: string }> {
  return decidePhotoWork(existingItem, obj, options, () =>
    thumbnailExists(photoId),
  );
}

/**
 * 检查缓存数据的完整性
 */
export function validateCacheData(
  existingItem: PhotoManifestItem | undefined,
  options: PhotoProcessorOptions,
): {
  needsThumbnail: boolean;
  needsExif: boolean;
  needsToneAnalysis: boolean;
} {
  if (!existingItem) {
    return {
      needsThumbnail: true,
      needsExif: true,
      needsToneAnalysis: true,
    };
  }

  return {
    needsThumbnail:
      options.isForceMode ||
      options.isForceThumbnails ||
      !existingItem.thumbHash,
    needsExif:
      options.isForceMode || options.isForceManifest || !existingItem.exif,
    needsToneAnalysis:
      options.isForceMode ||
      options.isForceManifest ||
      !existingItem.toneAnalysis,
  };
}
