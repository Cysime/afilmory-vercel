import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface VercelConfig {
  trailingSlash?: boolean;
  rewrites?: Array<{ destination: string; source: string }>;
  headers?: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "vercel.json"), "utf8"),
) as VercelConfig;

describe("vercel static SPA routing", () => {
  it("falls missing photo routes back without shadowing dotted IDs", () => {
    const [photoFallback, catchAll] = config.rewrites ?? [];

    // Vercel checks the filesystem before rewrites. Existing
    // photos/<id>/index.html shells therefore win, while this first rule lets
    // missing/deleted IDs reach React's route-level NotFound UI. It must remain
    // ahead of the generic extension-aware fallback because IDs may contain a
    // dot and look like static files.
    expect(photoFallback).toEqual({
      source: "/photos/:path*",
      destination: "/index.html",
    });
    expect(catchAll?.destination).toBe("/index.html");
    expect(catchAll?.source).not.toContain("photos(?:/|$)");

    const genericPattern = new RegExp(`^${catchAll?.source ?? ""}$`);
    expect(genericPattern.test("/photos/missing-photo")).toBe(true);
    expect(genericPattern.test("/photos/missing.photo")).toBe(false);
    expect(genericPattern.test("/map")).toBe(true);
    expect(genericPattern.test("/assets/app.js")).toBe(false);
    expect(genericPattern.test("/originals/photo.jpg")).toBe(false);
  });

  it("keeps canonical trailing slashes and revalidates photo documents", () => {
    expect(config.trailingSlash).toBe(true);

    const photoHeaders = config.headers?.find(
      ({ source }) => source === "/photos/(.*)",
    );
    const cacheControl = photoHeaders?.headers.find(
      ({ key }) => key.toLowerCase() === "cache-control",
    );
    expect(cacheControl?.value).toBe("public, max-age=0, must-revalidate");

    const indexHeaders = config.headers?.find(
      ({ source }) => source === "/index.html",
    );
    expect(
      indexHeaders?.headers.find(
        ({ key }) => key.toLowerCase() === "cache-control",
      )?.value,
    ).toBe("no-cache, no-store, must-revalidate");
  });
});
