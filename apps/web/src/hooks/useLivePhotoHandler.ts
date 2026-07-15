import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isMobileDevice } from "~/lib/device-viewport";
import type { ImageLoaderManager } from "~/lib/image-loader-manager";
import type { VideoSource } from "~/lib/image-loading-types";
import { useAfilmoryRuntime } from "~/runtime/app-runtime";
import type { PhotoManifest } from "~/types/photo";

import { useStableVideoSource } from "./useStableVideoSource";

interface UseLivePhotoHandlerProps {
  data: PhotoManifest;
  imageLoaded: boolean;
}

const LIVE_PHOTO_HOVER_DWELL_MS = 200;
const MAX_CONCURRENT_GRID_VIDEO_LOADS = 2;
let activeGridVideoLoads = 0;
const queuedGridVideoLoads: Array<() => void> = [];

function acquireGridVideoLoadSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let released = false;
    let started = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener("abort", handleAbort);
      activeGridVideoLoads = Math.max(0, activeGridVideoLoads - 1);
      queuedGridVideoLoads.shift()?.();
    };
    const start = () => {
      if (signal.aborted) {
        reject(createAbortLikeError());
        queuedGridVideoLoads.shift()?.();
        return;
      }
      started = true;
      activeGridVideoLoads += 1;
      resolve(release);
    };
    const handleAbort = () => {
      if (started) {
        release();
        return;
      }
      const index = queuedGridVideoLoads.indexOf(start);
      if (index !== -1) queuedGridVideoLoads.splice(index, 1);
      reject(createAbortLikeError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    if (activeGridVideoLoads < MAX_CONCURRENT_GRID_VIDEO_LOADS) start();
    else queuedGridVideoLoads.push(start);
  });
}

