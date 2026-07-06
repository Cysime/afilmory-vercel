import path from "node:path";

const dirname = path.dirname(new URL(import.meta.url).pathname);
export const MANIFEST_PATH = path.resolve(
  dirname,
  "../../../../../generated/photos-manifest.json",
);

const MONOREPO_ROOT_PATH = path.resolve(dirname, "../../../../..");

export const LOCALES_PATH = path.join(MONOREPO_ROOT_PATH, "locales") + path.sep;
