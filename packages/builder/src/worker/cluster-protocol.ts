import type { StorageObject } from "../storage/interfaces.js";
import type { BuilderConfig } from "../types/config.js";
import type { BuilderOptions } from "../types/options.js";
import type { PhotoManifestItem } from "../types/photo.js";

export interface ClusterWorkerSharedData {
  existingManifestMap: Map<string, PhotoManifestItem>;
  livePhotoMap: Map<string, StorageObject>;
  imageObjects: StorageObject[];
  builderConfig: BuilderConfig;
  builderOptions: BuilderOptions;
  photoIdCollisionKeys?: string[];
}

export interface WorkerReadyMessage {
  type: "ready" | "pong";
  workerId: number;
}

export interface TaskMessage {
  type: "task";
  taskId: string;
  taskIndex: number;
  workerId: number;
}

export interface BatchTaskMessage {
  type: "batch-task";
  tasks: Array<{
    taskId: string;
    taskIndex: number;
  }>;
  workerId: number;
}

export interface TaskResult {
  type: "result" | "error";
  taskId: string;
  result?: unknown;
  error?: string;
}

export interface BatchTaskResult {
  type: "batch-result";
  results: TaskResult[];
}

export interface WorkerStats {
  workerId: number;
  processedTasks: number;
  isIdle: boolean;
  isReady: boolean;
}

export interface WorkerInitMessage {
  type: "init";
  // IPC 通道使用 advanced（v8 结构化克隆）序列化，Map/Date/Buffer 可原生传输，
  // 因此这里直接携带共享数据本体，无需手动 v8.serialize -> number[] 的中转。
  sharedData: ClusterWorkerSharedData;
}

export type ClusterWorkerMessage =
  | TaskResult
  | BatchTaskResult
  | WorkerReadyMessage
  | { type: "init-complete"; workerId: number };
