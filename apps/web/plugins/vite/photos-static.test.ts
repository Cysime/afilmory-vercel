import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  copyLocalPhotos,
  getLocalMediaKeyFromUrl,
  normalizeLocalPhotosBaseUrl,
  parseByteRange,
  resolveLocalPhotoPath,
  resolveRealLocalPhotoPath,
} from "./photos-static";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("photosStaticPlugin helpers", () => {
  it("normalizes safe local URL prefixes and rejects root/traversal prefixes", () => {
    expect(normalizeLocalPhotosBaseUrl("/originals/")).toBe("/originals");
    expect(() => normalizeLocalPhotosBaseUrl("/")).toThrow();
    expect(() => normalizeLocalPhotosBaseUrl("/../private")).toThrow();
    expect(() => normalizeLocalPhotosBaseUrl("/%2e%2e/private")).toThrow();
    expect(() => normalizeLocalPhotosBaseUrl("/photos")).toThrow(
      "reserved application namespace",
    );
    expect(() =>
      normalizeLocalPhotosBaseUrl("https://example.com/photos"),
    ).toThrow();
  });

  it("resolves unicode filenames without allowing traversal", () => {
    const root = path.resolve("/tmp/gallery-photos");
    expect(resolveLocalPhotoPath(root, "/旅行/日落%20%F0%9F%8C%85.jpg")).toBe(
      path.join(root, "旅行/日落 🌅.jpg"),
    );
    expect(resolveLocalPhotoPath(root, "/../secret.jpg")).toBeNull();
    expect(resolveLocalPhotoPath(root, "/%2e%2e/secret.jpg")).toBeNull();
  });

  it("does not follow local-photo symlinks outside the configured root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "photos-static-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const privateFile = path.join(root, "private.jpg");
    await fs.mkdir(source);
    await fs.writeFile(privateFile, "private");
    await fs.symlink(privateFile, path.join(source, "linked.jpg"));

    expect(resolveRealLocalPhotoPath(source, "/linked.jpg")).toBeNull();
  });

  it("parses standard, open-ended, and suffix byte ranges", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=100-", 100)).toBe("invalid");
    expect(parseByteRange("bytes=0-1,4-5", 100)).toBe("invalid");
  });

  it("recognizes thumbnails stored by the local thumbnail-storage plugin", () => {
    expect(
      getLocalMediaKeyFromUrl(
        "/originals/.afilmory/thumbnails/photo.hash.jpg?v=1",
        "/originals",
      ),
    ).toBe(".afilmory/thumbnails/photo.hash.jpg");
    expect(
      getLocalMediaKeyFromUrl("/thumbnails/photo.hash.jpg", "/originals"),
    ).toBeNull();
    expect(
      getLocalMediaKeyFromUrl("/originals/%2e%2e/private.jpg", "/originals"),
    ).toBeNull();
  });

  it("copies only manifest media without deleting generated photo pages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "photos-static-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const destination = path.join(root, "dist/photos");
    await fs.mkdir(path.join(destination, "photo-id"), { recursive: true });
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "photo.jpg"), "image");
    await fs.mkdir(path.join(source, ".afilmory/thumbnails"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(source, ".afilmory/thumbnails/photo.hash.jpg"),
      "thumbnail",
    );
    await fs.writeFile(path.join(source, ".env"), "secret");
    await fs.writeFile(
      path.join(destination, "photo-id/index.html"),
      "seo shell",
    );

    await copyLocalPhotos(source, destination, [
      "photo.jpg",
      ".afilmory/thumbnails/photo.hash.jpg",
    ]);

    await expect(
      fs.readFile(path.join(destination, "photo.jpg"), "utf8"),
    ).resolves.toBe("image");
    await expect(
      fs.readFile(path.join(destination, "photo-id/index.html"), "utf8"),
    ).resolves.toBe("seo shell");
    await expect(
      fs.readFile(
        path.join(destination, ".afilmory/thumbnails/photo.hash.jpg"),
        "utf8",
      ),
    ).resolves.toBe("thumbnail");
    await expect(fs.stat(path.join(destination, ".env"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });
});
