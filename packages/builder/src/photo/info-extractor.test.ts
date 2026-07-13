import { describe, expect, it, vi } from "vitest";

import { extractPhotoInfo } from "./info-extractor.js";

vi.mock("./execution-context.js", () => ({
  getPhotoExecutionContext: () => ({
    normalizeStorageKey: (key: string) => key,
  }),
}));

vi.mock("./logger-adapter.js", () => ({
  getPhotoProcessingLoggers: () => ({
    image: {
      info: vi.fn(),
      warn: vi.fn(),
    },
  }),
}));

describe("extractPhotoInfo", () => {
  it("uses source modification time as a deterministic date fallback", () => {
    expect(
      extractPhotoInfo(
        "gallery/untitled.jpg",
        null,
        new Date("2024-05-06T07:08:09.000Z"),
      ).dateTaken,
    ).toBe("2024-05-06T07:08:09.000Z");
  });

  it("uses a deterministic epoch when no date metadata exists", () => {
    expect(extractPhotoInfo("untitled.jpg", null).dateTaken).toBe(
      "1970-01-01T00:00:00.000Z",
    );
  });

  it("still prefers a valid EXIF capture date", () => {
    expect(
      extractPhotoInfo(
        "untitled.jpg",
        { DateTimeOriginal: "2020-01-02T03:04:05.000Z" },
        "2024-05-06T07:08:09.000Z",
      ).dateTaken,
    ).toBe("2020-01-02T03:04:05.000Z");
  });
});
