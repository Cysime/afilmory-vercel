import { describe, expect, it } from "vitest";

import {
  assertPublishableSourceMetadata,
  normalizeRepositoryUrl,
  resolveBuildMetadata,
} from "./build-metadata";

const upstreamMetadata = {
  version: "1.2.3",
  repository: "https://github.com/upstream/afilmory.git",
};

describe("build source metadata", () => {
  it("links a Vercel fork commit to the fork instead of upstream", () => {
    const metadata = resolveBuildMetadata({
      env: {
        VERCEL_GIT_COMMIT_SHA: "abc123",
        VERCEL_GIT_REPO_OWNER: "photographer",
        VERCEL_GIT_REPO_SLUG: "my-gallery",
      },
      execGit: () => "",
      metadata: upstreamMetadata,
      now: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(metadata).toMatchObject({
      version: "1.2.3",
      gitCommitHash: "abc123",
      sourceDirty: false,
      sourceExact: true,
      sourceUrl: "https://github.com/photographer/my-gallery/tree/abc123",
      licenseUrl:
        "https://github.com/photographer/my-gallery/blob/abc123/LICENSE",
    });
  });

  it("allows an explicit repository URL to override CI metadata", () => {
    const metadata = resolveBuildMetadata({
      env: {
        AFILMORY_SOURCE_URL: "https://gitlab.com/team/gallery.git",
        GITHUB_REPOSITORY: "wrong/repository",
        GITHUB_SHA: "def456",
      },
      execGit: () => "",
      metadata: upstreamMetadata,
    });

    expect(metadata.sourceUrl).toBe(
      "https://gitlab.com/team/gallery/-/tree/def456",
    );
    expect(metadata.licenseUrl).toBe(
      "https://gitlab.com/team/gallery/-/blob/def456/LICENSE",
    );
  });

  it("falls back to a credential-free normalized git remote", () => {
    const metadata = resolveBuildMetadata({
      env: {},
      execGit: (args) => {
        if (args[0] === "remote") {
          return "git@github.com:fork/local-gallery.git";
        }
        if (args[0] === "status") return "";
        return "789abc";
      },
      metadata: upstreamMetadata,
    });

    expect(metadata.sourceUrl).toBe(
      "https://github.com/fork/local-gallery/tree/789abc",
    );
  });

  it("rejects local paths and removes URL credentials", () => {
    expect(normalizeRepositoryUrl("/tmp/private/repository")).toBeNull();
    expect(
      normalizeRepositoryUrl(
        "https://token:secret@github.com/owner/repository.git?token=secret",
      ),
    ).toBe("https://github.com/owner/repository");
  });

  it("does not advertise a clean commit as the exact source of dirty Project Code", () => {
    const metadata = resolveBuildMetadata({
      env: {},
      execGit: (args) => {
        if (args[0] === "remote") {
          return "https://github.com/fork/local-gallery.git";
        }
        if (args[0] === "status") {
          expect(args).toContain("apps/web/src");
          expect(args).not.toContain("generated");
          return " M apps/web/src/main.tsx";
        }
        return "789abc";
      },
      metadata: upstreamMetadata,
    });

    expect(metadata).toMatchObject({
      gitCommitHash: "789abc",
      sourceDirty: true,
      sourceExact: false,
      sourceUrl: "https://github.com/fork/local-gallery",
    });
    expect(() =>
      assertPublishableSourceMetadata(metadata, { CI: "true" }),
    ).toThrow("not reproducible");
  });

  it("accepts an explicit public corresponding-source archive for a dirty deployment", () => {
    const metadata = resolveBuildMetadata({
      env: {
        AFILMORY_CORRESPONDING_SOURCE_URL:
          "https://downloads.example.com/gallery/source-abc.tar.gz",
      },
      execGit: (args) => {
        if (args[0] === "remote") {
          return "https://github.com/fork/local-gallery.git";
        }
        if (args[0] === "status") return " M packages/builder/src/cli.ts";
        return "789abc";
      },
      metadata: upstreamMetadata,
    });

    expect(metadata).toMatchObject({
      sourceDirty: true,
      sourceExact: true,
      sourceUrl: "https://downloads.example.com/gallery/source-abc.tar.gz",
    });
    expect(() =>
      assertPublishableSourceMetadata(metadata, { VERCEL: "1" }),
    ).not.toThrow();
  });

  it("rejects credentialed or signed source URLs instead of treating a stripped URL as exact", () => {
    const metadata = resolveBuildMetadata({
      env: {
        AFILMORY_CORRESPONDING_SOURCE_URL:
          "https://downloads.example.com/gallery/source.tar.gz?token=secret",
      },
      execGit: (args) => {
        if (args[0] === "status") return " M apps/web/src/main.tsx";
        if (args[0] === "remote") {
          return "https://github.com/fork/local-gallery.git";
        }
        return "789abc";
      },
      metadata: upstreamMetadata,
    });

    expect(metadata.sourceExact).toBe(false);
    expect(metadata.sourceUrl).toBe("https://github.com/fork/local-gallery");
    expect(() =>
      assertPublishableSourceMetadata(metadata, { CI: "true" }),
    ).toThrow("not reproducible");
  });
});
