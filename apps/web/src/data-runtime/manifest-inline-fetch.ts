// 该模块是外部 manifest 模式下内联 <script> 的唯一事实来源：data-inject vite
// 插件在构建期用 esbuild 把它打包成经典内联脚本（IIFE、无 import、target
// es2018）注入 index.html 的 #manifest 槽位，在 HTML 解析期立即发起 fetch 做
// 早发现，并把 { mode: 'external', url, promise } 存到 window.__AFILMORY__.manifest
// 供 manifest-runtime.ts 消费。超时与 fetch 选项来自 manifest-fetch-options.ts，
// 与运行时兜底路径共享同一份契约。
//
// 注意：这里必须用相对路径导入（不能用 ~/ 别名）——esbuild 打包该文件时
// 不知道 vite 的别名配置。
import type { AfilmoryBrowserRuntime } from "../runtime/browser-runtime";
import {
  buildManifestRequestInit,
  MANIFEST_REQUEST_TIMEOUT_MS,
} from "./manifest-fetch-options";

type AfilmoryWindow = Window &
  typeof globalThis & {
    __AFILMORY__?: AfilmoryBrowserRuntime;
  };

export function startManifestInlineFetch(manifestUrl: string): void {
  const win = window as AfilmoryWindow;
  // 与 index.html 中 #config 内联脚本一致的 runtime 初始化写法：
  // 用 Object.assign 兜底 version 字段，同时保留已存在的属性。
  const runtime: AfilmoryBrowserRuntime = Object.assign(
    { version: 1 as const },
    win.__AFILMORY__ ?? {},
  );
  win.__AFILMORY__ = runtime;

  const manifest =
    runtime.manifest?.mode === "external"
      ? runtime.manifest
      : { mode: "external" as const, url: manifestUrl };
  runtime.manifest = manifest;
  manifest.url = manifestUrl;

  manifest.promise ??= (() => {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = win.setTimeout(
      () => controller?.abort(),
      MANIFEST_REQUEST_TIMEOUT_MS,
    );
    return fetch(
      manifest.url,
      buildManifestRequestInit(controller ? controller.signal : undefined),
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `[data-inject] Failed to fetch manifest: ${response.status} ${response.statusText}`.trim(),
          );
        }
        return response.json();
      })
      .finally(() => win.clearTimeout(timeoutId));
  })();
}
