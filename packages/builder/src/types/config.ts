import type { BuilderPluginConfigEntry } from "../core/contracts/plugin-ref.js";
import type { StorageConfig } from "../storage/interfaces.js";

export interface LoggingConfig {
  verbose: boolean;
  level: "info" | "warn" | "error" | "debug";
  outputToFile: boolean;
  logFilePath?: string;
}

export interface WorkerPerformanceConfig {
  timeout: number;
  useClusterMode: boolean;
  processCount: number;
  globalTaskConcurrency: number;
  workerConcurrency: number;
  /** @deprecated Use processCount. */
  workerCount: number;
}

export interface SystemProcessingSettings {
  defaultConcurrency: number;
  enableLivePhotoDetection: boolean;
  supportedFormats?: Set<string>;
  digestSuffixLength?: number;
  locationMode: "strip" | "coarse" | "exact";
  worker: WorkerPerformanceConfig;
}

export interface SystemObservabilitySettings {
  showProgress: boolean;
  showDetailedStats: boolean;
  logging: LoggingConfig;
  /** @deprecated Input compatibility only; resolved configs use processing.worker. */
  performance?: { worker?: WorkerPerformanceConfig };
}

export interface SystemBuilderSettings {
  processing: SystemProcessingSettings;
  observability: SystemObservabilitySettings;
}

export interface UserBuilderSettings {
  storage: StorageConfig | null;
}

export interface BuilderOutputSettings {
  manifestPath: string;
  thumbnailsDir: string;
  originalsDir: string;
}

export interface BuilderConfig {
  system: SystemBuilderSettings;
  user: UserBuilderSettings | null;
  output: BuilderOutputSettings;
  plugins: BuilderPluginConfigEntry[];
}

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export type BuilderConfigInput = {
  storage?: StorageConfig | null;
  user?: DeepPartial<UserBuilderSettings>;
  system?: DeepPartial<SystemBuilderSettings>;
  output?: DeepPartial<BuilderOutputSettings>;
  plugins?: BuilderPluginConfigEntry[];
};
