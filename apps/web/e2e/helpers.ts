import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

// Shared offline stubs for the e2e specs. Every spec applies the relevant
// subset in its beforeEach so the whole suite runs without real network
// access — keep stub behavior changes here, in one place.

export const VIEWER_FIXTURE_IMAGE_PATH = fileURLToPath(
  new URL("../public/favicon-48x48.png", import.meta.url),
);
// 合成 fixture 里 Live Photo 的可播放视频（画廊在缩略图加载后会立即拉取）。
const LIVE_PHOTO_FIXTURE_VIDEO_PATH = fileURLToPath(
  new URL("fixtures/thumbnails/SYNTH0012.webm", import.meta.url),
);

export async function stubGoogleFonts(page: Page) {
  // index.html 从 Google Fonts 拉 Geist（preload + stylesheet + gstatic woff2）：
  // 响应慢会触发 Chromium 的 "preload not used" 警告，连接失败/导航中止则
  // 产生 error 级 console 输出——全都撞上 runtime-state.spec 严格的 diagnostics
  // 断言。就地回空 CSS（无 @font-face → 不再请求 gstatic）。另一处真实外网
  // 依赖是 carto 底图，由 stubCartoBasemap 拦截；两者合起来让测试彻底离线、
  // 确定。
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({
      contentType: "text/css",
      body: "/* e2e: external fonts stubbed */",
    }),
  );
  await page.route("https://fonts.gstatic.com/**", (route) =>
    route.fulfill({ contentType: "font/woff2", body: "" }),
  );
}

export async function stubCartoBasemap(page: Page) {
  // 地图 style（MapLibreStyle.json）的 source/sprite/glyphs 全都指向
  // tiles.basemaps.cartocdn.com：CI 出口受限或 CDN 抖动时 MapLibre 会发出
  // error 级 console 输出，撞上严格的 diagnostics 断言。就地回最小合法响应；
  // tiles 数组必须非空且指回本 stub 域名，这样后续瓦片请求也留在路由内
  // （空数组会让 MapLibre 取模索引出 undefined 瓦片 URL，反而制造新错误）。
  await page.route("https://tiles.basemaps.cartocdn.com/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("tiles.json")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          tilejson: "2.2.0",
          tiles: [
            "https://tiles.basemaps.cartocdn.com/e2e-stub/{z}/{x}/{y}.pbf",
          ],
          minzoom: 0,
          maxzoom: 0,
        }),
      });
      return;
    }
    if (url.endsWith(".pbf")) {
      // 空 body 是合法的空矢量瓦片 / 空字形区间。
      await route.fulfill({ contentType: "application/x-protobuf", body: "" });
      return;
    }
    if (url.endsWith(".json")) {
      // sprite.json / sprite@2x.json。
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    // sprite*.png：必须是可解码的真实图片，空 body 会让 MapLibre 报解码错误。
    await route.fulfill({
      contentType: "image/png",
      path: VIEWER_FIXTURE_IMAGE_PATH,
    });
  });
}

export async function stubLocalThumbnails(page: Page) {
  // Thumbnails are build-time assets that are gitignored and therefore absent in
  // CI. Serve a tiny local PNG so the gallery grid renders without 404 console
  // errors, which runtime-state.spec's diagnostics assertions treat as failures.
  // Harmless locally (real thumbnails are simply overridden by the same fixture
  // image).
  // Live Photo 的 .webm 请求则回真实 fixture 视频，否则视频加载失败同样会产生
  // error 级 console 输出。
  await page.route("**/thumbnails/**", async (route) => {
    const isLivePhotoVideo = route.request().url().endsWith(".webm");
    await route.fulfill({
      contentType: isLivePhotoVideo ? "video/webm" : "image/png",
      headers: { "Cache-Control": "no-store" },
      path: isLivePhotoVideo
        ? LIVE_PHOTO_FIXTURE_VIDEO_PATH
        : VIEWER_FIXTURE_IMAGE_PATH,
    });
  });
}
