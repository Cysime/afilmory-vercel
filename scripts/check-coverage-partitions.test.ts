import { describe, expect, it } from "vitest";

import { checkCoveragePartitions } from "./check-coverage-partitions";

const covered = (coveredCount: number, total: number) => ({
  branches: { covered: coveredCount, total },
  functions: { covered: coveredCount, total },
  lines: { covered: coveredCount, total },
  statements: { covered: coveredCount, total },
});

describe("partition coverage budget", () => {
  it("passes when every architectural partition clears its floor", () => {
    const result = checkCoveragePartitions({
      "/repo/apps/web/src/app.ts": covered(9, 10),
      "/repo/packages/builder/src/build.ts": covered(9, 10),
      "/repo/packages/schema/src/manifest.ts": covered(9, 10),
      "/repo/packages/webgl-viewer/src/engine.ts": covered(9, 10),
    });
    expect(result.issues).toEqual([]);
  });

  it("reports both a missing partition and a low metric", () => {
    const result = checkCoveragePartitions({
      "/repo/apps/web/src/app.ts": covered(1, 10),
    });
    expect(result.issues).toContain("builder: no coverage files matched");
    expect(result.issues).toContain("web.statements is 10.00%, below 68%");
  });
});
