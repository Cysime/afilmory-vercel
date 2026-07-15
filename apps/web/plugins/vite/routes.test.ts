import { describe, expect, it } from "vitest";

import { createVirtualRoutesModuleSource } from "./routes";

describe("virtual route module", () => {
  it("emits one inclusive glob in development", () => {
    const source = createVirtualRoutesModuleSource(true);
    expect(source.match(/import\.meta\.glob/g)).toHaveLength(1);
    expect(source).not.toContain("!/src/pages/(debug)");
  });

  it("excludes private route groups at transform time in production", () => {
    const source = createVirtualRoutesModuleSource(false, [
      "(main)/layout.tsx",
      "explore/index.tsx",
    ]);
    expect(source).not.toContain("import.meta.glob");
    expect(source).toContain("/src/pages/(main)/layout.tsx");
    expect(source).toContain("/src/pages/explore/index.tsx");
    expect(source).not.toContain("(debug)");
    expect(source).not.toContain("(data)");
  });
});
