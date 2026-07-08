import clsx from "clsx";
import { useStore } from "jotai";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { gallerySettingAtom } from "~/atoms/app";
import { navigateAtom, routeAtom } from "~/atoms/route";
import { ThumbnailImage } from "~/components/ui/ThumbnailImage";
import { useLivePhotoHandler } from "~/hooks/useLivePhotoHandler";
import { useContextPhotos, useOpenPhotoViewer } from "~/hooks/usePhotoViewer";
import {
  CarbonIsoOutline,
  MaterialSymbolsShutterSpeed,
  StreamlineImageAccessoriesLensesPhotosCameraShutterPicturePhotographyPicturesPhotoLens as LensIcon,
  TablerAperture,
} from "~/icons";
import { isMobileDevice } from "~/lib/device-viewport";
import { getEssentialExif } from "~/lib/essential-exif";
import { buildGalleryFilterSearch } from "~/lib/gallery-filter-url";
import { getImageFormat } from "~/lib/image-utils";
import { buildPhotoDetailPathname } from "~/lib/photo-detail-route";
import { flushStartupMetrics, markStartupOnce } from "~/lib/startup-metrics";
import {
  getThumbnailLoadCacheKey,
  hasLoadedThumbnail,
} from "~/lib/thumbnail-load-cache";
import type { PhotoManifest } from "~/types/photo";

import { computeMasonryItemHeight } from "./gallery-layout";

// 未命名照片兜底 aria-label 用的日期格式化：Intl.DateTimeFormat 构造不便宜
// （做法同 useVisiblePhotosDateRange），瀑布流单元是热路径，按 locale 缓存。
const untitledDateFormatters = new Map<string, Intl.DateTimeFormat>();

const formatUntitledPhotoDate = (
  locale: string,
  dateTaken: string,
): string | null => {
  const date = new Date(dateTaken);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  let formatter = untitledDateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    untitledDateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
};

