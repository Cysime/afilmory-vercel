import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PhotoManifestItem } from "@afilmory/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveGeneratedImageOutputPath,
  resolvePublicAssetDirectory,
  resolvePublicAssetPath,
  resolveWritableGeneratedImageOutputPath,
  sortPhotosForOg,
} from "./generate-og-image.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("resolvePublicAssetPath", () => {
  it("resolves regular public assets and rejects traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "og-public-"));
    temporaryDirectories.push(root);
    await fs.mkdir(path.join(root, "thumbnails"));
    const thumbnail = path.join(root, "thumbnails/photo.jpg");
    const dotPrefixedThumbnail = path.join(root, "thumbnails/..summer.jpg");
    await fs.writeFile(thumbnail, "image");
    await fs.writeFile(dotPrefixedThumbnail, "dot-image");

    expect(resolvePublicAssetPath("/thumbnails/photo.jpg?v=1", root)).toBe(
      await fs.realpath(thumbnail),
    );
    expect(resolvePublicAssetPath("/thumbnails/..summer.jpg", root)).toBe(
      await fs.realpath(dotPrefixedThumbnail),
    );
    expect(resolvePublicAssetPath("/../../private.jpg", root)).toBeNull();
    expect(resolvePublicAssetPath("/%2e%2e/private.jpg", root)).toBeNull();
  });

  it("rejects a public symlink that escapes the public directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "og-public-"));
    temporaryDirectories.push(root);
    const publicDirectory = path.join(root, "public");
    const privateFile = path.join(root, "private.jpg");
    await fs.mkdir(publicDirectory);
    await fs.writeFile(privateFile, "private");
    await fs.symlink(privateFile, path.join(publicDirectory, "linked.jpg"));

    expect(resolvePublicAssetPath("/linked.jpg", publicDirectory)).toBeNull();
  });
});

describe("resolveGeneratedImageOutputPath", () => {
  it("keeps generated files inside the requested output directory", () => {
    const outputDirectory = path.resolve("/tmp/afilmory-og-output");

    expect(
      resolveGeneratedImageOutputPath(outputDirectory, "assets/og-image.png"),
    ).toBe(path.join(outputDirectory, "assets/og-image.png"));
    expect(() =>
      resolveGeneratedImageOutputPath(outputDirectory, "../private.png"),
    ).toThrow("escapes outputDir");
    expect(() =>
      resolveGeneratedImageOutputPath(outputDirectory, "/private.png"),
    ).toThrow("safe relative path");
  });

  it("rejects symlinked output directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "og-output-"));
    temporaryDirectories.push(root);
    const outputDirectory = path.join(root, "public");
    const outsideDirectory = path.join(root, "outside");
    await fs.mkdir(outputDirectory);
    await fs.mkdir(outsideDirectory);
    await fs.symlink(outsideDirectory, path.join(outputDirectory, "assets"));

    expect(() =>
      resolveWritableGeneratedImageOutputPath(
        outputDirectory,
        "assets/og-image.png",
      ),
    ).toThrow("unsafe directory");
  });
});

describe("sortPhotosForOg", () => {
  const photo = (
    id: string,
    overrides: Partial<PhotoManifestItem> = {},
  ): PhotoManifestItem =>
    ({
      id,
      dateTaken: "",
      lastModified: "",
      exif: null,
      ...overrides,
    }) as PhotoManifestItem;

  it("orders valid dates ahead of missing dates with deterministic ties", () => {
    const sorted = sortPhotosForOg([
      photo("missing-z"),
      photo("older", { dateTaken: "2025-01-01T00:00:00.000Z" }),
      photo("newer-b", {
        exif: { DateTimeOriginal: "2026:02:03 04:05:06" },
      }),
      photo("newer-a", {
        dateTaken: "2026-02-03T04:05:06.000Z",
      }),
      photo("missing-a"),
    ]);

    expect(sorted.map(({ id }) => id)).toEqual([
      "newer-a",
      "newer-b",
      "older",
      "missing-a",
      "missing-z",
    ]);
  });
});

describe("resolvePublicAssetDirectory", () => {
  it("accepts an existing directory and resolves its real path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "og-public-"));
    temporaryDirectories.push(root);

    expect(resolvePublicAssetDirectory(root)).toBe(await fs.realpath(root));
  });

  it("rejects missing paths and regular files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "og-public-"));
    temporaryDirectories.push(root);
    const regularFile = path.join(root, "asset.txt");
    await fs.writeFile(regularFile, "asset");

    expect(() =>
      resolvePublicAssetDirectory(path.join(root, "missing")),
    ).toThrow(/must point to an existing directory/);
    expect(() => resolvePublicAssetDirectory(regularFile)).toThrow(
      /must point to a directory/,
    );
  });
});
