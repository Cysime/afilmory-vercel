import { atom } from "jotai";

// 移动/桌面分界（Tailwind lg）的唯一事实来源：useMobile、
// EventProvider 的 dataset.viewport 都从这里取值。
export const MOBILE_BREAKPOINT = 1024;

export const isMobileWidth = (w: number) => w < MOBILE_BREAKPOINT && w !== 0;

export const viewportAtom = atom({
  w: typeof window !== "undefined" ? window.innerWidth : 0,
  h: typeof window !== "undefined" ? window.innerHeight : 0,
});

export const isMobileAtom = atom((get) => isMobileWidth(get(viewportAtom).w));
