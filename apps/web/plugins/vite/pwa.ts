import { VitePWA } from "vite-plugin-pwa";

import type { SiteConfig } from "../../../../site.config";
import { AFILMORY_RUNTIME_CACHE_NAMES } from "../../src/runtime/cache-names";

interface RuntimeRequestContext {
  request: Request;
  url: URL;
}

interface RuntimeUrlContext {
  url: URL;
}

// Workbox serializes match callbacks into the generated service worker. Keep
// every matcher self-contained: references to module-level regexes or helpers
// would be undefined in sw.js even though they work in Vite's Node process.
export function matchThumbnailRequest({ url }: RuntimeUrlContext): boolean {
  return /\/thumbnails\/[^/]+\.(?:png|jpe?g|webp|avif)$/i.test(url.pathname);
}

export function matchImageRequest({
  url,
  request,
}: RuntimeRequestContext): boolean {
  return (
    request.destination === "image" ||
    /\.(?:png|jpe?g|svg|webp|avif|gif|heic|heif|hif|tif|tiff|bmp)$/i.test(
      url.pathname,
    )
  );
}

export function matchVideoRequest({
  url,
  request,
}: RuntimeRequestContext): boolean {
  return (
    request.destination === "video" ||
    /\.(?:mp4|m4v|mov|webm|ogv|ogg)$/i.test(url.pathname)
  );
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createNavigateFallbackDenylist(
  localPhotosBaseUrl = "/originals",
): RegExp[] {
  const normalizedLocalBase = localPhotosBaseUrl.replace(/\/+$/, "");
  return [
    /^\/photos(?:\/|\?|$)/,
    new RegExp(`^${escapeRegExp(normalizedLocalBase)}(?:/|\\?|$)`),
    /^\/(?:assets|thumbnails|vendor)(?:\/|\?|$)/,
    /^\/(?:feed\.xml|sitemap\.xml|manifest\.webmanifest|sw\.js|registerSW\.js|workbox-[^/]+\.js)(?:\?|$)/,
    /\.[\da-z]{1,16}(?:\?|$)/i,
  ];
}

export function createAfilmoryPwaPlugin(
  siteConfig: SiteConfig,
  localPhotosBaseUrl = "/originals",
) {
  return VitePWA({
    base: "/",
    scope: "/",
    injectRegister: false,
    registerType: "autoUpdate",
    includeAssets: ["favicon.ico", "masked-icon.svg"],
    manifest: {
      name: siteConfig.title,
      short_name: siteConfig.name,
      description: siteConfig.description,
      theme_color: "#1c1c1e",
      background_color: "#1c1c1e",
      display: "standalone",
      scope: "/",
      start_url: "/",
      icons: [
        {
          src: "android-chrome-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "android-chrome-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: "apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
    workbox: {
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      // NavigationRoute otherwise returns index.html for every same-origin
      // navigation, swallowing static photo shells, local originals, feeds,
      // sitemaps, and assets opened in a new tab after the SW takes control.
      navigateFallbackDenylist:
        createNavigateFallbackDenylist(localPhotosBaseUrl),
      globIgnores: [
        "**/*.{jpg,jpeg}",
        "**/vendor/heic-*.js",
        "**/vendor/exiftool-*.js",
        "**/assets/maplibre-gl-*.js",
        "**/assets/map-*.js",
        "**/vendor/map-*.js",
        "**/assets/vendor/map*.css",
        "**/og-image-*.png",
        // Photo route shells remain independently crawlable static documents,
        // but precaching every photo would make the service worker grow with
        // the entire library. Navigation uses the network/static host instead.
        "photos/**/index.html",
        "**/*.map",
      ],
      globPatterns: ["**/*.{js,css,html}", "**/assets/photos-manifest.*.json"],
      maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      runtimeCaching: [
        // 缩略图：构建期产物、Vercel 侧已是 immutable —— 用 CacheFirst 而非
        // StaleWhileRevalidate（SWR 会在每次展示时都发一次后台革新请求，且旧上限
        // 150 < 照片总数，整个画廊滚一遍就互相挤占、后续变成真回源——正是
        // 「缓存好了还在加载」的主因）。上限取照片数的数倍余量。
        {
          // Match pathname rather than the whole URL so query strings do not
          // change routing semantics.
          urlPattern: matchThumbnailRequest,
          handler: "CacheFirst",
          options: {
            cacheName: AFILMORY_RUNTIME_CACHE_NAMES[0],
            expiration: {
              maxEntries: 600,
              maxAgeSeconds: 60 * 60 * 24 * 365,
              purgeOnQuotaError: true,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
        // Cache a small number of full video responses and let Workbox slice
        // them for byte-range requests. A browser's initial 206 response is not
        // cached; it remains a normal network response until a cacheable 200 is
        // available, avoiding corrupt partial objects in Cache Storage.
        {
          urlPattern: matchVideoRequest,
          handler: "CacheFirst",
          options: {
            cacheName: AFILMORY_RUNTIME_CACHE_NAMES[2],
            expiration: {
              maxEntries: 12,
              maxAgeSeconds: 60 * 60 * 24 * 30,
              purgeOnQuotaError: true,
            },
            cacheableResponse: {
              statuses: [200],
            },
            rangeRequests: true,
          },
        },
        // 其余图片 = 主要是 CDN 原图（几 MB/张，经查看器 XHR 或 <img> 加载）。
        // PhotoRepository 会按 etag/lastModified 给原图 URL 加版本参数，因此同 key
        // 内容更新会自然得到新的 Cache Storage key，CacheFirst 不会长期返回旧图。
        // 旧规则按主机名匹配 s3|amazonaws|cloudfront|cdn，自定义域（如 img.*）
        // 永远不命中，且被前面的通配图片规则遮蔽 → 等于没有原图缓存。改为
        // 兜底 CacheFirst：条目按体积保守设上限，配额吃紧时整体清退。
        {
          urlPattern: matchImageRequest,
          handler: "CacheFirst",
          options: {
            cacheName: AFILMORY_RUNTIME_CACHE_NAMES[1],
            expiration: {
              maxEntries: 40,
              maxAgeSeconds: 60 * 60 * 24 * 90,
              purgeOnQuotaError: true,
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
      ],
      skipWaiting: true,
    },
    devOptions: {
      enabled: false,
    },
  });
}
