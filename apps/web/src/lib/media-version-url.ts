import type { PhotoManifestItem } from "@afilmory/schema";

/**
 * Gives stable source URLs content-versioned cache identity. The builder keeps
 * original URLs stable by storage key, while etag/mtime can change underneath;
 * without this query the PWA CacheFirst route can serve replaced media for its
 * entire retention window.
 */
export function getVersionedOriginalUrl(
  photo: Pick<
    PhotoManifestItem,
    "etag" | "lastModified" | "originalUrl" | "size"
  >,
): string {
  const version = photo.etag || `${photo.lastModified}:${photo.size}`;
  return appendMediaVersion(photo.originalUrl, version);
}

export function appendMediaVersion(url: string, version: string): string {
  if (!version) return url;
  const isRootRelative = url.startsWith("/") && !url.startsWith("//");
  const isHttp = /^https?:\/\//i.test(url);
  if (!isRootRelative && !isHttp) return url;

  try {
    const parsed = new URL(url, "https://afilmory.invalid");
    parsed.searchParams.set("v", version);
    return isRootRelative
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.href;
  } catch {
    return url;
  }
}
