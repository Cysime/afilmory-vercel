import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { ThumbnailResult } from "../photo/data-processors.js";
import { getPhotoExecutionContext } from "../photo/execution-context.js";
import { getPhotoProcessingLoggers } from "../photo/logger-adapter.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { SOURCE_SHARP_OPTIONS } from "./sharp-options.js";
import { generateThumbHash } from "./thumbhash.js";

// 常量定义
// q80 + mozjpeg：600px 网格缩略图 q90 时普遍 200-450KB，移动端解码慢、浏览器内存
// 图像缓存留不住（虚拟列表滚回时重解码 → 闪烁）；q80+mozjpeg 视觉几乎无差，
// 体积约减半。
const THUMBNAIL_QUALITY = 80;
const THUMBNAIL_WIDTH = 600;

/**
 * 缩略图编码参数签名。写入缩略图目录的 `.encoding` 标记文件；CLI 启动时若磁盘
 * 标记与当前签名不一致（或缺失），等价于 --force-thumbnails 全量重生成。
 *
 * 动机：部署构建会从 artifact-cache 恢复旧缩略图 + manifest，增量模式据此判定
 * 「0 张需要处理」——改了质量/尺寸/格式参数却永远不会生效。签名机制让参数变更
 * 自动触发一次全量重生成，之后缓存里存的就是新参数产物，回到增量快路径。
 */
export const THUMBNAIL_ENCODING_SIGNATURE = `jpeg-w${THUMBNAIL_WIDTH}-q${THUMBNAIL_QUALITY}-mozjpeg`;

const ENCODING_MARKER_FILENAME = ".encoding";

export async function isThumbnailEncodingStale(
  thumbnailsDir: string,
): Promise<boolean> {
  try {
    const marker = await fs.readFile(
      path.join(thumbnailsDir, ENCODING_MARKER_FILENAME),
      "utf-8",
    );
    return marker.trim() !== THUMBNAIL_ENCODING_SIGNATURE;
  } catch {
    // 无标记：目录里既有缩略图的生成参数未知（老缓存），视为过期。
    // 全新空目录也走这条——强制与否等价（每张都按缺失生成），无副作用。
    return true;
  }
}

export async function writeThumbnailEncodingMarker(
  thumbnailsDir: string,
): Promise<void> {
  await fs.mkdir(thumbnailsDir, { recursive: true });
  await fs.writeFile(
    path.join(thumbnailsDir, ENCODING_MARKER_FILENAME),
    `${THUMBNAIL_ENCODING_SIGNATURE}\n`,
  );
}

// 获取缩略图路径信息（照片作用域内调用；构建作用域的读者走显式参数，见 thumbnailExists）
function getThumbnailPaths(photoId: string) {
  const { thumbnailsDir } = getPhotoExecutionContext().output;
  const filename = `${photoId}.jpg`;
  const thumbnailPath = path.join(thumbnailsDir, filename);
  const thumbnailUrl = getThumbnailPublicUrl(photoId);

  return { thumbnailPath, thumbnailUrl };
}

export function getThumbnailPublicUrl(photoId: string): string {
  return `/thumbnails/${encodeURIComponent(`${photoId}.jpg`)}`;
}

// 创建成功结果
function createSuccessResult(
  thumbnailUrl: string,
  thumbnailBuffer: Buffer,
  thumbHash: Uint8Array | null,
): ThumbnailResult {
  return {
    thumbnailUrl,
    thumbnailBuffer,
    thumbHash,
  };
}

// 确保缩略图目录存在
async function ensureThumbnailDir(): Promise<void> {
  const { thumbnailsDir } = getPhotoExecutionContext().output;
  await fs.mkdir(thumbnailsDir, { recursive: true });
}

