import { clsxm } from "@afilmory/ui";
import { AnimatePresence, m } from "motion/react";
import type { FC } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { isMobileDevice } from "~/lib/device-viewport";

import type { LivePhotoBadgeProps } from "./types";

export const LivePhotoBadge: FC<LivePhotoBadgeProps> = ({
  livePhotoRef,
  isLivePhotoPlaying,
}) => {
  const { t } = useTranslation();

  const handlePlay = useCallback(async () => {
    if (!livePhotoRef.current?.getIsVideoLoaded() || isLivePhotoPlaying) return;
    livePhotoRef.current.play();
  }, [livePhotoRef, isLivePhotoPlaying]);

  const handleStop = useCallback(() => {
    if (!isLivePhotoPlaying) return;
    livePhotoRef.current?.stop();
  }, [livePhotoRef, isLivePhotoPlaying]);

  const handleClick = useCallback(() => {
    if (!livePhotoRef.current?.getIsVideoLoaded()) return;

    if (isLivePhotoPlaying) {
      handleStop();
    } else {
      handlePlay();
    }
  }, [livePhotoRef, isLivePhotoPlaying, handlePlay, handleStop]);

  return (
    <>
      {/* Live Photo 标识 */}
      <button
        type="button"
        aria-label={t("photo.live.badge")}
        aria-pressed={isLivePhotoPlaying}
        title={t("photo.live.badge")}
        className={clsxm(
          "absolute z-20 flex min-h-11 items-center space-x-1 rounded-xl bg-black/50 px-2 py-1 text-xs text-white transition-[background-color,box-shadow,color,transform] duration-200",
          "cursor-pointer hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/80",
          isLivePhotoPlaying && "bg-accent/70 hover:bg-accent/80",
          import.meta.env.DEV ? "top-16 right-4" : "top-12 lg:top-4 left-4",
        )}
        onClick={handleClick}
      >
        <i
          className={clsxm(
            "size-4",
            isLivePhotoPlaying
              ? "i-mingcute-live-photo-fill"
              : "i-mingcute-live-photo-line",
          )}
          aria-hidden="true"
        />
        <span className="mr-1">{t("photo.live.badge")}</span>
      </button>

      {/* 播放状态提示 */}
      <AnimatePresence>
        {isLivePhotoPlaying && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
              <i className="i-mingcute-live-photo-fill" aria-hidden="true" />
              <span>{t("photo.live.playing")}</span>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* 操作提示 */}
      <div
        className={clsxm(
          "pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded bg-black/50 px-2 py-1 text-xs text-white opacity-0 duration-200 group-hover:opacity-50",
          isLivePhotoPlaying && "opacity-0!",
        )}
      >
        {isMobileDevice
          ? t("photo.live.tooltip.mobile.zoom")
          : t("photo.live.tooltip.desktop.zoom")}
      </div>
    </>
  );
};
