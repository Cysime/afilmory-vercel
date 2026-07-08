/**
 * GalleryThumbnail 缩略图条的几何常量。单独成模块的原因：PhotoViewer 懒加载
 * GalleryThumbnail，Suspense fallback 需要用同一份尺寸占住条高，避免 chunk 到达
 * 时媒体区高度跳变（入场 FLIP 的目标矩形会随之失真）；而 fallback 若直接从
 * GalleryThumbnail 静态导入常量，会把整个模块拉回主 chunk，代码分割就假了。
 */
export const thumbnailSize = {
  mobile: 48,
  desktop: 64,
};

export const thumbnailGapSize = {
  mobile: 8,
  desktop: 12,
};

export const thumbnailPaddingSize = {
  mobile: 12,
  desktop: 16,
};

/** 缩略图条内容高度（缩略图 + 上下 padding；不含 border-t 与 pb-safe inset）。 */
export const getGalleryThumbnailStripHeight = (isMobile: boolean): number =>
  (isMobile ? thumbnailSize.mobile : thumbnailSize.desktop) +
  2 * (isMobile ? thumbnailPaddingSize.mobile : thumbnailPaddingSize.desktop);
