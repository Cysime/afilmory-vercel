import { describe, expect, it } from "vitest";

import type { BuilderConfigInput } from "../types/config.js";
import { defineBuilderConfig } from "./helper.js";

const sampleConfig: BuilderConfigInput = {
  output: { manifestPath: "generated/photos-manifest.json" },
};

describe("defineBuilderConfig", () => {
  it("returns a plain config object as-is", () => {
    expect(defineBuilderConfig(sampleConfig)).toBe(sampleConfig);
  });

  it("invokes a factory function and returns its result", () => {
    expect(defineBuilderConfig(() => sampleConfig)).toBe(sampleConfig);
  });

  it("calls the factory exactly once", () => {
    let calls = 0;
    const factory = () => {
      calls += 1;
      return sampleConfig;
    };
    defineBuilderConfig(factory);
    expect(calls).toBe(1);
  });

  it("accepts the canonical system.processing.worker path (compile-time check)", () => {
    // 编译期断言：builder.config.ts 迁移到新路径后必须能通过类型检查
    const config = defineBuilderConfig({
      system: {
        processing: {
          defaultConcurrency: 10,
          worker: { workerCount: 4, useClusterMode: false },
        },
      },
    });
    expect(config.system?.processing?.worker?.workerCount).toBe(4);
  });
});
