import { describe, expect, it } from "vitest";

import geocodingPlugin from "../plugins/geocoding.js";
import type { BuilderConfigInput } from "../types/config.js";
import { createDefaultBuilderConfig } from "./defaults.js";
import { applyBuilderConfigInput, redactConfigSecrets } from "./schema.js";

// 测试里大量构造带拼写错误/非法类型的输入，统一用这个帮手绕过编译期类型
function asInput(value: unknown): BuilderConfigInput {
  return value as BuilderConfigInput;
}

describe("applyBuilderConfigInput — unknown keys", () => {
  it("warns with the full leaf path and a spelling suggestion", () => {
    const config = createDefaultBuilderConfig();
    const warnings = applyBuilderConfigInput(
      config,
      asInput({ system: { procesing: { thumbnailWidth: 600 } } }),
    );
    expect(warnings).toEqual([
      '[config] Unknown key "system.procesing.thumbnailWidth" — did you mean "processing"?',
    ]);
    // 未知键被丢弃（沿用旧实现的行为），不会混进 resolved config
    expect("procesing" in config.system).toBe(false);
  });

  it("warns on unknown top-level keys", () => {
    const warnings = applyBuilderConfigInput(
      createDefaultBuilderConfig(),
      asInput({ pluginss: [] }),
    );
    expect(warnings).toEqual([
      '[config] Unknown key "pluginss" — did you mean "plugins"?',
    ]);
  });

  it("omits the suggestion when nothing is close enough", () => {
    const warnings = applyBuilderConfigInput(
      createDefaultBuilderConfig(),
      asInput({ system: { observability: { telemetry: true } } }),
    );
    expect(warnings).toEqual([
      '[config] Unknown key "system.observability.telemetry"',
    ]);
  });

  it("warns per provider key set but keeps unknown storage keys (wholesale pass-through)", () => {
    const config = createDefaultBuilderConfig();
    const storage = { provider: "local", basePath: "/photos", bucket: "b" };
    const warnings = applyBuilderConfigInput(config, asInput({ storage }));
    expect(warnings).toEqual(['[config] Unknown key "storage.bucket"']);
    // storage 整体透传：未知键保留，对象保持同一引用
    expect(config.user?.storage).toBe(storage);
  });

  it("does not warn on s3 keys when provider is s3 (and vice versa)", () => {
    const warnings = applyBuilderConfigInput(
      createDefaultBuilderConfig(),
      asInput({ storage: { provider: "s3", bucket: "b", maxSockets: 64 } }),
    );
    expect(warnings).toEqual([]);
  });

  it("treats a storage config without provider as legacy s3 for key checking", () => {
    const warnings = applyBuilderConfigInput(
      createDefaultBuilderConfig(),
      asInput({ storage: { bucket: "b", buckit: "typo" } }),
    );
    expect(warnings).toEqual([
      '[config] Unknown key "storage.buckit" — did you mean "bucket"?',
    ]);
  });

  it("warns on unknown keys inside user", () => {
    const config = createDefaultBuilderConfig();
    const warnings = applyBuilderConfigInput(
      config,
      asInput({ user: { storagee: null } }),
    );
    expect(warnings).toEqual([
      '[config] Unknown key "user.storagee" — did you mean "storage"?',
    ]);
    // user 为对象时照旧物化出 { storage: null }
    expect(config.user).toEqual({ storage: null });
  });
});

