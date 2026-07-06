import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PhotoProcessorOptions } from "../core/contracts/photo-processing.js";
import {
  generateThumbnailAndThumbHash,
  thumbnailExists,
} from "../image/thumbnail.js";
import type { PhotoManifestItem } from "../types/photo.js";
import { processThumbnailAndThumbHash } from "./data-processors.js";

// `vi.mock` is hoisted above the imports by Vitest, so the imported
// `generateThumbnailAndThumbHash` resolves to the mock below.
vi.mock("../image/thumbnail.js", () => ({
  generateThumbnailAndThumbHash: vi.fn(),
  getThumbnailPublicUrl: (photoId: string) => `/thumbnails/${photoId}.jpg`,
  thumbnailExists: vi.fn(async () => false),
}));

// 生产路径里 processThumbnailAndThumbHash 只从照片上下文读 output.thumbnailsDir。
vi.mock("./execution-context.js", () => ({
  getPhotoExecutionContext: () => ({
    output: {
      manifestPath: "/test-out/photos-manifest.json",
      thumbnailsDir: "/test-out/thumbnails",
      originalsDir: "/test-out/originals",
    },
  }),
}));

vi.mock("./logger-adapter.js", () => {
  const makeLogger = () => ({
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  return {
    getPhotoProcessingLoggers: () => ({
      image: makeLogger(),
      s3: makeLogger(),
      thumbnail: makeLogger(),
      thumbhash: makeLogger(),
      exif: makeLogger(),
      tone: makeLogger(),
      location: makeLogger(),
    }),
  };
});

const mockedGenerate = vi.mocked(generateThumbnailAndThumbHash);

const options: PhotoProcessorOptions = {
  isForceMode: false,
  isForceManifest: false,
  isForceThumbnails: false,
};

describe("processThumbnailAndThumbHash failure handling", () => {
  beforeEach(() => {
    mockedGenerate.mockReset();
  });

  it("returns null (skip the photo) when thumbnail generation fails, instead of null-filled fields", async () => {
    // Regression guard: a failed thumbnail must NOT produce a manifest item with
    // thumbnailUrl: null — lenient parsing would salvage it into a permanently
    // broken image, and the web build's strict assertManifest gate would fail.
    // The photo should be dropped (counted as failed) instead.
    mockedGenerate.mockResolvedValue({
      thumbnailUrl: null,
      thumbnailBuffer: null,
      thumbHash: null,
    });

    const result = await processThumbnailAndThumbHash(
      Buffer.from("not-a-real-image"),
      "broken-photo",
      undefined,
      options,
      false,
    );

    expect(result).toBeNull();
  });

  it("returns the thumbnail result when generation succeeds", async () => {
    const buffer = Buffer.from("jpeg-bytes");
    mockedGenerate.mockResolvedValue({
      thumbnailUrl: "/thumbnails/ok-photo.jpg",
      thumbnailBuffer: buffer,
      thumbHash: new Uint8Array([1, 2, 3]),
    });

    const result = await processThumbnailAndThumbHash(
      Buffer.from("real-image"),
      "ok-photo",
      undefined,
      options,
      false,
    );

    expect(result).not.toBeNull();
    expect(result?.thumbnailUrl).toBe("/thumbnails/ok-photo.jpg");
    expect(result?.thumbnailBuffer).toBe(buffer);
  });

  it("regenerates instead of reusing when the source content changed", async () => {
    // Regression guard：内容已变（needsUpdate 判定为真）的照片曾经静默复用
    // 旧缩略图——existingItem 有 thumbHash、磁盘有旧文件，两层复用检查都命中，
    // 白白下载的新原图被丢弃。contentChanged 必须同时击穿两层：跳过复用分支，
    // 并把 forceRegenerate 传成 true。
    const buffer = Buffer.from("regenerated");
    mockedGenerate.mockResolvedValue({
      thumbnailUrl: "/thumbnails/changed-photo.jpg",
      thumbnailBuffer: buffer,
      thumbHash: new Uint8Array([9]),
    });
    // 磁盘上"存在"旧缩略图 + existingItem 带 thumbHash：两个复用条件都满足，
    // 只有 contentChanged 能阻止复用——这正是本测试要钉住的行为。
    vi.mocked(thumbnailExists).mockResolvedValue(true);
    const existingItem = { thumbHash: "0a0b" } as PhotoManifestItem;

    const result = await processThumbnailAndThumbHash(
      Buffer.from("new-content"),
      "changed-photo",
      existingItem,
      options,
      true,
    );

    expect(result?.thumbnailBuffer).toBe(buffer);
    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.any(Buffer),
      "changed-photo",
      true,
    );
  });
});
