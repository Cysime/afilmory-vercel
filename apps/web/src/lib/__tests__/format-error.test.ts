import { describe, expect, it } from "vitest";

import { formatUnknownError } from "~/lib/format-error";

describe("formatUnknownError", () => {
  it("formats Error, undefined, bigint, and circular values safely", () => {
    const missing: unknown = undefined;
    expect(formatUnknownError(new Error("broken"))).toBe("broken");
    expect(formatUnknownError(missing)).toBe("Unknown error");
    expect(formatUnknownError({ count: 12n })).toBe('{"count":"12"}');

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(formatUnknownError(circular)).toBe('{"self":"[Circular]"}');
  });
});
