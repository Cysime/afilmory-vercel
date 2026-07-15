import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateWorkspaceContracts } from "./check-workspace-contracts";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("workspace contracts", () => {
  it("keeps package metadata, direct imports, and type-check discovery aligned", async () => {
    await expect(validateWorkspaceContracts(rootDir)).resolves.toEqual([]);
  });
});