// 检查缩略图是否存在。
// 目录显式传参：这是唯一同时被两种作用域调用的函数——DiffPlanner 在主进程
// 规划阶段（无照片上下文，取 session.config.output）与照片管道内（取
// 上下文 output）都要用它。
export async function thumbnailExists(
  photoId: string,
  thumbnailsDir: string,
): Promise<boolean> {
  try {
    await fs.access(path.join(thumbnailsDir, `${photoId}.jpg`));
    return true;
  } catch {
    return false;
  }
}

// 读取现有缩略图并生成 thumbhash
async function processExistingThumbnail(
  photoId: string,
): Promise<ThumbnailResult | null> {
  const { thumbnailPath, thumbnailUrl } = getThumbnailPaths(photoId);

  const thumbnailLog = getPhotoProcessingLoggers().thumbnail;
  thumbnailLog.info(`复用现有缩略图：${photoId}`);

  try {
    const existingBuffer = await fs.readFile(thumbnailPath);
    const thumbHash = await generateThumbHash(existingBuffer);

    return createSuccessResult(thumbnailUrl, existingBuffer, thumbHash);
  } catch (error) {
    thumbnailLog?.warn(`读取现有缩略图失败，重新生成：${photoId}`, error);
    return null;
  }
}

// 生成新的缩略图（失败返回 null）
async function generateNewThumbnail(
  imageBuffer: Buffer,
  photoId: string,
): Promise<ThumbnailResult | null> {
  const { thumbnailPath, thumbnailUrl } = getThumbnailPaths(photoId);

  const log = getPhotoProcessingLoggers().thumbnail;
  log.info(`生成缩略图：${photoId}`);
  const startTime = Date.now();

  try {
    // 创建 Sharp 实例，复用于缩略图和 thumbhash 生成
    const sharpInstance = sharp(imageBuffer, SOURCE_SHARP_OPTIONS).rotate(); // 自动根据 EXIF 旋转

    // 生成缩略图
    const thumbnailBuffer = await sharpInstance
      .clone() // 克隆实例用于缩略图生成
      .resize(THUMBNAIL_WIDTH, null, {
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
      .toBuffer();

    // 原子落盘：普通 writeFile 中途被杀会留下截断的 .jpg，增量路径此后会
    // 永远复用这张坏图（thumbnailExists 只看存在性，不看完整性）。
    await writeFileAtomic(thumbnailPath, thumbnailBuffer);

    // 记录生成信息
    const duration = Date.now() - startTime;
    const sizeKB = Math.round(thumbnailBuffer.length / 1024);
    log.success(`生成完成：${photoId} (${sizeKB}KB, ${duration}ms)`);

    // 基于生成的缩略图生成 thumbhash
    const thumbHash = await generateThumbHash(thumbnailBuffer);

    return createSuccessResult(thumbnailUrl, thumbnailBuffer, thumbHash);
  } catch (error) {
    log.error(`生成失败：${photoId}`, error);
    return null;
  }
}

// 生成缩略图和 thumbhash（复用 Sharp 实例）。失败返回 null——
// 这是唯一的失败编码，调用方据此把整张照片标记为失败并跳过。
export async function generateThumbnailAndThumbHash(
  imageBuffer: Buffer,
  photoId: string,
  forceRegenerate = false,
): Promise<ThumbnailResult | null> {
  const thumbnailLog = getPhotoProcessingLoggers().thumbnail;

  try {
    await ensureThumbnailDir();

    // 如果不是强制模式且缩略图已存在，尝试复用现有文件
    if (
      !forceRegenerate &&
      (await thumbnailExists(
        photoId,
        getPhotoExecutionContext().output.thumbnailsDir,
      ))
    ) {
      const existingResult = await processExistingThumbnail(photoId);

      if (existingResult) {
        return existingResult;
      }
      // 如果处理现有缩略图失败，继续生成新的
    }

    // 生成新的缩略图
    return await generateNewThumbnail(imageBuffer, photoId);
  } catch (error) {
    thumbnailLog.error(`处理失败：${photoId}`, error);
    return null;
  }
}
