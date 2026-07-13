import { useEffect } from "react";

interface IsolationSnapshot {
  bodyOverflow: string;
  main: HTMLElement | null;
  mainAriaHidden: string | null;
  mainHadInertAttribute: boolean;
  mainInert: boolean;
  mainInertAttribute: string | null;
}

let isolationCount = 0;
let isolationSnapshot: IsolationSnapshot | null = null;

const readInert = (element: HTMLElement): boolean => element.inert;

const writeInert = (element: HTMLElement, value: boolean): void => {
  element.inert = value;
  if (value) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }
};

/**
 * Hides the gallery from assistive technology and prevents background scroll
 * while one or more app-level modals are open. The module-level reference
 * count keeps nested and transitioning modals from unlocking each other.
 */
export const acquireModalIsolation = (): (() => void) => {
  if (typeof document === "undefined") {
    return () => {};
  }

  if (isolationCount === 0) {
    const main = document.querySelector<HTMLElement>("#main-content");
    isolationSnapshot = {
      bodyOverflow: document.body.style.overflow,
      main,
      mainAriaHidden: main?.getAttribute("aria-hidden") ?? null,
      mainHadInertAttribute: main?.hasAttribute("inert") ?? false,
      mainInert: main ? readInert(main) : false,
      mainInertAttribute: main?.getAttribute("inert") ?? null,
    };

    document.body.style.overflow = "hidden";
    if (main) {
      writeInert(main, true);
      main.setAttribute("aria-hidden", "true");
    }
  }

  isolationCount += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    isolationCount = Math.max(0, isolationCount - 1);
    if (isolationCount > 0 || !isolationSnapshot) return;

    const snapshot = isolationSnapshot;
    isolationSnapshot = null;
    document.body.style.overflow = snapshot.bodyOverflow;

    if (!snapshot.main?.isConnected) return;

    writeInert(snapshot.main, snapshot.mainInert);
    if (snapshot.mainHadInertAttribute) {
      snapshot.main.setAttribute("inert", snapshot.mainInertAttribute ?? "");
    }

    if (snapshot.mainAriaHidden === null) {
      snapshot.main.removeAttribute("aria-hidden");
    } else {
      snapshot.main.setAttribute("aria-hidden", snapshot.mainAriaHidden);
    }
  };
};

export const useModalIsolation = (isOpen: boolean): void => {
  useEffect(() => {
    if (!isOpen) return;
    return acquireModalIsolation();
  }, [isOpen]);
};
