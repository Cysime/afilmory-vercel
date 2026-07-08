import { useGalleryUrlSync } from "~/hooks/useGalleryUrlSync";
import { usePhotoViewerBodyScrollLock } from "~/hooks/usePhotoViewer";

/**
 * Null-rendering subscription sink（同 StableRouterProvider 的模式）：
 * useGalleryUrlSync 订阅全部 router hooks 与查看器原子，挂在这里而不是
 * (main)/layout 里，查看器每次滑动（currentIndex + URL replace）才不会
 * 连带整棵 masonry 树重渲染两次。
 */
export const GalleryStateSync = () => {
  usePhotoViewerBodyScrollLock();
  // URL <-> 图库状态双向同步（详见 useGalleryUrlSync）
  useGalleryUrlSync();

  return null;
};
