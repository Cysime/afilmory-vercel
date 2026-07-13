import { createManifest } from "@afilmory/schema";
import { describe, expect, it } from "vitest";

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
});
