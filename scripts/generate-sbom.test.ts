import { describe, expect, it } from "vitest";

import { createCycloneDxSbom } from "./generate-sbom";

describe("CycloneDX SBOM", () => {
  it("deduplicates components and records dependency edges", () => {
    const sbom = createCycloneDxSbom([
      {
        name: "@afilmory/monorepo",
        version: "1.0.0",
        dependencies: {
          react: {
            version: "19.2.0",
            dependencies: { scheduler: { version: "0.27.0" } },
          },
        },
      },
      {
        name: "@afilmory/web",
        version: "1.0.0",
        private: true,
        dependencies: { react: { version: "19.2.0" } },
      },
    ]);

    expect(sbom.bomFormat).toBe("CycloneDX");
    expect(
      sbom.components.filter((item) => item.name === "react"),
    ).toHaveLength(1);
    expect(sbom.dependencies).toContainEqual({
      ref: "pkg:npm/react@19.2.0",
      dependsOn: ["pkg:npm/scheduler@0.27.0"],
    });
  });
});
