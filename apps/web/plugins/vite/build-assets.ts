import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { generateOGImage } from "@afilmory/build-assets";
import type { PhotoManifestItem } from "@afilmory/schema";
import { assertManifest } from "@afilmory/schema";
import type { Plugin } from "vite";

// site.config 是仓库根级配置（by design），保持相对路径引用
import type { SiteConfig } from "../../../../site.config";
import { MANIFEST_PATH } from "./__internal__/constants";
import { generateRSSFeed } from "./rss";

interface OGImagePluginOptions {
  title?: string;
  description?: string;
  siteName?: string;
  siteUrl?: string;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function buildAssetsPlugin(
  ogOptions: OGImagePluginOptions = {},
  siteConfig: SiteConfig,
): Plugin {
  const {
    title = "Afilmory",
    description = "Capturing beautiful moments in life, documenting daily warmth and emotions through my lens.",
    siteName = "Afilmory",
    siteUrl,
  } = ogOptions;

  let ogImagePath = "";

  return {
    name: "build-assets",
    apply: "build",
    async buildStart() {
      try {
        const ogImage = await generateOGImage({
          title,
          description,
          outputPath: "assets/og-image.png",
          includePhotos: true,
          photoCount: 4,
          writeToDisk: false,
        });

        // 用内容哈希命名（与 data-inject 的 manifest 资产一致）：同样的输入产出
        // 同样的 URL，构建可复现、CDN 缓存不再被 Date.now() 每次打穿。
        // 注意保留 og-image- 前缀，pwa.ts 的 globIgnores '**/og-image-*.png' 依赖它。
        const hash = createHash("sha256")
          .update(ogImage.buffer)
          .digest("hex")
          .slice(0, 10);
        const fileName = `assets/og-image-${hash}.png`;

        this.emitFile({
          type: "asset",
          fileName,
          source: ogImage.buffer,
        });

        ogImagePath = `/${fileName}`;
        this.info(`OG image generated: ${ogImagePath}`);
      } catch (error) {
        this.error(
          `Failed to generate OG image: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    generateBundle() {
      try {
        const manifest = assertManifest(
          JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")),
        );

        // Sort photos by date taken (newest first)
        const sortedPhotos = [...manifest.photos].sort(
          (a, b) =>
            new Date(b.dateTaken).getTime() - new Date(a.dateTaken).getTime(),
        );

        // Generate RSS feed
        const rssXml = generateRSSFeed(sortedPhotos, siteConfig);

        // Generate sitemap
        const sitemapXml = generateSitemap(sortedPhotos, siteConfig);

        // Emit RSS feed
        this.emitFile({
          type: "asset",
          fileName: "feed.xml",
          source: rssXml,
        });

        // Emit sitemap
        this.emitFile({
          type: "asset",
          fileName: "sitemap.xml",
          source: sitemapXml,
        });

        this.info(`Generated RSS feed with ${sortedPhotos.length} photos`);
        this.info(`Generated sitemap with ${sortedPhotos.length + 1} URLs`);
      } catch (error) {
        this.error(
          `Error generating RSS feed and sitemap: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!ogImagePath) {
          console.warn("⚠️  No OG image path available");
          return html;
        }

        const baseUrl = normalizeBaseUrl(siteUrl || "");
        const ogImageUrl = `${baseUrl}${ogImagePath}`;
        const safeBaseUrl = escapeHtmlAttribute(baseUrl);
        const safeTitle = escapeHtmlAttribute(title);
        const safeDescription = escapeHtmlAttribute(description);
        const safeSiteName = escapeHtmlAttribute(siteName);
        const safeOgImageUrl = escapeHtmlAttribute(ogImageUrl);

        // 生成 meta 标签
        const metaTags = `
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${safeBaseUrl}" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:image" content="${safeOgImageUrl}" />
    <meta property="og:site_name" content="${safeSiteName}" />

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:url" content="${safeBaseUrl}" />
    <meta property="twitter:title" content="${safeTitle}" />
    <meta property="twitter:description" content="${safeDescription}" />
    <meta property="twitter:image" content="${safeOgImageUrl}" />

    <!-- Additional meta tags -->
    <meta name="description" content="${safeDescription}" />
    <meta name="author" content="${safeSiteName}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#0a0a0a" />
    <meta name="msapplication-TileColor" content="#0a0a0a" />

    <!-- Favicon and app icons -->
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="shortcut icon" href="/favicon.ico" />
        `;

        // 在 </head> 标签前插入 meta 标签
        return html.replace("</head>", `${metaTags}\n  </head>`);
      },
    },
  };
}

function generateSitemap(
  photos: PhotoManifestItem[],
  config: SiteConfig,
): string {
  const now = new Date().toISOString();
  const baseUrl = normalizeBaseUrl(config.url);

  // Main page
  const mainPageXml = `  <url>
    <loc>${baseUrl}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`;

  // Photo pages
  const photoUrls = photos
    .map((photo) => {
      const lastmod = new Date(
        photo.lastModified || photo.dateTaken,
      ).toISOString();
      const photoUrl = `${baseUrl}/photos/${encodeURIComponent(photo.id)}`;
      return `  <url>
    <loc>${photoUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${mainPageXml}
${photoUrls}
</urlset>`;
}
