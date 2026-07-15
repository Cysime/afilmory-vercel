import { readFileSync } from "node:fs";

import type { AfilmoryManifest } from "@afilmory/schema";
import {
  applyManifestLocationPrivacy,
  assertManifest,
  createEmptyManifest,
} from "@afilmory/schema";
import { DOMParser } from "linkedom";
import type { Plugin } from "vite";

import { env } from "../../../../env";
import { siteConfig } from "../../../../site.config.build";
import type { ProjectPackageMetadata } from "./__internal__/build-metadata";
import {
  assertPublishableSourceMetadata,
  resolveBuildMetadata,
} from "./__internal__/build-metadata";
import { MANIFEST_PATH } from "./__internal__/constants";
import { createWebDeliveryArtifacts } from "./__internal__/delivery-manifest-build";
import { buildExternalManifestScriptContent } from "./__internal__/manifest-inline-snippet";

// ── manifest helpers ──────────────────────────────────────────────────────────

function resolveEmbedPreference(command: "serve" | "build"): boolean {
  const flag = process.env.AFILMORY_EMBED_MANIFEST?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return command === "serve";
}

function getManifest(command: "serve" | "build"): AfilmoryManifest {
  try {
    const manifest = assertManifest(
      JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")),
    );
    return applyManifestLocationPrivacy(manifest, env.PHOTO_LOCATION_MODE);
  } catch (error) {
    if (command === "build") {
      throw new Error(
        `[data-inject] Cannot read manifest at ${MANIFEST_PATH}. ` +
          `Run "pnpm build:manifest" before "pnpm build:web". Original error: ${error}`,
      );
    }
    console.warn(
      "[data-inject] Failed to read manifest file (dev mode, using empty object):",
      error,
    );
    return createEmptyManifest();
  }
}

function getManifestContent(command: "serve" | "build"): string {
  return JSON.stringify(getManifest(command));
}

