import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// 两种互斥的运行模式，避免日常 dev-server 迭代为生产构建买单：
//
// - 默认（`pnpm test:e2e`）：vite dev server + 内嵌 manifest，跑 chromium /
//   mobile 两个 project（runtime-state、dismiss-gesture 等 spec）。
// - prod-smoke（`pnpm test:e2e:prod`，即 E2E_PROD_SMOKE=true；命令行里出现
//   "prod-smoke" —— 如 `playwright test --project=prod-smoke` —— 也会触发）：
//   webServer 换成 scripts/e2e-prod-server.ts，先用合成 fixture 做一次真实
//   vite build（外部 manifest 资产 + PWA Service Worker + 压缩分块产物），
//   再以 vite preview 伺服 dist，只跑 prod-smoke project。
//
// 两个模式请分开调用（CI 也如此）：Playwright 的 webServer 数组不会按
// --project 过滤，若两个 server 常驻同一份配置，纯 dev 运行也要等生产构建。
const prodSmoke =
  process.env.E2E_PROD_SMOKE === "true" ||
  process.argv.some((arg) => arg.includes("prod-smoke"));

const devBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:1924";
const prodBaseURL =
  process.env.PLAYWRIGHT_PROD_BASE_URL ?? "http://127.0.0.1:4173";
const baseURL = prodSmoke ? prodBaseURL : devBaseURL;

// 本地 zsh 的 nvm lazy-loader 可能让 webServer 子进程解析不到 node/pnpm：
// 把当前 node 的 bin 目录置于 PATH 最前（nvm 下全局 pnpm 也装在这里）。
const nodeBinDir = path.dirname(process.execPath);
const webServerPath = `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ""}`;

// 环境里设有 HTTP(S)_PROXY 时，Playwright 对 webServer url 的健康检查也会把
// 127.0.0.1 发往代理（表现为 407/连接失败，服务器永远"未就绪"）。loopback
// 永远不该走代理：显式追加到 NO_PROXY。
for (const key of ["NO_PROXY", "no_proxy"] as const) {
  process.env[key] = [process.env[key], "127.0.0.1,localhost"]
    .filter(Boolean)
    .join(",");
}

export default defineConfig({
  testDir: "./apps/web/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: htmlReportFolder() }]]
    : [["list"], ["html", { outputFolder: htmlReportFolder() }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: prodSmoke
    ? {
        command: "pnpm exec tsx scripts/e2e-prod-server.ts",
        env: { PATH: webServerPath },
        // Playwright 默认 SIGKILL 整棵进程树，e2e-prod-server 的 manifest
        // 备份恢复（SIGTERM → preview exit → restore）会被跳过：先给 SIGTERM
        // 一个宽限期，恢复逻辑才有机会执行。
        gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
        reuseExistingServer: !process.env.CI,
        // 完整生产构建（含 vite-plugin-checker 的 tsc）+ preview 启动。
        timeout: 420_000,
        url: prodBaseURL,
      }
    : {
        command:
          "pnpm --filter @afilmory/web exec vite --host 127.0.0.1 --port 1924 --strictPort",
        env: {
          AFILMORY_EMBED_MANIFEST: "true",
          PATH: webServerPath,
        },
        reuseExistingServer: !process.env.CI,
        // Cold Vite dep-optimization (heavy deps: maplibre, react, motion) can take
        // well over a minute on a fresh CI cache; keep generous headroom.
        timeout: 180_000,
        url: devBaseURL,
      },
  projects: prodSmoke
    ? [
        {
          name: "prod-smoke",
          use: { ...devices["Desktop Chrome"] },
          testMatch: /prod-smoke\.spec\.ts/,
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
          testIgnore: /prod-smoke\.spec\.ts/,
        },
        {
          // 触摸 + 移动布局（viewport <1024 → useMobile() 为真）。用于下滑关闭的触摸路径，
          // 触摸拖拽经 CDP Input.dispatchTouchEvent 派发（见 e2e/dismiss-gesture.spec.ts）。
          // 仅跑手势 spec；runtime-state 等桌面 spec 只在 chromium 上跑。
          name: "mobile",
          use: { ...devices["Pixel 5"] },
          testMatch: /dismiss-gesture\.spec\.ts/,
        },
      ],
});

// 两种模式先后运行时（本地验证、CI 同一 job 两个 step）互不覆盖 HTML 报告。
function htmlReportFolder() {
  return prodSmoke ? "playwright-report-prod" : "playwright-report";
}
