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
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  const startPlayTimer = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      setIsPlayingLivePhoto(true);
      const video = videoRef.current;
      if (video) {
        video.currentTime = 0;
        void video.play().catch((error: unknown) => {
          console.error("Failed to play masonry live photo video:", error);
          setIsPlayingLivePhoto(false);
        });
      }
    }, 200);
  }, []);

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

    const loadVideo = async () => {
      setLivePhotoVideoLoaded(false);
      setIsConvertingVideo(true);

      const imageLoaderManager = runtime.imageLoading.createLoader();
      imageLoaderManagerRef.current = imageLoaderManager;

      try {
        await imageLoaderManager.processVideo(videoSource, videoEl);
        if (!cancelled) {
          loadedVideoKeyRef.current = videoSourceKey;
          setLivePhotoVideoLoaded(true);
          // The load was hover-initiated; if the pointer is still on the
          // cell, start playback now instead of requiring a second hover.
          if (isHoveringRef.current) {
            startPlayTimer();
          }
        }
      } catch (videoError) {
        if (!cancelled && !isAbortLikeError(videoError)) {
          console.error("Failed to process video:", videoError);
          setVideoConversionError(videoError);
        }
      } finally {
        if (!cancelled) {
          setIsConvertingVideo(false);
        }
      }
    };

    void loadVideo();

    return () => {
      cancelled = true;
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
    startPlayTimer,
  ]);

  // Live Photo/Motion Photo hover handling (desktop only)
  const handleMouseEnter = useCallback(() => {
    if (isMobileDevice || !hasVideo) {
      return;
    }

    isHoveringRef.current = true;
    setVideoLoadRequested(true);

    if (!livePhotoVideoLoaded || isPlayingLivePhoto || isConvertingVideo) {
      return;
    }

    startPlayTimer();
  }, [
    hasVideo,
    livePhotoVideoLoaded,
    isPlayingLivePhoto,
    isConvertingVideo,
    startPlayTimer,
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
  }, [isPlayingLivePhoto]);

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
