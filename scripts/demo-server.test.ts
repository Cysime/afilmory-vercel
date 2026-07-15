import { describe, expect, it } from "vitest";

import { createDemoEnvironment } from "./demo-server";

describe("zero-credential demo", () => {
  it("uses the committed synthetic fixture without inheriting repository secrets", () => {
    const environment = createDemoEnvironment({
      PATH: "/bin",
      REPO_TOKEN: "must-not-pass-through",
      S3_SECRET_ACCESS_KEY: "must-not-pass-through",
    });
    expect(environment.PHOTO_STORAGE_PROVIDER).toBe("local");
    expect(environment.AFILMORY_MANIFEST_PATH).toContain(
      "apps/web/e2e/fixtures/photos-manifest.json",
    );
    expect(environment.REPO_TOKEN).toBeUndefined();
    expect(environment.S3_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
