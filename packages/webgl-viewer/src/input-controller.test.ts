import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebGLInputControllerHost } from "./input-controller";
import { WebGLInputController } from "./input-controller";
import type { WebGLImageViewerProps } from "./interface";

function firePointer(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    }),
  );
}

function createHost(): WebGLInputControllerHost {
  return {
    isAnimating: vi.fn(() => false),
    stopAnimation: vi.fn(),
    panBy: vi.fn(),
    zoomAt: vi.fn(),
    performDoubleClickAction: vi.fn(),
    onPinchEnd: vi.fn(),
  };
}

function createController(host: WebGLInputControllerHost) {
  const canvas = document.createElement("canvas");
  const config = {
    pinch: {},
    panning: {},
    doubleClick: { step: 0.7, mode: "toggle", animationTime: 200 },
    wheel: { step: 0.2 },
  } as Partial<
    Required<WebGLImageViewerProps>
  > as Required<WebGLImageViewerProps>;
  const controller = new WebGLInputController(canvas, config, host);
  controller.connect();
  return { canvas, controller };
}

// tap 合成对时间敏感（300ms 窗口）：用可控时钟驱动，避免真实时间抖动。
function mockNow(initial: number) {
  let current = initial;
  vi.spyOn(Date, "now").mockImplementation(() => current);
  return (next: number) => {
    current = next;
  };
}

describe("WebGLInputController double-tap synthesis", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires the double-click action on two quick clean taps", () => {
    const setNow = mockNow(1000);
    const host = createHost();
    const { canvas } = createController(host);

    firePointer(canvas, "pointerdown", 100, 100);
    firePointer(canvas, "pointerup", 100, 100);
    setNow(1150);
    firePointer(canvas, "pointerdown", 102, 103);
    firePointer(canvas, "pointerup", 102, 103);

    expect(host.performDoubleClickAction).toHaveBeenCalledTimes(1);
    expect(host.performDoubleClickAction).toHaveBeenCalledWith(102, 103);
  });

  it("tolerates sub-10px jitter within each tap", () => {
    const setNow = mockNow(1000);
    const host = createHost();
    const { canvas } = createController(host);

    // 每次 tap 内位移 <10px（真实手指的抖动量）仍应算 tap
    firePointer(canvas, "pointerdown", 100, 100);
    firePointer(canvas, "pointerup", 104, 106);
    setNow(1150);
    firePointer(canvas, "pointerdown", 101, 101);
    firePointer(canvas, "pointerup", 97, 98);

    expect(host.performDoubleClickAction).toHaveBeenCalledTimes(1);
  });

  it("does not count the final lift of a pinch as a tap (pinch then quick tap must not toggle zoom)", () => {
    const setNow = mockNow(1000);
    const host = createHost();
    const { canvas } = createController(host);

    // 捏合：两指按下、张开、依次抬起
    firePointer(canvas, "pointerdown", 100, 100, 1);
    firePointer(canvas, "pointerdown", 200, 100, 2);
    firePointer(canvas, "pointermove", 220, 100, 2);
    firePointer(canvas, "pointerup", 100, 100, 1);
    firePointer(canvas, "pointerup", 220, 100, 2);
    expect(host.zoomAt).toHaveBeenCalled();
    expect(host.onPinchEnd).toHaveBeenCalledTimes(1);

    // 300ms/50px 内的一次单击：不得与捏合收尾的抬指合成双击
    setNow(1150);
    firePointer(canvas, "pointerdown", 215, 100, 1);
    firePointer(canvas, "pointerup", 215, 100, 1);

    expect(host.performDoubleClickAction).not.toHaveBeenCalled();
  });

  it("does not count pan ends as taps (two flicks ending near the same point must not toggle zoom)", () => {
    const setNow = mockNow(1000);
    const host = createHost();
    const { canvas } = createController(host);

    firePointer(canvas, "pointerdown", 100, 300, 1);
    firePointer(canvas, "pointermove", 100, 180, 1);
    firePointer(canvas, "pointerup", 100, 105, 1);
    setNow(1150);
    firePointer(canvas, "pointerdown", 98, 320, 1);
    firePointer(canvas, "pointermove", 98, 200, 1);
    firePointer(canvas, "pointerup", 98, 102, 1);

    expect(host.panBy).toHaveBeenCalled();
    expect(host.performDoubleClickAction).not.toHaveBeenCalled();
  });

  it("still fires on a genuine double-tap right after a pinch gesture", () => {
    const setNow = mockNow(1000);
    const host = createHost();
    const { canvas } = createController(host);

    firePointer(canvas, "pointerdown", 100, 100, 1);
    firePointer(canvas, "pointerdown", 200, 100, 2);
    firePointer(canvas, "pointermove", 220, 100, 2);
    firePointer(canvas, "pointerup", 100, 100, 1);
    firePointer(canvas, "pointerup", 220, 100, 2);

    // gestureHadPinch 在捏合手势结束时复位：随后的两次干净 tap 照常合成双击
    setNow(1100);
    firePointer(canvas, "pointerdown", 150, 100, 1);
    firePointer(canvas, "pointerup", 150, 100, 1);
    setNow(1250);
    firePointer(canvas, "pointerdown", 152, 101, 1);
    firePointer(canvas, "pointerup", 152, 101, 1);

    expect(host.performDoubleClickAction).toHaveBeenCalledTimes(1);
    expect(host.performDoubleClickAction).toHaveBeenCalledWith(152, 101);
  });
});
