import type { StorageManager } from "../storage/index.js";
import type { StorageObject } from "../storage/interfaces.js";
import { getPhotoProcessingLoggers } from "./logger-adapter.js";

export type LivePhotoResult =
  | { isLivePhoto: false }
  | {
      isLivePhoto: true;
      livePhotoVideoUrl: string;
      livePhotoVideoS3Key: string;
    };

/**
 * 检测并处理 Live Photo
 * @param photoKey 照片的 S3 key
 * @param livePhotoMap Live Photo 映射表
 * @param storageManager 存储管理器，用于生成公共访问链接
 * @returns Live Photo 处理结果
 */
export async function processLivePhoto(
  photoKey: string,
  livePhotoMap: Map<string, StorageObject>,
  storageManager: StorageManager,
): Promise<LivePhotoResult> {
  const loggers = getPhotoProcessingLoggers();
  const livePhotoVideo = livePhotoMap.get(photoKey);
  const isLivePhoto = !!livePhotoVideo;

  if (!isLivePhoto) {
    return { isLivePhoto: false };
  }

  const videoKey = livePhotoVideo.key;
  if (!videoKey) {
    return { isLivePhoto: false };
  }

  const livePhotoVideoUrl = await storageManager.generatePublicUrl(videoKey);

  loggers.image.info(`📱 检测到 Live Photo：${photoKey} -> ${videoKey}`);

  return {
    isLivePhoto: true,
    livePhotoVideoUrl,
    livePhotoVideoS3Key: videoKey,
  };
}
