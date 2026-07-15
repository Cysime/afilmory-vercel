import { describe, expect, it } from "vitest";

import { findStaticVendorChunkCycle } from "./deps";

describe("findStaticVendorChunkCycle", () => {
  it("reports a static cycle spanning multiple vendor chunks", () => {
    const imports = new Map<string, string[]>([
      ["assets/entry.js", ["vendor/ui-a.js"]],
      ["vendor/ui-a.js", ["assets/shared.js"]],
      ["assets/shared.js", ["vendor/ui-b.js"]],
      ["vendor/ui-b.js", ["vendor/ui-a.js"]],
    ]);

    expect(findStaticVendorChunkCycle(imports)).toEqual([
      "vendor/ui-a.js",
      "assets/shared.js",
      "vendor/ui-b.js",
      "vendor/ui-a.js",
    ]);
  });

  it("allows acyclic graphs and cycles contained in one vendor chunk", () => {
    expect(
      findStaticVendorChunkCycle(
        new Map([
          ["assets/entry.js", ["vendor/ui.js"]],
          ["vendor/ui.js", ["assets/shared.js"]],
          ["assets/shared.js", ["vendor/ui.js"]],
        ]),
      ),
    ).toBeNull();

    expect(
      findStaticVendorChunkCycle(
        new Map([
          ["assets/entry.js", ["vendor/ui.js"]],
          ["vendor/ui.js", []],
        ]),
      ),
    ).toBeNull();
  });
});