function escapeInlineScriptJson(json: string): string {
  return json
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003C")
    .replaceAll(">", "\\u003E")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function ensureRuntimeScript(): string {
  return `window.__AFILMORY__ = Object.assign({ version: 1 }, window.__AFILMORY__);`;
}

function buildRuntimeAssignment(path: string, json: string): string {
  return `${ensureRuntimeScript()}window.__AFILMORY__.${path} = ${escapeInlineScriptJson(json)};`;
}

function getBuildMetadata() {
  let metadata: ProjectPackageMetadata = {};
  try {
    metadata = JSON.parse(
      readFileSync(
        new URL("../../../../package.json", import.meta.url),
        "utf8",
      ),
    ) as ProjectPackageMetadata;
  } catch {
    // A missing package file should not make a downstream source checkout
    // impossible to build; the UI still exposes the generic project URL.
  }
  return resolveBuildMetadata({ metadata });
}

// ── site-config helpers ───────────────────────────────────────────────────────

const CONFIG_SCRIPT_ID = "config";
const INJECTED_SCRIPT_ID = "config-runtime";
const MANIFEST_DEV_PUBLIC_PATH = "/__afilmory/gallery-index.json";

function buildInlineManifestScriptContent(manifestJson: string): string {
  return [
    ensureRuntimeScript(),
    `window.__AFILMORY__.manifest = {`,
    `  mode: 'inline',`,
    `  data: ${escapeInlineScriptJson(manifestJson)},`,
    `};`,
    `window.__AFILMORY__.manifest.promise = Promise.resolve(window.__AFILMORY__.manifest.data);`,
  ].join("");
}

// 外部模式的内联脚本见 __internal__/manifest-inline-snippet.ts：
// 由 src/data-runtime/manifest-inline-fetch.ts 打包而来，不再手写字符串。

// ── combined plugin ───────────────────────────────────────────────────────────

export function dataInjectPlugin(): Plugin {
  let embedManifest: boolean | undefined;
  let resolvedCommand: "serve" | "build" | undefined;
  let emittedManifestAssetFileName: string | null = null;
  let devDeliveryAssets = new Map<string, string>();

  const buildMetadata = getBuildMetadata();
  const siteConfigScriptContent = buildRuntimeAssignment(
    "config",
    JSON.stringify({
      site: siteConfig,
    }),
  );
  const buildInfoScriptContent = buildRuntimeAssignment(
    "build",
    JSON.stringify(buildMetadata),
  );
  const parser = new DOMParser();
  const getBuildManifestAssetPublicPath = () => {
    if (!emittedManifestAssetFileName) {
      throw new Error(
        "[data-inject] External manifest asset path was not initialized during build.",
      );
    }
    return `/${emittedManifestAssetFileName}`;
  };

  return {
    name: "data-inject",
    enforce: "pre",

    configResolved(config) {
      resolvedCommand = config.command as "serve" | "build";
      embedManifest = resolveEmbedPreference(resolvedCommand);
    },

    buildStart() {
      if (resolvedCommand === "serve") return;
      assertPublishableSourceMetadata(buildMetadata);
      const shouldEmbed = embedManifest ?? resolveEmbedPreference("build");
      emittedManifestAssetFileName = null;

      if (shouldEmbed) {
        return;
      }

      const delivery = createWebDeliveryArtifacts(
        getManifest("build"),
        undefined,
        env.PHOTO_LOCATION_MODE,
      );
      emittedManifestAssetFileName = delivery.indexFileName;
      for (const asset of delivery.assets) {
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: asset.source,
        });
      }
      const savedPercent =
        delivery.fullManifestBytes > 0
          ? Math.round(
              (1 - delivery.indexBytes / delivery.fullManifestBytes) * 100,
            )
          : 0;
      this.info(
        `Emitted Web Delivery Manifest v3 (${delivery.indexBytes} bytes, ${savedPercent}% smaller startup payload)`,
      );
    },

    configureServer(server) {
      const shouldEmbed =
        embedManifest ??
        resolveEmbedPreference(server.config.command as "serve");
      server.watcher.add(MANIFEST_PATH);

      server.watcher.on("change", (file) => {
        if (file === MANIFEST_PATH) {
          server.config.logger.info(
            "[data-inject] Manifest file changed, triggering full reload",
          );
          // 触发页面重新加载
          server.ws.send({
            type: "full-reload",
          });
        }
      });

      if (shouldEmbed) {
        return;
      }

      const refreshDevDeliveryAssets = () => {
        const delivery = createWebDeliveryArtifacts(
          getManifest("serve"),
          undefined,
          env.PHOTO_LOCATION_MODE,
        );
        devDeliveryAssets = new Map(
          delivery.assets.map((asset) => [`/${asset.fileName}`, asset.source]),
        );
        return devDeliveryAssets.get(`/${delivery.indexFileName}`) ?? "{}";
      };

      server.middlewares.use(MANIFEST_DEV_PUBLIC_PATH, (_req, res) => {
        try {
          const manifestContent = refreshDevDeliveryAssets();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(manifestContent);
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
      server.middlewares.use((req, res, next) => {
        const pathname = req.url
          ? new URL(req.url, "http://localhost").pathname
          : "";
        const source = devDeliveryAssets.get(pathname);
        if (source === undefined) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(source);
      });
    },

    transformIndexHtml(html, ctx) {
      const command: "serve" | "build" = ctx?.server ? "serve" : "build";
      const shouldEmbed = embedManifest ?? resolveEmbedPreference(command);
      embedManifest = shouldEmbed;
      const document = parser.parseFromString(html, "text/html");

      const manifestScriptContent = shouldEmbed
        ? buildInlineManifestScriptContent(getManifestContent(command))
        : buildExternalManifestScriptContent(
            command === "serve"
              ? MANIFEST_DEV_PUBLIC_PATH
              : getBuildManifestAssetPublicPath(),
          );

      const manifestScript = document.querySelector("#manifest");
      if (manifestScript) {
        manifestScript.textContent = manifestScriptContent;
      }

      // 不再注入 <link rel="preload" as="fetch"> ——外部模式下，内联的 #manifest
      // 脚本已在解析期立即发起 fetch(cache:"force-cache", accept:application/json) 做
      // 早发现。preload 与该 fetch 几乎同时发起、请求参数又不同(cache 模式/accept 头)，
      // 浏览器无法把 preload 复用给 fetch，结果 manifest 被并发下载两次(~86KB)。
      // 内联 fetch 本身就是早发现机制，preload 纯属冗余，移除以消除重复下载。

      if (!document.querySelector(`#${INJECTED_SCRIPT_ID}`)) {
        const scriptEl = document.createElement("script", "text/javascript");
        scriptEl.id = INJECTED_SCRIPT_ID;
        scriptEl.textContent = `${siteConfigScriptContent}${buildInfoScriptContent}`;

        const configScript = document.querySelector(`#${CONFIG_SCRIPT_ID}`);
        if (configScript?.parentNode) {
          configScript.parentNode.insertBefore(
            scriptEl,
            configScript.nextSibling,
          );
        } else if (document.head) {
          document.head.append(scriptEl);
        } else {
          const fallbackParent = document.body ?? document.documentElement;
          fallbackParent?.append(scriptEl);
        }
      }

      return document.toString();
    },
  };
}
