import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertManifest, createManifest } from "@afilmory/schema";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AfilmoryBuilder } from "../builder/builder.js";
import { createDefaultBuilderConfig } from "../config/defaults.js";
import { writeThumbnailEncodingMarker } from "../image/thumbnail.js";
import type { BuilderPlugin } from "../plugins/types.js";
import { StorageManager } from "../storage/manager.js";
import type { BuilderConfig } from "../types/config.js";
import type { BuilderOptions } from "../types/options.js";
import type { PhotoManifestItem } from "../types/photo.js";

const OPTIONS: BuilderOptions = {
  isForceMode: false,
  isForceManifest: false,
  isForceThumbnails: false,
};

const temporaryDirectories: string[] = [];
const builders: AfilmoryBuilder[] = [];

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "afilmory-safety-"));
  temporaryDirectories.push(root);
  const sourceDir = path.join(root, "source");
  const outputDir = path.join(root, "output");
  const thumbnailsDir = path.join(outputDir, "thumbnails");
  const manifestPath = path.join(outputDir, "photos-manifest.json");
  await fs.mkdir(sourceDir, { recursive: true });

  const config = createDefaultBuilderConfig();
  config.user = {
    storage: { provider: "local", basePath: sourceDir, baseUrl: "/photos" },
  };
  config.output = {
    manifestPath,
    thumbnailsDir,
    originalsDir: path.join(outputDir, "originals"),
  };
  config.plugins = [];
  config.system.processing.worker.useClusterMode = false;
  return { config, manifestPath, sourceDir, thumbnailsDir };
}

function createPhoto(
  id = "photo",
  overrides: Partial<PhotoManifestItem> = {},
): PhotoManifestItem {
  return {
    id,
    originalUrl: `/photos/${id}.jpg`,
    thumbnailUrl: `/thumbnails/${id}.jpg`,
    thumbHash: null,
    width: 32,
    height: 24,
    aspectRatio: 4 / 3,
    s3Key: `${id}.jpg`,
    lastModified: "2026-01-01T00:00:00.000Z",
    size: 12,
    exif: null,
    toneAnalysis: null,
    location: null,
    title: id,
    dateTaken: "2026-01-01T00:00:00.000Z",
    tags: [],
    description: "",
    ...overrides,
  };
}

