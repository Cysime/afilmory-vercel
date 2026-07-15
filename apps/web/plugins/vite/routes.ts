import { readdirSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

export const VIRTUAL_ROUTES_MODULE_ID = "virtual:afilmory-routes";
const RESOLVED_VIRTUAL_ROUTES_MODULE_ID = `\0${VIRTUAL_ROUTES_MODULE_ID}`;

export function createVirtualRoutesModuleSource(
  includePrivateRoutes: boolean,
  productionRouteFiles: string[] = [],
) {
  if (includePrivateRoutes) {
    return [
      'const rawRoutes = import.meta.glob("/src/pages/**/*.tsx");',
      "export const globTree = Object.fromEntries(",
      "  Object.entries(rawRoutes).map(([key, loader]) => [key.replace(/^\\/src\\//, './'), loader]),",
      ");",
    ].join("\n");
  }

  const entries = productionRouteFiles.map((relativePath) => {
    const normalized = relativePath.replaceAll("\\", "/");
    return `${JSON.stringify(`./pages/${normalized}`)}: () => import(${JSON.stringify(`/src/pages/${normalized}`)})`;
  });
  return `export const globTree = {${entries.join(",")}};`;
}

function collectProductionRouteFiles(directory: string): string[] {
  const files: string[] = [];
  const visit = (currentDirectory: string, relativeDirectory = "") => {
    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (
        entry.isDirectory() &&
        (relativePath === "(debug)" || relativePath === "(data)")
      ) {
        continue;
      }
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        files.push(relativePath);
      }
    }
  };
  visit(directory);
  return files.sort();
}

/**
 * Emits exactly one import.meta.glob expression for the active environment.
 * Keeping both dev and production globs in a source-level ternary makes Vite
 * transform both branches, which previously shipped private debug/data pages.
 */
export function virtualRoutesPlugin(): Plugin {
  let includePrivateRoutes = false;
  let productionRouteFiles: string[] = [];
  return {
    name: "afilmory-virtual-routes",
    configResolved(config) {
      includePrivateRoutes = config.command === "serve";
      if (!includePrivateRoutes) {
        productionRouteFiles = collectProductionRouteFiles(
          path.resolve(config.root, "src/pages"),
        );
      }
    },
    resolveId(id) {
      return id === VIRTUAL_ROUTES_MODULE_ID
        ? RESOLVED_VIRTUAL_ROUTES_MODULE_ID
        : null;
    },
    load(id) {
      return id === RESOLVED_VIRTUAL_ROUTES_MODULE_ID
        ? createVirtualRoutesModuleSource(
            includePrivateRoutes,
            productionRouteFiles,
          )
        : null;
    },
  };
}
