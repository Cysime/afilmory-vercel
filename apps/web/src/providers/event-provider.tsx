import { throttle } from "es-toolkit/compat";
import { useIsomorphicLayoutEffect } from "foxact/use-isomorphic-layout-effect";
import { useStore } from "jotai";
import type { FC } from "react";

import { isMobileWidth, viewportAtom } from "~/atoms/viewport";

export const EventProvider: FC = () => {
  const store = useStore();
  useIsomorphicLayoutEffect(() => {
    const readViewport = throttle(() => {
      const { innerWidth: w, innerHeight: h } = window;
      store.set(viewportAtom, { w, h });

      document.documentElement.dataset.viewport = isMobileWidth(w)
        ? "mobile"
        : "desktop";
    }, 16);

    readViewport();

    window.addEventListener("resize", readViewport);
    return () => {
      window.removeEventListener("resize", readViewport);
      readViewport.cancel();
    };
  }, []);

  return null;
};
