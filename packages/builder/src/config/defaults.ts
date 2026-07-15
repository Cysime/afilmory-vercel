import os from "node:os";

import { createDefaultOutputSettings } from "../output-paths.js";
import type { BuilderConfig } from "../types/config.js";

export function createDefaultBuilderConfig(): BuilderConfig {
  const available =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length;
  const processCount = Math.min(4, Math.max(1, Math.ceil(available / 2)));
  return {
    system: {
      processing: {
        defaultConcurrency: 10,
        enableLivePhotoDetection: true,
        digestSuffixLength: 0,
        locationMode: "coarse",
        worker: {
          processCount,
          globalTaskConcurrency: Math.min(8, Math.max(1, available)),
          workerCount: processCount,
          timeout: 300_000,
          useClusterMode: true,
          workerConcurrency: 2,
        },
      },
      observability: {
        showProgress: true,
        showDetailedStats: true,
        logging: {
          verbose: false,
          level: "info",
          outputToFile: false,
        },
      },
    },
    user: null,
    output: createDefaultOutputSettings(),
    plugins: [],
  };
}
