import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PhotoProcessorOptions } from "../core/contracts/photo-processing.js";
import { thumbnailExists } from "../image/thumbnail.js";
import type { StorageObject } from "../storage/interfaces.js";
import type { PhotoManifestItem } from "../types/photo.js";
import { CURRENT_CORE_PROCESSING_FINGERPRINTS } from "./processing-fingerprints.js";
import { decidePhotoWork, shouldProcessPhoto } from "./work-decision.js";

vi.mock("../image/thumbnail.js", () => ({
  thumbnailExists: vi.fn(async () => true),
}));

// shouldProcessPhoto 从照片执行上下文读取缩略图目录；单测里固定为测试路径。
vi.mock("./execution-context.js", () => ({
  getPhotoExecutionContext: () => ({
    output: {
      manifestPath: "/test-out/photos-manifest.json",
      thumbnailsDir: "/test-out/thumbnails",
      originalsDir: "/test-out/originals",
    },
  }),
}));

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
    processing: { ...CURRENT_CORE_PROCESSING_FINGERPRINTS },
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

    expect(result).toEqual({ shouldProcess: true, reason: "new photo" });
    expect(hasThumbnail).not.toHaveBeenCalled();
  });

  it("forces leniently repaired cache entries through processing", async () => {
    const hasThumbnail = vi.fn(async () => true);
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions({ reprocessKeys: ["photo.jpg"] }),
      hasThumbnail,
    );

    expect(result).toEqual({
      shouldProcess: true,
      reason: "repaired manifest cache",
    });
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

    expect(result).toEqual({ shouldProcess: true, reason: "file updated" });
  });

  it("processes same-timestamp changes when size changes", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject({ size: 2 }),
      createOptions(),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "file updated" });
  });

  it("processes same-timestamp changes when etag changes", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject({ etag: "new" }),
      createOptions(),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "file updated" });
  });

  it("processes when the thumbnail is missing", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions(),
      async () => false,
    );

    expect(result).toEqual({
      shouldProcess: true,
      reason: "thumbnail missing",
    });
  });

  it("skips unchanged photos with an existing thumbnail", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions(),
      async () => true,
    );

    expect(result).toEqual({
      shouldProcess: false,
      reason: "no processing needed",
    });
  });

  it("reprocesses unchanged photos when a derived-stage fingerprint is stale", async () => {
    const hasThumbnail = vi.fn(async () => true);
    const existing = createExistingPhoto({
      processing: {
        ...CURRENT_CORE_PROCESSING_FINGERPRINTS,
        tone: "tone:old",
      },
    });

    await expect(
      decidePhotoWork(
        existing,
        createStorageObject(),
        createOptions(),
        hasThumbnail,
      ),
    ).resolves.toEqual({
      shouldProcess: true,
      reason: "processing fingerprint changed",
    });
    expect(hasThumbnail).not.toHaveBeenCalled();
  });

  it("always processes in force mode without probing thumbnails", async () => {
    const hasThumbnail = vi.fn(async () => true);

    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions({ isForceMode: true }),
      hasThumbnail,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "force mode" });
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

    expect(result).toEqual({
      shouldProcess: true,
      reason: "force update manifest",
    });
    expect(hasThumbnail).not.toHaveBeenCalled();
  });

  it("prefers the file-updated reason over force-manifest", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject({ size: 2 }),
      createOptions({ isForceManifest: true }),
      async () => true,
    );

    expect(result).toEqual({ shouldProcess: true, reason: "file updated" });
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
      reason: "force regenerate thumbnail",
    });
  });

  it("supports a synchronous hasThumbnail provider", async () => {
    const result = await decidePhotoWork(
      createExistingPhoto(),
      createStorageObject(),
      createOptions(),
      () => false,
    );

    expect(result).toEqual({
      shouldProcess: true,
      reason: "thumbnail missing",
    });
  });
});

describe("shouldProcessPhoto", () => {
  beforeEach(() => {
    vi.mocked(thumbnailExists).mockClear();
    vi.mocked(thumbnailExists).mockResolvedValue(true);
  });

  it("probes thumbnail existence in the photo execution context's thumbnails dir", async () => {
    vi.mocked(thumbnailExists).mockResolvedValue(false);

    const result = await shouldProcessPhoto(
      "photo",
      createExistingPhoto(),
      createStorageObject(),
      createOptions(),
    );

    expect(result).toEqual({
      shouldProcess: true,
      reason: "thumbnail missing",
    });
    expect(thumbnailExists).toHaveBeenCalledWith(
      "photo",
      "/test-out/thumbnails",
      "/thumbnails/photo.jpg",
    );
  });

  it("processes same-timestamp size changes without probing thumbnails", async () => {
    // Regression guard: worker 侧包装必须与 DiffPlanner 共用 decidePhotoWork，
    // same-timestamp 的 size/etag 变更不能进入 worker 后又被跳过。
    const result = await shouldProcessPhoto(
      "photo",
      createExistingPhoto(),
      createStorageObject({ size: 2 }),
      createOptions(),
    );

    expect(result).toEqual({ shouldProcess: true, reason: "file updated" });
    expect(thumbnailExists).not.toHaveBeenCalled();
  });
});
