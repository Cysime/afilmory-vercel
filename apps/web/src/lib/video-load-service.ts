import { getI18n } from "~/i18n";
import { debugLog } from "~/lib/debug-log";
import type {
  LoadingCallbacks,
  VideoProcessResult,
  VideoSource,
} from "~/lib/image-loading-types";
import { createAbortError } from "~/lib/image-loading-types";
import { extractMotionPhotoVideo } from "~/lib/motion-photo-extractor";
import { needsVideoConversion, relabelMovAsMp4 } from "~/lib/video-converter";

export class VideoLoadService {
  private static readonly DEFAULT_READY_TIMEOUT_MS = 15_000;

  private pendingReject: ((reason?: unknown) => void) | null = null;
  private pendingCleanup: (() => void) | null = null;
  private currentAbortController: AbortController | null = null;
  private activeVideoElement: HTMLVideoElement | null = null;
  private ownedVideoUrl: string | null = null;

  constructor(
    private readonly readyTimeoutMs = VideoLoadService.DEFAULT_READY_TIMEOUT_MS,
  ) {}

  async processVideo(
    videoSource: VideoSource,
    videoElement: HTMLVideoElement,
    callbacks: LoadingCallbacks = {},
  ): Promise<VideoProcessResult> {
    const { onLoadingStateUpdate } = callbacks;
    const i18n = getI18n();

    this.currentAbortController?.abort();
    this.currentAbortController = new AbortController();

    try {
      if (videoSource.type === "motion-photo") {
        debugLog("Processing Motion Photo embedded video...");
        onLoadingStateUpdate?.({
          isVisible: true,
          conversionMessage: i18n.t("video.motion-photo.extracting"),
        });

        const extractedVideoUrl = await extractMotionPhotoVideo(
          videoSource.imageUrl,
          {
            motionPhotoOffset: videoSource.offset,
            motionPhotoVideoSize: videoSource.size,
            presentationTimestampUs: videoSource.presentationTimestamp,
          },
          this.currentAbortController.signal,
        );

        if (!extractedVideoUrl) {
          throw new Error("Failed to extract Motion Photo video");
        }

        debugLog("Motion Photo video extracted successfully");
        onLoadingStateUpdate?.({
          isVisible: false,
        });

        return await this.loadVideoSource(
          videoElement,
          extractedVideoUrl,
          {
            convertedVideoUrl: extractedVideoUrl,
            conversionMethod: "motion-photo-extraction",
          },
          { ownedBlobUrl: true },
        );
      }

      if (videoSource.type === "live-photo") {
        if (needsVideoConversion(videoSource.videoUrl)) {
          return await this.convertVideo(
            videoSource.videoUrl,
            videoElement,
            callbacks,
          );
        }

        return await this.loadDirectVideo(videoSource.videoUrl, videoElement);
      }

      throw new Error("No video source provided");
    } catch (error) {
      console.error("Failed to process video:", error);
      onLoadingStateUpdate?.({
        isVisible: false,
      });
      throw error;
    }
  }

  cleanup(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    if (this.pendingReject) {
      this.rejectPending(createAbortError("Video load cancelled"));
    }

    this.clearVideoElement();
  }

  private rejectPending(error: Error): void {
    if (!this.pendingReject) {
      return;
    }

    const reject = this.pendingReject;
    this.pendingReject = null;
    reject(error);
  }

  private clearVideoElement(): void {
    this.rejectPending(createAbortError("Video load cancelled"));

    if (this.pendingCleanup) {
      this.pendingCleanup();
      this.pendingCleanup = null;
    }

    const videoElement = this.activeVideoElement;
    if (videoElement) {
      try {
        videoElement.pause();
      } catch (error) {
        console.warn("Failed to pause video during cleanup:", error);
      }

      videoElement.removeAttribute("src");
      videoElement.load();
    }

    if (this.ownedVideoUrl) {
      try {
        URL.revokeObjectURL(this.ownedVideoUrl);
        debugLog("Revoked owned video blob URL during cleanup");
      } catch (error) {
        console.warn("Failed to revoke owned video blob URL:", error);
      }
    }

    this.activeVideoElement = null;
    this.ownedVideoUrl = null;
  }

  private loadVideoSource(
    videoElement: HTMLVideoElement,
    src: string,
    result: VideoProcessResult,
    options: { ownedBlobUrl?: boolean } = {},
  ): Promise<VideoProcessResult> {
    this.clearVideoElement();
    this.activeVideoElement = videoElement;
    this.ownedVideoUrl = options.ownedBlobUrl ? src : null;

    return new Promise((resolve, reject) => {
      const signal = this.currentAbortController?.signal;
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      this.pendingReject = reject;

      const cleanup = () => {
        videoElement.removeEventListener("loadeddata", handleVideoCanPlay);
        videoElement.removeEventListener("canplay", handleVideoCanPlay);
        videoElement.removeEventListener("canplaythrough", handleVideoCanPlay);
        videoElement.removeEventListener("error", handleVideoError);
        signal?.removeEventListener("abort", handleAbort);
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (this.pendingCleanup === cleanup) {
          this.pendingCleanup = null;
        }
        if (this.pendingReject === reject) {
          this.pendingReject = null;
        }
      };

      const handleVideoCanPlay = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const handleVideoError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Video failed to load"));
      };

      const handleAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(createAbortError("Video load cancelled"));
      };

      this.pendingCleanup = cleanup;

      // Listeners must be installed before assigning src/load(). Cached media
      // and test doubles are allowed to fire their readiness event
      // synchronously from load().
      videoElement.addEventListener("loadeddata", handleVideoCanPlay);
      videoElement.addEventListener("canplay", handleVideoCanPlay);
      videoElement.addEventListener("canplaythrough", handleVideoCanPlay);
      videoElement.addEventListener("error", handleVideoError);
      signal?.addEventListener("abort", handleAbort, { once: true });

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(
            `Video did not become ready within ${this.readyTimeoutMs}ms`,
          ),
        );
      }, this.readyTimeoutMs);

      if (signal?.aborted) {
        handleAbort();
        return;
      }

      videoElement.src = src;
      videoElement.load();

      // Browsers do not have to dispatch another event when media is already
      // ready (for example after a memory-cache hit).
      if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        handleVideoCanPlay();
      }
    });
  }

  private async convertVideo(
    livePhotoVideoUrl: string,
    videoElement: HTMLVideoElement,
    callbacks: LoadingCallbacks,
  ): Promise<VideoProcessResult> {
    const { onLoadingStateUpdate } = callbacks;

    onLoadingStateUpdate?.({
      isVisible: true,
      isConverting: true,
      loadingProgress: 0,
    });

    debugLog("Relabeling MOV video as MP4...");

    // 失败时直接向上抛：processVideo 的 catch 统一负责隐藏加载指示器
    const convertedVideoUrl = await relabelMovAsMp4(livePhotoVideoUrl, {
      signal: this.currentAbortController?.signal,
    });

    onLoadingStateUpdate?.({
      isVisible: false,
    });

    return await this.loadVideoSource(videoElement, convertedVideoUrl, {
      convertedVideoUrl,
    });
  }

  private async loadDirectVideo(
    livePhotoVideoUrl: string,
    videoElement: HTMLVideoElement,
  ): Promise<VideoProcessResult> {
    return await this.loadVideoSource(videoElement, livePhotoVideoUrl, {
      conversionMethod: "",
    });
  }
}
