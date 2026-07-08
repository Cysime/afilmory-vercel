import { useRef } from "react";

import type { VideoSource } from "~/lib/image-loading-types";
import { getVideoSourceKey } from "~/lib/image-loading-types";

interface StableVideoSource {
  videoSource: VideoSource;
  videoSourceKey: string;
}

/**
 * Consumers rebuild the VideoSource union on every render (from props or
 * manifest fields), which would retrigger load effects keyed on its identity.
 * Memoize on the serialized source key so equal sources keep a stable
 * identity — without flattening the union into scalars and reassembling it.
 */
export function useStableVideoSource(source: VideoSource): StableVideoSource {
  const key = getVideoSourceKey(source);
  const stableRef = useRef<StableVideoSource | null>(null);

  if (stableRef.current === null || stableRef.current.videoSourceKey !== key) {
    stableRef.current = { videoSource: source, videoSourceKey: key };
  }

  return stableRef.current;
}