function createAbortLikeError(): Error {
  const error = new Error("Grid Live Photo load cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function resetVideoElement(videoElement: HTMLVideoElement | null): void {
  if (!videoElement) {
    return;
  }

  videoElement.pause();
  videoElement.removeAttribute("src");
  videoElement.load();
}

function toVideoSource(
  video: PhotoManifest["video"],
  originalUrl: string,
): VideoSource {
  switch (video?.type) {
    case "motion-photo": {
      return { ...video, imageUrl: originalUrl };
    }
    case "live-photo": {
      return { type: "live-photo", videoUrl: video.videoUrl };
    }
    default: {
      return { type: "none" };
    }
  }
}

export const useLivePhotoHandler = ({
  data,
  imageLoaded,
}: UseLivePhotoHandlerProps) => {
  const { id, video, originalUrl } = data;
  const runtime = useAfilmoryRuntime();
  const shouldReduceMotion = useReducedMotion() === true;
  const [isPlayingLivePhoto, setIsPlayingLivePhoto] = useState(false);
  const [livePhotoVideoLoaded, setLivePhotoVideoLoaded] = useState(false);
  const [isConvertingVideo, setIsConvertingVideo] = useState(false);
  const [videoConversionError, setVideoConversionError] =
    useState<unknown>(null);
  // Video bytes are multi-MB (motion photos range-fetch the original file), so
  // the grid only loads them once the user signals intent by hovering the
  // cell. Grid playback is hover-only, so touch devices never request them.
  const [videoLoadRequested, setVideoLoadRequested] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageLoaderManagerRef = useRef<ImageLoaderManager | null>(null);
  const loadedVideoKeyRef = useRef<string | null>(null);
  const isHoveringRef = useRef(false);
  const { videoSource, videoSourceKey } = useStableVideoSource(
    toVideoSource(video, originalUrl),
  );

  const hasVideo = videoSource.type !== "none";

  useEffect(() => {
    setIsPlayingLivePhoto(false);
    setLivePhotoVideoLoaded(false);
    setIsConvertingVideo(false);
    setVideoConversionError(null);
    setVideoLoadRequested(false);
    loadedVideoKeyRef.current = null;
    isHoveringRef.current = false;

    resetVideoElement(videoRef.current);
  }, [id]);

  const playLoadedVideo = useCallback(() => {
    if (!isHoveringRef.current || shouldReduceMotion) return;
    setIsPlayingLivePhoto(true);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      void video.play().catch((error: unknown) => {
        console.error("Failed to play masonry live photo video:", error);
        setIsPlayingLivePhoto(false);
      });
    }
  }, [shouldReduceMotion]);

  // Live Photo/Motion Photo video loading logic (deferred until hover intent)
  useEffect(() => {
    if (
      !videoLoadRequested ||
      videoSource.type === "none" ||
      !imageLoaded ||
      !videoRef.current ||
      loadedVideoKeyRef.current === videoSourceKey
    ) {
      return;
    }

    const videoEl = videoRef.current;

    let cancelled = false;
    const queueController = new AbortController();

    const loadVideo = async () => {
      setLivePhotoVideoLoaded(false);
      setIsConvertingVideo(true);
      let releaseSlot: (() => void) | null = null;

      try {
        releaseSlot = await acquireGridVideoLoadSlot(queueController.signal);
        if (cancelled) return;
        const imageLoaderManager = runtime.imageLoading.createLoader();
        imageLoaderManagerRef.current = imageLoaderManager;
        await imageLoaderManager.processVideo(videoSource, videoEl);
        if (!cancelled) {
          loadedVideoKeyRef.current = videoSourceKey;
          setLivePhotoVideoLoaded(true);
          // The load was hover-initiated; if the pointer is still on the
          // cell, start playback now instead of requiring a second hover.
          if (isHoveringRef.current) {
            playLoadedVideo();
          }
        }
      } catch (videoError) {
        if (!cancelled && !isAbortLikeError(videoError)) {
          console.error("Failed to process video:", videoError);
          setVideoConversionError(videoError);
        }
      } finally {
        releaseSlot?.();
        if (!cancelled) {
          setIsConvertingVideo(false);
        }
      }
    };

    void loadVideo();

    return () => {
      cancelled = true;
      queueController.abort();
      if (imageLoaderManagerRef.current) {
        runtime.imageLoading.cleanupLoader(imageLoaderManagerRef.current);
        imageLoaderManagerRef.current = null;
      }
      resetVideoElement(videoEl);
    };
  }, [
    videoLoadRequested,
    videoSource,
    videoSourceKey,
    imageLoaded,
    runtime.imageLoading,
    playLoadedVideo,
  ]);

  // Live Photo/Motion Photo hover handling (desktop only)
  const handleMouseEnter = useCallback(() => {
    if (isMobileDevice || !hasVideo || shouldReduceMotion) {
      return;
    }

    isHoveringRef.current = true;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      if (!isHoveringRef.current) return;
      if (livePhotoVideoLoaded && !isPlayingLivePhoto && !isConvertingVideo) {
        playLoadedVideo();
      } else {
        setVideoLoadRequested(true);
      }
    }, LIVE_PHOTO_HOVER_DWELL_MS);
  }, [
    hasVideo,
    shouldReduceMotion,
    livePhotoVideoLoaded,
    isPlayingLivePhoto,
    isConvertingVideo,
    playLoadedVideo,
  ]);

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (isPlayingLivePhoto) {
      setIsPlayingLivePhoto(false);
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
    }

    // Leaving before readiness is an explicit cancellation signal. This also
    // removes queued work before a loader is created, so a quick pointer sweep
    // cannot build up a tail of multi-megabyte requests.
    if (!livePhotoVideoLoaded) {
      setVideoLoadRequested(false);
      setIsConvertingVideo(false);
    }
  }, [isPlayingLivePhoto, livePhotoVideoLoaded]);

  const handleVideoEnded = useCallback(() => {
    setIsPlayingLivePhoto(false);
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    const currentVideoElement = videoRef.current;

    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      if (imageLoaderManagerRef.current) {
        runtime.imageLoading.cleanupLoader(imageLoaderManagerRef.current);
        imageLoaderManagerRef.current = null;
      }

      loadedVideoKeyRef.current = null;
      resetVideoElement(currentVideoElement);
    };
  }, [runtime.imageLoading]);

  return {
    videoRef,
    hasVideo,
    isPlayingLivePhoto,
    isConvertingVideo,
    videoConversionError,
    handleMouseEnter,
    handleMouseLeave,
    handleVideoEnded,
  };
};
