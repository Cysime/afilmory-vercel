import { ScrollArea, ScrollElementContext } from "@afilmory/ui";
import { Outlet } from "react-router";

import { siteConfig } from "~/config";
import { useGalleryUrlSync } from "~/hooks/useGalleryUrlSync";
import { useMobile } from "~/hooks/useMobile";
import {
  usePhotos,
  usePhotoViewer,
  usePhotoViewerBodyScrollLock,
} from "~/hooks/usePhotoViewer";
import { MasonryRoot } from "~/modules/gallery/MasonryRoot";
import { PhotosProvider } from "~/providers/photos-provider";

export const Component = () => {
  usePhotoViewerBodyScrollLock();
  // URL <-> 图库状态双向同步（详见 useGalleryUrlSync）
  useGalleryUrlSync();

  const isMobile = useMobile();
  const { isOpen: isPhotoViewerOpen } = usePhotoViewer();
  const galleryHiddenClassName = isPhotoViewerOpen
    ? "pointer-events-none invisible"
    : undefined;

  const photos = usePhotos();
  const mobileScrollElement =
    typeof document === "undefined" ? null : document.body;

  return (
    <>
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
