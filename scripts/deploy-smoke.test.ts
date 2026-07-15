import { describe, expect, it } from "vitest";

import { createDeploySmokeEnvironment } from "./deploy-smoke";

describe("deployment smoke environment", () => {
  it("forces the static entrypoint onto an isolated local fixture", () => {
    const environment = createDeploySmokeEnvironment({
      GIT_TOKEN: "must-not-pass-through",
      PATH: "/bin",
      REPO_TOKEN: "must-not-pass-through",
    });
    expect(environment.PHOTO_STORAGE_PROVIDER).toBe("local");
    expect(environment.SKIP_MANIFEST_BUILD).toBe("true");
    expect(environment.REQUIRE_FRESH_BUILD).toBe("true");
    expect(environment.REPO_TOKEN).toBe("");
    expect(environment.GIT_TOKEN).toBeUndefined();
    expect(environment.AFILMORY_MANIFEST_PATH).toContain(
      "apps/web/e2e/fixtures/photos-manifest.json",
    );
  });
});
