import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolvePublicAssetDirectory,
  resolvePublicAssetPath,
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
    await fs.writeFile(thumbnail, "image");

    expect(resolvePublicAssetPath("/thumbnails/photo.jpg?v=1", root)).toBe(
      await fs.realpath(thumbnail),
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
