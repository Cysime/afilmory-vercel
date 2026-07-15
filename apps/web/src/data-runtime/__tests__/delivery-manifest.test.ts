import type { PhotoManifestItem } from "@afilmory/schema";
import { createManifest } from "@afilmory/schema";
import { describe, expect, it, vi } from "vitest";

import {
  parseWebDeliveryManifest,
  parseWebMapDetailShard,
  parseWebPhotoDetailShard,
  WEB_DELIVERY_MANIFEST_SCHEMA,
  WEB_DELIVERY_MANIFEST_VERSION,
} from "../delivery-manifest";

const manifest = createManifest();

const createPhoto = (id: string): PhotoManifestItem => ({
  id,
  originalUrl: `/originals/${id}.jpg`,
  thumbnailUrl: `/thumbnails/${id}.jpg`,
  thumbHash: null,
  width: 4000,
  height: 3000,
  aspectRatio: 4 / 3,
  s3Key: `${id}.jpg`,
  lastModified: "2026-07-13T00:00:00.000Z",
  size: 123,
  exif: { Make: "Camera" },
  toneAnalysis: null,
  location: null,
  title: id,
  dateTaken: "2026-07-13T00:00:00.000Z",
  tags: [],
  description: "",
});

const createDeliveryIndex = (
  photos: unknown[],
  detailShards: Array<{ url: string; photoIds: string[] }>,
) => ({
  schema: WEB_DELIVERY_MANIFEST_SCHEMA,
  version: WEB_DELIVERY_MANIFEST_VERSION,
  kind: "gallery-index",
  manifest: { ...createManifest(), photos },
  delivery: { detailShards },
});

describe("web delivery manifest parsing", () => {
  it("does not claim legacy manifest inputs", () => {
    expect(parseWebDeliveryManifest(manifest)).toBeNull();
  });

  it("rejects unsafe or duplicated shard references", () => {
    expect(() =>
      parseWebDeliveryManifest({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "gallery-index",
        manifest,
        delivery: {
          detailShards: [{ url: "https://evil.example/x", photoIds: [] }],
        },
      }),
    ).toThrow("Invalid web delivery detail shard");

    const photo = createPhoto("photo");
    expect(() =>
      parseWebDeliveryManifest(
        createDeliveryIndex(
          [photo],
          [
            { url: "/assets/one.json", photoIds: ["photo"] },
            { url: "/assets/two.json", photoIds: ["photo"] },
          ],
        ),
      ),
    ).toThrow("assigned to multiple detail shards");

    expect(() =>
      parseWebDeliveryManifest(
        createDeliveryIndex(
          [photo],
          [
            { url: "/assets/shared.json", photoIds: ["photo"] },
            { url: "/assets/shared.json", photoIds: [] },
          ],
        ),
      ),
    ).toThrow("detail shard /assets/shared.json is duplicated");
  });

  it("requires every valid gallery photo to have exactly one detail shard", () => {
    const photo = createPhoto("photo");
    expect(() =>
      parseWebDeliveryManifest(createDeliveryIndex([photo], [])),
    ).toThrow("Photo photo is not assigned to a detail shard");

    expect(() =>
      parseWebDeliveryManifest(
        createDeliveryIndex(
          [photo],
          [{ url: "/assets/details.json", photoIds: ["unknown"] }],
        ),
      ),
    ).toThrow("references unknown photo unknown");
  });

  it("drops the shard reference of a photo skipped by lenient parsing", () => {
    const goodPhoto = createPhoto("good");
    const badPhoto = { ...createPhoto("bad"), originalUrl: "" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const parsed = parseWebDeliveryManifest(
        createDeliveryIndex(
          [goodPhoto, badPhoto],
          [
            {
              url: "/assets/details.json",
              photoIds: ["good", "bad"],
            },
          ],
        ),
      );

      expect(parsed?.manifest.photos.map((photo) => photo.id)).toEqual([
        "good",
      ]);
      expect(parsed?.delivery.detailShards).toEqual([
        {
          url: "/assets/details.json",
          photoIds: ["good"],
          ignoredPhotoIds: ["bad"],
        },
      ]);
      expect(parsed?.delivery.ignoredPhotoIds).toEqual(["bad"]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not mistake a genuinely foreign shard id for a skipped photo", () => {
    const goodPhoto = createPhoto("good");
    const badPhoto = { ...createPhoto("bad"), originalUrl: "" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(() =>
        parseWebDeliveryManifest(
          createDeliveryIndex(
            [goodPhoto, badPhoto],
            [
              {
                url: "/assets/details.json",
                photoIds: ["good", "bad", "foreign"],
              },
            ],
          ),
        ),
      ).toThrow("references unknown photo foreign");
    } finally {
      warn.mockRestore();
    }
  });

  it("still rejects duplicate assignments for a leniently skipped photo", () => {
    const goodPhoto = createPhoto("good");
    const badPhoto = { ...createPhoto("bad"), originalUrl: "" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(() =>
        parseWebDeliveryManifest(
          createDeliveryIndex(
            [goodPhoto, badPhoto],
            [
              {
                url: "/assets/one.json",
                photoIds: ["good", "bad"],
              },
              { url: "/assets/two.json", photoIds: ["bad"] },
            ],
          ),
        ),
      ).toThrow("Photo bad is assigned to multiple detail shards");
    } finally {
      warn.mockRestore();
    }
  });

  it("validates detail and map shard envelopes and nested records", () => {
    expect(
      parseWebPhotoDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "photo-details",
        photos: {
          a: { exif: { Make: "Camera" }, toneAnalysis: null, location: null },
        },
      }),
    ).toMatchObject({ a: { exif: { Make: "Camera" } } });

    expect(
      parseWebMapDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "map-details",
        photos: { a: { location: null, exif: { GPSLatitude: 1 } } },
      }),
    ).toMatchObject({ a: { exif: { GPSLatitude: 1 } } });

    expect(() =>
      parseWebPhotoDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "photo-details",
        photos: { a: {} },
      }),
    ).toThrow("missing required fields");

    expect(() =>
      parseWebPhotoDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "photo-details",
        photos: {
          a: {
            exif: null,
            toneAnalysis: {
              toneType: "normal",
              brightness: 101,
              contrast: 20,
              shadowRatio: 0.1,
              highlightRatio: 0.2,
            },
            location: null,
          },
        },
      }),
    ).toThrow("toneAnalysis is invalid");

    expect(() =>
      parseWebPhotoDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "photo-details",
        photos: {
          a: {
            exif: null,
            toneAnalysis: null,
            location: {
              latitude: 1,
              longitude: 2,
              adminI18n: { zh: { city: 3 } },
            },
          },
        },
      }),
    ).toThrow("location.adminI18n is invalid");

    expect(() =>
      parseWebMapDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "map-details",
        photos: { a: {} },
      }),
    ).toThrow("missing required fields");

    expect(() =>
      parseWebMapDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "map-details",
        photos: {
          a: {
            location: { latitude: 91, longitude: 2 },
            exif: { GPSLatitude: 91 },
          },
        },
      }),
    ).toThrow("location is invalid");

    expect(() =>
      parseWebMapDetailShard({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "map-details",
        photos: {
          a: { location: null, exif: { Artist: "not-map-exif" } },
        },
      }),
    ).toThrow("exif.Artist is invalid");
  });
});
