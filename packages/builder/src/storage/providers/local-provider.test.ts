import { Buffer } from "node:buffer";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanProgress } from "../interfaces.js";
import { LocalFileSystemProvider } from "./local-provider.js";

let baseDir: string;

async function writeFixture(
  relativePath: string,
  content = "x",
): Promise<void> {
  const absolute = path.join(baseDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "afilmory-local-"));
  await writeFixture("a.jpg", "photo-a");
  await writeFixture("notes.txt");
  await writeFixture("trip/IMG.heic");
  await writeFixture("trip/IMG.mov");
  await writeFixture("drafts/skip.jpg");
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("LocalFileSystemProvider", () => {
  it("lists all files recursively with posix keys, sorted, with stat-derived metadata", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    const objects = await provider.listAllFiles();
    expect(objects.map((o) => o.key)).toEqual([
      "a.jpg",
      "drafts/skip.jpg",
      "notes.txt",
      "trip/IMG.heic",
      "trip/IMG.mov",
    ]);

    const first = objects[0];
    expect(first.size).toBe(Buffer.byteLength("photo-a"));
    expect(first.lastModified).toBeInstanceOf(Date);
    // 弱 etag 由 stat 派生（mtimeMs-size），必须与 size 部分保持一致
    expect(first.etag).toMatch(/^[\d.]+-\d+$/);
    expect(first.etag!.endsWith(`-${first.size}`)).toBe(true);
  });

  it("accepts children whose names start with two dots", async () => {
    await writeFixture("..archive/..photo.jpg", "dot-photo");
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    const listing = await provider.listAllFilesDetailed();
    expect(listing.complete).toBe(true);
    expect(listing.objects.map((object) => object.key)).toContain(
      "..archive/..photo.jpg",
    );
    await expect(provider.getFile("..archive/..photo.jpg")).resolves.toEqual(
      Buffer.from("dot-photo"),
    );
  });

  it("reports scan progress while listing", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });
    const progress = vi.fn<(p: ScanProgress) => void>();

    await provider.listAllFiles(progress);
    expect(progress).toHaveBeenCalledTimes(5);
    const last = progress.mock.calls.at(-1)![0];
    expect(last.filesScanned).toBe(5);
  });

  it("filters listImages to supported image extensions", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    const images = await provider.listImages();
    expect(images.map((o) => o.key)).toEqual([
      "a.jpg",
      "drafts/skip.jpg",
      "trip/IMG.heic",
    ]);
  });

  it("applies excludeRegex to both listImages and listAllFiles", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
      excludeRegex: "^drafts/",
    });

    const allKeys = (await provider.listAllFiles()).map((o) => o.key);
    expect(allKeys).not.toContain("drafts/skip.jpg");

    const imageKeys = (await provider.listImages()).map((o) => o.key);
    expect(imageKeys).toEqual(["a.jpg", "trip/IMG.heic"]);
  });

  it("ignores an invalid excludeRegex instead of throwing", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
      excludeRegex: "[",
    });

    const keys = (await provider.listAllFiles()).map((o) => o.key);
    expect(keys).toContain("a.jpg");
  });

  it("marks a missing basePath as an incomplete listing", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: path.join(baseDir, "does-not-exist"),
    });

    await expect(provider.listAllFiles()).resolves.toEqual([]);
    await expect(provider.listAllFilesDetailed()).resolves.toMatchObject({
      objects: [],
      complete: false,
      reason: { code: "provider-error" },
    });
  });

  it("marks a scan incomplete when a listed subdirectory disappears", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });
    let removed = false;

    const listing = await provider.listAllFilesDetailed(() => {
      if (removed) return;
      removed = true;
      fsSync.rmSync(path.join(baseDir, "trip"), {
        force: true,
        recursive: true,
      });
    });

    expect(listing.complete).toBe(false);
    expect(listing.reason?.code).toBe("provider-error");
  });

  it("getFile returns the file content and null for missing keys", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    await expect(provider.getFile("a.jpg")).resolves.toEqual(
      Buffer.from("photo-a"),
    );
    await expect(provider.getFile("missing.jpg")).resolves.toBeNull();
  });

  it("getFile rejects path traversal outside basePath", async () => {
    const outside = path.join(path.dirname(baseDir), "outside-secret.txt");
    await fs.writeFile(outside, "secret");
    try {
      const provider = new LocalFileSystemProvider({
        provider: "local",
        basePath: baseDir,
      });

      await expect(
        provider.getFile("../outside-secret.txt"),
      ).resolves.toBeNull();
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it("getFile rejects a symlink that escapes basePath", async () => {
    const outside = path.join(path.dirname(baseDir), "outside-secret.txt");
    const linked = path.join(baseDir, "linked.jpg");
    await fs.writeFile(outside, "secret");
    await fs.symlink(outside, linked);
    try {
      const provider = new LocalFileSystemProvider({
        provider: "local",
        basePath: baseDir,
      });

      await expect(provider.getFile("linked.jpg")).resolves.toBeNull();
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it("generates public URLs under /originals by default with encoded segments", () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    expect(provider.generatePublicUrl("family/2024 #1?.jpg")).toBe(
      "/originals/family/2024%20%231%3F.jpg",
    );
  });

  it("respects a custom baseUrl and strips its trailing slash", () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
      baseUrl: "https://cdn.example.com/photos/",
    });

    expect(provider.generatePublicUrl("a.jpg")).toBe(
      "https://cdn.example.com/photos/a.jpg",
    );
  });

  it("detects live photo pairs from listed objects", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    const allObjects = await provider.listAllFiles();
    const pairs = provider.detectLivePhotos(allObjects);

    expect(pairs.size).toBe(1);
    expect(pairs.get("trip/IMG.heic")?.key).toBe("trip/IMG.mov");
  });

  it("uploadFile writes under basePath and listObjectKeys sees it without excludes", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
      excludeRegex: "^thumbnails/",
    });

    const uploaded = await provider.uploadFile(
      "thumbnails/a.jpg",
      Buffer.from("thumb"),
    );
    expect(uploaded.key).toBe("thumbnails/a.jpg");
    expect(uploaded.size).toBe(5);

    // listObjectKeys 契约：不应用 excludeRegex（与 S3 provider 一致）
    await expect(provider.listObjectKeys("thumbnails/")).resolves.toEqual([
      "thumbnails/a.jpg",
    ]);
    // 但 listAllFiles 会应用 excludeRegex
    const allKeys = (await provider.listAllFiles()).map((o) => o.key);
    expect(allKeys).not.toContain("thumbnails/a.jpg");
  });

  it("allows concurrent uploads to create the same parent directory", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    await expect(
      Promise.all([
        provider.uploadFile("new/nested/a.jpg", Buffer.from("a")),
        provider.uploadFile("new/nested/b.jpg", Buffer.from("b")),
      ]),
    ).resolves.toHaveLength(2);
    await expect(
      fs.readFile(path.join(baseDir, "new/nested/a.jpg")),
    ).resolves.toEqual(Buffer.from("a"));
    await expect(
      fs.readFile(path.join(baseDir, "new/nested/b.jpg")),
    ).resolves.toEqual(Buffer.from("b"));
  });

  it("uploadFile never follows an existing destination symlink", async () => {
    const outside = path.join(path.dirname(baseDir), "outside-target.jpg");
    await fs.writeFile(outside, "do-not-overwrite");
    await fs.symlink(outside, path.join(baseDir, "thumbnail.jpg"));
    try {
      const provider = new LocalFileSystemProvider({
        provider: "local",
        basePath: baseDir,
      });

      await expect(
        provider.uploadFile("thumbnail.jpg", Buffer.from("replacement")),
      ).rejects.toThrow("symbolic link");
      await expect(fs.readFile(outside, "utf8")).resolves.toBe(
        "do-not-overwrite",
      );
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it("uploadFile rejects a parent directory symlink outside basePath", async () => {
    const outsideDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "afilmory-local-outside-"),
    );
    await fs.symlink(outsideDirectory, path.join(baseDir, "linked-dir"));
    try {
      const provider = new LocalFileSystemProvider({
        provider: "local",
        basePath: baseDir,
      });

      await expect(
        provider.uploadFile("linked-dir/thumbnail.jpg", Buffer.from("image")),
      ).rejects.toThrow("outside the photo directory");
      await expect(
        fs.stat(path.join(outsideDirectory, "thumbnail.jpg")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(outsideDirectory, { force: true, recursive: true });
    }
  });

  it("deleteFile removes the file and tolerates missing keys", async () => {
    const provider = new LocalFileSystemProvider({
      provider: "local",
      basePath: baseDir,
    });

    await provider.deleteFile("notes.txt");
    await expect(provider.getFile("notes.txt")).resolves.toBeNull();
    // 与 S3 DeleteObject 一致：删除不存在的 key 不抛错
    await expect(provider.deleteFile("notes.txt")).resolves.toBeUndefined();
  });
});
