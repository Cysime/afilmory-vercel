import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMeasure } from "../useMeasure";

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }
}

describe("useMeasure", () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses resize notifications for bounds and disconnects when the ref clears", () => {
    const node = document.createElement("div");
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
      x: 5,
      y: 6,
      top: 6,
      left: 5,
      right: 105,
      bottom: 56,
      width: 100,
      height: 50,
      toJSON: () => ({}),
    });
    const { result } = renderHook(() => useMeasure());

    act(() => result.current[0](node));
    const observer = ResizeObserverMock.instances.at(-1)!;
    expect(observer.observe).toHaveBeenCalledWith(node);

    act(() => observer.callback([], observer));
    expect(result.current[1]).toMatchObject({ width: 100, height: 50 });

    act(() => result.current[0](null));
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending debounced resize on unmount", () => {
    vi.useFakeTimers();
    const node = document.createElement("div");
    const { result, unmount } = renderHook(() =>
      useMeasure({ debounce: { resize: 100, scroll: 0 } }),
    );
    act(() => result.current[0](node));

    const observer = ResizeObserverMock.instances.at(-1)!;
    act(() => observer.callback([], observer));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
