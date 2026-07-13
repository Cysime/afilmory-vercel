import { describe, expect, it } from "vitest";

import {
  MAX_CANVAS_BACKING_BYTES,
  resolveCanvasBackingStore,
} from "./canvas-memory";

describe("resolveCanvasBackingStore", () => {
  it("caps high-DPR canvases by DPR, texture dimensions, and byte budget", () => {
    const result = resolveCanvasBackingStore({
      cssWidth: 3840,
      cssHeight: 2160,
      requestedDpr: 3,
      maxTextureSize: 4096,
    });

    expect(result.dpr).toBeLessThan(1.1);
    expect(result.width).toBeLessThanOrEqual(4096);
    expect(result.height).toBeLessThanOrEqual(4096);
    expect(result.bytes).toBeLessThanOrEqual(MAX_CANVAS_BACKING_BYTES);
  });

  it("keeps ordinary DPR backing stores unchanged", () => {
    expect(
      resolveCanvasBackingStore({
        cssWidth: 800,
        cssHeight: 600,
        requestedDpr: 2,
        maxTextureSize: 4096,
      }),
    ).toMatchObject({ width: 1600, height: 1200, dpr: 2 });
  });
});
