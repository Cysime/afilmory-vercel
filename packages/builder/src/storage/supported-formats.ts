import path from "node:path";

import { SUPPORTED_FORMATS } from "../constants/index.js";

// 「是否为受支持的图片」的唯一事实来源：按扩展名判断。
// 该谓词是 provider 中立的：S3 / 本地文件系统 provider 的 listImages、
// Live Photo 配对（live-photo.ts）与 SourceScanner 的本地派生共用此实现，
// 避免多处扩展名过滤逻辑漂移。
export function isSupportedImageKey(
  key: string | undefined,
  supportedFormats: ReadonlySet<string> = SUPPORTED_FORMATS,
): key is string {
  if (!key) return false;
  return supportedFormats.has(path.extname(key).toLowerCase());
}
