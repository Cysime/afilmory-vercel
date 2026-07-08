import type { PhotoManifestItem } from "@afilmory/schema";
import { createManifest } from "@afilmory/schema";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GallerySetting } from "~/atoms/app";
import { gallerySettingAtom } from "~/atoms/app";
import {
  filterAndSortPhotos,
  getFilteredPhotos,
  getViewerPhotos,
  getViewerSourceMode,
  useOpenPhotoViewer,
  usePhotoViewer,
  usePhotoViewerBodyScrollLock,
  useViewerPhotos,
} from "~/hooks/usePhotoViewer";
import type { AppRuntime } from "~/runtime/app-runtime";
import { createAppRuntime } from "~/runtime/app-runtime";
import { AfilmoryRuntimeProvider } from "~/runtime/app-runtime-provider";

const defaultGallerySetting: GallerySetting = {
  sortOrder: "desc",
  selectedTags: [],
  selectedCameras: [],
  selectedLenses: [],
  selectedGeoCountries: [],
  selectedGeoRegions: [],
  selectedGeoCities: [],
  selectedGeoDistricts: [],
};

const createPhoto = (
  overrides: Partial<PhotoManifestItem>,
): PhotoManifestItem => ({
  id: "photo",
  title: "photo",
  dateTaken: "2026-04-12T00:00:00.000Z",
  tags: [],
  description: "",
  originalUrl: "/photos/photo.jpg",
  thumbnailUrl: "/thumbnails/photo.jpg",
  thumbHash: null,
  width: 1000,
  height: 800,
  aspectRatio: 1.25,
  s3Key: "photo.jpg",
  lastModified: "2026-04-12T00:00:00.000Z",
  size: 1024,
  exif: null,
  toneAnalysis: null,
  location: null,
  ...overrides,
});

const manifest = createManifest({
  photos: [
    createPhoto({
      id: "visible-photo",
      title: "Visible Photo",
      dateTaken: "2026-04-12T00:00:00.000Z",
      s3Key: "visible-photo.jpg",
      originalUrl: "/photos/visible-photo.jpg",
      thumbnailUrl: "/thumbnails/visible-photo.jpg",
      tags: ["keep"],
    }),
    createPhoto({
      id: "hidden-photo",
      title: "Hidden Photo",
      dateTaken: "2026-04-11T00:00:00.000Z",
      lastModified: "2026-04-11T00:00:00.000Z",
      s3Key: "hidden-photo.jpg",
      originalUrl: "/photos/hidden-photo.jpg",
      thumbnailUrl: "/thumbnails/hidden-photo.jpg",
      tags: ["other"],
    }),
  ],
});

let runtime: AppRuntime;

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    AfilmoryRuntimeProvider,
    { runtime },
    React.createElement(Provider, { store: runtime.store }, children),
  );

