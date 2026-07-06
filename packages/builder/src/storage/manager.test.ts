import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { StorageConfig } from "./interfaces.js";
import { normalizeStorageConfig } from "./interfaces.js";
import { StorageManager } from "./manager.js";
import { LocalFileSystemProvider } from "./providers/local-provider.js";
import { S3StorageProvider } from "./providers/s3-provider.js";

const s3Config: StorageConfig = {
  provider: "s3",
  bucket: "bucket",
  region: "auto",
  endpoint: "https://example.com",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

// 模拟历史配置文件里的原始对象：config 装载层本来就是未经校验的类型断言
// （见 config/index.ts applyUserOverrides），这里复刻同一条信任边界。
function asRawStorageConfig(raw: Record<string, unknown>): StorageConfig {
  return raw as StorageConfig;
}

describe("StorageManager.createProvider dispatch", () => {
  it("creates an S3StorageProvider for provider: 's3'", () => {
    const manager = new StorageManager(s3Config);
    expect(manager.getProvider()).toBeInstanceOf(S3StorageProvider);
  });

  it("creates a LocalFileSystemProvider for provider: 'local'", () => {
    const manager = new StorageManager({
      provider: "local",
      basePath: "/tmp/photos",
    });
    expect(manager.getProvider()).toBeInstanceOf(LocalFileSystemProvider);
  });

  it("throws for an unknown provider instead of silently falling back to S3", () => {
    const config = asRawStorageConfig({
      provider: "ftp",
      basePath: "/tmp/photos",
    });
    expect(() => new StorageManager(config)).toThrow(
      /Unknown storage provider: ftp/,
    );
  });
});

describe("legacy config compatibility", () => {
  it("resolves a discriminant-less S3 config to the S3 provider", () => {
    // 历史配置：StorageConfig 曾经就是 S3Config，provider 字段可能缺失。
    // config 装载层是未经校验的类型断言，运行时必须兜底成 s3。
    const legacy = asRawStorageConfig({
      bucket: "bucket",
      region: "auto",
      endpoint: "https://example.com",
      accessKeyId: "key",
      secretAccessKey: "secret",
    });

    const manager = new StorageManager(legacy);
    expect(manager.getProvider()).toBeInstanceOf(S3StorageProvider);
  });

  it("normalizeStorageConfig defaults a missing provider to 's3' without mutating explicit configs", () => {
    const legacy = asRawStorageConfig({ bucket: "bucket" });
    expect(normalizeStorageConfig(legacy).provider).toBe("s3");

    const local: StorageConfig = { provider: "local", basePath: "/tmp/x" };
    expect(normalizeStorageConfig(local)).toBe(local);
    expect(normalizeStorageConfig(s3Config)).toBe(s3Config);
  });
});

describe("StorageManager exclude filters (cross-provider layer)", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "afilmory-manager-"));
    await fs.writeFile(path.join(baseDir, "a.jpg"), "a");
    await fs.mkdir(path.join(baseDir, "thumbnails"), { recursive: true });
    await fs.writeFile(path.join(baseDir, "thumbnails", "a.jpg"), "t");
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("addExcludePrefix filters listings on top of any provider", async () => {
    const manager = new StorageManager({
      provider: "local",
      basePath: baseDir,
    });
    manager.addExcludePrefix("thumbnails");

    const keys = (await manager.listAllFiles()).map((o) => o.key);
    expect(keys).toEqual(["a.jpg"]);
  });
});
