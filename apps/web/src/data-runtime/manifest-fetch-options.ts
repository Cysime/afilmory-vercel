// manifest 请求的共享契约：超时时长与 fetch 选项。
// 两个消费方必须保持一致，否则外部模式下内联脚本发起的请求与运行时兜底
// 请求参数不同，浏览器无法复用缓存/连接：
// 1. manifest-runtime.ts 的 fetchManifest（运行时兜底路径）
// 2. manifest-inline-fetch.ts（被 data-inject 插件打包进 index.html 的内联脚本，
//    在 HTML 解析期提前发起 fetch）
export const MANIFEST_REQUEST_TIMEOUT_MS = 15_000;

export function buildManifestRequestInit(signal?: AbortSignal): RequestInit {
  return {
    credentials: "same-origin",
    cache: "force-cache",
    signal,
    headers: {
      accept: "application/json",
    },
  };
}
