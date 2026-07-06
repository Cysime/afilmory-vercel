import path from "node:path";

import type { StorageObject } from "./interfaces.js";
import { isSupportedImageKey } from "./supported-formats.js";

/**
 * Live Photo 配对是纯 key 运算（同目录 + 同基础文件名的「图片 + .mov 视频」），
 * 与具体存储实现无关：S3 与本地文件系统 provider 共用此实现，
 * 避免第二个 provider 出现时配对规则各自漂移。
 *
 * @returns Live Photo 配对映射 (图片 key -> 视频对象)
 */
export function detectLivePhotoPairs(
  allObjects: StorageObject[],
): Map<string, StorageObject> {
  const livePhotoMap = new Map<string, StorageObject>(); // image key -> video object

  // 按目录和基础文件名分组所有文件
  const fileGroups = new Map<string, StorageObject[]>();

  for (const obj of allObjects) {
    if (!obj.key) continue;

    const dir = path.dirname(obj.key);
    const basename = path.parse(obj.key).name;
    const groupKey = `${dir}/${basename}`;

    if (!fileGroups.has(groupKey)) {
      fileGroups.set(groupKey, []);
    }
    fileGroups.get(groupKey)!.push(obj);
  }

  // 在每个分组中寻找图片 + 视频配对。先按 key 稳定排序，使配对结果与存储列举
  // 顺序无关（否则同名多图时"最后一个胜出"会随列举顺序漂移）。
  for (const files of fileGroups.values()) {
    const sorted = files
      .filter((file) => file.key)
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));

    const imageFile =
      sorted.find((file) => isSupportedImageKey(file.key)) ?? null;
    const videoFile =
      sorted.find(
        (file) => file.key && path.extname(file.key).toLowerCase() === ".mov",
      ) ?? null;

    // 如果找到配对，记录为 live photo
    if (imageFile?.key && videoFile) {
      livePhotoMap.set(imageFile.key, videoFile);
    }
  }

  return livePhotoMap;
}
