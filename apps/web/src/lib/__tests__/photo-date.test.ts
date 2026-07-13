import type { PhotoManifestItem } from "@afilmory/schema";
import { describe, expect, it } from "vitest";

import { getPhotoDate, getPhotoSortTime } from "../photo-date";

function createPhoto(
  overrides: Partial<PhotoManifestItem> = {},
): PhotoManifestItem {
  return {
    id: "test-1",
    title: "Test Photo",
    dateTaken: "",
    tags: [],
    description: "",
    originalUrl: "/photos/test.jpg",
    thumbnailUrl: "/thumbs/test.jpg",
    thumbHash: null,
    width: 4000,
    height: 3000,
    aspectRatio: 4 / 3,
    s3Key: "test.jpg",
    lastModified: "2024-06-01T12:00:00Z",
    size: 1024,
    exif: null,
    toneAnalysis: null,
    location: null,
    ...overrides,
  };
}

describe("getPhotoDate", () => {
  it("prefers the builder's canonical dateTaken field", () => {
    const photo = createPhoto({
      dateTaken: "2023-12-24T18:30:00Z",
      lastModified: "2024-06-01T12:00:00Z",
    });

    expect(getPhotoDate(photo).toISOString()).toBe("2023-12-24T18:30:00.000Z");
  });

  it("should return correct Date from EXIF DateTimeOriginal", () => {
    const photo = createPhoto({
      exif: {
        DateTimeOriginal: "2024:03:15 14:30:00",
        MeteringMode: undefined,
        WhiteBalance: undefined,
        WBShiftAB: undefined,
        WBShiftGM: undefined,
        WhiteBalanceBias: undefined,
        FlashMeteringMode: undefined,
        SensingMethod: undefined,
        FocalPlaneXResolution: undefined,
        FocalPlaneYResolution: undefined,
        GPSAltitude: undefined,
        GPSLatitude: undefined,
        GPSLongitude: undefined,
        GPSAltitudeRef: undefined,
        GPSLatitudeRef: undefined,
        GPSLongitudeRef: undefined,
      },
    });

    const date = getPhotoDate(photo);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(2); // March is 0-indexed
    expect(date.getDate()).toBe(15);
  });

  it("should handle ISO format DateTimeOriginal", () => {
    const photo = createPhoto({
      exif: {
        DateTimeOriginal: "2024-03-15T14:30:00Z",
        MeteringMode: undefined,
        WhiteBalance: undefined,
        WBShiftAB: undefined,
        WBShiftGM: undefined,
        WhiteBalanceBias: undefined,
        FlashMeteringMode: undefined,
        SensingMethod: undefined,
        FocalPlaneXResolution: undefined,
        FocalPlaneYResolution: undefined,
        GPSAltitude: undefined,
        GPSLatitude: undefined,
        GPSLongitude: undefined,
        GPSAltitudeRef: undefined,
        GPSLatitudeRef: undefined,
        GPSLongitudeRef: undefined,
      },
    });

    const date = getPhotoDate(photo);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(15);
  });

  it("should fall back to lastModified when exif is null", () => {
    const photo = createPhoto({
      exif: null,
      lastModified: "2024-06-01T12:00:00Z",
    });

    const date = getPhotoDate(photo);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(5); // June
    expect(date.getDate()).toBe(1);
  });

  it("should fall back to lastModified when DateTimeOriginal is missing", () => {
    const photo = createPhoto({
      exif: {
        MeteringMode: undefined,
        WhiteBalance: undefined,
        WBShiftAB: undefined,
        WBShiftGM: undefined,
        WhiteBalanceBias: undefined,
        FlashMeteringMode: undefined,
        SensingMethod: undefined,
        FocalPlaneXResolution: undefined,
        FocalPlaneYResolution: undefined,
        GPSAltitude: undefined,
        GPSLatitude: undefined,
        GPSLongitude: undefined,
        GPSAltitudeRef: undefined,
        GPSLatitudeRef: undefined,
        GPSLongitudeRef: undefined,
      },
      lastModified: "2024-06-01T12:00:00Z",
    });

    const date = getPhotoDate(photo);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(5);
  });

  it("should fall back to lastModified for invalid EXIF dates", () => {
    const photo = createPhoto({
      exif: {
        DateTimeOriginal: "not-a-valid-date",
        MeteringMode: undefined,
        WhiteBalance: undefined,
        WBShiftAB: undefined,
        WBShiftGM: undefined,
        WhiteBalanceBias: undefined,
        FlashMeteringMode: undefined,
        SensingMethod: undefined,
        FocalPlaneXResolution: undefined,
        FocalPlaneYResolution: undefined,
        GPSAltitude: undefined,
        GPSLatitude: undefined,
        GPSLongitude: undefined,
        GPSAltitudeRef: undefined,
        GPSLatitudeRef: undefined,
        GPSLongitudeRef: undefined,
      },
      lastModified: "2024-06-01T12:00:00Z",
    });

    const date = getPhotoDate(photo);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(5); // Falls back to lastModified
  });
});

describe("getPhotoSortTime", () => {
  const exifWithDate = (DateTimeOriginal: string) => ({
    DateTimeOriginal,
    MeteringMode: undefined,
    WhiteBalance: undefined,
    WBShiftAB: undefined,
    WBShiftGM: undefined,
    WhiteBalanceBias: undefined,
    FlashMeteringMode: undefined,
    SensingMethod: undefined,
    FocalPlaneXResolution: undefined,
    FocalPlaneYResolution: undefined,
    GPSAltitude: undefined,
    GPSLatitude: undefined,
    GPSLongitude: undefined,
    GPSAltitudeRef: undefined,
    GPSLatitudeRef: undefined,
    GPSLongitudeRef: undefined,
  });

  it("should match getPhotoDate's timestamp", () => {
    const photo = createPhoto({
      exif: exifWithDate("2024:03:15 14:30:00"),
    });

    expect(getPhotoSortTime(photo)).toBe(getPhotoDate(photo).getTime());
  });

  it("should order raw-EXIF dates against ISO dates chronologically", () => {
    // 字符串比较在 ':'(58) vs '-'(45) 处判定 EXIF 串更大，三月会排到六月之后；
    // 时间戳比较必须给出三月 < 六月。
    const exifMarch = createPhoto({
      id: "exif-march",
      exif: exifWithDate("2024:03:15 14:30:00"),
      lastModified: "2024-01-01T00:00:00Z",
    });
    const isoJune = createPhoto({
      id: "iso-june",
      exif: null,
      lastModified: "2024-06-01T12:00:00Z",
    });

    expect(getPhotoSortTime(exifMarch)).toBeLessThan(getPhotoSortTime(isoJune));
  });

  it("should collapse unparsable dates to 0", () => {
    const photo = createPhoto({
      exif: null,
      lastModified: "not-a-date",
    });

    expect(getPhotoSortTime(photo)).toBe(0);
  });

  it("should memoize by manifest item identity", () => {
    const photo = createPhoto({
      exif: null,
      lastModified: "2024-06-01T12:00:00Z",
    });

    const first = getPhotoSortTime(photo);
    photo.lastModified = "2025-01-01T00:00:00Z";

    expect(getPhotoSortTime(photo)).toBe(first);
  });
});
