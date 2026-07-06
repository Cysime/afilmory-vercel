import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePanelDragDismiss } from "../usePanelDragDismiss";

// 统一 Pointer 路径：一个 firePointer 覆盖鼠标 / 触摸 / 触控笔。
// hook 内部走 setState，dispatch 需包在 act() 里刷新渲染。
function firePointer(
  el: EventTarget,
  type: string,
  y: number,
  {
    pointerId = 1,
    pointerType = "touch",
    button = 0,
  }: {
    pointerId?: number;
    pointerType?: string;
    button?: number;
  } = {},
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: y,
    pointerId,
    pointerType,
    isPrimary: true,
    button,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

const THRESHOLD = 72;

function setup(opts: { enabled?: boolean; threshold?: number } = {}) {
  const onDismiss = vi.fn();

  const Harness = () => {
    const { offset, isDragging, handleRef } = usePanelDragDismiss({
      enabled: opts.enabled ?? true,
      onDismiss,
      threshold: opts.threshold ?? THRESHOLD,
    });
    return (
      <div
        ref={handleRef}
        data-testid="handle"
        data-offset={offset}
        data-dragging={isDragging}
      >
        {/* 模拟真实句柄里的把手横条：触摸的隐式捕获落在它身上 */}
        <div data-testid="pill" />
      </div>
    );
  };

  const { getByTestId, unmount } = render(<Harness />);
  const el = getByTestId("handle");
  const pill = getByTestId("pill");
  const offset = () => Number(el.dataset.offset);
  const dragging = () => el.dataset.dragging === "true";
  return { el, pill, onDismiss, unmount, offset, dragging };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePanelDragDismiss", () => {
  it("按下即认领：isDragging=true、offset=0，并对句柄 setPointerCapture", () => {
    const setCapture = vi.spyOn(Element.prototype, "setPointerCapture");
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    expect(t.dragging()).toBe(true);
    expect(t.offset()).toBe(0);
    expect(setCapture).toHaveBeenCalledWith(1);
  });

  it("跟手：offset 随指针下移；上移钳制为 0", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 250);
    expect(t.offset()).toBe(50);
    firePointer(t.el, "pointermove", 150); // 上移越过起点
    expect(t.offset()).toBe(0);
    firePointer(t.el, "pointermove", 230);
    expect(t.offset()).toBe(30);
  });

  it("不过阈值松手 → 弹回（offset 归零、isDragging=false），不关闭", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 200 + THRESHOLD - 1);
    firePointer(t.el, "pointerup", 200 + THRESHOLD - 1);
    expect(t.onDismiss).not.toHaveBeenCalled();
    expect(t.offset()).toBe(0);
    expect(t.dragging()).toBe(false);
  });

  it("过阈值松手 → onDismiss 恰好一次，状态复位", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 200 + THRESHOLD + 20);
    firePointer(t.el, "pointerup", 200 + THRESHOLD + 20);
    expect(t.onDismiss).toHaveBeenCalledTimes(1);
    expect(t.offset()).toBe(0);
    expect(t.dragging()).toBe(false);
  });

  it("恰好等于阈值 → 关闭（>= 判定）", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 200 + THRESHOLD);
    firePointer(t.el, "pointerup", 200 + THRESHOLD);
    expect(t.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("lostpointercapture 守卫：后代冒泡上来的捕获丢失不结束拖拽；el 自身丢失才收尾", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 260);
    expect(t.dragging()).toBe(true);

    // 认领时 setPointerCapture 从把手横条（实际命中目标）夺走隐式捕获，
    // 其 lostpointercapture 冒泡到句柄——不能被误判为拖拽结束（否则一按下即弹回）。
    firePointer(t.pill, "lostpointercapture", 260);
    expect(t.dragging()).toBe(true);
    expect(t.offset()).toBe(60);
    expect(t.onDismiss).not.toHaveBeenCalled();

    // el 自身丢失捕获（如元素被移除/系统夺走）→ 按当前位移收尾（60 < 72，弹回）
    firePointer(t.el, "lostpointercapture", 260);
    expect(t.dragging()).toBe(false);
    expect(t.offset()).toBe(0);
    expect(t.onDismiss).not.toHaveBeenCalled();
  });

  it("el 自身 lostpointercapture 时已过阈值 → 关闭", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 200 + THRESHOLD + 10);
    firePointer(t.el, "lostpointercapture", 200 + THRESHOLD + 10);
    expect(t.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("pointercancel → 直接弹回，即便已过阈值也不关闭", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 200 + THRESHOLD + 40);
    firePointer(t.el, "pointercancel", 200 + THRESHOLD + 40);
    expect(t.onDismiss).not.toHaveBeenCalled();
    expect(t.offset()).toBe(0);
    expect(t.dragging()).toBe(false);
  });

  it("拖拽中第二根手指按下 → 忽略，首指针独占手势", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 250);
    firePointer(t.el, "pointerdown", 300, { pointerId: 2 });
    firePointer(t.el, "pointermove", 400, { pointerId: 2 }); // 第二指移动不生效
    expect(t.offset()).toBe(50);
    firePointer(t.el, "pointerup", 400, { pointerId: 2 }); // 第二指抬起不收尾
    expect(t.dragging()).toBe(true);
    firePointer(t.el, "pointerup", 250); // 首指针收尾（50 < 72 → 弹回）
    expect(t.onDismiss).not.toHaveBeenCalled();
    expect(t.dragging()).toBe(false);
  });

  it("鼠标：主键拖过阈值 → 关闭；非主键按下不认领", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200, { pointerType: "mouse", button: 2 });
    expect(t.dragging()).toBe(false);

    firePointer(t.el, "pointerdown", 200, { pointerType: "mouse" });
    expect(t.dragging()).toBe(true);
    firePointer(t.el, "pointermove", 200 + THRESHOLD + 8, {
      pointerType: "mouse",
    });
    firePointer(t.el, "pointerup", 200 + THRESHOLD + 8, {
      pointerType: "mouse",
    });
    expect(t.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("鼠标按下 preventDefault（阻止文本选择）；触摸按下不 preventDefault", () => {
    const t = setup();
    const mouseDown = firePointer(t.el, "pointerdown", 200, {
      pointerType: "mouse",
    });
    expect(mouseDown.defaultPrevented).toBe(true);
    firePointer(t.el, "pointerup", 200, { pointerType: "mouse" });

    const touchDown = firePointer(t.el, "pointerdown", 200, { pointerId: 2 });
    expect(touchDown.defaultPrevented).toBe(false);
  });

  it("向下跟手时 pointermove 被 preventDefault；offset=0 时不阻止", () => {
    const t = setup();
    firePointer(t.el, "pointerdown", 200);
    const flat = firePointer(t.el, "pointermove", 200);
    expect(flat.defaultPrevented).toBe(false);
    const down = firePointer(t.el, "pointermove", 240);
    expect(down.defaultPrevented).toBe(true);
  });

  it("enabled=false → 完全不响应", () => {
    const t = setup({ enabled: false });
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 400);
    firePointer(t.el, "pointerup", 400);
    expect(t.dragging()).toBe(false);
    expect(t.offset()).toBe(0);
    expect(t.onDismiss).not.toHaveBeenCalled();
  });

  it("卸载后不再响应事件", () => {
    const t = setup();
    t.unmount();
    firePointer(t.el, "pointerdown", 200);
    firePointer(t.el, "pointermove", 400);
    firePointer(t.el, "pointerup", 400);
    expect(t.onDismiss).not.toHaveBeenCalled();
  });
});
