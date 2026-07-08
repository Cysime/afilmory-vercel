import { useAtomValue } from "jotai";

import { isMobileAtom, isMobileWidth } from "~/atoms/viewport";

export const useMobile = () => useAtomValue(isMobileAtom);

export const isMobile = () =>
  typeof window !== "undefined" && isMobileWidth(window.innerWidth);
