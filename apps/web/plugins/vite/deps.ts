import { gzipSync } from "node:zlib";

import type { Plugin, UserConfig } from "vite";

export type DependencyChunkGroup = {
  name: string;
  patterns: string[];
};

function getNodeModulePackageName(id: string): string | null {
  const modulePath = id.split("/node_modules/").at(-1);
  if (!modulePath) return null;

  const [firstSegment, secondSegment] = modulePath.split("/");
  if (!firstSegment || firstSegment === ".pnpm") return null;

  if (firstSegment.startsWith("@") && secondSegment) {
    return `${firstSegment}/${secondSegment}`;
  }

  return firstSegment;
}

function matchesPattern(packageName: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    return packageName.startsWith(pattern.slice(0, -1));
  }

  return packageName === pattern;
}

export function createDependencyChunksPlugin(
  groups: DependencyChunkGroup[],
): Plugin {
  return {
    name: "dependency-chunks",
    config(config: UserConfig) {
      config.build = config.build || {};
      // The HEIC codec bundle is intentionally loaded on demand and remains large.
      config.build.chunkSizeWarningLimit = 3000;
      config.build.rollupOptions = config.build.rollupOptions || {};
      config.build.rollupOptions.output =
        config.build.rollupOptions.output || {};

      const { output } = config.build.rollupOptions;
      const outputConfig = Array.isArray(output) ? output[0] : output;
      // 产物命名模板集中在这里单一来源；vite.config.ts 里的同名字段会被本钩子覆盖。
      outputConfig.entryFileNames = "assets/[name].[hash].js";
      outputConfig.assetFileNames = "assets/[name].[hash:6][extname]";
      // Let Rollup place shared helpers into a neutral shared chunk.
      // Forcing only-explicit manual chunks can make vendor chunks import the entry chunk,
      // which creates bootstrap-time ESM cycles in production.
      outputConfig.chunkFileNames = (chunkInfo) => {
        return chunkInfo.name.startsWith("vendor/")
          ? "[name]-[hash].js"
          : "assets/[name]-[hash].js";
      };

      outputConfig.manualChunks = (id: string) => {
        // Vite's preload helper and Rollup's CommonJS helpers are shared by both
        // eager and lazy chunks. If Rollup happens to place either helper inside
        // a large lazy-only vendor chunk (MapLibre was the observed case), the
        // entry chunk acquires a static import to that vendor and Vite emits a
        // modulepreload for the whole feature. Keep runtime glue in a tiny,
        // neutral chunk so feature boundaries stay real rather than cosmetic.
        if (
          id.includes("vite/preload-helper") ||
          id.includes("commonjsHelpers") ||
          id.includes("commonjs-dynamic-modules")
        ) {
          return "vendor/runtime";
        }

        if (!id.includes("/node_modules/")) {
          return null;
        }

        const packageName = getNodeModulePackageName(id);
        if (!packageName) {
          return null;
        }

        const matchedGroup = groups.find((group) =>
          group.patterns.some((pattern) =>
            matchesPattern(packageName, pattern),
          ),
        );
        return matchedGroup ? `vendor/${matchedGroup.name}` : null;
      };
    },
    generateBundle(_outputOptions, bundle) {
      const chunks = Object.values(bundle).filter(
        (item): item is Extract<(typeof bundle)[string], { type: "chunk" }> =>
          item.type === "chunk",
      );
      const chunksByFileName = new Map(
        chunks.map((chunk) => [chunk.fileName, chunk]),
      );
      const entryFiles = new Set(
        chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName),
      );

      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk" || !item.fileName.startsWith("vendor/")) {
          continue;
        }

        const importedEntryChunk = [
          ...item.imports,
          ...item.dynamicImports,
        ].find((importedFile) => entryFiles.has(importedFile));

        if (importedEntryChunk) {
          this.error(
            `Vendor chunk ${item.fileName} must not depend on entry chunk ${importedEntryChunk}. ` +
              "This creates a bootstrap cycle and can break production initialization.",
          );
        }
      }

      // Protect the initial dependency closure, not merely individual chunk
      // sizes. A tiny entry can still preload a megabyte through one misplaced
      // helper import. Map/HEIC/raw-EXIF are deliberately lazy product features
      // and must never enter the static entry closure.
      const initialFiles = new Set<string>();
      const visitInitialImport = (fileName: string) => {
        if (initialFiles.has(fileName)) return;
        initialFiles.add(fileName);
        const chunk = chunksByFileName.get(fileName);
        for (const importedFile of chunk?.imports ?? []) {
          visitInitialImport(importedFile);
        }
      };
      for (const entryFile of entryFiles) visitInitialImport(entryFile);

      const forbiddenInitialPrefixes = [
        "vendor/map-",
        "vendor/heic-",
        "vendor/exiftool-",
      ];
      const leakedLazyChunk = [...initialFiles].find((fileName) =>
        forbiddenInitialPrefixes.some((prefix) => fileName.startsWith(prefix)),
      );
      if (leakedLazyChunk) {
        this.error(
          `Lazy-only chunk ${leakedLazyChunk} leaked into the static entry dependency closure.`,
        );
      }

      const initialGzipBytes = [...initialFiles].reduce((total, fileName) => {
        const item = bundle[fileName];
        if (!item) return total;
        const source =
          item.type === "chunk"
            ? item.code
            : typeof item.source === "string"
              ? item.source
              : Buffer.from(item.source);
        return total + gzipSync(source).byteLength;
      }, 0);
      const initialJsBudget = 360 * 1024;
      if (initialGzipBytes > initialJsBudget) {
        this.error(
          `Initial JavaScript closure is ${(initialGzipBytes / 1024).toFixed(1)} KiB gzip; budget is ${initialJsBudget / 1024} KiB.`,
        );
      }
    },
  };
}
