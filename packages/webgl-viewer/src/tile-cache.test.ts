import { describe, expect, it } from "vitest";

import {
  createTileKey,
  getTileGridSize,
  parseTileKey,
  SIMPLE_LOD_LEVELS,
  TILE_SIZE,
} from "./tile-cache";

describe("createTileKey / parseTileKey", () => {
  it("round-trips coordinates through the key format", () => {
    for (const [x, y, lodLevel] of [
      [0, 0, 0],
      [1, 2, 3],
      [17, 42, 4],
    ] as const) {
      expect(parseTileKey(createTileKey(x, y, lodLevel))).toEqual({
        x,
        y,
        lodLevel,
      });
    }
  });

  it("parses the documented key layout", () => {
    expect(createTileKey(3, 5, 2)).toBe("3-5-2");
    expect(parseTileKey("3-5-2")).toEqual({ x: 3, y: 5, lodLevel: 2 });
  });
});

describe("getTileGridSize", () => {
  it("scales the image by the LOD level and divides into TILE_SIZE tiles", () => {
    expect(
      getTileGridSize({ imageWidth: 4000, imageHeight: 3000, lodLevel: 2 }),
    ).toEqual({
      cols: Math.ceil(4000 / TILE_SIZE),
      rows: Math.ceil(3000 / TILE_SIZE),
    });

    const lodConfig = SIMPLE_LOD_LEVELS[4];
    expect(
      getTileGridSize({ imageWidth: 1000, imageHeight: 500, lodLevel: 4 }),
    ).toEqual({
      cols: Math.ceil((1000 * lodConfig.scale) / TILE_SIZE),
      rows: Math.ceil((500 * lodConfig.scale) / TILE_SIZE),
    });
  });
});
