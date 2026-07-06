import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PhotoProcessorOptions } from "../core/contracts/photo-processing.js";
import { generateThumbnailAndThumbHash } from "../image/thumbnail.js";
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
    // thumbnailUrl: null — that poisons the manifest and bricks future builds via
    // assertManifest. The photo should be dropped (counted as failed) instead.
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
    );

    expect(result).not.toBeNull();
    expect(result?.thumbnailUrl).toBe("/thumbnails/ok-photo.jpg");
    expect(result?.thumbnailBuffer).toBe(buffer);
  });
});
