import { ScrollArea, ScrollElementContext } from "@afilmory/ui";
import { Outlet } from "react-router";

import { siteConfig } from "~/config";
import { useMobile } from "~/hooks/useMobile";
import { useIsPhotoViewerOpen, usePhotos } from "~/hooks/usePhotoViewer";
import { MasonryRoot } from "~/modules/gallery/MasonryRoot";
import { GalleryStateSync } from "~/providers/gallery-state-sync";
import { PhotosProvider } from "~/providers/photos-provider";

export const Component = () => {
  const isMobile = useMobile();
  // 只订阅开/关：滑动换图与 URL 同步都收敛在 GalleryStateSync（null 子组件）里，
  // 这里不再消费 router hooks / usePhotoViewer 的其余原子，避免整树重渲染。
  const isPhotoViewerOpen = useIsPhotoViewerOpen();
  const galleryHiddenClassName = isPhotoViewerOpen
    ? "pointer-events-none invisible"
    : undefined;

  const photos = usePhotos();
  const mobileScrollElement =
    typeof document === "undefined" ? null : document.body;

  return (
    <>
      <GalleryStateSync />
      <PhotosProvider photos={photos}>
        {siteConfig.accentColor && (
          <style>{`
          :root:has(input.theme-controller[value=dark]:checked), [data-theme="dark"] {
            --color-primary: ${siteConfig.accentColor};
            --color-accent: ${siteConfig.accentColor};
            --color-secondary: ${siteConfig.accentColor};
          }
          `}</style>
        )}

        {isMobile ? (
          <ScrollElementContext value={mobileScrollElement}>
            <div className={galleryHiddenClassName}>
              <MasonryRoot />
            </div>
          </ScrollElementContext>
        ) : (
          <ScrollArea
            rootClassName={
              galleryHiddenClassName
                ? `h-svh w-full ${galleryHiddenClassName}`
                : "h-svh w-full"
            }
            viewportClassName="size-full"
          >
            <MasonryRoot />
          </ScrollArea>
        )}

        <Outlet />
      </PhotosProvider>
    </>
  );
};
