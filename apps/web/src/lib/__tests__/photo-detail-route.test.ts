import { describe, expect, it } from "vitest";

import {
  buildPhotoDetailPathname,
  isPhotoDetailPathname,
} from "../photo-detail-route";

describe("photo-detail-route", () => {
  it("encodes photo ids as one safe route segment", () => {
    expect(buildPhotoDetailPathname("album #1?50%")).toBe(
      "/photos/album%20%231%3F50%25",
    );
  });

  it("recognizes single-segment photo detail pathnames", () => {
    expect(isPhotoDetailPathname("/photos/abc")).toBe(true);
    expect(
      isPhotoDetailPathname(buildPhotoDetailPathname("album #1?50%")),
    ).toBe(true);
  });

  it("rejects non-detail pathnames", () => {
    expect(isPhotoDetailPathname("/")).toBe(false);
    expect(isPhotoDetailPathname("/photos")).toBe(false);
    expect(isPhotoDetailPathname("/photos/")).toBe(false);
    expect(isPhotoDetailPathname("/photos/abc/nested")).toBe(false);
    expect(isPhotoDetailPathname("/gallery/photos/abc")).toBe(false);
  });
});
