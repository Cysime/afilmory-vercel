import { describe, expect, it } from "vitest";

import {
  appendMediaVersion,
  getVersionedOriginalUrl,
} from "../media-version-url";

describe("media version URLs", () => {
  it("versions root-relative and absolute media while preserving parameters", () => {
    expect(appendMediaVersion("/originals/a b.jpg?download=1", '"etag"')).toBe(
      "/originals/a%20b.jpg?download=1&v=%22etag%22",
    );
    expect(appendMediaVersion("https://cdn.example.com/a.jpg", "next")).toBe(
      "https://cdn.example.com/a.jpg?v=next",
    );
  });

  it("falls back to stable manifest metadata when etag is absent", () => {
    expect(
      getVersionedOriginalUrl({
        originalUrl: "/originals/a.jpg",
        lastModified: "2026-01-02T03:04:05.000Z",
        size: 42,
      }),
    ).toBe("/originals/a.jpg?v=2026-01-02T03%3A04%3A05.000Z%3A42");
  });

  it("does not rewrite unsupported URL schemes", () => {
    expect(appendMediaVersion("javascript:alert(1)", "v1")).toBe(
      "javascript:alert(1)",
    );
  });
});
