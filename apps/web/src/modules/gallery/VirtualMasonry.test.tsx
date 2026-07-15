import { act, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MasonryRef } from "./VirtualMasonry";
import { Masonry } from "./VirtualMasonry";

let scrollEl: HTMLElement | null = null;

vi.mock("@afilmory/ui", () => ({
  useScrollViewElement: () => scrollEl,
}));

beforeEach(() => {
  scrollEl = null;
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Masonry (pure-computed virtual masonry)", () => {
  it("renders visible cells and exposes layout metrics + item rects", () => {
    let capturedRef: { current: MasonryRef | null } | null = null;

    const Probe = () => {
      const ref = useRef<MasonryRef>(null);
      capturedRef = ref;
      return (
        <Masonry
          ref={ref}
          items={[{ id: "a" }, { id: "b" }, { id: "c" }]}
          columnWidth={100}
          columnGutter={4}
          rowGutter={6}
          itemHeight={() => 80}
          itemKey={(data) => data.id}
          render={({ data }) => (
            <div data-testid={`cell-${data.id}`}>{data.id}</div>
          )}
        />
      );
    };

    render(<Probe />);

    // jsdom 下容器宽度为 0 → 回退到列宽 → 单列，三个 item 垂直堆叠。
    expect(screen.getByTestId("cell-a")).toBeTruthy();

    const rect0 = capturedRef?.current?.getItemRect(0);
    expect(rect0?.width).toBe(100);
    expect(rect0?.height).toBe(80);

    const rect1 = capturedRef?.current?.getItemRect(1);
    // 第二个 cell 紧贴第一个下方 + rowGutter。
    expect(rect1?.top).toBe(80 + 6);

    const metrics = capturedRef?.current?.getLayoutMetrics();
    expect(metrics?.columnWidth).toBe(100);
    // 布局列宽（estimatePhotoVirtualRect 复算 left 用）：容器宽未知时回退目标列宽。
    expect(metrics?.layoutColumnWidth).toBe(100);
    expect(metrics?.columnCount).toBe(1);
    expect(metrics?.rowGutter).toBe(6);
  });

  it("returns null item rect for an out-of-range index", () => {
    let capturedRef: { current: MasonryRef | null } | null = null;
    const Probe = () => {
      const ref = useRef<MasonryRef>(null);
      capturedRef = ref;
      return (
        <Masonry
          ref={ref}
          items={[{ id: "only" }]}
          columnWidth={100}
          itemHeight={() => 50}
          itemKey={(data) => data.id}
          render={({ data }) => <div>{data.id}</div>}
        />
      );
    };
    render(<Probe />);
    expect(capturedRef?.current?.getItemRect(99)).toBeNull();
  });

  it("calls onRender with the visible index range", () => {
    const onRender = vi.fn();
    render(
      <Masonry
        items={[{ id: "a" }, { id: "b" }]}
        columnWidth={100}
        itemHeight={() => 50}
        itemKey={(data) => data.id}
        onRender={onRender}
        render={({ data }) => <div>{data.id}</div>}
      />,
    );
    expect(onRender).toHaveBeenCalled();
    const [startIndex, stopIndex] = onRender.mock.calls.at(-1) ?? [];
    expect(startIndex).toBe(0);
    expect(stopIndex).toBe(1);
  });

  it("pins, scrolls to, and focuses a keyboard target beyond 100 virtual items", async () => {
    const scroller = document.createElement("div");
    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo;
    scrollEl = scroller;
    const items = Array.from({ length: 120 }, (_, index) => ({
      id: `photo-${index}`,
    }));
    let capturedRef: { current: MasonryRef | null } | null = null;

    const Probe = () => {
      const ref = useRef<MasonryRef>(null);
      capturedRef = ref;
      return (
        <Masonry
          ref={ref}
          items={items}
          columnWidth={100}
          itemHeight={() => 50}
          itemKey={(data) => data.id}
          render={({ data }) => (
            <a href={`#${data.id}`} data-gallery-photo-link>
              {data.id}
            </a>
          )}
        />
      );
    };

    render(<Probe />);
    expect(screen.queryByText("photo-119")).toBeNull();

    act(() => {
      capturedRef?.current?.scrollToIndex(119, { focus: true });
    });

    await waitFor(() => {
      expect(screen.getByText("photo-119")).toBe(document.activeElement);
    });
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });
});
