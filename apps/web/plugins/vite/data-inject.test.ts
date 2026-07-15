import { afterEach, describe, expect, it, vi } from "vitest";

import { dataInjectPlugin } from "./data-inject";

describe("data inject Vite lifecycle", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("leaves external delivery assets to the dev middleware during serve", async () => {
    vi.stubEnv("AFILMORY_EMBED_MANIFEST", "false");
    const plugin = dataInjectPlugin();
    if (
      typeof plugin.configResolved !== "function" ||
      typeof plugin.buildStart !== "function"
    ) {
      throw new TypeError("dataInjectPlugin must expose callable Vite hooks");
    }

    Reflect.apply(plugin.configResolved, undefined, [{ command: "serve" }]);
    const context = { emitFile: vi.fn(), info: vi.fn() };
    await Reflect.apply(plugin.buildStart, context, []);

    expect(context.emitFile).not.toHaveBeenCalled();
    expect(context.info).not.toHaveBeenCalled();
  });
});
