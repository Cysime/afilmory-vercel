import os from "node:os";

import { createDefaultOutputSettings } from "../output-paths.js";
import type { BuilderConfig } from "../types/config.js";

export function createDefaultBuilderConfig(): BuilderConfig {
  return {
    system: {
      processing: {
        defaultConcurrency: 10,
        enableLivePhotoDetection: true,
        digestSuffixLength: 0,
      },
      observability: {
        showProgress: true,
        showDetailedStats: true,
        logging: {
          verbose: false,
          level: "info",
          outputToFile: false,
        },
        performance: {
          worker: {
            workerCount: Math.min(1024, Math.max(1, os.cpus().length * 2)),
            timeout: 300_000,
            useClusterMode: true,
            workerConcurrency: 2,
          },
        },
      },
    },
    user: null,
    output: createDefaultOutputSettings(),
    plugins: [],
  };
}
