import { thumbnailExists } from "../../image/thumbnail.js";
import { logger } from "../../logger/index.js";
import { findPhotoIdCollisionKeys } from "../../photo/id.js";
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
  ): Promise<DiffPlan> {
    const { options } = session;

    session.setPhotoIdCollisionKeys(
      findPhotoIdCollisionKeys(imageObjects.map((obj) => obj.key)),
    );

    const collisionKeys = session.getPhotoIdCollisionKeys();
    if (collisionKeys.size > 0) {
      logger.main.warn(
        `检测到 ${collisionKeys.size} 张跨目录同名照片，将为这些照片 ID 添加路径摘要后缀以避免冲突`,
      );
    }

    await session.emit("afterImagesListed", {
      options,
      imageObjects,
    });

    const s3ImageKeys = new Set(imageObjects.map((obj) => obj.key));
    const tasksToProcess = this.sortByWorkCost(
      await this.filterTaskImages(session, imageObjects, existingManifestMap),
    );

    await session.emit("afterTasksPrepared", {
      options,
      tasks: tasksToProcess,
      totalImages: imageObjects.length,
    });

    logger.main.info(
      `存储中找到 ${imageObjects.length} 张照片，实际需要处理 ${tasksToProcess.length} 张`,
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
  ): Promise<StorageObject[]> {
    const { options } = session;

    const tasksToProcess: StorageObject[] = [];

    // 与 worker 侧的 shouldProcessPhoto 共享同一判定实现（decidePhotoWork），
    // 避免两处级联漂移导致增量构建静默出错。
    for (const obj of imageObjects) {
      const { key } = obj;
      const existingItem = existingManifestMap.get(key);

      const { shouldProcess } = await decidePhotoWork(
        existingItem,
        obj,
        options,
        () => thumbnailExists(session.getPhotoIdForKey(key, existingItem)),
      );

      if (shouldProcess) {
        tasksToProcess.push(obj);
      }
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
      logger.main.info("已按文件大小降序重排处理队列");
    }

    return sorted;
  }
}
