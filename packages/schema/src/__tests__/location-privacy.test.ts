import { describe, expect, it } from "vitest";

import type { PhotoManifestItem } from "../index";
import { applyManifestLocationPrivacy, createManifest } from "../index";

const createLegacyPhoto = (): PhotoManifestItem => ({
  id: "legacy-photo",
  originalUrl: "/originals/legacy-photo.jpg",
  thumbnailUrl: "/thumbnails/legacy-photo.jpg",
  thumbHash: null,
  width: 4_000,
  height: 3_000,
  aspectRatio: 4 / 3,
  s3Key: "legacy-photo.jpg",
  lastModified: "2026-01-01T00:00:00.000Z",
  size: 1_024,
  exif: {
    Make: "Camera",
    GPSAltitude: 12,
    GPSCoordinates: "31.234567, -121.567891",
    GPSLatitude: 31.234567,
    GPSLatitudeRef: "N",
    GPSLongitude: 121.567891,
    GPSLongitudeRef: "W",
  },
  toneAnalysis: null,
  location: {
    latitude: 31.234567,
    longitude: -121.567891,
    city: "Private place",
  },
  title: "Legacy photo",
  dateTaken: "2026-01-01T00:00:00.000Z",
  tags: [],
  description: "",
});

describe("manifest publication location privacy", () => {
  it("coarsens legacy manifests without mutating the disk snapshot", () => {
    const photo = createLegacyPhoto();
    const manifest = createManifest({ photos: [photo] });

    const publication = applyManifestLocationPrivacy(manifest, "coarse");

    expect(publication.photos[0]).toMatchObject({
      exif: {
        GPSLatitude: 31.23,
        GPSLatitudeRef: "N",
        GPSLongitude: 121.57,
        GPSLongitudeRef: "W",
      },
      location: { latitude: 31.23, longitude: -121.57 },
      processing: { privacy: "location-privacy:v1:coarse" },
    });
    expect(publication.photos[0]?.exif).not.toHaveProperty("GPSAltitude");
    expect(publication.photos[0]?.exif).not.toHaveProperty("GPSCoordinates");
    expect(photo.exif?.GPSLatitude).toBe(31.234567);
    expect(photo.processing).toBeUndefined();
  });

  it("strips coordinates from both EXIF and resolved locations", () => {
    const publication = applyManifestLocationPrivacy(
      createManifest({ photos: [createLegacyPhoto()] }),
      "strip",
    );

    expect(publication.photos[0]?.location).toBeNull();
    expect(publication.photos[0]?.exif).toEqual({ Make: "Camera" });
    expect(publication.photos[0]?.processing?.privacy).toBe(
      "location-privacy:v1:strip",
    );
  });

  it("keeps precise coordinates only after an explicit exact opt-in", () => {
    const publication = applyManifestLocationPrivacy(
      createManifest({ photos: [createLegacyPhoto()] }),
      "exact",
    );

    expect(publication.photos[0]?.location?.longitude).toBe(-121.567891);
    expect(publication.photos[0]?.exif?.GPSCoordinates).toBe(
      "31.234567, -121.567891",
    );
    expect(publication.photos[0]?.processing?.privacy).toBe(
      "location-privacy:v1:exact",
    );
  });
});
