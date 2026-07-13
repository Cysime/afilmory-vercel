import fs from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGeocodingCacheState,
  ensurePersistentCacheLoaded,
  mergeGeocodingCacheDelta,
} from "./geocoding-cache.js";

const logger = { info: vi.fn(), warn: vi.fn() };

describe("geocoding persistent cache", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares one load promise across concurrent callers", async () => {
    let finishRead!: (value: string) => void;
    const read = vi.spyOn(fs, "readFile").mockImplementation(
      async () =>
        await new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    const state = createGeocodingCacheState();

    const first = ensurePersistentCacheLoaded(
      state,
      "/tmp/afilmory-geocoding-cache.json",
      logger,
    );
    const second = ensurePersistentCacheLoaded(
      state,
      "/tmp/afilmory-geocoding-cache.json",
      logger,
    );
    expect(read).toHaveBeenCalledTimes(1);

    finishRead(
      JSON.stringify({
        version: 2,
        updatedAt: "2026-01-01T00:00:00.000Z",
        entries: {},
      }),
    );
    await Promise.all([first, second]);
    expect(state.loadPromise).toBeNull();
  });

  it("merges independent cluster-worker deltas without losing locales", () => {
    const state = createGeocodingCacheState();
    mergeGeocodingCacheDelta(state, {
      key: "point",
      entry: {
        locales: { en: null },
        notFoundExpiresAt: { en: "2026-01-02T00:00:00.000Z" },
      },
    });
    mergeGeocodingCacheDelta(state, {
      key: "point",
      entry: {
        locales: {
          "zh-CN": {
            latitude: 1,
            longitude: 2,
            country: "中国",
          },
        },
      },
    });

    mergeGeocodingCacheDelta(state, {
      key: "point",
      entry: { locales: {} },
      deletedLocales: ["en"],
    });

    expect(state.cache.get("point")).toMatchObject({
      locales: { "zh-CN": { country: "中国" } },
    });
    expect(state.cache.get("point")?.notFoundExpiresAt).toBeUndefined();
    expect(state.cacheDirty).toBe(true);
  });
});
