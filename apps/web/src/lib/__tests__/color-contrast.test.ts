import { describe, expect, it } from "vitest";

import { getReadableTextColor } from "~/lib/color-contrast";

describe("getReadableTextColor", () => {
  it("chooses black for light accents and white for dark accents", () => {
    expect(getReadableTextColor("#ffd60a")).toBe("#000000");
    expect(getReadableTextColor("#007aff")).toBe("#000000");
    expect(getReadableTextColor("#000")).toBe("#ffffff");
  });

  it("uses a caller-provided fallback for unsupported CSS colors", () => {
    expect(getReadableTextColor("oklch(60% 0.2 240)", "currentColor")).toBe(
      "currentColor",
    );
  });

  it("composites alpha hex colors over the app's dark canvas", () => {
    expect(getReadableTextColor("#ffffff00")).toBe("#ffffff");
    expect(getReadableTextColor("#ffffffcc")).toBe("#000000");
    expect(getReadableTextColor("#fff0")).toBe("#ffffff");
  });
});
