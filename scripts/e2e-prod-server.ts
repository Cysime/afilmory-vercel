/**
 * prod-smoke webServer 入口（见 playwright.config.ts 的 prod-smoke project）：
 * 用固定的合成 fixture 走一遍真实生产构建，再以 vite preview 伺服 dist。
 * dev server 跑不到的生产专属行为——外部 manifest 资产 + index.html 内联
 * fetch 脚本、手动 vendor 分块、压缩产物、PWA Service Worker——只有这条
 * 路径能在真实浏览器里验证。
 *
 * 步骤：
 * 1. 把 apps/web/e2e/fixtures/photos-manifest.json staged 到
 *    generated/photos-manifest.json —— vite build 从该路径读取，必须在构建前
 *    就位。会覆盖本地已有的 manifest（它是 gitignore 的构建产物，
 *    `pnpm build:manifest` 可随时重建）。
 * 2. vite build（不设 AFILMORY_EMBED_MANIFEST → 生产默认的外部 manifest 模式）。
 * 3. 把 fixture 缩略图拷进 dist/thumbnails/，并写一个空的 Speed Insights
 *    脚本占位——两者都让页面加载零 404，spec 才能严格断言无 console error。
 * 4. vite preview 伺服 dist，Playwright 轮询 baseURL 直到就绪。
 *
 * vite 通过 node 直接执行其 bin，绕开对 PATH 里 pnpm 的依赖（本地 nvm
 * lazy-loader 环境下 webServer 子进程可能解析不到 pnpm）。
 */
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "apps/web");
const distDir = path.join(webDir, "dist");
const fixturesDir = path.join(webDir, "e2e/fixtures");

const PREVIEW_HOST = "127.0.0.1";
const PREVIEW_PORT = process.env.E2E_PROD_PORT ?? "4173";

// 1. Stage the synthetic fixture where the build reads the manifest from.
//    本地开发者的真实 manifest 先备份，退出时尽力恢复（见下方 restore）——
//    否则跑一次 prod-smoke 就把 dev 环境的照片库换成合成数据，虽可
//    `pnpm build:manifest` 重建，但那是一次完整的 S3 增量构建。
const manifestPath = path.join(root, "generated/photos-manifest.json");
const manifestBackupPath = path.join(
  root,
  "generated/photos-manifest.pre-e2e-backup.json",
);
mkdirSync(path.join(root, "generated"), { recursive: true });
const fixtureContent = readFileSync(
  path.join(fixturesDir, "photos-manifest.json"),
  "utf-8",
);
if (
  existsSync(manifestPath) &&
  readFileSync(manifestPath, "utf-8") !== fixtureContent
) {
  copyFileSync(manifestPath, manifestBackupPath);
}
writeFileSync(manifestPath, fixtureContent);

const restoreManifest = () => {
  try {
    if (existsSync(manifestBackupPath)) {
      copyFileSync(manifestBackupPath, manifestPath);
    }
  } catch {
    // 尽力而为：备份文件仍在磁盘上，用户可手动恢复。
  }
};

const webRequire = createRequire(path.join(webDir, "package.json"));
const viteBin = path.join(
  path.dirname(webRequire.resolve("vite/package.json")),
  "bin/vite.js",
);

// 2. Real production build (minified bundle, manual chunks, PWA SW,
//    hashed external-manifest asset, inline fetch script in dist/index.html).
const build = spawnSync(process.execPath, [viteBin, "build"], {
  cwd: webDir,
  stdio: "inherit",
});
if (build.status !== 0) {
  restoreManifest();
  // 顶层 throw：非零退出且不再往下执行（拷贝缩略图 / 启动 preview）。
  throw new Error(`vite build failed with exit code ${build.status ?? "null"}`);
}

// 3. Ship the fixture thumbnails (含 Live Photo 的 .webm 视频) inside dist so
//    the gallery grid loads real files（no route stubs → Service Worker
//    接管后的请求也不会 404）。
cpSync(path.join(fixturesDir, "thumbnails"), path.join(distDir, "thumbnails"), {
  recursive: true,
});
// @vercel/speed-insights 在生产构建里会加载 /_vercel/speed-insights/script.js；
// preview 环境没有 Vercel 注入，放一个空脚本避免 404 console error。
mkdirSync(path.join(distDir, "_vercel/speed-insights"), { recursive: true });
writeFileSync(path.join(distDir, "_vercel/speed-insights/script.js"), "");

// 4. Serve dist; Playwright owns this process's lifetime (kills the tree).
const preview = spawn(
  process.execPath,
  [
    viteBin,
    "preview",
    "--host",
    PREVIEW_HOST,
    "--port",
    PREVIEW_PORT,
    "--strictPort",
  ],
  { cwd: webDir, stdio: "inherit" },
);
preview.on("exit", (code) => {
  restoreManifest();
  // 子进程退出后本进程事件循环随之排空，自然以该码退出（勿用 process.exit，
  // 避免截断尚未 flush 的 stdio）。
  process.exitCode = code ?? 0;
});
// Playwright 关停 webServer 时向进程组发信号：转发给 preview，restore 走
// 上面的 exit 回调；事件循环随后自然排空。
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    preview.kill(signal);
  });
}
