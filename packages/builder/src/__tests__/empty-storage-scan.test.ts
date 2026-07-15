import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertManifest, createManifest } from "@afilmory/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AfilmoryBuilder,
  shouldWriteThumbnailEncodingMarker,
} from "../builder/builder.js";
import { createDefaultBuilderConfig } from "../config/defaults.js";
import {
  isThumbnailEncodingStale,
  writeThumbnailEncodingMarker,
} from "../image/thumbnail.js";
import type { LogMessage } from "../logger/index.js";
import { setLogListener } from "../logger/index.js";
import type { BuilderConfig } from "../types/config.js";
import type { BuilderOptions } from "../types/options.js";
import type { PhotoManifestItem } from "../types/photo.js";

/**
 * 空扫描收敛性回归（真实 local provider + 真实文件系统，零照片故无需 sharp/exiftool）：
 *
 * 1. 列举成功但得到 0 张照片、且现有 manifest 非空——必须视作疑似误配/瞬时故障：
 *    manifest 与缩略图原样保留（不清理、不落盘），并以错误结束，让生产 fresh
 *    build 不能把旧图库误报成刷新成功；错误给出指向 --force 的操作提示。
 * 2. 同样的空扫描叠加 --force——「空图库」是用户意图：走正常管道写出空 manifest
 *    并清空孤儿缩略图。
 * 3. 零照片构建不得落盘 .encoding 编码签名标记：瞬时空列举撞上编码参数变更时
 *    failedCount 恰好为 0，旧的 CLI 判定会盖上新标记，旧参数缩略图永远不再重生成。
 */

const INCREMENTAL_OPTIONS: BuilderOptions = {
  isForceMode: false,
  isForceManifest: false,
  isForceThumbnails: false,
};

const SEEDED_PHOTOS: PhotoManifestItem[] = [
  createPhoto("kept-a"),
  createPhoto("kept-b"),
];

let tmpDir: string;
let sourceDir: string;
let manifestPath: string;
let thumbnailsDir: string;
let config: BuilderConfig;
let logs: LogMessage[];

// ExifService 包着 exiftool-vendored 的常驻子进程（零照片构建不会真正用到，
// 但仍统一登记并 dispose，兜底防止 vitest 挂住）。
const createdBuilders: AfilmoryBuilder[] = [];

function makeBuilder(): AfilmoryBuilder {
  const builder = new AfilmoryBuilder(config);
  createdBuilders.push(builder);
  return builder;
}

function createPhoto(id: string): PhotoManifestItem {
  return {
    id,
    title: id,
    description: "",
    dateTaken: "2026-06-06T00:00:00.000Z",
    tags: [],
    originalUrl: `/photos/${id}.jpg`,
    thumbnailUrl: `/thumbnails/${id}.jpg`,
    thumbHash: null,
    width: 100,
    height: 100,
    aspectRatio: 1,
    s3Key: `${id}.jpg`,
    lastModified: "2026-06-06T00:00:00.000Z",
    size: 100,
    etag: id,
    exif: null,
    toneAnalysis: null,
    location: null,
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "afilmory-empty-scan-"));
  // 源目录存在但为空：local provider 列举成功且返回 0 个对象（≠ 列举失败）。
  sourceDir = path.join(tmpDir, "source");
  await mkdir(sourceDir, { recursive: true });

  manifestPath = path.join(tmpDir, "out", "photos-manifest.json");
  thumbnailsDir = path.join(tmpDir, "out", "thumbnails");
  const originalsDir = path.join(tmpDir, "out", "originals");

  config = createDefaultBuilderConfig();
  config.user = {
    storage: { provider: "local", basePath: sourceDir, baseUrl: "/photos" },
  };
  config.output = { manifestPath, thumbnailsDir, originalsDir };
  config.system.processing.worker.useClusterMode = false;
  config.plugins = [];

  // 上一次成功构建留下的产物：非空 manifest + 每张照片的缩略图 + .encoding 标记。
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(createManifest({ photos: SEEDED_PHOTOS }), null, 2),
  );
  await mkdir(thumbnailsDir, { recursive: true });
  for (const photo of SEEDED_PHOTOS) {
    await writeFile(path.join(thumbnailsDir, `${photo.id}.jpg`), "stale-jpeg");
  }
  await writeThumbnailEncodingMarker(thumbnailsDir);

  logs = [];
  setLogListener((message) => logs.push(message), { forwardToConsole: false });
});

afterEach(async () => {
  setLogListener(null, { forwardToConsole: true });
  for (const builder of createdBuilders.splice(0)) {
    builder.dispose();
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("empty storage scan", () => {
  it("keeps a non-empty manifest untouched and fails actionably without --force", async () => {
    const manifestBefore = await readFile(manifestPath, "utf-8");

    await expect(
      makeBuilder().buildManifest(INCREMENTAL_OPTIONS),
    ).rejects.toThrow("Pass --force");

    // manifest 逐字节未动；缩略图与 .encoding 标记未被孤儿清理波及。
    expect(await readFile(manifestPath, "utf-8")).toBe(manifestBefore);
    for (const photo of SEEDED_PHOTOS) {
      expect(
        await pathExists(path.join(thumbnailsDir, `${photo.id}.jpg`)),
      ).toBe(true);
    }
    expect(await isThumbnailEncodingStale(thumbnailsDir)).toBe(false);

    const failure = logs.find(
      (message) =>
        message.level === "error" &&
        String(message.args[0]).includes("Pass --force"),
    );
    expect(failure, "an actionable error should be logged").toBeDefined();
    expect(String(failure!.args[0])).toContain(
      `manifest has ${SEEDED_PHOTOS.length}`,
    );
  });

  it("publishes an empty manifest and cleans up thumbnails with --force", async () => {
    const result = await makeBuilder().buildManifest({
      ...INCREMENTAL_OPTIONS,
      isForceMode: true,
    });

    expect(result.failedCount).toBe(0);
    expect(result.totalPhotos).toBe(0);

    // 空 manifest 真正落盘，且通过严格 assertManifest。
    const manifest = assertManifest(
      JSON.parse(await readFile(manifestPath, "utf-8")),
    );
    expect(manifest.photos).toHaveLength(0);

    // 孤儿清理跑过：整个缩略图目录（含旧缩略图）被清空。
    expect(await pathExists(thumbnailsDir)).toBe(false);
  });
});

describe("shouldWriteThumbnailEncodingMarker", () => {
  it("rejects zero-photo results regardless of force mode", () => {
    expect(
      shouldWriteThumbnailEncodingMarker(
        { totalPhotos: 0, failedCount: 0 },
        false,
      ),
    ).toBe(false);
    expect(
      shouldWriteThumbnailEncodingMarker(
        { totalPhotos: 0, failedCount: 0 },
        true,
      ),
    ).toBe(false);
  });

  it("keeps the force-run failure semantics for non-empty builds", () => {
    expect(
      shouldWriteThumbnailEncodingMarker(
        { totalPhotos: 3, failedCount: 0 },
        true,
      ),
    ).toBe(true);
    expect(
      shouldWriteThumbnailEncodingMarker(
        { totalPhotos: 3, failedCount: 1 },
        true,
      ),
    ).toBe(false);
    expect(
      shouldWriteThumbnailEncodingMarker(
        { totalPhotos: 3, failedCount: 1 },
        false,
      ),
    ).toBe(true);
  });
});
