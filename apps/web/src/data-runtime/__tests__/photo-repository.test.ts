import { createManifest } from "@afilmory/schema";
import { describe, expect, it, vi } from "vitest";

import {
  parseWebDeliveryManifest,
  WEB_DELIVERY_MANIFEST_SCHEMA,
  WEB_DELIVERY_MANIFEST_VERSION,
} from "../delivery-manifest";
import { PhotoRepository } from "../photo-repository";

function createPhoto() {
  return {
    id: "photo",
    originalUrl: "/originals/photo.jpg?download=1",
    thumbnailUrl: "/thumbnails/photo.jpg",
    thumbHash: null,
    width: 4000,
    height: 3000,
    aspectRatio: 4 / 3,
    s3Key: "photo.jpg",
    lastModified: "2026-07-13T00:00:00.000Z",
    size: 123,
    etag: "image-etag",
    exif: null,
    toneAnalysis: null,
    location: null,
    title: "Photo",
    dateTaken: "2026-07-13T00:00:00.000Z",
    tags: [],
    description: "",
    video: {
      type: "live-photo" as const,
      videoUrl: "/originals/photo.mov",
      s3Key: "photo.mov",
      version: "etag:video-etag",
    },
  };
}

const createDetailShard = (photos: Record<string, unknown>) => ({
  schema: WEB_DELIVERY_MANIFEST_SCHEMA,
  version: WEB_DELIVERY_MANIFEST_VERSION,
  kind: "photo-details",
  photos,
});

const createValidDetail = (artist = "Hydrated") => ({
  exif: { Make: "Camera", Artist: artist },
  toneAnalysis: {
    toneType: "normal",
    brightness: 50,
    contrast: 20,
    shadowRatio: 0.1,
    highlightRatio: 0.2,
  },
  location: null,
});

const createMapShard = (photos: Record<string, unknown>) => ({
  schema: WEB_DELIVERY_MANIFEST_SCHEMA,
  version: WEB_DELIVERY_MANIFEST_VERSION,
  kind: "map-details",
  photos,
});

const createValidMapDetail = (city: string) => ({
  location: { latitude: 1, longitude: 2, city },
  exif: { GPSLatitude: 1, GPSLongitude: 2 },
});

