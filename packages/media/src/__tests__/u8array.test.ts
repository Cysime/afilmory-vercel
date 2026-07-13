import { describe, expect, it } from "vitest";

import { hexToUint8Array, uint8ArrayToHex } from "../index";

describe("u8array helpers", () => {
  it("roundtrips bytes through hex", () => {
    const original = Uint8Array.from([0, 1, 15, 16, 255]);

    expect(hexToUint8Array(uint8ArrayToHex(original))).toEqual(original);
  });

  it("pads single-nibble bytes", () => {
    expect(uint8ArrayToHex(Uint8Array.from([0, 15, 255]))).toBe("000fff");
  });

  it.each(["0", "abc", "0g", "zz"])(
    "rejects malformed hex instead of partially decoding %s",
    (hex) => {
      expect(() => hexToUint8Array(hex)).toThrow(TypeError);
    },
  );

  it("accepts empty and uppercase hex input", () => {
    expect(hexToUint8Array("")).toEqual(new Uint8Array());
    expect(hexToUint8Array("00FF")).toEqual(Uint8Array.from([0, 255]));
  });
});
