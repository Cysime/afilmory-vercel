import { loadConfig } from "c12";
import consola from "consola";

import type { BuilderConfig, BuilderConfigInput } from "../types/config.js";
import { clone } from "../utils/clone.js";
import { createDefaultBuilderConfig } from "./defaults.js";
import { applyBuilderConfigInput, redactConfigSecrets } from "./schema.js";

export interface LoadBuilderConfigOptions {
  cwd?: string;
  configFile?: string;
}

export function resolveBuilderConfig(
  input: BuilderConfigInput,
  base?: BuilderConfig,
): BuilderConfig {
  const config = base ? clone(base) : createDefaultBuilderConfig();
  const warnings = applyBuilderConfigInput(config, input);
  for (const warning of warnings) {
    // builder.config.ts 是每个 self-hoster 都要编辑的文件，拼写错误必须大声可见
    consola.warn(warning);
  }
  return config;
}

export async function loadBuilderConfig(
  options: LoadBuilderConfigOptions = {},
): Promise<BuilderConfig> {
  const result = await loadConfig<BuilderConfigInput>({
    name: "builder",
    cwd: options.cwd ?? process.cwd(),
    configFile: options.configFile,
    rcFile: false,
    dotenv: false,
  });

  const userConfig = result.config ?? {};

  const config = resolveBuilderConfig(userConfig);

  if (!config.user?.storage) {
    throw new Error("缺失存储配置，请配置 storage 字段");
  }

  if (process.env.DEBUG === "1") {
    const logger = consola.withTag("CONFIG");
    logger.info("Using builder config from", result.configFile ?? "defaults");
    logger.info(redactConfigSecrets(config));
  }

  return config;
}
