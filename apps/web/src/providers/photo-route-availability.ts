import { createContext, use, useEffect, useLayoutEffect } from "react";

const PhotoRouteAvailabilityContext = createContext<
  ((unavailable: boolean) => void) | null
>(null);

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export const PhotoRouteAvailabilityProvider = PhotoRouteAvailabilityContext;

/**
 * Lets the nested detail route isolate an unavailable photo from the gallery
 * without making the long-lived layout subscribe to every photoId while the
 * viewer is swiped.
 */
export function usePhotoRouteUnavailable(unavailable: boolean): void {
  const setUnavailable = use(PhotoRouteAvailabilityContext);

  useBrowserLayoutEffect(() => {
    if (!setUnavailable) return;

    setUnavailable(unavailable);
    return () => setUnavailable(false);
  }, [setUnavailable, unavailable]);
}
