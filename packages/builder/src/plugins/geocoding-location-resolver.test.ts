import { afterEach, describe, expect, it, vi } from "vitest";

import type { PhotoManifestItem, PickedExif } from "../types/photo.js";
import { createGeocodingCacheState } from "./geocoding-cache.js";
import { resolveLocationForItem } from "./geocoding-location-resolver.js";
import type { ResolvedGeocodingSettings } from "./geocoding-options.js";

const logger = {
  warn: vi.fn(),
  info: vi.fn(),
} as const;

function createPhoto(): PhotoManifestItem {
  return {
    id: "photo",
    title: "photo",
    description: "",
    dateTaken: "2026-06-06T00:00:00.000Z",
    tags: [],
    originalUrl: "https://example.com/photo.jpg",
    thumbnailUrl: "/thumbnails/photo.jpg",
    thumbHash: null,
    width: 100,
    height: 100,
    aspectRatio: 1,
    s3Key: "photo.jpg",
    lastModified: "2026-06-06T00:00:00.000Z",
    size: 100,
    exif: null,
    toneAnalysis: null,
    location: null,
  };
}

const gpsExif: PickedExif = {
  GPSLatitude: 41.4031,
  GPSLongitude: 2.174,
};

const settings: ResolvedGeocodingSettings = {
  cachePrecision: 4,
  negativeCacheTtlMs: 60_000,
  requestTimeoutMs: 10_000,
  locales: ["en", "zh-CN"],
  provider: "nominatim",
};

describe("geocoding location resolver", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("resolves missing localized locations through providers and cache", async () => {
    const item = createPhoto();
    const state = createGeocodingCacheState();
    const calls: string[] = [];

    const result = await resolveLocationForItem({
      item,
      exif: gpsExif,
      state,
      settings,
      shouldOverwriteExisting: false,
      logger,
      getProvider: (locale) => ({
        reverseGeocode: vi.fn(async (latitude, longitude) => {
          calls.push(locale);
          return {
            latitude,
            longitude,
            admin: {
              country: locale === "en" ? "Spain" : "西班牙",
              countryCode: "ES",
              city: locale === "en" ? "Barcelona" : "巴塞罗那",
            },
            country: locale === "en" ? "Spain" : "西班牙",
            city: locale === "en" ? "Barcelona" : "巴塞罗那",
            locationName:
              locale === "en" ? "Barcelona, Spain" : "巴塞罗那, 西班牙",
          };
        }),
      }),
    });

    expect(result).toMatchObject({ attempted: true, updated: true });
    expect(result.cacheDelta?.key).toBe("nominatim||4|41.4031|2.1740");
    expect(calls).toEqual(["en", "zh-CN"]);
    expect(item.location).toMatchObject({
      adminKey: {
        city: "Barcelona",
        country: "Spain",
        countryCode: "ES",
      },
      adminI18n: {
        en: {
          city: "Barcelona",
          country: "Spain",
        },
        "zh-CN": {
          city: "巴塞罗那",
          country: "西班牙",
        },
      },
      locationNameI18n: {
        en: "Barcelona, Spain",
        "zh-CN": "巴塞罗那, 西班牙",
      },
    });
    expect(state.cache.size).toBe(1);
  });

  it("does not cache transient provider failures as not-found", async () => {
    const item = createPhoto();
    const state = createGeocodingCacheState();
    const provider = {
      reverseGeocode: vi.fn(async () => {
        throw new Error("temporary network failure");
      }),
    };

    const result = await resolveLocationForItem({
      item,
      exif: gpsExif,
      state,
      settings: { ...settings, locales: ["en"] },
      shouldOverwriteExisting: false,
      logger,
      getProvider: () => provider,
    });

    expect(result).toMatchObject({ attempted: true, updated: false });
    expect([...state.cache.values()][0]?.locales).toEqual({});
    expect(state.cacheDirty).toBe(false);
  });

  it("expires confirmed not-found entries and retries them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const item = createPhoto();
    const state = createGeocodingCacheState();
    const provider = { reverseGeocode: vi.fn(async () => null) };
    const negativeSettings = {
      ...settings,
      locales: ["en"],
      negativeCacheTtlMs: 100,
    };
    const input = {
      item,
      exif: gpsExif,
      state,
      settings: negativeSettings,
      shouldOverwriteExisting: false,
      logger,
      getProvider: () => provider,
    };

    await resolveLocationForItem(input);
    await resolveLocationForItem(input);
    expect(provider.reverseGeocode).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:00:00.101Z"));
    await resolveLocationForItem(input);
    expect(provider.reverseGeocode).toHaveBeenCalledTimes(2);
  });
});