function makeBuilder(config: BuilderConfig) {
  const builder = new AfilmoryBuilder(config);
  builders.push(builder);
  return builder;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const builder of builders.splice(0)) builder.dispose();
  for (const directory of temporaryDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("builder artifact safety", () => {
  it("preflights cluster plugin serialization before scanning storage", async () => {
    const { config } = await createFixture();
    config.system.processing.worker.useClusterMode = true;
    config.plugins = [{ name: "inline-only", hooks: {} }];
    const listSpy = vi.spyOn(StorageManager.prototype, "listAllFilesDetailed");

    await expect(makeBuilder(config).buildManifest(OPTIONS)).rejects.toThrow(
      /Cluster mode cannot serialize inline plugin "inline-only"/,
    );
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("preserves the committed gallery when a source listing is incomplete", async () => {
    const { config, manifestPath, thumbnailsDir } = await createFixture();
    const photo = createPhoto();
    const previous = createManifest({
      generatedAt: "2026-01-02T00:00:00.000Z",
      source: { provider: "local", baseUrl: "/photos" },
      photos: [photo],
    });
    const serialized = JSON.stringify(previous, null, 2);
    await fs.mkdir(thumbnailsDir, { recursive: true });
    await fs.writeFile(manifestPath, serialized);
    await fs.writeFile(path.join(thumbnailsDir, "photo.jpg"), "old thumbnail");
    await writeThumbnailEncodingMarker(thumbnailsDir);

    let onErrorCalled = false;
    const observerPlugin = {
      name: "observe-final-gallery",
      hooks: {
        onError: () => {
          onErrorCalled = true;
        },
      },
    } satisfies BuilderPlugin;
    config.plugins = [observerPlugin];
    vi.spyOn(
      StorageManager.prototype,
      "listAllFilesDetailed",
    ).mockResolvedValue({
      objects: [{ key: "photo.jpg" }],
      complete: false,
      reason: { code: "max-file-limit", message: "test truncation" },
    });

    await expect(makeBuilder(config).buildManifest(OPTIONS)).rejects.toThrow(
      "incomplete storage listing",
    );

    expect(onErrorCalled).toBe(true);
    expect(await fs.readFile(manifestPath, "utf8")).toBe(serialized);
    await expect(
      fs.access(path.join(thumbnailsDir, "photo.jpg")),
    ).resolves.toBeUndefined();
  });

  it("keeps the previous item when a force reprocess fails", async () => {
    const { config, manifestPath, sourceDir, thumbnailsDir } =
      await createFixture();
    const photo = createPhoto();
    const previous = createManifest({
      generatedAt: "2026-01-02T00:00:00.000Z",
      source: { provider: "local", baseUrl: "/photos" },
      photos: [photo],
    });
    const serialized = JSON.stringify(previous, null, 2);
    await fs.mkdir(thumbnailsDir, { recursive: true });
    await fs.writeFile(manifestPath, serialized);
    await fs.writeFile(path.join(thumbnailsDir, "photo.jpg"), "old thumbnail");
    await fs.writeFile(path.join(sourceDir, "photo.jpg"), "not an image");

    const result = await makeBuilder(config).buildManifest({
      ...OPTIONS,
      isForceMode: true,
    });

    expect(result).toMatchObject({
      failedCount: 1,
      hasUpdates: false,
      totalPhotos: 1,
    });
    expect(await fs.readFile(manifestPath, "utf8")).toBe(serialized);
    await expect(
      fs.access(path.join(thumbnailsDir, "photo.jpg")),
    ).resolves.toBeUndefined();
  }, 30_000);

  it("reprocesses a leniently repaired cached item", async () => {
    const { config, manifestPath, sourceDir, thumbnailsDir } =
      await createFixture();
    const image = await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .jpeg()
      .toBuffer();
    await fs.writeFile(path.join(sourceDir, "photo.jpg"), image);
    const rawManifest = {
      ...createManifest({
        generatedAt: "2026-01-02T00:00:00.000Z",
        source: { provider: "local", baseUrl: "/photos" },
      }),
      photos: [{ ...createPhoto(), width: "corrupt-but-repairable" }],
    };
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(rawManifest, null, 2));
    await writeThumbnailEncodingMarker(thumbnailsDir);

    const result = await makeBuilder(config).buildManifest(OPTIONS);
    const rawWrittenManifest = JSON.parse(
      await fs.readFile(manifestPath, "utf8"),
    );
    const manifest = assertManifest(rawWrittenManifest);

    expect(result.newCount).toBe(0);
    expect(result.processedCount).toBe(1);
    expect(manifest.photos[0]).toMatchObject({ width: 40, height: 20 });
    expect(manifest.photos[0]!.aspectRatio).toBe(2);
    expect(rawWrittenManifest.source).toEqual({
      provider: "local",
      baseUrl: "/photos",
    });
  }, 30_000);

  it("rejects concurrent builds on one instance and resets the guard", async () => {
    const { config } = await createFixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gatePlugin = {
      name: "build-gate",
      hooks: {
        beforeBuild: async () => {
          entered();
          await gate;
        },
      },
    } satisfies BuilderPlugin;
    config.plugins = [gatePlugin];
    const builder = makeBuilder(config);
    const first = builder.buildManifest(OPTIONS);
    await enteredGate;

    await expect(builder.buildManifest(OPTIONS)).rejects.toThrow(
      /cannot run concurrently/,
    );
    release();
    await first;

    await expect(builder.buildManifest(OPTIONS)).resolves.toMatchObject({
      totalPhotos: 0,
    });
  });
});
