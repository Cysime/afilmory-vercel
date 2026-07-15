import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BuilderOutputSettings } from "./types/config.js";

export type { BuilderOutputSettings } from "./types/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const monorepoRoot = path.resolve(__dirname, "../../..");
export const webAppDir = path.join(monorepoRoot, "apps/web");

export function createDefaultOutputSettings(): BuilderOutputSettings {
  return {
    manifestPath: path.join(monorepoRoot, "generated", "photos-manifest.json"),
    thumbnailsDir: path.join(webAppDir, "public", "thumbnails"),
    originalsDir: path.join(webAppDir, "public", "originals"),
  };
}

export function assertSafeThumbnailOutputDirectory(
  thumbnailsDir: string,
): void {
  const resolved = path.resolve(thumbnailsDir);
  if (
    resolved === path.parse(resolved).root ||
    resolved === path.resolve(".")
  ) {
    throw new Error(
      `output.thumbnailsDir must be a dedicated subdirectory, not ${JSON.stringify(resolved)}`,
    );
  }
}

// 唯一的归一化入口：resolveBuilderConfig 与 AfilmoryBuilder 构造器都会经过这里，
// 此后所有读者（manifest IO、缩略图路径、CLI 的 .encoding 检查）拿到的永远是
// 绝对路径，不再依赖读取时的 cwd。
export function normalizeBuilderOutputSettings(
  output: BuilderOutputSettings,
): BuilderOutputSettings {
  const normalized = {
    manifestPath: path.resolve(output.manifestPath),
    thumbnailsDir: path.resolve(output.thumbnailsDir),
    originalsDir: path.resolve(output.originalsDir),
  };
  assertSafeThumbnailOutputDirectory(normalized.thumbnailsDir);
  return normalized;
}
