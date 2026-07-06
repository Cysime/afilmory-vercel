import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

export interface PanelDragDismissOptions {
  /** false 时不挂监听（面板关闭、句柄未渲染时）。翻转会复位拖拽状态 */
  enabled: boolean;
  /** 松手时位移 ≥ threshold（px）→ 关闭 */
  onDismiss: () => void;
  /** 关闭距离阈值（px） */
  threshold: number;
}

export interface PanelDragDismissValues {
  /** 跟手位移（px，≥0），驱动面板 translateY */
  offset: number;
  /**
   * 拖拽中。用于关闭 CSS transition 实现跟手；松手后 offset 归零 + transition
   * 重新生效，即得弹回动画（不足阈值）——面板侧无需额外动画代码。
   */
  isDragging: boolean;
  /** 挂到拖拽句柄元素上（句柄需 touch-action:none，否则触摸拖动会被浏览器滚动抢走） */
  handleRef: RefObject<HTMLDivElement | null>;
}

/**
 * 底部面板（sheet）「下拉关闭」手势，统一 Pointer Events 一套覆盖鼠标 / 触摸 / 触控笔
 * （取代旧的 Pointer + mouse 兜底 + touch 兜底三路并挂、靠 dragInputRef 互斥的写法）。
 *
 * 按下即认领（无方向死区——句柄是专职拖拽区，不与滚动/横滑争夺），setPointerCapture
 * 保证移出句柄/窗口后 move/up 仍投递；跟手期间 offset 随指针（向上钳制为 0），
 * 松手 ≥ threshold 则 onDismiss()，否则复位弹回。pointercancel 直接弹回、不判阈值。
 */
export function usePanelDragDismiss({
  enabled,
  onDismiss,
  threshold,
}: PanelDragDismissOptions): PanelDragDismissValues {
  const handleRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // 通过 ref 读最新的 onDismiss / threshold，避免每次变化都重挂监听
  const latestRef = useRef({ onDismiss, threshold });
  latestRef.current = { onDismiss, threshold };

  useEffect(() => {
    if (!enabled) return;
    const el = handleRef.current;
    if (!el) return;

    // 当前追踪的指针 id（null=空闲）。拖拽中出现第二根手指 → 忽略，首指针独占本次手势。
    let activePointerId: number | null = null;
    let startY = 0;
    let lastOffset = 0;

    const reset = () => {
      activePointerId = null;
      lastOffset = 0;
      setIsDragging(false);
      setOffset(0);
    };

    // shouldJudge=false（pointercancel / 捕获意外丢失以外的取消路径）：直接弹回不判阈值
    const end = (shouldJudge: boolean) => {
      const shouldDismiss =
        shouldJudge && lastOffset >= latestRef.current.threshold;
      reset();
      if (shouldDismiss) latestRef.current.onDismiss();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (activePointerId !== null) return; // 已在拖拽 → 第二根手指不接管
      if (e.pointerType === "mouse" && e.button !== 0) return; // 仅鼠标主键
      // 鼠标：阻止随下而来的文本选择/原生拖拽（等价旧 mousedown 路径的 preventDefault）
      if (e.pointerType === "mouse") e.preventDefault();
      activePointerId = e.pointerId;
      startY = e.clientY;
      lastOffset = 0;
      // 捕获指针：即便移出句柄乃至窗口外，move/up 仍投递到 el（取代旧的 window 监听兜底）
      el.setPointerCapture?.(e.pointerId);
      setIsDragging(true);
      setOffset(0);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return; // 忽略 hover / 第二指
      const next = Math.max(0, e.clientY - startY);
      lastOffset = next;
      setOffset(next);
      if (next > 0) e.preventDefault();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      if (el.hasPointerCapture?.(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      end(true);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      end(false);
    };

    // lostpointercapture 必须守 e.target === el：认领时 setPointerCapture 会从实际
    // 命中的后代（句柄里的把手横条）夺走隐式触摸捕获，令其触发 lostpointercapture 并
    // 冒泡至此——若不加 target 守卫，会把这次「夺取」误判为拖拽结束，导致移动端一按下
    // 即被弹回（同 useDismissGesture 的硬教训）。
    const onLostCapture = (e: PointerEvent) => {
      if (e.target !== el) return;
      if (e.pointerId !== activePointerId) return;
      end(true);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("lostpointercapture", onLostCapture);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("lostpointercapture", onLostCapture);
      // 关闭/卸载途中若仍在拖拽，复位状态，保证下次打开从干净起点开始
      reset();
    };
  }, [enabled]);

  return { offset, isDragging, handleRef };
}
