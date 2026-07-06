import { describe, expect, it } from "vitest";

import { measureSVGText, renderSVGText, wrapSVGText } from "./index.ts";

// 这些函数是纯函数（内置字形表，无 I/O），是包迁移后验证公共出口
// （'@afilmory/build-assets' 的 index.ts）可用的最轻量方式。
describe("renderSVGText", () => {
  it("renders one <path> group per character", () => {
    const svg = renderSVGText("ab", 0, 0, { fontSize: 100 });
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg.match(/<g transform=/g)).toHaveLength(2);
  });

  it("applies the fill color and bold stroke", () => {
    const svg = renderSVGText("A", 0, 0, { color: "red", fontWeight: "bold" });
    expect(svg).toContain('fill="red"');
    expect(svg).toContain('stroke="red"');
  });

  it("offsets subsequent lines by fontSize * lineHeight", () => {
    const svg = renderSVGText("a\na", 10, 20, { fontSize: 50, lineHeight: 2 });
    expect(svg).toContain("translate(10, 20)");
    expect(svg).toContain("translate(10, 120)");
  });
});

describe("measureSVGText", () => {
  it("scales width with fontSize and computes line height", () => {
    const small = measureSVGText("MM", { fontSize: 50 });
    const large = measureSVGText("MM", { fontSize: 100 });
    expect(large.width).toBeCloseTo(small.width * 2);
    expect(large.height).toBeCloseTo(100 * 1.2);
  });

  it("uses the widest line for multi-line text", () => {
    const wide = measureSVGText("MMMM", { fontSize: 40 });
    const multi = measureSVGText("MMMM\nM", { fontSize: 40 });
    expect(multi.width).toBeCloseTo(wide.width);
    expect(multi.height).toBeCloseTo(2 * 40 * 1.2);
  });
});

describe("wrapSVGText", () => {
  it("keeps short text on a single line", () => {
    expect(wrapSVGText("hello", 10_000, { fontSize: 32 })).toBe("hello");
  });

  it("wraps words so each line fits within maxWidth", () => {
    const wrapped = wrapSVGText("aaaa bbbb cccc dddd", 200, { fontSize: 48 });
    const lines = wrapped.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureSVGText(line, { fontSize: 48 }).width).toBeLessThanOrEqual(
        200,
      );
    }
    // 换行只重排空格，不丢内容
    expect(wrapped.replaceAll("\n", " ")).toBe("aaaa bbbb cccc dddd");
  });
});