describe("PhotoRepository media URLs", () => {
  it("content-versions originals and Live Photo sidecars without mutating input", () => {
    const photo = createPhoto();
    const manifest = createManifest({ photos: [photo] });
    const repository = new PhotoRepository(manifest);

    expect(repository.getPhoto("photo")).toMatchObject({
      originalUrl: "/originals/photo.jpg?download=1&v=image-etag",
      video: {
        videoUrl: "/originals/photo.mov?v=etag%3Avideo-etag",
      },
    });
    expect(manifest.photos[0]?.originalUrl).toBe(
      "/originals/photo.jpg?download=1",
    );
    expect(manifest.photos[0]?.video?.videoUrl).toBe("/originals/photo.mov");
  });

  it("uses the manifest generation as the legacy sidecar cache version", () => {
    const photo = createPhoto();
    delete photo.video.version;
    const manifest = createManifest({
      generatedAt: "2026-07-15T01:02:03.000Z",
      photos: [photo],
    });

    const repository = new PhotoRepository(manifest);

    expect(repository.getPhoto("photo")?.video).toMatchObject({
      videoUrl:
        "/originals/photo.mov?v=2026-07-15T01%3A02%3A03.000Z%3Aphoto.mov%3Avideo",
    });
    expect(photo.video.videoUrl).toBe("/originals/photo.mov");
  });

  it("deduplicates detail shard requests and publishes hydrated records", async () => {
    const photo = {
      ...createPhoto(),
      exif: { Make: "Camera" },
      toneAnalysis: null,
    };
    const manifest = createManifest({ photos: [photo] });
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "photo-details",
        photos: {
          photo: {
            exif: { Make: "Camera", Artist: "Hydrated" },
            toneAnalysis: {
              toneType: "normal",
              brightness: 50,
              contrast: 20,
              shadowRatio: 0.1,
              highlightRatio: 0.2,
            },
            location: null,
          },
        },
      }),
    );
    const repository = new PhotoRepository(manifest, {
      fetcher,
      delivery: {
        detailShards: [
          { url: "/assets/photo-details.0.deadbeef.json", photoIds: ["photo"] },
        ],
      },
    });
    const listener = vi.fn();
    repository.subscribe(listener);

    await Promise.all([
      repository.ensurePhotoDetails("photo"),
      repository.ensurePhotoDetails("photo"),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(repository.getPhoto("photo")?.exif?.Artist).toBe("Hydrated");
    expect(repository.getPhoto("photo")?.toneAnalysis?.brightness).toBe(50);
    expect(repository.getVersion()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(repository.hasDeferredPhotoDetails("photo")).toBe(false);
  });

  it("hydrates map-only location data independently", async () => {
    const photo = { ...createPhoto(), location: null, exif: null };
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "map-details",
        photos: {
          photo: {
            location: { latitude: 1, longitude: 2, city: "Somewhere" },
            exif: { GPSLatitude: 1, GPSLongitude: 2 },
          },
        },
      }),
    );
    const repository = new PhotoRepository(
      createManifest({ photos: [photo] }),
      {
        fetcher,
        delivery: {
          detailShards: [],
          mapUrl: "/assets/map-details.deadbeef.json",
        },
      },
    );

    await repository.ensureMapDetails();

    expect(repository.getPhoto("photo")?.location?.city).toBe("Somewhere");
    expect(repository.getPhoto("photo")?.exif?.GPSLongitude).toBe(2);
    expect(repository.hasDeferredMapDetails()).toBe(false);
  });

  it("keeps summary data intact and retries after a malformed detail record", async () => {
    const photo = {
      ...createPhoto(),
      exif: { Make: "Summary" },
      toneAnalysis: null,
      video: undefined,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(createDetailShard({ photo: {} })))
      .mockResolvedValueOnce(
        Response.json(
          createDetailShard({ photo: createValidDetail("Recovered") }),
        ),
      );
    const repository = new PhotoRepository(
      createManifest({ photos: [photo] }),
      {
        fetcher,
        delivery: {
          detailShards: [
            {
              url: "/assets/photo-details.retry.json",
              photoIds: ["photo"],
            },
          ],
        },
      },
    );
    const listener = vi.fn();
    repository.subscribe(listener);

    await expect(repository.ensurePhotoDetails("photo")).rejects.toThrow(
      "missing required fields",
    );
    expect(repository.getPhoto("photo")?.exif).toEqual({ Make: "Summary" });
    expect(repository.getVersion()).toBe(0);
    expect(repository.hasDeferredPhotoDetails("photo")).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    await repository.ensurePhotoDetails("photo");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(repository.getPhoto("photo")?.exif?.Artist).toBe("Recovered");
    expect(repository.hasDeferredPhotoDetails("photo")).toBe(false);
    expect(repository.getVersion()).toBe(1);
  });

  it("rejects missing and extra detail IDs atomically and remains retryable", async () => {
    const photo = {
      ...createPhoto(),
      exif: { Make: "Summary" },
      video: undefined,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(createDetailShard({})))
      .mockResolvedValueOnce(
        Response.json(
          createDetailShard({
            photo: createValidDetail("Should not apply"),
            extra: createValidDetail("Extra"),
          }),
        ),
      )
      .mockResolvedValueOnce(
        Response.json(createDetailShard({ photo: createValidDetail("Final") })),
      );
    const repository = new PhotoRepository(
      createManifest({ photos: [photo] }),
      {
        fetcher,
        delivery: {
          detailShards: [
            {
              url: "/assets/photo-details.exact.json",
              photoIds: ["photo"],
            },
          ],
        },
      },
    );

    await expect(repository.ensurePhotoDetails("photo")).rejects.toThrow(
      "is missing photo",
    );
    expect(repository.getPhoto("photo")?.exif).toEqual({ Make: "Summary" });

    await expect(repository.ensurePhotoDetails("photo")).rejects.toThrow(
      "contains unexpected extra",
    );
    expect(repository.getPhoto("photo")?.exif).toEqual({ Make: "Summary" });
    expect(repository.getVersion()).toBe(0);
    expect(repository.hasDeferredPhotoDetails("photo")).toBe(true);

    await repository.ensurePhotoDetails("photo");
    expect(repository.getPhoto("photo")?.exif?.Artist).toBe("Final");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects unknown map IDs before mutating and retries a valid shard", async () => {
    const photo = {
      ...createPhoto(),
      exif: { Make: "Summary" },
      location: { latitude: 10, longitude: 20, city: "Summary" },
      video: undefined,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          createMapShard({
            photo: createValidMapDetail("Should not apply"),
            foreign: createValidMapDetail("Foreign"),
          }),
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          createMapShard({ photo: createValidMapDetail("Recovered") }),
        ),
      );
    const repository = new PhotoRepository(
      createManifest({ photos: [photo] }),
      {
        fetcher,
        delivery: {
          detailShards: [],
          mapUrl: "/assets/map-details.retry.json",
        },
      },
    );

    await expect(repository.ensureMapDetails()).rejects.toThrow(
      "references unknown photo foreign",
    );
    expect(repository.getPhoto("photo")?.location?.city).toBe("Summary");
    expect(repository.getPhoto("photo")?.exif).toEqual({ Make: "Summary" });
    expect(repository.getVersion()).toBe(0);
    expect(repository.hasDeferredMapDetails()).toBe(true);

    await repository.ensureMapDetails();
    expect(repository.getPhoto("photo")?.location?.city).toBe("Recovered");
    expect(repository.getPhoto("photo")?.exif).toEqual({
      Make: "Summary",
      GPSLatitude: 1,
      GPSLongitude: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(repository.hasDeferredMapDetails()).toBe(false);
  });

  it("hydrates valid photos when a leniently skipped peer remains in the same assets", async () => {
    const goodPhoto = {
      ...createPhoto(),
      id: "good",
      s3Key: "good.jpg",
      originalUrl: "/originals/good.jpg",
      thumbnailUrl: "/thumbnails/good.jpg",
      exif: { Make: "Summary" },
      video: undefined,
    };
    const badPhoto = {
      ...goodPhoto,
      id: "bad",
      s3Key: "bad.jpg",
      originalUrl: "",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const parsed = parseWebDeliveryManifest({
        schema: WEB_DELIVERY_MANIFEST_SCHEMA,
        version: WEB_DELIVERY_MANIFEST_VERSION,
        kind: "gallery-index",
        manifest: createManifest({ photos: [goodPhoto, badPhoto] }),
        delivery: {
          detailShards: [
            {
              url: "/assets/details.shared.json",
              photoIds: ["good", "bad"],
            },
          ],
          mapUrl: "/assets/map.shared.json",
        },
      });
      expect(parsed).not.toBeNull();

      const fetcher = vi.fn<typeof fetch>(async (input) =>
        Response.json(
          String(input).includes("map.shared")
            ? createMapShard({
                good: createValidMapDetail("Mapped"),
                bad: createValidMapDetail("Ignored"),
              })
            : createDetailShard({
                good: createValidDetail("Hydrated"),
                bad: createValidDetail("Ignored"),
              }),
        ),
      );
      const repository = new PhotoRepository(parsed!.manifest, {
        fetcher,
        delivery: parsed!.delivery,
      });

      await repository.ensurePhotoDetails("good");
      await repository.ensureMapDetails();

      expect(repository.getPhoto("good")?.exif?.Artist).toBe("Hydrated");
      expect(repository.getPhoto("good")?.location?.city).toBe("Mapped");
      expect(repository.getPhoto("bad")).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(repository.hasDeferredPhotoDetails("good")).toBe(false);
      expect(repository.hasDeferredMapDetails()).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
