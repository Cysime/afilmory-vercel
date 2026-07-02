import { logger } from "../../logger/index.js";
import type { StorageObject } from "../../storage/interfaces.js";
import { isSupportedImageKey } from "../../storage/supported-formats.js";
import type { BuildSession } from "./session.js";

export interface SourceScanResult {
  allObjects: StorageObject[];
  livePhotoMap: Map<string, StorageObject>;
  imageObjects: StorageObject[];
}

export class SourceScanner {
  async scan(session: BuildSession): Promise<SourceScanResult> {
    const { options, storageManager } = session;

    const allObjects = await storageManager.listAllFiles();
    logger.main.info(`存储中找到 ${allObjects.length} 个文件`);

    await session.emit("afterAllFilesListed", {
      options,
      allObjects,
    });

    const livePhotoMap = await this.detectLivePhotos(session, allObjects);
    if (session.config.system.processing.enableLivePhotoDetection) {
      logger.main.info(`检测到 ${livePhotoMap.size} 个 Live Photo`);
    }

    await session.emit("afterLivePhotoDetection", {
      options,
      livePhotoMap,
    });

    // 从已获取的 allObjects 本地派生图片列表（共用 isSupportedImageKey 谓词），
    // 避免对存储桶做第二次全量 ListObjectsV2 分页；同时 allObjects 与 imageObjects
    // 观察到的是同一份桶快照，不会因两次列举之间的写入而彼此不一致。
    const imageObjects = allObjects.filter((object) =>
      isSupportedImageKey(object.key),
    );
    logger.main.info(`存储中找到 ${imageObjects.length} 张照片`);

    return {
      allObjects,
      livePhotoMap,
      imageObjects,
    };
  }

  private async detectLivePhotos(
    session: BuildSession,
    allObjects: StorageObject[],
  ): Promise<Map<string, StorageObject>> {
    if (!session.config.system.processing.enableLivePhotoDetection) {
      return new Map();
    }

    return await session.storageManager.detectLivePhotos(allObjects);
  }
}
