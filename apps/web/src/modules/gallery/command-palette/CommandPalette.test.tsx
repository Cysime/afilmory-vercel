import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";

// jsdom 没有 scrollIntoView（选中项滚动效果会触发）
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

let isMobile = false;

vi.mock("@afilmory/ui", () => ({
  clsxm: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en",
      getResource: () => null,
      services: {
        interpolator: { interpolate: (template: string) => template },
      },
    },
  }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("~/hooks/useMobile", () => ({
  useMobile: () => isMobile,
}));

vi.mock("~/hooks/usePanelDragDismiss", () => ({
  usePanelDragDismiss: () => ({
    offset: 0,
    isDragging: false,
    handleRef: () => {},
  }),
}));

vi.mock("~/hooks/usePhotoViewer", () => ({
  getViewerPhotos: () => [],
  getViewerSourceMode: () => "all",
  useOpenPhotoViewer: () => vi.fn(),
}));

vi.mock("~/runtime/app-runtime", () => ({
  useAfilmoryRuntime: () => ({}),
  usePhotoRepository: () => ({
    getAllTags: () => [],
    getAllCameras: () => [],
    getAllLenses: () => [],
    getPhotos: () => [],
  }),
}));

vi.mock("~/components/ui/ThumbnailImage", () => ({
  ThumbnailImage: () => null,
}));

vi.mock("~/modules/gallery/panels/FilterPanel", () => ({
  FilterPanel: () => (
    <button type="button" data-testid="filter-panel-button">
      filter
    </button>
  ),
}));

describe("CommandPalette", () => {
  let store: ReturnType<typeof createStore>;

  const renderPalette = (props: { isOpen: boolean; onClose: () => void }) =>
    render(<CommandPalette {...props} />, {
      wrapper: ({ children }: PropsWithChildren) => (
        <Provider store={store}>{children}</Provider>
      ),
    });

  beforeEach(() => {
    isMobile = false;
    store = createStore();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exposes modal dialog semantics on the palette panel", () => {
    const { getByRole } = renderPalette({ isOpen: true, onClose: vi.fn() });

    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe(
      "action.search.unified.title",
    );
  });

  it("autofocuses the search input on desktop", async () => {
    const { getByPlaceholderText } = renderPalette({
      isOpen: true,
      onClose: vi.fn(),
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        getByPlaceholderText("action.search.placeholder"),
      );
    });
  });

  it("moves focus onto the panel itself on mobile (no virtual keyboard pop)", () => {
    isMobile = true;

    const { getByRole } = renderPalette({ isOpen: true, onClose: vi.fn() });

    expect(document.activeElement).toBe(getByRole("dialog"));
  });

  it("wraps Tab from the last focusable element back to the first", () => {
    const { getByRole, getByTestId } = renderPalette({
      isOpen: true,
      onClose: vi.fn(),
    });

    const lastFocusable = getByTestId("filter-panel-button");
    lastFocusable.focus();
    fireEvent.keyDown(lastFocusable, { key: "Tab" });

    expect(document.activeElement).toBe(
      getByRole("button", { name: "action.search.reset" }),
    );
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    const { getByRole, getByTestId } = renderPalette({
      isOpen: true,
      onClose: vi.fn(),
    });

    const firstFocusable = getByRole("button", {
      name: "action.search.reset",
    });
    firstFocusable.focus();
    fireEvent.keyDown(firstFocusable, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(getByTestId("filter-panel-button"));
  });

  it("restores focus to the previously focused element on close", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    const view = renderPalette({ isOpen: true, onClose: vi.fn() });
    view.rerender(<CommandPalette isOpen={false} onClose={vi.fn()} />);

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