export const MasonryPhotoItem = memo(
  ({
    data,
    width,
    index,
  }: {
    data: PhotoManifest;
    width: number;
    index: number;
  }) => {
    const photos = useContextPhotos();
    const openViewer = useOpenPhotoViewer();
    const { t, i18n } = useTranslation();
    // 通过 jotai store 在点击时按需读取路由 / 导航 / 画廊设置，避免订阅
    // useLocation()/useNavigate()/gallerySettingAtom —— 否则打开查看器(URL 变化)
    // 或调整任一筛选都会让全部可见的虚拟单元重渲染。沿用 StableRouterProvider 的
    // 设计意图：路由状态存在 atom 里，读取时不触发组件重渲染。
    const store = useStore();
    const [imageError, setImageError] = useState(false);

    const imageRef = useRef<HTMLImageElement>(null);
    const thumbnailCacheKey = getThumbnailLoadCacheKey(
      data.id,
      data.thumbnailUrl,
    );
    const hasLoadedThumbnailBefore = hasLoadedThumbnail(thumbnailCacheKey);
    const [imageLoaded, setImageLoaded] = useState(hasLoadedThumbnailBefore);

    const {
      videoRef,
      hasVideo,
      isPlayingLivePhoto,
      isConvertingVideo,
      videoConversionError,
      handleMouseEnter,
      handleMouseLeave,
      handleVideoEnded,
    } = useLivePhotoHandler({ data, imageLoaded });

    useEffect(() => {
      setImageLoaded(hasLoadedThumbnail(thumbnailCacheKey));
      setImageError(false);
    }, [thumbnailCacheKey]);

    const handleImageLoad = () => {
      if (markStartupOnce("first-thumbnail-loaded", { photoId: data.id })) {
        flushStartupMetrics("first-thumbnail-loaded");
      }
    };

    const handleImageError = () => {
      setImageError(true);
    };

    const handleClick = useCallback(() => {
      const photoIndex =
        photos[index]?.id === data.id
          ? index
          : photos.findIndex((photo) => photo.id === data.id);
      const openPhotoViewer = () => {
        if (photoIndex === -1) {
          return;
        }

        const triggerEl =
          imageRef.current?.parentElement instanceof HTMLElement
            ? imageRef.current.parentElement
            : imageRef.current;

        openViewer(photoIndex, {
          element: triggerEl ?? undefined,
          sourceMode: "filtered",
          sourcePhotoIds: photos.map((photo) => photo.id),
        });
      };

      const navigate = store.get(navigateAtom).fn;
      const navigationResult = navigate?.({
        pathname: buildPhotoDetailPathname(data.id),
        search: buildGalleryFilterSearch(
          store.get(routeAtom).location.search,
          store.get(gallerySettingAtom),
        ),
      }) as void | PromiseLike<void> | undefined;

      if (navigationResult && typeof navigationResult.then === "function") {
        void navigationResult.then(openPhotoViewer, openPhotoViewer);
        return;
      }

      openPhotoViewer();
    }, [data.id, index, openViewer, photos, store]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      },
      [handleClick],
    );

    // 与虚拟布局同一个整数高度函数（守卫 aspectRatio 异常 + 整数几何，见 gallery-layout.ts），
    // 保证格子壳与照片内容逐像素一致、无小数 y 坐标（iOS 分块光栅化 hairline 的根源）。
    const calculatedHeight = computeMasonryItemHeight(width, data);

    // 核心 EXIF 拍摄参数：与查看器面板共用同一份格式化逻辑（essential-exif.ts）。
    // 覆盖层只有一格焦距，无 35mm 等效值时回退实际焦距。
    const essentialExif = getEssentialExif(data.exif);
    const exifData = {
      ...essentialExif,
      focalLength35mm:
        essentialExif.focalLength35mm ?? essentialExif.focalLength,
    };
    const shouldShowImageDetails = imageLoaded || hasLoadedThumbnailBefore;

    // 使用通用的图片格式提取函数
    const imageFormat = getImageFormat(data.originalUrl || data.s3Key || "");

    // 首屏首几张缩略图是 LCP 候选：立即加载并提高优先级，消除 LCP 的发现/加载延迟；
    // 其余照片懒加载、低优先级，避免与首屏关键资源争抢带宽。
    const isPriorityThumbnail = index < 4;
    // 曾加载过的图重挂载（虚拟列表滚回）必然命中缓存：eager 跳过浏览器的
    // lazy-load 观察/延迟决策，让缓存图尽快上屏，缩短重挂载的空窗。
    const shouldLoadEagerly = isPriorityThumbnail || hasLoadedThumbnailBefore;

    // 标题和描述都缺失时，aria-label 不能是 undefined —— 那会让整格照片对
    // 读屏器变成一个无名按钮；回退到"摄于某日的照片"，日期无效再退到通用文案。
    let ariaLabel = data.title || data.description;
    if (!ariaLabel) {
      const takenDate = formatUntitledPhotoDate(i18n.language, data.dateTaken);
      ariaLabel = takenDate
        ? t("photo.untitled.taken-on", { date: takenDate })
        : t("photo.untitled.fallback");
    }

    return (
      // 纯 div：入场动画由 MasonryRoot 的包裹层负责，这里不用任何 motion 能力。
      // m.div 会给每个虚拟格子实例化 visualElement/投影树（热路径的纯浪费）。
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        className="bg-fill-quaternary group relative w-full cursor-pointer overflow-hidden"
        style={{
          width,
          height: calculatedHeight,
        }}
        data-photo-id={data.id}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Thumbhash 占位符 */}
        {!imageError && (
          <ThumbnailImage
            ref={imageRef}
            photoId={data.id}
            src={data.thumbnailUrl}
            alt={data.title}
            thumbHash={data.thumbHash}
            loading={shouldLoadEagerly ? "eager" : "lazy"}
            fetchPriority={isPriorityThumbnail ? "high" : "low"}
            containerClassName="absolute inset-0"
            imageClassName={clsx(
              "h-full w-full object-cover duration-300 group-hover:scale-105",
            )}
            placeholderClassName="h-full w-full"
            onLoad={handleImageLoad}
            onError={handleImageError}
            onLoadStateChange={setImageLoaded}
          />
        )}

        {/* Live Photo/Motion Photo 视频 */}
        {hasVideo && (
          <video
            ref={videoRef}
            className={clsx(
              "absolute inset-0 h-full w-full object-cover duration-300 group-hover:scale-105",
              isPlayingLivePhoto ? "z-10" : "pointer-events-none opacity-0",
            )}
            muted
            playsInline
            onEnded={handleVideoEnded}
          />
        )}

        {/* 错误状态 */}
        {imageError && (
          <div className="bg-fill-quaternary text-text-tertiary absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <i className="i-mingcute-image-line text-2xl" />
              <p className="mt-2 text-sm">{t("photo.error.loading")}</p>
            </div>
          </div>
        )}

        {/* Live Photo/Motion Photo 标识 */}
        {hasVideo && (
          <div
            className={clsx(
              "absolute z-20 flex items-center space-x-1 rounded-xl bg-black/50 px-1 py-1 text-xs text-white transition-all duration-200 hover:bg-black/70",
              "top-2 left-2",
              "flex-wrap gap-y-1",
            )}
            title={
              isMobileDevice
                ? t("photo.live.tooltip.mobile.main")
                : t("photo.live.tooltip.desktop.main")
            }
          >
            {isConvertingVideo ? (
              <div className="flex items-center gap-1 px-1">
                <i className="i-mingcute-loading-line animate-spin" />
                <span>{t("loading.converting")}</span>
              </div>
            ) : (
              <Fragment>
                <i className="i-mingcute-live-photo-line size-4 shrink-0" />
                <span className="mr-1 shrink-0">{t("photo.live.badge")}</span>
                {videoConversionError ? (
                  <span className={"bg-warning/20 ml-0.5 rounded px-1 text-xs"}>
                    <div
                      className="text-yellow w-3 text-center font-bold"
                      title={(videoConversionError as Error).message}
                    >
                      !
                    </div>
                  </span>
                ) : null}
              </Fragment>
            )}
          </div>
        )}

        {/* 图片信息和 EXIF 覆盖层：仅非触摸（鼠标 hover）设备渲染。移动/触摸端
            永远 opacity-0（没有 hover），却仍占满 DOM 并参与每帧 style recalc 与
            backdrop-blur 合成 —— 直接不渲染可把每个 item 的 DOM 从 ~41 降到 ~5，
            大幅减少滚动时的样式重算与掉帧。移动端看详情请点开查看器。 */}
        {!isMobileDevice && shouldShowImageDetails && (
          <div className="pointer-events-none">
            {/* 渐变背景 - 独立的层 */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

            {/* 内容层 - 独立的层以支持 backdrop-filter */}
            <div className="absolute inset-x-0 bottom-0 p-4 pb-0 text-white">
              {/* 基本信息和标签 section */}
              <div className="mb-3 [&_*]:duration-300">
                <h3 className="mb-2 truncate text-sm font-medium opacity-0 group-hover:opacity-100">
                  {data.title}
                </h3>
                {data.description && (
                  <p className="mb-2 line-clamp-2 text-sm text-white/80 opacity-0 group-hover:opacity-100">
                    {data.description}
                  </p>
                )}

                {/* 基本信息 */}
                <div className="mb-2 flex flex-wrap gap-2 text-xs text-white/80 opacity-0 group-hover:opacity-100">
                  <span>{imageFormat}</span>
                  <span>•</span>
                  <span>
                    {data.width} × {data.height}
                  </span>
                  <span>•</span>
                  <span>{(data.size / 1024 / 1024).toFixed(1)}MB</span>
                </div>

                {/* Tags */}
                {data.tags && data.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white/20 px-2 py-0.5 text-xs text-white/90 opacity-0 backdrop-blur-sm group-hover:opacity-100"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* EXIF 信息网格 */}
              {calculatedHeight >= 200 && (
                <div className="grid grid-cols-2 gap-2 pb-4 text-xs">
                  {exifData.focalLength35mm && (
                    <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100">
                      <LensIcon className="text-white/70" />
                      <span className="text-white/90">
                        {exifData.focalLength35mm}mm
                      </span>
                    </div>
                  )}

                  {exifData.aperture && (
                    <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100">
                      <TablerAperture className="text-white/70" />
                      <span className="text-white/90">{exifData.aperture}</span>
                    </div>
                  )}

                  {exifData.shutterSpeed && (
                    <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100">
                      <MaterialSymbolsShutterSpeed className="text-white/70" />
                      <span className="text-white/90">
                        {exifData.shutterSpeed}
                      </span>
                    </div>
                  )}

                  {exifData.iso && (
                    <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 opacity-0 backdrop-blur-md transition-opacity duration-300 group-hover:opacity-100">
                      <CarbonIsoOutline className="text-white/70" />
                      <span className="text-white/90">ISO {exifData.iso}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);
