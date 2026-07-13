import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_BUILD_MANIFEST_PATH,
  resolveBuildManifestPath,
} from "./manifest-path.ts";

const temporaryRoots: string[] = [];

const createFixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "afilmory-manifest-path-"));
  temporaryRoots.push(root);
  const fixturePath = path.join(root, "fixtures", "manifest.json");
  mkdirSync(path.dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, "{}\n");
  return { fixturePath, root };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("resolveBuildManifestPath", () => {
  it("preserves the repository manifest as the default", () => {
    expect(resolveBuildManifestPath(undefined, "/ignored")).toBe(
      DEFAULT_BUILD_MANIFEST_PATH,
    );
  });

  it("accepts an existing absolute fixture path", () => {
    const { fixturePath } = createFixture();
    expect(resolveBuildManifestPath(fixturePath)).toBe(fixturePath);
  });

  it("resolves a relative fixture path from the caller's cwd", () => {
    const { fixturePath, root } = createFixture();
    expect(resolveBuildManifestPath("fixtures/manifest.json", root)).toBe(
      fixturePath,
    );
  });

  it("fails early when an override fixture is missing", () => {
    const { root } = createFixture();
    expect(() =>
      resolveBuildManifestPath("fixtures/missing.json", root),
    ).toThrow(/AFILMORY_MANIFEST_PATH must point to an existing file/);
  });
});
