import { AsyncLocalStorage } from "node:async_hooks";

import type { PhotoExecutionContext } from "../core/contracts/execution-context.js";
import type { StorageConfig } from "../storage/interfaces.js";

export type {
  EmitPluginEventFn,
  PhotoExecutionContext,
} from "../core/contracts/execution-context.js";

const photoContextStorage = new AsyncLocalStorage<PhotoExecutionContext>();

export function runWithPhotoExecutionContext<T>(
  context: PhotoExecutionContext,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return photoContextStorage.run(context, callback);
}

export function getPhotoExecutionContext(): PhotoExecutionContext {
  const context = photoContextStorage.getStore();
  if (!context) {
    throw new Error("Photo execution context is not available");
  }
  return context;
}

function sanitizeStoragePath(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * 创建一个用于标准化存储键值的函数
 * 会去除配置中的 prefix/path 等前缀，并统一路径分隔符
 */
export function createStorageKeyNormalizer(
  storageConfig: StorageConfig,
): (key: string) => string {
  // 只有 S3 配置有 prefix；本地文件系统的 key 本来就是相对 basePath 的路径。
  // 用 "prefix" in 而不是判别字段，兼容缺失 provider 的历史配置对象。
  const basePrefix = sanitizeStoragePath(
    "prefix" in storageConfig ? storageConfig.prefix : undefined,
  );

  const prefixWithSlash = basePrefix ? `${basePrefix}/` : "";

  return (rawKey: string): string => {
    if (!rawKey) return "";

    const sanitizedKey = rawKey
      .replaceAll("\\", "/")
      .replaceAll(/\/+/g, "/")
      .replace(/^\/+/, "");

    if (!basePrefix) {
      return sanitizedKey;
    }

    if (sanitizedKey === basePrefix) {
      return "";
    }

    if (sanitizedKey.startsWith(prefixWithSlash)) {
      return sanitizedKey.slice(prefixWithSlash.length);
    }

    return sanitizedKey;
  };
}
