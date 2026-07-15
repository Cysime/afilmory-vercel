import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 外部 manifest 模式下注入 index.html 的内联脚本不再手写字符串，而是把真正的
// TypeScript 模块 src/data-runtime/manifest-inline-fetch.ts 在构建期用 esbuild
// 打包成经典内联脚本（IIFE、无 import、target es2018——CSP 下必须保持 classic
// inline script）。这样超时常量与 fetch 选项和 manifest-runtime.ts 共享同一份
// 契约，不会再出现手写副本悄悄漂移的问题。

const dirname = path.dirname(fileURLToPath(import.meta.url));

const INLINE_FETCH_MODULE_PATH = path.resolve(
  dirname,
  "../../../src/data-runtime/manifest-inline-fetch.ts",
);

// manifest URL 每次构建都带内容 hash，而打包产物与 URL 无关：先用占位字符串
// 打包一次并缓存，再按调用替换成真实 URL(JSON.stringify 后的字符串字面量)。
const MANIFEST_URL_PLACEHOLDER = "__AFILMORY_MANIFEST_URL_PLACEHOLDER__";

const ENTRY_CONTENTS = [
  `import { startManifestInlineFetch } from ${JSON.stringify(
    INLINE_FETCH_MODULE_PATH,
  )};`,
  `startManifestInlineFetch(${JSON.stringify(MANIFEST_URL_PLACEHOLDER)});`,
].join("\n");

type ManifestSnippetEsbuild = {
  buildSync: (options: {
    stdin: {
      contents: string;
      resolveDir: string;
      sourcefile: string;
      loader: "ts";
    };
    bundle: true;
    write: false;
    format: "iife";
    platform: "browser";
    target: string;
    minify: false;
  }) => { outputFiles?: Array<{ text: string }> };
};

function loadEsbuild(): ManifestSnippetEsbuild {
  // pnpm 严格 node_modules 下 esbuild 没有被提升到 apps/web 可解析的位置，
  // 但它永远装在 vite 的依赖旁边（vite 直接依赖 esbuild），所以顺着 vite 的
  // 解析链去找。
  const requireFromHere = createRequire(import.meta.url);
  const requireFromVite = createRequire(requireFromHere.resolve("vite"));
  return requireFromVite("esbuild") as ManifestSnippetEsbuild;
}

let cachedSnippetTemplate: string | null = null;

function bundleInlineFetchSnippet(): string {
  const result = loadEsbuild().buildSync({
    stdin: {
      contents: ENTRY_CONTENTS,
      resolveDir: path.dirname(INLINE_FETCH_MODULE_PATH),
      sourcefile: "manifest-inline-fetch-entry.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    // 经典内联脚本：输出禁止出现 import 语句（IIFE 保证）。
    format: "iife",
    platform: "browser",
    // 与此前手写内联脚本的兼容目标一致（??= 等新语法会被降级）。
    target: "es2018",
    minify: false,
  });

  const text = result.outputFiles?.[0]?.text;
  if (!text) {
    throw new Error(
      "[data-inject] esbuild produced no output for the manifest inline-fetch snippet.",
    );
  }
  if (!text.includes(JSON.stringify(MANIFEST_URL_PLACEHOLDER))) {
    throw new Error(
      "[data-inject] Manifest URL placeholder was lost while bundling the inline-fetch snippet.",
    );
  }
  // 内联 <script> 安全性：产物里绝不能出现提前终止标签的序列。
  if (text.includes("</script") || text.includes("<!--")) {
    throw new Error(
      "[data-inject] Bundled inline-fetch snippet contains an HTML-breaking sequence.",
    );
  }
  return text;
}

export function buildExternalManifestScriptContent(
  manifestUrl: string,
): string {
  cachedSnippetTemplate ??= bundleInlineFetchSnippet();
  return cachedSnippetTemplate.replaceAll(
    JSON.stringify(MANIFEST_URL_PLACEHOLDER),
    JSON.stringify(manifestUrl),
  );
}
