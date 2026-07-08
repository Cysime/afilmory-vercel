import type { BuilderConfigFileInput } from "./schema.js";

export function defineBuilderConfig(
  config: BuilderConfigFileInput | (() => BuilderConfigFileInput),
): BuilderConfigFileInput {
  return typeof config === "function" ? config() : config;
}