describe("viewer photo resolution", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  beforeEach(() => {
    runtime = createAppRuntime({ manifest });
    runtime.store.set(gallerySettingAtom, defaultGallerySetting);

    const { result, unmount } = renderHook(() => usePhotoViewer(), { wrapper });
    act(() => {
      result.current.closeViewer();
    });
    unmount();
  });

  it("memoizes filterAndSortPhotos on (photos, setting) reference identity", () => {
    const photos = [
      createPhoto({ id: "a", tags: ["keep"] }),
      createPhoto({ id: "b", tags: ["other"] }),
    ];
    const setting = { ...defaultGallerySetting, selectedTags: ["keep"] };

    const first = filterAndSortPhotos(photos, setting);
    const second = filterAndSortPhotos(photos, setting);

    // 同引用重复调用必须返回同一个结果数组（引用相等）
    expect(second).toBe(first);
    expect(first.map((photo) => photo.id)).toEqual(["a"]);

    // setting 引用变化（即使内容相同）要重算
    const recomputed = filterAndSortPhotos(photos, { ...setting });
    expect(recomputed).not.toBe(first);
    expect(recomputed.map((photo) => photo.id)).toEqual(["a"]);

    // photos 引用变化也要重算
    const otherPhotos = [...photos];
    const recomputedForPhotos = filterAndSortPhotos(otherPhotos, setting);
    expect(recomputedForPhotos).not.toBe(first);
    expect(recomputedForPhotos.map((photo) => photo.id)).toEqual(["a"]);
  });

  it("sorts mixed raw-EXIF and ISO dated photos chronologically", () => {
    // 旧实现按原始日期串 localeCompare：EXIF 的 ':' 比 ISO 的 '-' 大，
    // 三月的 EXIF 照片会被排到六月的 ISO 照片之后。
    const exifMarch = createPhoto({
      id: "exif-march",
      exif: { DateTimeOriginal: "2026:03:15 14:30:00" },
      lastModified: "2026-01-01T00:00:00.000Z",
    });
    const isoFeb = createPhoto({
      id: "iso-feb",
      lastModified: "2026-02-01T12:00:00.000Z",
    });
    const isoJune = createPhoto({
      id: "iso-june",
      lastModified: "2026-06-01T12:00:00.000Z",
    });

    expect(
      filterAndSortPhotos(
        [isoFeb, isoJune, exifMarch],
        defaultGallerySetting,
      ).map((photo) => photo.id),
    ).toEqual(["iso-june", "exif-march", "iso-feb"]);

    expect(
      filterAndSortPhotos([exifMarch, isoJune, isoFeb], {
        ...defaultGallerySetting,
        sortOrder: "asc",
      }).map((photo) => photo.id),
    ).toEqual(["iso-feb", "exif-march", "iso-june"]);
  });

  it("returns referentially equal results across getFilteredPhotos calls with stable runtime state", () => {
    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      selectedTags: ["keep"],
    });

    // layout.tsx 在同一个 effect 里连续调用 getViewerPhotos/getViewerSourceMode，
    // 两次内部的 getFilteredPhotos 应命中备忘、返回同一数组
    expect(getFilteredPhotos(runtime)).toBe(getFilteredPhotos(runtime));

    runtime.store.set(gallerySettingAtom, { ...defaultGallerySetting });
    const afterSettingChange = getFilteredPhotos(runtime);
    expect(afterSettingChange.map((photo) => photo.id)).toEqual([
      "visible-photo",
      "hidden-photo",
    ]);
  });

  it("keeps the filtered viewer set when the requested photo is still visible", () => {
    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      selectedTags: ["keep"],
    });

    const filteredPhotos = getFilteredPhotos(runtime);
    const viewerPhotos = getViewerPhotos(runtime, "visible-photo");

    expect(filteredPhotos.map((photo) => photo.id)).toEqual(["visible-photo"]);
    expect(viewerPhotos.map((photo) => photo.id)).toEqual(["visible-photo"]);
  });

  it("uses OR within a filter group and AND across filter groups", () => {
    const photos = [
      createPhoto({
        id: "sony-street",
        tags: ["street"],
        exif: { Make: "SONY", Model: "A7C" },
      }),
      createPhoto({
        id: "sony-night",
        tags: ["night"],
        exif: { Make: "SONY", Model: "A7C" },
      }),
      createPhoto({
        id: "fuji-night",
        tags: ["night"],
        exif: { Make: "FUJIFILM", Model: "X-T5" },
      }),
    ];

    expect(
      filterAndSortPhotos(photos, {
        ...defaultGallerySetting,
        selectedTags: ["street", "night"],
        selectedCameras: ["SONY A7C"],
      }).map((photo) => photo.id),
    ).toEqual(["sony-street", "sony-night"]);
  });

  it("falls back to the full photo set when the requested photo is excluded by filters", () => {
    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      selectedTags: ["keep"],
    });

    const filteredPhotos = getFilteredPhotos(runtime);
    const viewerPhotos = getViewerPhotos(runtime, "hidden-photo");

    expect(filteredPhotos.map((photo) => photo.id)).toEqual(["visible-photo"]);
    expect(viewerPhotos.map((photo) => photo.id)).toEqual([
      "visible-photo",
      "hidden-photo",
    ]);
    expect(viewerPhotos.findIndex((photo) => photo.id === "hidden-photo")).toBe(
      1,
    );
  });

  it("preserves the active sort order when falling back to the full photo set", () => {
    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      sortOrder: "asc",
      selectedTags: ["keep"],
    });

    const viewerPhotos = getViewerPhotos(runtime, "hidden-photo");

    expect(viewerPhotos.map((photo) => photo.id)).toEqual([
      "hidden-photo",
      "visible-photo",
    ]);
    expect(viewerPhotos.findIndex((photo) => photo.id === "hidden-photo")).toBe(
      0,
    );
  });

  it("keeps goToIndex bounded by the active viewer photo count", () => {
    const { result } = renderHook(() => usePhotoViewer(1), { wrapper });

    act(() => {
      result.current.openViewer(0, { sourceMode: "filtered" });
      result.current.goToIndex(1);
    });

    expect(result.current.currentIndex).toBe(0);
  });

  it("keeps an all-photos viewer session stable after navigating to a visible filtered photo", async () => {
    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      selectedTags: ["keep"],
    });

    const { result, rerender } = renderHook(
      ({ photoId }) => {
        const photos = useViewerPhotos(photoId);
        const viewer = usePhotoViewer(photos.length);
        return { photos, viewer };
      },
      { initialProps: { photoId: "hidden-photo" as string | null }, wrapper },
    );

    act(() => {
      result.current.viewer.openViewer(1, {
        sourceMode: getViewerSourceMode(runtime, "hidden-photo"),
      });
    });

    rerender({ photoId: "visible-photo" });
    expect(result.current.photos.map((photo) => photo.id)).toEqual([
      "visible-photo",
      "hidden-photo",
    ]);
    expect(result.current.viewer.viewerSourceMode).toBe("all");

    act(() => {
      result.current.viewer.closeViewer();
    });

    rerender({ photoId: "visible-photo" });
    await waitFor(() => {
      expect(result.current.photos.map((photo) => photo.id)).toEqual([
        "visible-photo",
      ]);
      expect(result.current.viewer.viewerSourceMode).toBeNull();
    });
  });

  it("falls back to all photos when a filtered viewer session loses the active photo", () => {
    const { result: viewerResult } = renderHook(() => usePhotoViewer(), {
      wrapper,
    });
    const { result, rerender } = renderHook(
      ({ photoId }) => useViewerPhotos(photoId),
      {
        initialProps: { photoId: "hidden-photo" as string | null },
        wrapper,
      },
    );

    act(() => {
      viewerResult.current.openViewer(1, { sourceMode: "filtered" });
    });

    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      selectedTags: ["keep"],
    });

    rerender({ photoId: "hidden-photo" });
    expect(result.current.map((photo) => photo.id)).toEqual([
      "visible-photo",
      "hidden-photo",
    ]);
  });

  it("keeps goToIndex bounded by the filtered viewer count when no explicit photoCount is provided", () => {
    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      selectedTags: ["keep"],
    });

    const { result } = renderHook(() => usePhotoViewer(), { wrapper });

    act(() => {
      result.current.openViewer(0, { sourceMode: "filtered" });
      result.current.goToIndex(1);
    });

    expect(result.current.currentIndex).toBe(0);
  });

  it("keeps a filtered viewer session on its opened photo ids even if filters momentarily clear", () => {
    runtime.store.set(gallerySettingAtom, {
      ...defaultGallerySetting,
      selectedTags: ["keep"],
    });

    const { result, rerender } = renderHook(
      ({ photoId }) => useViewerPhotos(photoId),
      {
        initialProps: { photoId: "visible-photo" as string | null },
        wrapper,
      },
    );
    const { result: viewerResult } = renderHook(() => usePhotoViewer(), {
      wrapper,
    });

    act(() => {
      viewerResult.current.openViewer(0, {
        sourceMode: "filtered",
        sourcePhotoIds: ["visible-photo"],
      });
    });

    runtime.store.set(gallerySettingAtom, defaultGallerySetting);
    rerender({ photoId: "visible-photo" });

    expect(result.current.map((photo) => photo.id)).toEqual(["visible-photo"]);
  });

  it("restores the previous body overflow when the viewer closes or unmounts", async () => {
    document.body.style.overflow = "clip";

    const { result, unmount } = renderHook(
      () => {
        usePhotoViewerBodyScrollLock();
        return usePhotoViewer();
      },
      { wrapper },
    );

    act(() => {
      result.current.openViewer(0);
    });

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("hidden");
    });

    act(() => {
      result.current.closeViewer();
    });

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("clip");
    });

    act(() => {
      result.current.openViewer(0);
    });

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("hidden");
    });

    unmount();

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("clip");
    });
    document.body.style.overflow = "";
  });

  it("keeps body scroll locking outside action-only viewer consumers", async () => {
    document.body.style.overflow = "clip";

    const { result: openViewerResult } = renderHook(
      () => useOpenPhotoViewer(),
      {
        wrapper,
      },
    );

    act(() => {
      openViewerResult.current(0);
    });

    expect(document.body.style.overflow).toBe("clip");

    const { unmount: unmountScrollLock } = renderHook(
      () => usePhotoViewerBodyScrollLock(),
      { wrapper },
    );

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("hidden");
    });

    unmountScrollLock();

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("clip");
    });

    const { result: viewerResult } = renderHook(() => usePhotoViewer(), {
      wrapper,
    });
    act(() => {
      viewerResult.current.closeViewer();
    });
    document.body.style.overflow = "";
  });
});
