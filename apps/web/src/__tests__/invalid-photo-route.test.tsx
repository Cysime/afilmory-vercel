import { createManifest } from "@afilmory/schema";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Component as MainLayout } from "../pages/(main)/layout";
import { Component as PhotoRoute } from "../pages/(main)/photos/[photoId]/index";
import type { AppRuntime } from "../runtime/app-runtime";
import { createAppRuntime } from "../runtime/app-runtime";
import { AfilmoryRuntimeProvider } from "../runtime/app-runtime-provider";

vi.mock("@afilmory/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@afilmory/ui")>();
  return {
    ...actual,
    ScrollArea: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ScrollElementContext: ({ children }: PropsWithChildren) => <>{children}</>,
  };
});

vi.mock("~/components/ui/photo-viewer", () => ({
  PhotoViewer: () => <div data-testid="photo-viewer" />,
}));

vi.mock("~/hooks/useMobile", () => ({
  useMobile: () => false,
}));

vi.mock("~/modules/gallery/MasonryRoot", () => ({
  MasonryRoot: () => <div data-testid="gallery">gallery</div>,
}));

vi.mock("~/providers/gallery-state-sync", () => ({
  GalleryStateSync: () => null,
}));

describe("invalid photo detail route", () => {
  let runtime: AppRuntime;

  beforeEach(() => {
    runtime = createAppRuntime({ manifest: createManifest({ photos: [] }) });
  });

  it("removes the gallery from layout and exposes only the not-found main content", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <MainLayout />,
          children: [
            {
              path: "photos/:photoId",
              element: <PhotoRoute />,
            },
          ],
        },
      ],
      { initialEntries: ["/photos/missing-photo"] },
    );

    const { container } = render(
      <AfilmoryRuntimeProvider runtime={runtime}>
        <Provider store={runtime.store}>
          <RouterProvider router={router} />
        </Provider>
      </AfilmoryRuntimeProvider>,
    );

    const galleryMain = container.querySelector<HTMLElement>("#main-content");
    expect(galleryMain).not.toBeNull();

    await waitFor(() => {
      expect(galleryMain?.getAttribute("aria-hidden")).toBe("true");
      expect(galleryMain?.hasAttribute("inert")).toBe(true);
      expect(galleryMain?.classList.contains("hidden")).toBe(true);
    });

    expect(screen.getByTestId("gallery").closest("main")).toBe(galleryMain);
    expect(
      screen
        .getByRole("main")
        .contains(screen.getByRole("heading", { level: 1 })),
    ).toBe(true);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/");
    expect(container.querySelector('a[href="#main-content"]')).toBeNull();
  });
});
