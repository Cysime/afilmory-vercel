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

import { assertManifest } from "@afilmory/schema";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AfilmoryBuilder } from "../builder/builder.js";
import { createDefaultBuilderConfig } from "../config/defaults.js";
import type { BuilderConfig } from "../types/config.js";
import type { BuilderOptions } from "../types/options.js";

/**
 * 为什么存在这个测试（收口用的唯一一条真实链路测试）：
 *
 * 本仓的其余 builder 测试全部跑在 mock 之下——存储、sharp、exiftool、缩略图落盘
 * 都是替身。于是 AfilmoryBuilder.buildManifest → 图片管道 → 处理器 这条"产品的核心
 * 承诺"（扫描存储 → 产出合法 manifest + 缩略图，并且能增量）从未被任何测试真正执行过。
 * 一次审计把这条"从未被执行的核心路径"列为必须补齐的缺口。
 *
 * 这个测试就是那条收口：用 sharp 生成真实的小 JPEG，走 provider:"local" 真实文件系统，
 * 真正调用 exiftool + sharp + thumbhash，把 manifest 与缩略图真正写到磁盘，然后断言：
 *   1. 落盘的 manifest 能通过 @afilmory/schema 的严格 assertManifest（web 构建的闸门）；
 *   2. 首次构建把每张照片都当新照片处理，产出缩略图、thumbHash、尺寸/宽高比；
 *   3. 同配置再构建一次是完全增量的（没有任何照片被重新处理，全部照片被保留）；
 *   4. 删掉一张源文件后，该照片连同其缩略图被正确清理。
 *
 * 只要这条链路里的任何一环真的坏了（而不仅仅是 mock 的契约漂了），这个测试就会红。
 */

// 真实生成的源图：三种不同宽高比，避免"宽高被读错却恰好相等"这类假阳性。
const FIXTURES = [
  {
    name: "red-64x48.jpg",
    width: 64,
    height: 48,
    bg: { r: 200, g: 40, b: 40 },
  },
  {
    name: "green-48x64.jpg",
    width: 48,
    height: 64,
    bg: { r: 40, g: 200, b: 40 },
  },
  {
    name: "blue-32x32.jpg",
    width: 32,
    height: 32,
    bg: { r: 40, g: 40, b: 200 },
  },
] as const;

// 第三次构建要删掉的那张（连同它的缩略图应当被清理）。
const DELETED_FIXTURE = FIXTURES.at(-1)!;

const BUILD_OPTIONS: BuilderOptions = {
  isForceMode: false,
  isForceManifest: false,
  isForceThumbnails: false,
};

let tmpDir: string;
let sourceDir: string;
let manifestPath: string;
let thumbnailsDir: string;
let config: BuilderConfig;

// 每个构建都用一个全新的 AfilmoryBuilder；ExifService 包着 exiftool-vendored 的常驻
// 子进程，忘了 dispose 会让 vitest 永远挂住。这里统一登记、在 afterAll 兜底 dispose，
// 即使中途某个断言抛错，已创建的 builder 也都会被关闭。
const createdBuilders: AfilmoryBuilder[] = [];

function makeBuilder(): AfilmoryBuilder {
  // 直接 new AfilmoryBuilder(fullConfig) —— 与 CLI 里 resolveBuilderConfig 产出完整
  // BuilderConfig 后 `new AfilmoryBuilder(config)` 的构造路径一致；这里跳过 c12 装载与
  // schema 校验，直接给一个已完整的 config（构造器会把 output 幂等归一成绝对路径）。
  const builder = new AfilmoryBuilder(config);
  createdBuilders.push(builder);
  return builder;
}

async function generateJpeg(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background },
  })
    .jpeg()
    .toBuffer();
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readManifestFromDisk() {
  const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
  // 严格断言：这正是 web 构建用来卡关的门；刚生成的 manifest 必须无损通过。
  return assertManifest(raw);
}

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "afilmory-builder-it-"));
  sourceDir = path.join(tmpDir, "source");
  await mkdir(sourceDir, { recursive: true });

  for (const fixture of FIXTURES) {
    await writeFile(
      path.join(sourceDir, fixture.name),
      await generateJpeg(fixture.width, fixture.height, fixture.bg),
    );
  }

  manifestPath = path.join(tmpDir, "out", "photos-manifest.json");
  thumbnailsDir = path.join(tmpDir, "out", "thumbnails");
  const originalsDir = path.join(tmpDir, "out", "originals");

  config = createDefaultBuilderConfig();
  // provider:"local" 需要绝对 basePath；用临时目录的绝对路径。字段名以 LocalConfig 为准：
  // { provider, basePath, baseUrl }。baseUrl 决定 originalUrl 前缀（/photos/<key>）。
  config.user = {
    storage: { provider: "local", basePath: sourceDir, baseUrl: "/photos" },
  };
  config.output = { manifestPath, thumbnailsDir, originalsDir };
  // 强制非 cluster：本测试图片数很少（< concurrency*2 本就不会进 cluster），但显式关掉
  // useClusterMode，锁定走主进程内的并发池路径，避免依赖"任务数阈值"这种隐式条件。
  config.system.observability.performance.worker.useClusterMode = false;
  // 无插件：不加载 geocoding（否则会走网络），也不挂远端缩略图存储——缩略图只落本地。
  config.plugins = [];
});

