import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDefaultOutputSettings,
  monorepoRoot,
  normalizeBuilderOutputSettings,
  webAppDir,
} from "./output-paths.js";

describe("module-level paths", () => {
  it("resolves monorepoRoot to an absolute path", () => {
    expect(path.isAbsolute(monorepoRoot)).toBe(true);
  });

  it("derives webAppDir as apps/web under the monorepo root", () => {
    expect(webAppDir).toBe(path.join(monorepoRoot, "apps", "web"));
  });
});

describe("createDefaultOutputSettings", () => {
  it("builds the conventional default layout under the monorepo root", () => {
    const settings = createDefaultOutputSettings();

    expect(settings.manifestPath).toBe(
      path.join(monorepoRoot, "generated", "photos-manifest.json"),
    );
    expect(settings.thumbnailsDir).toBe(
      path.join(webAppDir, "public", "thumbnails"),
    );
    expect(settings.originalsDir).toBe(
      path.join(webAppDir, "public", "originals"),
    );
  });
});

describe("normalizeBuilderOutputSettings", () => {
  it.each([".", path.parse(process.cwd()).root])(
    "rejects a shared or filesystem-root thumbnail directory: %s",
    (thumbnailsDir) => {
      expect(() =>
        normalizeBuilderOutputSettings({
          manifestPath: "rel/manifest.json",
          thumbnailsDir,
          originalsDir: "rel/originals",
        }),
      ).toThrow(/thumbnailsDir must be a dedicated subdirectory/);
    },
  );

  it("resolves relative paths against the current working directory", () => {
    const result = normalizeBuilderOutputSettings({
      manifestPath: "rel/manifest.json",
      thumbnailsDir: "rel/thumbs",
      originalsDir: "rel/originals",
    });

    expect(result.manifestPath).toBe(path.resolve("rel/manifest.json"));
    expect(result.thumbnailsDir).toBe(path.resolve("rel/thumbs"));
    expect(result.originalsDir).toBe(path.resolve("rel/originals"));
  });

  it("normalizes already-absolute paths (collapsing . and ..)", () => {
    const result = normalizeBuilderOutputSettings({
      manifestPath: "/data/out/../manifest.json",
      thumbnailsDir: "/data/./thumbs",
      originalsDir: "/data/originals",
    });

    expect(result.manifestPath).toBe("/data/manifest.json");
    expect(result.thumbnailsDir).toBe("/data/thumbs");
    expect(result.originalsDir).toBe("/data/originals");
  });

  it("is idempotent, so config-resolve and builder-constructor can both apply it", () => {
    const once = normalizeBuilderOutputSettings({
      manifestPath: "rel/manifest.json",
      thumbnailsDir: "/data/./thumbs",
      originalsDir: "rel/../originals",
    });

    expect(normalizeBuilderOutputSettings(once)).toEqual(once);
  });
});
