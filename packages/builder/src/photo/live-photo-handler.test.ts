import { describe, expect, it } from "vitest";

import { getStorageObjectVersion } from "./live-photo-handler.js";

describe("Live Photo sidecar versioning", () => {
  it("prefers the storage etag", () => {
    expect(
      getStorageObjectVersion({
        key: "photo.mov",
        etag: '"video-etag"',
        size: 42,
      }),
    ).toBe('etag:"video-etag"');
  });

  it("falls back to modification time and size", () => {
    expect(
      getStorageObjectVersion({
        key: "photo.mov",
        lastModified: new Date("2026-07-13T00:00:00.000Z"),
        size: 42,
      }),
    ).toBe("mtime:2026-07-13T00:00:00.000Z:size:42");
  });
});
