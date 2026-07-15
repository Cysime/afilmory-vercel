import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isThumbnailEncodingStale,
  THUMBNAIL_ENCODING_SIGNATURE,
  writeThumbnailEncodingMarker,
} from "./thumbnail.js";

describe("thumbnail encoding marker", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "afilmory-thumb-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("treats a directory without a marker as stale (unknown encoding params)", async () => {
    await expect(isThumbnailEncodingStale(dir)).resolves.toBe(true);
  });

  it("treats a mismatched marker as stale so param changes force regeneration", async () => {
    await fs.writeFile(path.join(dir, ".encoding"), "jpeg-w600-q90\n");
    await expect(isThumbnailEncodingStale(dir)).resolves.toBe(true);
  });

  it("round-trips: after writing the marker the directory is fresh", async () => {
    await writeThumbnailEncodingMarker(dir);
    await expect(isThumbnailEncodingStale(dir)).resolves.toBe(false);
    const marker = await fs.readFile(path.join(dir, ".encoding"), "utf-8");
    expect(marker.trim()).toBe(THUMBNAIL_ENCODING_SIGNATURE);
  });

  it("creates the directory when writing the marker into a fresh path", async () => {
    const nested = path.join(dir, "not-yet-created");
    await writeThumbnailEncodingMarker(nested);
    await expect(isThumbnailEncodingStale(nested)).resolves.toBe(false);
  });

  it("surfaces marker I/O/type errors instead of treating them as stale", async () => {
    await fs.mkdir(path.join(dir, ".encoding"));
    await expect(isThumbnailEncodingStale(dir)).rejects.toMatchObject({
      code: "EISDIR",
    });
  });

  it("replaces a marker symlink without overwriting its target", async () => {
    const outside = path.join(dir, "outside.txt");
    const marker = path.join(dir, ".encoding");
    await fs.writeFile(outside, "keep");
    await fs.symlink(outside, marker);

    await writeThumbnailEncodingMarker(dir);

    await expect(fs.readFile(outside, "utf8")).resolves.toBe("keep");
    expect((await fs.lstat(marker)).isSymbolicLink()).toBe(false);
  });
});
