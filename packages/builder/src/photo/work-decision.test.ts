import { describe, expect, it, vi } from "vitest";

import type { PhotoProcessorOptions } from "../core/contracts/photo-processing.js";
import type { StorageObject } from "../storage/interfaces.js";
import type { PhotoManifestItem } from "../types/photo.js";
import { decidePhotoWork } from "./work-decision.js";

function createExistingPhoto(
  overrides: Partial<PhotoManifestItem> = {},
): PhotoManifestItem {
  return {
    id: "photo",
    title: "photo",
    description: "",
    dateTaken: "2024-01-01T00:00:00.000Z",
    tags: [],
    originalUrl: "/originals/photo.jpg",
    thumbnailUrl: "/thumbnails/photo.jpg",
    thumbHash: null,
    width: 100,
    height: 100,
    aspectRatio: 1,
    s3Key: "photo.jpg",
    lastModified: "2024-01-01T00:00:00.000Z",
    size: 1,
    etag: "old",
    exif: null,
    toneAnalysis: null,
    location: null,
    ...overrides,
  };
}

function createStorageObject(
  overrides: Partial<StorageObject> = {},
): StorageObject {
  return {
    key: "photo.jpg",
    lastModified: new Date("2024-01-01T00:00:00.000Z"),
    size: 1,
    etag: "old",
    ...overrides,
  };
}

function createOptions(
  overrides: Partial<PhotoProcessorOptions> = {},
): PhotoProcessorOptions {
  return {
    isForceMode: false,
    isForceManifest: false,
    isForceThumbnails: false,
    ...overrides,
  };
}

describe("decidePhotoWork", () => {
  it("processes new photos", async () => {
    const hasThumbnail = vi.fn(async () => true);

    const result = await decidePhotoWork(
      undefined,
      createStorageObject(),
      createOptions(),
      hasThumbnail,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "新照片" });
    expect(hasThumbnail).not.toHaveBeenCalled();
  });

  it("processes when lastModified is newer", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject({
        lastModified: new Date("2024-02-01T00:00:00.000Z"),
      }),
      createOptions(),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "文件已更新" });
  });

  it("processes same-timestamp changes when size changes", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject({ size: 2 }),
      createOptions(),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "文件已更新" });
  });

  it("processes same-timestamp changes when etag changes", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject({ etag: "new" }),
      createOptions(),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "文件已更新" });
  });

  it("processes when the thumbnail is missing", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions(),
      async () => false,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "缩略图缺失" });
  });

  it("skips unchanged photos with an existing thumbnail", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions(),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: false, reason: "无需处理" });
  });

  it("always processes in force mode without probing thumbnails", async () => {
    const hasThumbnail = vi.fn(async () => true);

    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions({ isForceMode: true }),
      hasThumbnail,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "强制模式" });
    expect(hasThumbnail).not.toHaveBeenCalled();
  });

  it("processes unchanged photos in force-manifest mode without probing thumbnails", async () => {
    const hasThumbnail = vi.fn(async () => true);

    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions({ isForceManifest: true }),
      hasThumbnail,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "强制更新清单" });
    expect(hasThumbnail).not.toHaveBeenCalled();
  });

  it("prefers the file-updated reason over force-manifest", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject({ size: 2 }),
      createOptions({ isForceManifest: true }),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "文件已更新" });
  });

  it("processes unchanged photos in force-thumbnails mode even when a thumbnail exists", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions({ isForceThumbnails: true }),
      async () => true,
    );

    expect(result).toEqual({
      shouldProcess: true,
      reason: "强制重新生成缩略图",
    });
  });

  it("supports a synchronous hasThumbnail provider", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions(),
      () => false,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "缩略图缺失" });
  });
});
