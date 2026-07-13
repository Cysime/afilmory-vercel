import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBuildManifestPath } from "@afilmory/build-assets";

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH = resolveBuildManifestPath();

const MONOREPO_ROOT_PATH = path.resolve(dirname, "../../../../..");

export const LOCALES_PATH = path.join(MONOREPO_ROOT_PATH, "locales") + path.sep;
