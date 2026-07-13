import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BUILD_MANIFEST_PATH = path.resolve(
  dirname,
  "../../../generated/photos-manifest.json",
);

/**
 * Resolves the build-time manifest without changing the repository default.
 * E2E passes an isolated fixture through AFILMORY_MANIFEST_PATH so tests never
 * overwrite a developer's generated manifest.
 */
export function resolveBuildManifestPath(
  override = process.env.AFILMORY_MANIFEST_PATH,
  cwd = process.cwd(),
): string {
  if (!override) return DEFAULT_BUILD_MANIFEST_PATH;

  const resolved = path.resolve(cwd, override);
  if (!existsSync(resolved) || !lstatSync(resolved).isFile()) {
    throw new Error(
      `[manifest-path] AFILMORY_MANIFEST_PATH must point to an existing file: ${resolved}`,
    );
  }
  return resolved;
}
