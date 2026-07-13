import { thumbnailExists } from "../../image/thumbnail.js";
import { logger } from "../../logger/index.js";
import { findPhotoIdCollisionKeys } from "../../photo/id.js";
import { getStorageObjectVersion } from "../../photo/live-photo-handler.js";
import { decidePhotoWork } from "../../photo/work-decision.js";
import type { StorageObject } from "../../storage/interfaces.js";
import type { PhotoManifestItem } from "../../types/photo.js";
import type { BuildSession } from "./session.js";

export interface DiffPlan {
  s3ImageKeys: Set<string>;
  tasksToProcess: StorageObject[];
}

export class DiffPlanner {
  async plan(
    session: BuildSession,
    imageObjects: StorageObject[],
    existingManifestMap: Map<string, PhotoManifestItem>,
    livePhotoMap: Map<string, StorageObject> = new Map<string, StorageObject>(),
  ): Promise<DiffPlan> {
    const { options } = session;

    session.setPhotoIdCollisionKeys(
      findPhotoIdCollisionKeys(imageObjects.map((obj) => obj.key)),
    );

    const collisionKeys = session.getPhotoIdCollisionKeys();
    if (collisionKeys.size > 0) {
      logger.main.warn(
        `Detected ${collisionKeys.size} photos with the same name across directories; adding a path digest suffix to their IDs to avoid collisions`,
      );
    }

    await session.emit("afterImagesListed", {
      options,
      imageObjects,
    });

    const s3ImageKeys = new Set(imageObjects.map((obj) => obj.key));
    const tasksToProcess = this.sortByWorkCost(
      await this.filterTaskImages(
        session,
        imageObjects,
        existingManifestMap,
        livePhotoMap,
      ),
    );

    await session.emit("afterTasksPrepared", {
      options,
      tasks: tasksToProcess,
      totalImages: imageObjects.length,
    });

    logger.main.info(
      `Found ${imageObjects.length} photos in storage; ${tasksToProcess.length} need processing`,
    );

    return {
      s3ImageKeys,
      tasksToProcess,
    };
  }

  private async filterTaskImages(
    session: BuildSession,
    imageObjects: StorageObject[],
    existingManifestMap: Map<string, PhotoManifestItem>,
    livePhotoMap: Map<string, StorageObject>,
  ): Promise<StorageObject[]> {
    const { options } = session;

    const tasksToProcess: StorageObject[] = [];
    const reprocessKeys = new Set(options.reprocessKeys ?? []);
    let addedLivePhotoReprocessKey = false;

    // 与 worker 侧的 shouldProcessPhoto 共享同一判定实现（decidePhotoWork），
    // 避免两处级联漂移导致增量构建静默出错。
    for (const obj of imageObjects) {
      const { key } = obj;
      const existingItem = existingManifestMap.get(key);

      const { shouldProcess } = await decidePhotoWork(
        existingItem,
        obj,
        options,
        // 主进程规划阶段没有照片上下文，缩略图目录走 session 配置显式传入。
        () =>
          thumbnailExists(
            session.getPhotoIdForKey(key, existingItem),
            session.config.output.thumbnailsDir,
            existingItem?.thumbnailUrl,
          ),
      );

      const currentLivePhoto = livePhotoMap.get(key);
      const existingLivePhoto =
        existingItem?.video?.type === "live-photo"
          ? existingItem.video
          : undefined;
      const livePhotoChanged = currentLivePhoto
        ? !existingLivePhoto ||
          existingLivePhoto.s3Key !== currentLivePhoto.key ||
          existingLivePhoto.version !==
            getStorageObjectVersion(currentLivePhoto)
        : Boolean(existingLivePhoto);

      // Live Photo 的视频旁路对象不参与图片本身的 needsUpdate 判定。
      // 将对应图片显式加入 reprocessKeys，确保 worker 二次检查时不会把
      // DiffPlanner 已经排入队列的任务再次当作“未变化”跳过。
      if (livePhotoChanged && !reprocessKeys.has(key)) {
        reprocessKeys.add(key);
        addedLivePhotoReprocessKey = true;
      }

      if (shouldProcess || livePhotoChanged) {
        tasksToProcess.push(obj);
      }
    }

    if (addedLivePhotoReprocessKey) {
      options.reprocessKeys = [...reprocessKeys];
    }

    return tasksToProcess;
  }

  private sortByWorkCost(tasks: StorageObject[]): StorageObject[] {
    if (tasks.length <= 1) {
      return tasks;
    }

    const beforeFirst = tasks[0]?.key;
    const sorted = [...tasks].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

    if (beforeFirst !== sorted[0]?.key) {
      logger.main.info(
        "Reordered the processing queue by file size (largest first)",
      );
    }

    return sorted;
  }
}
