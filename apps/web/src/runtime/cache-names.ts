export const AFILMORY_RUNTIME_CACHE_NAMES = [
  "afilmory-thumbnails-v2",
  "afilmory-original-images-v2",
  "afilmory-videos-v1",
] as const;

const AFILMORY_RUNTIME_CACHE_NAME_SET = new Set<string>([
  ...AFILMORY_RUNTIME_CACHE_NAMES,
  // Previous releases used these names. Keep recognizing them so recovery
  // and upgrades can remove the orphaned caches after the self-hosted font
  // and content-addressed thumbnail migrations.
  "google-fonts-cache",
  "gstatic-fonts-cache",
  "images-cache",
  "s3-images-cache",
]);

export function isAfilmoryRuntimeCacheName(name: string): boolean {
  return (
    AFILMORY_RUNTIME_CACHE_NAME_SET.has(name) ||
    name.startsWith("workbox-") ||
    name.includes("precache")
  );
}
