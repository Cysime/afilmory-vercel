import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoLoadService } from "../video-load-service";

vi.mock("~/i18n", () => ({
  getI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("~/lib/video-converter", () => ({
  needsVideoConversion: () => false,
  relabelMovAsMp4: vi.fn(),
}));

vi.mock("~/lib/motion-photo-extractor", () => ({
  extractMotionPhotoVideo: vi.fn(),
}));

const source = {
  type: "live-photo" as const,
  videoUrl: "https://example.com/live.mp4",
};

describe("VideoLoadService", () => {
  let video: HTMLVideoElement;

  beforeEach(() => {
    video = document.createElement("video");
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "load").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("observes a readiness event fired synchronously by load()", async () => {
    vi.mocked(video.load).mockImplementation(() => {
      video.dispatchEvent(new Event("loadeddata"));
    });

    await expect(
      new VideoLoadService().processVideo(source, video),
    ).resolves.toEqual({ conversionMethod: "" });
  });

  it("resolves immediately when cached media is already ready", async () => {
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });

    await expect(
      new VideoLoadService().processVideo(source, video),
    ).resolves.toEqual({ conversionMethod: "" });
  });

  it.each(["canplay", "canplaythrough"])(
    "accepts the %s readiness event",
    async (eventName) => {
      const promise = new VideoLoadService().processVideo(source, video);
      video.dispatchEvent(new Event(eventName));
      await expect(promise).resolves.toEqual({ conversionMethod: "" });
    },
  );

  it("rejects when the video element reports an error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const promise = new VideoLoadService().processVideo(source, video);
    video.dispatchEvent(new Event("error"));

    await expect(promise).rejects.toThrow("Video failed to load");
    expect(consoleError).toHaveBeenCalled();
  });

  it("times out instead of remaining pending forever", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const promise = new VideoLoadService(250).processVideo(source, video);
    const assertion = expect(promise).rejects.toThrow(
      "Video did not become ready within 250ms",
    );

    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it("aborts an in-flight media wait during cleanup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new VideoLoadService();
    const promise = service.processVideo(source, video);

    service.cleanup();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(video.getAttribute("src")).toBeNull();
  });
});
