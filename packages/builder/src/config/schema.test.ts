import { describe, expect, it } from "vitest";

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
});
