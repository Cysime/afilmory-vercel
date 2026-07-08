import { createManifest } from "@afilmory/schema";
import { act, render } from "@testing-library/react";
import { Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePhotoViewer } from "../hooks/usePhotoViewer";
import { Component } from "../pages/(main)/layout";
import type { AppRuntime } from "../runtime/app-runtime";
import { createAppRuntime } from "../runtime/app-runtime";
import { AfilmoryRuntimeProvider } from "../runtime/app-runtime-provider";

const masonryRenders = vi.fn();

vi.mock("@afilmory/ui", () => ({
  ScrollArea: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ScrollElementContext: ({
    children,
  }: PropsWithChildren<{ value: HTMLElement | null }>) => <>{children}</>,
}));

vi.mock("react-router", () => ({
  Outlet: () => null,
  useLocation: () => ({
    pathname: "/",
    search: "",
    hash: "",
    state: null,
    key: "root",
  }),
  useNavigate: () => vi.fn(),
  useNavigationType: () => "PUSH",
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("~/config", () => ({
  siteConfig: {
    accentColor: "",
  },
}));

vi.mock("~/modules/gallery/MasonryRoot", () => ({
  MasonryRoot: () => {
    masonryRenders();
    return <div>masonry</div>;
  },
}));

vi.mock("~/providers/photos-provider", () => ({
  PhotosProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));

// 探针与布局同挂在一个 Provider 下，用真实原子驱动查看器状态。
let viewer: ReturnType<typeof usePhotoViewer>;
const ViewerProbe = () => {
  viewer = usePhotoViewer();
  return null;
};

describe("main layout render isolation", () => {
  let runtime: AppRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = createAppRuntime({ manifest: createManifest({ photos: [] }) });
  });

  const renderLayout = () =>
    render(
      <AfilmoryRuntimeProvider runtime={runtime}>
        <Provider store={runtime.store}>
          <Component />
          <ViewerProbe />
        </Provider>
      </AfilmoryRuntimeProvider>,
    );

  it("re-renders the gallery tree on viewer open but not on swipes", () => {
    renderLayout();
    const rendersAfterMount = masonryRenders.mock.calls.length;
    expect(rendersAfterMount).toBeGreaterThan(0);

    // 打开查看器改变 openAtom：布局要重渲染以隐藏图库
    act(() => {
      viewer.openViewer(0, { sourcePhotoIds: ["a", "b", "c"] });
    });
    const rendersAfterOpen = masonryRenders.mock.calls.length;
    expect(rendersAfterOpen).toBeGreaterThan(rendersAfterMount);

    // 滑动换图只改 currentIndexAtom：布局（及整棵 masonry 树）不得重渲染
    act(() => {
      viewer.goToIndex(1);
    });
    act(() => {
      viewer.goToIndex(2);
    });
    expect(masonryRenders.mock.calls.length).toBe(rendersAfterOpen);

    // 关闭查看器要恢复图库：布局重新渲染
    act(() => {
      viewer.closeViewer();
    });
    expect(masonryRenders.mock.calls.length).toBeGreaterThan(rendersAfterOpen);
  });
});
