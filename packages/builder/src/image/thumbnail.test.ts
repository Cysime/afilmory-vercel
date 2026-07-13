import { describe, expect, it } from "vitest";

import {
  createThumbnailFileName,
  getThumbnailPublicUrl,
  THUMBNAIL_ENCODING_VERSION,
} from "./thumbnail.js";

describe("thumbnail URL helpers", () => {
  it("encodes generated thumbnail filenames for public URLs", () => {
    expect(getThumbnailPublicUrl("album #1?50%")).toBe(
      "/thumbnails/album%20%231%3F50%25.jpg",
    );
  });

  it("content-addresses immutable generated thumbnails", () => {
    const buffer = Buffer.from("encoded jpeg");
    const fileName = createThumbnailFileName("photo", buffer);

    expect(fileName).toMatch(
      new RegExp(
        `^photo\\.[\\da-f]{64}\\.${THUMBNAIL_ENCODING_VERSION}\\.jpg$`,
      ),
    );
    expect(getThumbnailPublicUrl("photo", buffer)).toBe(
      `/thumbnails/${fileName}`,
    );
    expect(createThumbnailFileName("photo", Buffer.from("changed"))).not.toBe(
      fileName,
    );
  });
});
