import type { PhotoManifestItem } from "@afilmory/schema";
import { describe, expect, it } from "vitest";

import { searchPhotos } from "./search";

const photo: PhotoManifestItem = {
  id: "shanghai",
  originalUrl: "/originals/shanghai.jpg",
  thumbnailUrl: "/thumbnails/shanghai.jpg",
  thumbHash: null,
  width: 1_200,
  height: 800,
  aspectRatio: 1.5,
  s3Key: "shanghai.jpg",
  lastModified: "2026-01-01T00:00:00.000Z",
  size: 1_024,
  exif: null,
  toneAnalysis: null,
  location: {
    latitude: 31.23,
    longitude: 121.57,
    adminI18n: {
      en: { country: "China", city: "Shanghai" },
      "zh-CN": { country: "中国", city: "上海" },
    },
    locationNameI18n: { en: "The Bund", "zh-CN": "外滩" },
  },
  title: "City walk",
  dateTaken: "2026-01-01T00:00:00.000Z",
  tags: [],
  description: "",
};

describe("localized photo search", () => {
  it.each(["上海", "中国", "外滩"])(
    "finds a gallery-index photo by %s",
    (query) => {
      expect(searchPhotos([photo], query)).toEqual([photo]);
    },
  );
});
