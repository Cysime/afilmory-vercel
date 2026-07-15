import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { afterEach, describe, expect, it, vi } from "vitest";

import { galleryColumnsAtom, galleryMobileColumnsAtom } from "~/atoms/app";
import { viewportAtom } from "~/atoms/viewport";
import { getStorageNS } from "~/lib/ns";

import { ColumnsPanel } from "../panels/ColumnsPanel";

vi.mock("@afilmory/ui", () => ({
  clsxm: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      (
        ({
          "action.auto": "Auto",
          "action.columns.setting": "Column Settings",
          "slider.columns": `${options?.count} columns`,
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

const desktopStorageKey = getStorageNS("gallery-columns:v1");
const mobileStorageKey = getStorageNS("gallery-columns-mobile:v1");

describe("ColumnsPanel", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const renderPanel = (store = createStore()) => ({
    store,
    ...render(
      <Provider store={store}>
        <ColumnsPanel />
      </Provider>,
    ),
  });

  it("synchronizes its drag preview after the stored preference hydrates", async () => {
    localStorage.setItem(desktopStorageKey, JSON.stringify(6));
    renderPanel();

    await waitFor(() =>
      expect(
        screen
          .getByRole("slider", { name: "Column Settings" })
          .getAttribute("aria-valuenow"),
      ).toBe("6"),
    );
  });

  it("falls back to auto for an invalid persisted value", async () => {
    localStorage.setItem(desktopStorageKey, JSON.stringify("corrupt"));
    renderPanel();

    await waitFor(() =>
      expect(
        screen
          .getByRole("slider", { name: "Column Settings" })
          .getAttribute("aria-valuetext"),
      ).toBe("Auto"),
    );
  });

  it("keeps desktop and mobile preferences independent across breakpoints", async () => {
    localStorage.setItem(desktopStorageKey, JSON.stringify(8));
    localStorage.setItem(mobileStorageKey, JSON.stringify(5));
    const store = createStore();
    store.set(viewportAtom, { w: 1280, h: 800 });
    renderPanel(store);

    const slider = () =>
      screen.getByRole("slider", { name: "Column Settings" });
    await waitFor(() =>
      expect(slider().getAttribute("aria-valuenow")).toBe("8"),
    );
    expect(slider().getAttribute("aria-valuemax")).toBe("8");

    store.set(viewportAtom, { w: 390, h: 844 });
    await waitFor(() =>
      expect(slider().getAttribute("aria-valuenow")).toBe("5"),
    );
    expect(slider().getAttribute("aria-valuemax")).toBe("5");

    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    await waitFor(() => expect(store.get(galleryMobileColumnsAtom)).toBe(4));
    expect(store.get(galleryColumnsAtom)).toBe(8);

    store.set(viewportAtom, { w: 1280, h: 800 });
    await waitFor(() =>
      expect(slider().getAttribute("aria-valuenow")).toBe("8"),
    );
    expect(localStorage.getItem(desktopStorageKey)).toBe("8");
  });
});