describe("applyBuilderConfigInput — worker section moved to system.processing.worker", () => {
  const DEPRECATION_WARNING =
    '[config] Deprecated key "system.observability.performance.worker" — did you mean "system.processing.worker"? The legacy path still works this release.';

  it("merges the canonical processing.worker path into the internal worker location", () => {
    const config = createDefaultBuilderConfig();
    const warnings = applyBuilderConfigInput(config, {
      system: {
        processing: { worker: { workerCount: 4, useClusterMode: false } },
      },
    });
    expect(warnings).toEqual([]);
    expect(config.system.observability.performance.worker).toEqual({
      workerCount: 4,
      useClusterMode: false,
      timeout: 300_000,
      workerConcurrency: 2,
    });
    // 内部只有一份 worker 配置：processing 下不残留副本
    expect("worker" in config.system.processing).toBe(false);
  });

  it("honors the legacy observability.performance.worker path with a deprecation warning", () => {
    const config = createDefaultBuilderConfig();
    const warnings = applyBuilderConfigInput(config, {
      system: {
        observability: { performance: { worker: { workerCount: 3 } } },
      },
    });
    expect(warnings).toEqual([DEPRECATION_WARNING]);
    expect(config.system.observability.performance.worker.workerCount).toBe(3);
  });

  it("lets the canonical path win when both paths set the same leaf", () => {
    const config = createDefaultBuilderConfig();
    const warnings = applyBuilderConfigInput(config, {
      system: {
        processing: { worker: { workerCount: 8 } },
        observability: {
          performance: { worker: { workerCount: 3, timeout: 5000 } },
        },
      },
    });
    expect(warnings).toEqual([DEPRECATION_WARNING]);
    const { worker } = config.system.observability.performance;
    expect(worker.workerCount).toBe(8);
    // 只在旧路径给出的叶子照常生效
    expect(worker.timeout).toBe(5000);
  });

  it("validates canonical worker leaves with the new path in the error message", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          system: { processing: { worker: { workerCount: Number.NaN } } },
        }),
      ),
    ).toThrow(
      '[config] Invalid value for "system.processing.worker.workerCount": expected a finite number, got NaN',
    );
  });

  it("throws when processing.worker is not an object", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ system: { processing: { worker: "fast" } } }),
      ),
    ).toThrow(
      '[config] Invalid value for "system.processing.worker": expected an object, got "fast"',
    );
  });

  it('suggests "worker" for typos under processing', () => {
    const warnings = applyBuilderConfigInput(
      createDefaultBuilderConfig(),
      asInput({ system: { processing: { workr: { workerCount: 4 } } } }),
    );
    expect(warnings).toEqual([
      '[config] Unknown key "system.processing.workr.workerCount" — did you mean "worker"?',
    ]);
  });

  it("warns on unknown keys inside the canonical worker section", () => {
    const warnings = applyBuilderConfigInput(
      createDefaultBuilderConfig(),
      asInput({ system: { processing: { worker: { timout: 5000 } } } }),
    );
    expect(warnings).toEqual([
      '[config] Unknown key "system.processing.worker.timout" — did you mean "timeout"?',
    ]);
  });

  it("keeps warning about non-worker keys left under the legacy performance section", () => {
    const warnings = applyBuilderConfigInput(
      createDefaultBuilderConfig(),
      asInput({
        system: {
          observability: {
            performance: { worker: { workerCount: 2 }, fps: true },
          },
        },
      }),
    );
    expect(warnings).toEqual([
      DEPRECATION_WARNING,
      '[config] Unknown key "system.observability.performance.fps"',
    ]);
  });

  it("treats processing.worker: null as unset and does not mutate the caller's input", () => {
    const config = createDefaultBuilderConfig();
    const input = asInput({
      system: {
        processing: { worker: null },
        observability: { performance: { worker: { workerCount: 5 } } },
      },
    });
    const warnings = applyBuilderConfigInput(config, input);
    expect(warnings).toEqual([DEPRECATION_WARNING]);
    // null 叶子不覆盖；旧路径的值照常生效
    expect(config.system.observability.performance.worker.workerCount).toBe(5);
    // shim 不得改写调用方的输入对象
    expect(input).toEqual({
      system: {
        processing: { worker: null },
        observability: { performance: { worker: { workerCount: 5 } } },
      },
    });
  });
});

