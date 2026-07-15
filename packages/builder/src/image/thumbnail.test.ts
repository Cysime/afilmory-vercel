import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createThumbnailFileName,
  getThumbnailPublicUrl,
  resolveExistingThumbnail,
  THUMBNAIL_ENCODING_VERSION,
} from "./thumbnail.js";

describe("thumbnail URL helpers", () => {
  it("encodes generated thumbnail filenames for public URLs", () => {
    expect(getThumbnailPublicUrl("album #1?50%")).toBe(
      "/thumbnails/album%20%231%3F50%25.jpg",
    );
  });

  it("content-addresses immutable generated thumbnails", () => {
    const buffer = Buffer.from("encoded jpeg");
    const fileName = createThumbnailFileName("photo", buffer);

    expect(fileName).toMatch(
      new RegExp(
        `^photo\\.[\\da-f]{64}\\.${THUMBNAIL_ENCODING_VERSION}\\.jpg$`,
      ),
    );
    expect(getThumbnailPublicUrl("photo", buffer)).toBe(
      `/thumbnails/${fileName}`,
    );
    expect(createThumbnailFileName("photo", Buffer.from("changed"))).not.toBe(
      fileName,
    );
  });

  it("does not choose an arbitrary addressed file when a CDN URL hides the basename", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "afilmory-thumbnail-"),
    );
    try {
      const first = createThumbnailFileName("photo", Buffer.from("first"));
      const second = createThumbnailFileName("photo", Buffer.from("second"));
      await Promise.all([
        fs.writeFile(path.join(directory, first), "first"),
        fs.writeFile(path.join(directory, second), "second"),
      ]);

      await expect(
        resolveExistingThumbnail(
          "photo",
          directory,
          "https://cdn.example.com/assets/rewritten-name.jpg",
        ),
      ).resolves.toBeNull();
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  });

  it("only reuses regular thumbnail files", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "afilmory-thumbnail-"),
    );
    try {
      await fs.mkdir(path.join(directory, "photo.jpg"));
      await expect(
        resolveExistingThumbnail("photo", directory, "/thumbnails/photo.jpg"),
      ).resolves.toBeNull();
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  });
});
