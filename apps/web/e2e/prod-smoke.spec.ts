import { expect, test } from "@playwright/test";

// 生产构建冒烟（webServer 见 scripts/e2e-prod-server.ts，经
// `pnpm test:e2e:prod` 触发）：dev server 永远跑不到的产物形态——外部
// manifest 资产 + index.html 内联 fetch 脚本、压缩/手动分块 bundle、PWA
// Service Worker——只在这里于真实浏览器中验证。
//
// fixture 缩略图与空的 Speed Insights 脚本已由 e2e-prod-server 写进 dist，
// 页面加载全程零 404，本站资源一律不用 route stub —— 这很关键：SW
// （clientsClaim + skipWaiting）激活后接管的请求 Playwright route 拦截不到，
// 只有真实文件才能保证确定性（唯一例外是 Google Fonts，见测试内注释）。
// 原图域名是虚构的 .test 域，打开查看器后必然加载失败（降级回缩略图态），
// 因此 console error 断言只覆盖首屏加载 + SW 注册阶段。

// 外部 manifest 的 hashed 资产路径（data-inject 插件 buildStart 里 emitFile 的
// fileName 格式：assets/photos-manifest.<sha256 前 10 位>.json）。
const EXTERNAL_MANIFEST_ASSET = /\/assets\/photos-manifest\.[0-9a-f]{10}\.json/;

test("production bundle serves gallery, viewer route, and service worker", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });
  const manifestRequests: string[] = [];
  page.on("request", (request) => {
    if (EXTERNAL_MANIFEST_ASSET.test(request.url())) {
      manifestRequests.push(request.url());
    }
  });

  // 唯一的例外 stub：index.html 的 Google Fonts（preload + stylesheet）是
  // console error 断言窗口内仅剩的真实外网请求，网络抖动会产生
  // ERR_CONNECTION_CLOSED / preload 警告等非确定噪声。字体 CSS 在 HTML 解析期
  // 就发起、远早于 SW 激活，route 拦截可靠；回空 CSS 后也不再请求 gstatic。
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({
      contentType: "text/css",
      body: "/* e2e: external fonts stubbed */",
    }),
  );
  await page.route("https://fonts.gstatic.com/**", (route) =>
    route.fulfill({ contentType: "font/woff2", body: "" }),
  );

  await page.goto("/");

  // 画廊从生产 bundle 渲染出照片格。
  await expect(
    page.getByRole("button", { name: "Search & Filter" }),
  ).toBeVisible();
  const photoItems = page.locator("[data-photo-id]");
  await expect(photoItems.first()).toBeVisible();
  expect(await photoItems.count()).toBeGreaterThan(0);

  // 生产专属：manifest 以外部 hashed 资产 + 内联 fetch 脚本交付（dev server
  // 走 /__afilmory/ 中间件、内嵌模式则完全无请求）。不能断言
  // window.__AFILMORY__.manifest.mode === 'external'：manifest 加载完成后
  // setRuntimeManifest（src/runtime/browser-runtime.ts）会把它归一成
  // { mode: 'inline', data }，画廊可见时必然已是 inline。改为断言两个
  // 免竞态的产物形态：#manifest 内联脚本里烘焙了 hashed 资产 URL，
  // 且页面确实对该资产发起过请求。
  expect(
    await page.evaluate(
      () => document.querySelector("#manifest")?.textContent ?? "",
    ),
  ).toMatch(EXTERNAL_MANIFEST_ASSET);
  expect(manifestRequests).not.toEqual([]);

  // 生产专属：Service Worker 注册并激活（registerType: autoUpdate）。
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker?.getRegistration();
          return registration?.active?.state ?? null;
        }),
      { timeout: 15_000 },
    )
    .toBe("activated");

  // 加载 + SW 注册全程无 error 级 console 输出。
  expect(consoleErrors).toEqual([]);

  // 点击照片打开查看器路由（原图来自虚构 CDN 域，此后不再断言 console）。
  await photoItems.first().click();
  await expect(
    page.getByRole("dialog", { name: "Photo viewer" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/photos\/[^/?]+/);
});