describe("applyBuilderConfigInput — shape validation", () => {
  it("throws when a numeric tunable is not a number", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ system: { processing: { defaultConcurrency: "10" } } }),
      ),
    ).toThrow(
      '[config] Invalid value for "system.processing.defaultConcurrency": expected a finite number, got "10"',
    );
  });

  it("throws on NaN (e.g. Number(garbage env var))", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          system: {
            observability: {
              performance: { worker: { workerCount: Number.NaN } },
            },
          },
        }),
      ),
    ).toThrow(
      '[config] Invalid value for "system.observability.performance.worker.workerCount": expected a finite number, got NaN',
    );
  });

  it.each([
    ["workerCount", 0],
    ["workerConcurrency", -1],
    ["timeout", 0],
    ["workerCount", 1.5],
  ])("rejects invalid worker %s=%s", (key, value) => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          system: { processing: { worker: { [key]: value } } },
        }),
      ),
    ).toThrow(`system.processing.worker.${key}`);
  });

  it.each([
    ["maxFileLimit", 0],
    ["maxSockets", 0],
    ["maxAttempts", 0],
    ["downloadConcurrency", 0],
  ])("rejects invalid S3 %s=%s", (key, value) => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ storage: { provider: "s3", [key]: value } }),
      ),
    ).toThrow(`storage.${key}`);
  });

  it("allows the default credential chain but rejects partial explicit credentials", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ storage: { provider: "s3", bucket: "photos" } }),
      ),
    ).not.toThrow();
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          storage: {
            provider: "s3",
            bucket: "photos",
            accessKeyId: "key-only",
          },
        }),
      ),
    ).toThrow(/must either both be provided or both be omitted/);
  });

  it.each([
    ["endpoint", "https://user:secret@s3.example.com"],
    ["endpoint", "https://s3.example.com?token=secret"],
    ["customDomain", "https://cdn.example.com/#private"],
  ])("rejects unsafe public S3 %s URLs", (key, value) => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          storage: { provider: "s3", bucket: "photos", [key]: value },
        }),
      ),
    ).toThrow(`storage.${key}`);
  });

  it("requires the aggregate download memory budget to cover one allowed file", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          storage: {
            provider: "s3",
            bucket: "photos",
            maxDownloadBytes: 20,
            downloadMemoryBudgetBytes: 10,
          },
        }),
      ),
    ).toThrow(/downloadMemoryBudgetBytes/);
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          storage: {
            provider: "s3",
            bucket: "photos",
            maxDownloadBytes: 3 * 1024 * 1024 * 1024,
          },
        }),
      ),
    ).toThrow(/downloadMemoryBudgetBytes/);
  });

  it("throws when an output path is not a string", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ output: { manifestPath: 123 } }),
      ),
    ).toThrow(
      '[config] Invalid value for "output.manifestPath": expected a string, got 123',
    );
  });

  it("throws on an unrecognized storage provider", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ storage: { provider: "gcs" } }),
      ),
    ).toThrow(
      '[config] Invalid value for "storage.provider": expected "s3" or "local", got "gcs"',
    );
  });

  it("throws when a local provider is missing basePath", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ storage: { provider: "local" } }),
      ),
    ).toThrow(
      '[config] Invalid value for "storage.basePath": provider "local" requires a non-empty string basePath, got a value of type undefined',
    );
  });

  it("throws when an S3 provider is missing its bucket", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ storage: { provider: "s3" } }),
      ),
    ).toThrow(/provider "s3" requires a non-empty string bucket/);
  });

  it("throws on an invalid logging level", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({
          system: { observability: { logging: { level: "trace" } } },
        }),
      ),
    ).toThrow(
      '[config] Invalid value for "system.observability.logging.level": expected "info" | "warn" | "error" | "debug", got "trace"',
    );
  });

  it("throws when plugins is not an array", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ plugins: "geocoding" }),
      ),
    ).toThrow(
      '[config] Invalid value for "plugins": expected an array, got "geocoding"',
    );
  });

  it("throws when a section is not an object", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ system: "fast" }),
      ),
    ).toThrow(
      '[config] Invalid value for "system": expected an object, got "fast"',
    );
  });

  it("throws when supportedFormats is not a Set or string array", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ system: { processing: { supportedFormats: "jpg" } } }),
      ),
    ).toThrow(
      '[config] Invalid value for "system.processing.supportedFormats": expected a Set or array of strings, got "jpg"',
    );
  });

  it("throws on invalid types inside a storage config", () => {
    expect(() =>
      applyBuilderConfigInput(
        createDefaultBuilderConfig(),
        asInput({ storage: { provider: "s3", keepAlive: "yes" } }),
      ),
    ).toThrow(
      '[config] Invalid value for "storage.keepAlive": expected a boolean, got "yes"',
    );
  });
});

