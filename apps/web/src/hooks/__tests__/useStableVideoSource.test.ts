import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { VideoSource } from "~/lib/image-loading-types";
import { getVideoSourceKey } from "~/lib/image-loading-types";

import { useStableVideoSource } from "../useStableVideoSource";

describe("useStableVideoSource", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the same identity across re-renders with structurally equal sources", () => {
    const first: VideoSource = {
      type: "motion-photo",
      imageUrl: "https://example.com/photo.jpg",
      offset: 1024,
      size: 2048,
      presentationTimestamp: 500,
    };

    const { result, rerender } = renderHook(
      ({ source }: { source: VideoSource }) => useStableVideoSource(source),
      { initialProps: { source: first } },
    );

    expect(result.current.videoSource).toBe(first);
    expect(result.current.videoSourceKey).toBe(getVideoSourceKey(first));
    const initial = result.current;

    rerender({ source: { ...first } });

    expect(result.current).toBe(initial);
    expect(result.current.videoSource).toBe(first);
  });

  it("returns the new source when the key changes", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: VideoSource }) => useStableVideoSource(source),
      {
        initialProps: {
          source: {
            type: "live-photo",
            videoUrl: "https://example.com/a.mov",
          } satisfies VideoSource,
        },
      },
    );

    const next: VideoSource = {
      type: "live-photo",
      videoUrl: "https://example.com/b.mov",
    };
    rerender({ source: next });

    expect(result.current.videoSource).toBe(next);
    expect(result.current.videoSourceKey).toBe(getVideoSourceKey(next));
  });

  it("keeps the union discriminant intact for the none variant", () => {
    const { result } = renderHook(() => useStableVideoSource({ type: "none" }));

    expect(result.current.videoSource).toEqual({ type: "none" });
    expect(result.current.videoSourceKey).toBe("none");
  });
});