afterAll(async () => {
  for (const builder of createdBuilders) {
    // ExifService.close() 幂等；不 dispose 会泄漏常驻 exiftool 进程并挂住 vitest。
    builder.dispose();
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("AfilmoryBuilder end-to-end (real sharp + exiftool + local FS)", () => {
  it("scans local storage into a valid manifest + thumbnails, then rebuilds incrementally and prunes deletions", async () => {
    // ---- 构建 #1：全新，每张都是新照片 ----
    const first = await makeBuilder().buildManifest(BUILD_OPTIONS);

    expect(first.newCount).toBe(FIXTURES.length);
    expect(first.processedCount).toBe(FIXTURES.length);
    expect(first.failedCount).toBe(0);
    expect(first.skippedCount).toBe(0);
    expect(first.deletedCount).toBe(0);
    expect(first.totalPhotos).toBe(FIXTURES.length);
    expect(first.hasUpdates).toBe(true);

    // (a) 落盘 manifest 通过严格 assertManifest。
    const manifest = await readManifestFromDisk();
    expect(manifest.photos).toHaveLength(FIXTURES.length);

    const byKey = new Map(manifest.photos.map((photo) => [photo.s3Key, photo]));

    for (const fixture of FIXTURES) {
      const item = byKey.get(fixture.name);
      expect(item, `manifest 应包含 ${fixture.name}`).toBeDefined();
      if (!item) continue;

      // (c) 尺寸/宽高比与源图一致。
      expect(item.width).toBe(fixture.width);
      expect(item.height).toBe(fixture.height);
      expect(item.aspectRatio).toBeCloseTo(fixture.width / fixture.height, 5);

      // 缩略图 URL 非空，指向 /thumbnails/<id>.jpg。
      expect(item.thumbnailUrl).toBeTruthy();
      expect(item.thumbnailUrl).toBe(`/thumbnails/${item.id}.jpg`);

      // thumbHash 非空，且是 uint8ArrayToHex 产出的十六进制字符串。
      expect(item.thumbHash).toBeTruthy();
      expect(item.thumbHash).toMatch(/^[\da-f]+$/i);

      // originalUrl 由本地 baseUrl(/photos) + key 拼出。
      expect(item.originalUrl).toBe(`/photos/${fixture.name}`);

      // 缩略图 .jpg 实际落盘（每张一个）。
      expect(
        await pathExists(path.join(thumbnailsDir, `${item.id}.jpg`)),
        `${fixture.name} 的缩略图应已落盘`,
      ).toBe(true);
    }

    // ---- 构建 #2：同配置、全新 builder —— 完全增量 ----
    const second = await makeBuilder().buildManifest(BUILD_OPTIONS);

    expect(second.newCount).toBe(0);
    expect(second.processedCount).toBe(0);
    expect(second.failedCount).toBe(0);
    expect(second.deletedCount).toBe(0);
    // 全部照片被保留：这才是"增量"的实质证据。
    expect(second.totalPhotos).toBe(FIXTURES.length);
    expect(second.hasUpdates).toBe(false);
    // 注意：当没有任何任务入队时，builder 走"空任务"快路径（addExistingItems），
    // 保留的照片走 totalPhotos 记账，并不计入 skippedCount —— 因此这里是 0，而不是总数。
    // “没有照片被重新处理”由 processedCount === 0 && totalPhotos === 全量 共同保证。
    expect(second.skippedCount).toBe(0);

    // 第二次构建后 manifest 仍完整且合法。
    const manifestAfterSecond = await readManifestFromDisk();
    expect(manifestAfterSecond.photos).toHaveLength(FIXTURES.length);

    // 记下将被删除那张照片的 id 与缩略图路径（删除前它应当在场）。
    const deletedItem = new Map(
      manifestAfterSecond.photos.map((photo) => [photo.s3Key, photo]),
    ).get(DELETED_FIXTURE.name);
    expect(deletedItem).toBeDefined();
    const deletedThumbnailPath = path.join(
      thumbnailsDir,
      `${deletedItem!.id}.jpg`,
    );
    expect(await pathExists(deletedThumbnailPath)).toBe(true);

    // ---- 构建 #3：删掉一张源文件 —— 该照片与其缩略图应被清理 ----
    await rm(path.join(sourceDir, DELETED_FIXTURE.name));

    const third = await makeBuilder().buildManifest(BUILD_OPTIONS);

    // (e) 恰好删除一张。
    expect(third.deletedCount).toBe(1);
    expect(third.newCount).toBe(0);
    expect(third.processedCount).toBe(0);
    expect(third.failedCount).toBe(0);
    expect(third.totalPhotos).toBe(FIXTURES.length - 1);
    expect(third.hasUpdates).toBe(true);

    // 该照片从 manifest 消失；其余照片仍在。
    const manifestAfterThird = await readManifestFromDisk();
    const keysAfterThird = new Set(
      manifestAfterThird.photos.map((photo) => photo.s3Key),
    );
    expect(keysAfterThird.has(DELETED_FIXTURE.name)).toBe(false);
    expect(manifestAfterThird.photos).toHaveLength(FIXTURES.length - 1);

    // 缩略图被物理删除；被保留照片的缩略图仍在。
    expect(await pathExists(deletedThumbnailPath)).toBe(false);
    for (const photo of manifestAfterThird.photos) {
      expect(
        await pathExists(path.join(thumbnailsDir, `${photo.id}.jpg`)),
      ).toBe(true);
    }
  }, 60_000);
});
