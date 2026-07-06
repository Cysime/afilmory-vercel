import fs from "node:fs/promises";
import path from "node:path";

import { logger } from "../../logger/index.js";
import { compileExcludeRegex } from "../exclude-regex.js";
import type {
  LocalConfig,
  ProgressCallback,
  StorageObject,
  StorageProvider,
  StorageUploadOptions,
} from "../interfaces.js";
import { detectLivePhotoPairs } from "../live-photo.js";
import { isSupportedImageKey } from "../supported-formats.js";
import { joinPublicUrl } from "../url.js";

export const DEFAULT_LOCAL_BASE_URL = "/photos";

/**
 * 本地文件系统 provider：以 basePath 为根递归扫描照片源目录。
 *
 * - key 为相对 basePath 的 posix 路径（与 S3 key 语义一致）。
 * - originalUrl 由 baseUrl（默认 "/photos"）+ key 拼出，
 *   dev 下由 apps/web 的 photos-static Vite 插件按同样的约定服务本地文件，
 *   因此不需要任何对象存储凭据即可完整跑通 builder + 前端。
 *
 * 排除逻辑分层约定（与 StorageManager 保持一致）：provider 只应用自身配置里的
 * 静态 excludeRegex（与 S3 provider 对等）；跨 provider 的动态过滤
 * （manager.addExcludeFilter / addExcludePrefix）由 StorageManager 统一负责，
 * 这里不得重复实现。
 */
export class LocalFileSystemProvider implements StorageProvider {
  private readonly config: LocalConfig;
  private readonly basePath: string;
  private readonly excludeRegex: RegExp | null;

  constructor(config: LocalConfig) {
    this.config = config;
    this.basePath = path.resolve(config.basePath);
    this.excludeRegex = compileExcludeRegex(config.excludeRegex, (error) => {
      logger.fs.warn(
        `本地存储 excludeRegex 无效，已忽略：${config.excludeRegex}`,
        error,
      );
    });
  }

  /**
   * 把 key 解析成 basePath 内的绝对路径。
   * key 一律来自我们自己的列举或 manifest，但 getFile/deleteFile 也可能收到
   * 外部拼出的 key——解析后必须仍在 basePath 之内，防目录穿越。
   */
  private resolveKey(key: string): string | null {
    const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
    const absolute = path.resolve(this.basePath, normalized);
    if (
      absolute !== this.basePath &&
      !absolute.startsWith(this.basePath + path.sep)
    ) {
      return null;
    }
    return absolute;
  }

  private isExcluded(key: string): boolean {
    return Boolean(this.excludeRegex && this.excludeRegex.test(key));
  }

  /**
   * 递归列举 basePath 下的所有文件（不应用 excludeRegex，
   * 供 listObjectKeys 等需要原始列表的场景复用），按 key 稳定排序。
   */
  private async walkAllObjects(
    progressCallback?: ProgressCallback,
  ): Promise<StorageObject[]> {
    const objects: StorageObject[] = [];
    let filesScanned = 0;

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          // basePath 不存在时返回空列表（与空 bucket 行为一致），
          // 由上层"没有找到需要处理的照片"给出统一提示。
          logger.fs.warn(`本地照片目录不存在：${dir}`);
          return;
        }
        throw error;
      }

      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue;

        const key = path
          .relative(this.basePath, absolute)
          .split(path.sep)
          .join("/");
        const stats = await fs.stat(absolute);
        filesScanned++;
        progressCallback?.({ currentPath: key, filesScanned });

        objects.push({
          key,
          size: stats.size,
          lastModified: stats.mtime,
          // 弱 etag：由 stat 派生（mtimeMs + size），不做内容哈希——诚实地只声明
          // "stat 变了"。needsUpdate 的 mtime 判定是"变新才算变"（>），同尺寸回滚到
          // 旧文件时只有该 etag 能兜住这种变化。
          etag: `${stats.mtimeMs}-${stats.size}`,
        });
      }
    };

    await walk(this.basePath);

    // 稳定排序：文件系统 readdir 顺序平台相关，排序后 diff/配对结果可复现。
    objects.sort((a, b) => a.key.localeCompare(b.key));
    return objects;
  }

  async getFile(key: string): Promise<Buffer | null> {
    const absolute = this.resolveKey(key);
    if (!absolute) {
      logger.fs.warn(`拒绝越出照片目录的 key：${key}`);
      return null;
    }

    try {
      return await fs.readFile(absolute);
    } catch (error) {
      // 与 S3 provider 的契约一致：最终失败返回 null，由上层按"该照片处理失败"处理。
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.fs.warn(`本地文件不存在：${key}`);
      } else {
        logger.fs.error(`读取本地文件失败：${key}`, error);
      }
      return null;
    }
  }

  async listImages(): Promise<StorageObject[]> {
    const objects = await this.listAllFiles();
    return objects.filter((obj) => isSupportedImageKey(obj.key));
  }

  async listAllFiles(
    progressCallback?: ProgressCallback,
  ): Promise<StorageObject[]> {
    const objects = await this.walkAllObjects(progressCallback);
    return objects.filter((obj) => !this.isExcluded(obj.key));
  }

  generatePublicUrl(key: string): string {
    return joinPublicUrl(this.config.baseUrl ?? DEFAULT_LOCAL_BASE_URL, key);
  }

  detectLivePhotos(allObjects: StorageObject[]): Map<string, StorageObject> {
    return detectLivePhotoPairs(allObjects);
  }

  async deleteFile(key: string): Promise<void> {
    const absolute = this.resolveKey(key);
    if (!absolute) {
      logger.fs.warn(`拒绝越出照片目录的 key：${key}`);
      return;
    }

    try {
      await fs.unlink(absolute);
    } catch (error) {
      // 与 S3 DeleteObject 对不存在 key 也返回成功的语义保持一致。
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  async listObjectKeys(prefix: string): Promise<string[]> {
    // 契约要求不应用 exclude（见 StorageProvider.listObjectKeys 注释），
    // 这里直接用原始列举。
    const objects = await this.walkAllObjects();
    return objects
      .map((obj) => obj.key)
      .filter((key) => key.startsWith(prefix));
  }

  async uploadFile(
    key: string,
    data: Buffer,
    _options?: StorageUploadOptions,
  ): Promise<StorageObject> {
    const absolute = this.resolveKey(key);
    if (!absolute) {
      throw new Error(`拒绝越出照片目录的 key：${key}`);
    }

    // 本地文件系统没有对象元数据，contentType/cacheControl 无处存放，忽略。
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, data);
    const stats = await fs.stat(absolute);

    return {
      key,
      size: stats.size,
      lastModified: stats.mtime,
      etag: `${stats.mtimeMs}-${stats.size}`,
    };
  }
}
