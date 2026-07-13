import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useControlledState } from "../useControlledState";

describe("useControlledState", () => {
  it("updates its own value when uncontrolled", () => {
    const { result } = renderHook(() =>
      useControlledState({ defaultValue: false }),
    );

    act(() => result.current[1](true));

    expect(result.current[0]).toBe(true);
  });

  it("never mutates a controlled value while still notifying the owner", () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useControlledState({ value, onChange }),
      { initialProps: { value: false } },
    );

    act(() => result.current[1](true));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(result.current[0]).toBe(false);

    rerender({ value: true });
    expect(result.current[0]).toBe(true);
  });
});