describe("redactConfigSecrets", () => {
  it("redacts every registered secret path and leaves the original untouched", () => {
    const config = createDefaultBuilderConfig();
    applyBuilderConfigInput(
      config,
      asInput({
        storage: {
          provider: "s3",
          bucket: "photos",
          accessKeyId: "AKIA_REAL",
          secretAccessKey: "s3cr3t",
          token: "tok",
        },
      }),
    );

    const sanitized = redactConfigSecrets(config);
    expect(sanitized.user?.storage).toEqual({
      provider: "s3",
      bucket: "photos",
      accessKeyId: "***",
      secretAccessKey: "***",
      token: "***",
    });
    // 原配置不能被打码污染（builder 还要用真实凭据）
    expect(config.user?.storage).toMatchObject({
      accessKeyId: "AKIA_REAL",
      secretAccessKey: "s3cr3t",
      token: "tok",
    });
  });

  it("returns the config as-is when no secret path exists", () => {
    const config = createDefaultBuilderConfig();
    expect(redactConfigSecrets(config)).toBe(config);

    applyBuilderConfigInput(
      config,
      asInput({ storage: { provider: "local", basePath: "/photos" } }),
    );
    const sanitized = redactConfigSecrets(config);
    expect(sanitized).toBe(config);
    expect(sanitized.user?.storage).toEqual({
      provider: "local",
      basePath: "/photos",
    });
  });

  it("deeply redacts provider tokens embedded in plugin descriptors", () => {
    const config = createDefaultBuilderConfig();
    config.plugins = [
      {
        plugin: "geocoding",
        options: {
          mapboxToken: "pk.secret",
          nested: {
            apiToken: "also",
            secretKey: "third",
            "api-key": "fourth",
          },
        },
      },
    ];

    const sanitized = redactConfigSecrets(config);
    expect(sanitized.plugins).toEqual([
      {
        plugin: "geocoding",
        options: {
          mapboxToken: "***",
          nested: {
            apiToken: "***",
            secretKey: "***",
            "api-key": "***",
          },
        },
      },
    ]);
    expect(config.plugins).toEqual([
      {
        plugin: "geocoding",
        options: {
          mapboxToken: "pk.secret",
          nested: {
            apiToken: "also",
            secretKey: "third",
            "api-key": "fourth",
          },
        },
      },
    ]);
  });

  it("does not expose secrets through circular plugin options", () => {
    const config = createDefaultBuilderConfig();
    const options: Record<string, unknown> = { secretKey: "do-not-log" };
    options.self = options;
    config.plugins = [{ plugin: "custom", options } as never];

    const sanitized = redactConfigSecrets(config);
    const sanitizedOptions = (
      sanitized.plugins[0] as { options: Record<string, unknown> }
    ).options;
    expect(sanitizedOptions.secretKey).toBe("***");
    expect(sanitizedOptions.self).toBe(sanitizedOptions);
    expect(options.secretKey).toBe("do-not-log");
  });

  it("redacts tokens from initialized built-in plugin references", () => {
    const config = createDefaultBuilderConfig();
    config.plugins = [
      geocodingPlugin({ enable: true, mapboxToken: "pk.production" }),
    ];

    const sanitized = redactConfigSecrets(config);
    expect(
      (
        sanitized.plugins[0] as {
          serializablePluginReference?: { options?: { mapboxToken?: string } };
        }
      ).serializablePluginReference?.options?.mapboxToken,
    ).toBe("***");
    expect(
      (
        config.plugins[0] as {
          serializablePluginReference?: { options?: { mapboxToken?: string } };
        }
      ).serializablePluginReference?.options?.mapboxToken,
    ).toBe("pk.production");
  });
});
