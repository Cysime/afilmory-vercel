import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import consola from "consola";
import { describe, expect, it, vi } from "vitest";

import type { StorageConfig } from "../storage/interfaces.js";
import type { BuilderConfigInput } from "../types/config.js";
import { createDefaultBuilderConfig } from "./defaults.js";
import { loadBuilderConfig, resolveBuilderConfig } from "./index.js";
import type { BuilderConfigFileInput } from "./schema.js";

function asInput(value: unknown): BuilderConfigInput {
  return value as BuilderConfigInput;
}

describe("resolveBuilderConfig — old merge semantics preserved", () => {
  it("resolves a representative self-hoster config (builder.config.ts shape) exactly like the old hand-merge", () => {
    // 输入形状对齐仓库根 builder.config.ts：output + s3 storage + system + plugins
    const storage: StorageConfig = {
      provider: "s3",
      bucket: "photos",
      region: "auto",
      endpoint: "https://s3.example.com",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      prefix: "photos/",
      keepAlive: true,
      maxSockets: 64,
      connectionTimeoutMs: 5_000,
      socketTimeoutMs: 30_000,
      requestTimeoutMs: 20_000,
      idleTimeoutMs: 10_000,
      totalTimeoutMs: 60_000,
      retryMode: "standard",
      maxAttempts: 3,
      downloadConcurrency: 8,
    };
    const plugins = [
      { plugin: "geocoding" as const, options: { enable: true } },
    ];
    const input: BuilderConfigFileInput = {
      output: {
        manifestPath: "/repo/generated/photos-manifest.json",
        thumbnailsDir: "/repo/apps/web/public/thumbnails",
        originalsDir: "/repo/apps/web/public/originals",
      },
      storage,
      system: {
        processing: {
          defaultConcurrency: 12,
          enableLivePhotoDetection: false,
          digestSuffixLength: 6,
          // worker 的用户侧路径已迁到 processing 下；resolved config 仍存放在
          // observability.performance.worker（见 schema.ts 的 mergeSystemSection）
          worker: { workerCount: 4, useClusterMode: false },
        },
        observability: {
          showProgress: false,
          logging: { level: "debug" },
        },
      },
      plugins,
    };

    const resolved = resolveBuilderConfig(input);

    // 期望值按旧 applySystemOverrides/applyUserOverrides/applyOutputOverrides 语义手工推导：
    // 未覆盖的键保留默认值（showDetailedStats、logging.verbose/outputToFile、worker.timeout/workerConcurrency）
    expect(resolved).toEqual({
      system: {
        processing: {
          defaultConcurrency: 12,
          enableLivePhotoDetection: false,
          digestSuffixLength: 6,
        },
        observability: {
          showProgress: false,
          showDetailedStats: true,
          logging: { verbose: false, level: "debug", outputToFile: false },
          performance: {
            worker: {
              workerCount: 4,
              timeout: 30_000,
              useClusterMode: false,
              workerConcurrency: 2,
            },
          },
        },
      },
      user: { storage },
      output: {
        manifestPath: "/repo/generated/photos-manifest.json",
        thumbnailsDir: "/repo/apps/web/public/thumbnails",
        originalsDir: "/repo/apps/web/public/originals",
      },
      plugins: [{ plugin: "geocoding", options: { enable: true } }],
    });

    // storage 整体按引用替换（旧实现直接赋值，不克隆）
    expect(resolved.user?.storage).toBe(storage);
    // plugins 浅拷贝：新数组、同元素引用
    expect(resolved.plugins).not.toBe(plugins);
    expect(resolved.plugins[0]).toBe(plugins[0]);
  });

  it("returns pristine defaults for an empty input", () => {
    expect(resolveBuilderConfig({})).toEqual(createDefaultBuilderConfig());
  });

  it("keeps user null when user is null or absent, materializes { storage: null } for user: {}", () => {
    expect(resolveBuilderConfig(asInput({ user: null })).user).toBeNull();
    expect(resolveBuilderConfig({}).user).toBeNull();
    expect(resolveBuilderConfig({ user: {} }).user).toEqual({ storage: null });
    expect(resolveBuilderConfig({ user: { storage: null } }).user).toEqual({
      storage: null,
    });
  });

  it("treats top-level storage: null as an explicit empty storage", () => {
    expect(resolveBuilderConfig({ storage: null }).user).toEqual({
      storage: null,
    });
  });

  it("lets top-level storage win over user.storage (applied after, like the old code)", () => {
    const userStorage: StorageConfig = { provider: "local", basePath: "/a" };
    const topStorage: StorageConfig = { provider: "local", basePath: "/b" };
    const resolved = resolveBuilderConfig({
      user: { storage: userStorage },
      storage: topStorage,
    });
    expect(resolved.user?.storage).toBe(topStorage);
  });

  it("ignores empty-string output paths (falls back to defaults, old behavior)", () => {
    const defaults = createDefaultBuilderConfig();
    const resolved = resolveBuilderConfig({
      output: { manifestPath: "", thumbnailsDir: "/x/thumbs" },
    });
    expect(resolved.output.manifestPath).toBe(defaults.output.manifestPath);
    expect(resolved.output.thumbnailsDir).toBe("/x/thumbs");
    expect(resolved.output.originalsDir).toBe(defaults.output.originalsDir);
  });

  it("does not clobber defaults with null/undefined leaves", () => {
    const defaults = createDefaultBuilderConfig();
    const resolved = resolveBuilderConfig(
      asInput({
        system: {
          processing: {
            defaultConcurrency: undefined,
            digestSuffixLength: null,
          },
          observability: { logging: null },
        },
        output: { manifestPath: null },
      }),
    );
    expect(resolved.system.processing.defaultConcurrency).toBe(
      defaults.system.processing.defaultConcurrency,
    );
    expect(resolved.system.processing.digestSuffixLength).toBe(
      defaults.system.processing.digestSuffixLength,
    );
    expect(resolved.system.observability.logging).toEqual(
      defaults.system.observability.logging,
    );
    expect(resolved.output.manifestPath).toBe(defaults.output.manifestPath);
  });

  it("copies supportedFormats into a fresh Set (accepts Set or array, old runtime behavior)", () => {
    const fromArray = resolveBuilderConfig(
      asInput({ system: { processing: { supportedFormats: ["jpg", "png"] } } }),
    );
    expect(fromArray.system.processing.supportedFormats).toEqual(
      new Set(["jpg", "png"]),
    );

    const source = new Set(["jpg"]);
    const fromSet = resolveBuilderConfig(
      asInput({ system: { processing: { supportedFormats: source } } }),
    );
    expect(fromSet.system.processing.supportedFormats).toEqual(
      new Set(["jpg"]),
    );
    expect(fromSet.system.processing.supportedFormats).not.toBe(source);
  });

  it("replaces the plugins list instead of concatenating with the base", () => {
    const base = resolveBuilderConfig({ plugins: [{ plugin: "geocoding" }] });
    const replaced = resolveBuilderConfig(
      { plugins: [{ plugin: "geocoding", name: "second" }] },
      base,
    );
    expect(replaced.plugins).toEqual([{ plugin: "geocoding", name: "second" }]);

    const kept = resolveBuilderConfig({}, base);
    expect(kept.plugins).toEqual([{ plugin: "geocoding" }]);
  });

  it("clones the base config instead of mutating it", () => {
    const base = createDefaultBuilderConfig();
    const resolved = resolveBuilderConfig(
      { system: { processing: { defaultConcurrency: 3 } } },
      base,
    );
    expect(resolved.system.processing.defaultConcurrency).toBe(3);
    expect(base.system.processing.defaultConcurrency).toBe(10);
  });

  it("resolves the legacy worker path identically to system.processing.worker (with a loud deprecation warning)", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    try {
      const modern = resolveBuilderConfig({
        system: { processing: { worker: { workerCount: 4, timeout: 1000 } } },
      });
      expect(warn).not.toHaveBeenCalled();

      const legacy = resolveBuilderConfig(
        asInput({
          system: {
            observability: {
              performance: { worker: { workerCount: 4, timeout: 1000 } },
            },
          },
        }),
      );
      expect(legacy).toEqual(modern);
      expect(warn).toHaveBeenCalledWith(
        '[config] Deprecated key "system.observability.performance.worker" — did you mean "system.processing.worker"? The legacy path still works this release.',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("logs unknown-key warnings loudly via consola", () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    try {
      resolveBuilderConfig(asInput({ system: { procesing: {} } }));
      expect(warn).toHaveBeenCalledWith(
        '[config] Unknown key "system.procesing" — did you mean "processing"?',
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("loadBuilderConfig", () => {
  it("loads builder.config.ts via c12 and resolves it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "afilmory-config-"));
    try {
      await fs.writeFile(
        path.join(dir, "builder.config.ts"),
        'export default { storage: { provider: "local", basePath: "/tmp/photos" }, system: { processing: { worker: { workerCount: 3 } } } };\n',
      );
      const config = await loadBuilderConfig({ cwd: dir });
      expect(config.user?.storage).toEqual({
        provider: "local",
        basePath: "/tmp/photos",
      });
      // 未覆盖的部分保持默认值
      expect(config.system.processing.defaultConcurrency).toBe(10);
      // 新路径 system.processing.worker 端到端落到内部 worker 配置
      expect(config.system.observability.performance.worker.workerCount).toBe(
        3,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("throws the storage-missing error when no config provides storage", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "afilmory-config-"));
    try {
      await expect(loadBuilderConfig({ cwd: dir })).rejects.toThrow(
        "缺失存储配置",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
