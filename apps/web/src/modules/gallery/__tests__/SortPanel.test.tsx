import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gallerySettingAtom } from "~/atoms/app";

import { SortPanel } from "../panels/SortPanel";

vi.mock("@afilmory/ui", () => ({
  clsxm: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          "action.sort.newest.first": "Newest first",
          "action.sort.oldest.first": "Oldest first",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

describe("SortPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const renderPanel = (store: ReturnType<typeof createStore>) =>
    render(
      <Provider store={store}>
        <SortPanel />
      </Provider>,
    );

  it("exposes the active sort order via aria-pressed (parity with FilterPanel chips)", () => {
    const store = createStore();
    renderPanel(store);

    expect(
      screen
        .getByRole("button", { name: "Newest first" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Oldest first" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("switches the sort order and flips aria-pressed on click", () => {
    const store = createStore();
    renderPanel(store);

    fireEvent.click(screen.getByRole("button", { name: "Oldest first" }));

    expect(store.get(gallerySettingAtom).sortOrder).toBe("asc");
    expect(
      screen
        .getByRole("button", { name: "Oldest first" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders a visible keyboard focus ring on each option (global CSS strips outlines)", () => {
    const store = createStore();
    renderPanel(store);

    for (const name of ["Newest first", "Oldest first"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("focus-visible:ring-2");
      expect(button.className).toContain("focus-visible:ring-accent/45");
      expect(button.className).toContain("focus-visible:ring-inset");
    }
  });
});
