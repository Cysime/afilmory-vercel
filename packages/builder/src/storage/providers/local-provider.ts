import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { logger } from "../../logger/index.js";
import { writeFileAtomic } from "../../utils/atomic-write.js";
import { compileExcludeRegex } from "../exclude-regex.js";
import type {
  LocalConfig,
  ProgressCallback,
  StorageListing,
  StorageObject,
  StorageProvider,
  StorageUploadOptions,
} from "../interfaces.js";
import { detectLivePhotoPairs } from "../live-photo.js";
import { isSupportedImageKey } from "../supported-formats.js";
import { joinPublicUrl } from "../url.js";

export const DEFAULT_LOCAL_BASE_URL = "/originals";

/**
 * 本地文件系统 provider：以 basePath 为根递归扫描照片源目录。
 *
 * - key 为相对 basePath 的 posix 路径（与 S3 key 语义一致）。
 * - originalUrl 由 baseUrl（默认 "/originals"）+ key 拼出，
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
        `Local storage excludeRegex is invalid, ignored: ${config.excludeRegex}`,
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
  private isWithinBasePath(
    candidatePath: string,
    realBasePath: string,
  ): boolean {
    const relativePath = path.relative(realBasePath, candidatePath);
    return (
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    );
  }

  private async resolveExistingKey(key: string): Promise<string | null> {
    const absolute = this.resolveKey(key);
    if (!absolute) return null;

    try {
      const [realBasePath, candidateStats] = await Promise.all([
        fs.realpath(this.basePath),
        fs.lstat(absolute),
      ]);
      if (candidateStats.isSymbolicLink()) return null;
      const realCandidatePath = await fs.realpath(absolute);
      return this.isWithinBasePath(realCandidatePath, realBasePath)
        ? realCandidatePath
        : null;
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      throw error;
    }
  }

  private async resolveSafeParent(key: string): Promise<string | null> {
    const absolute = this.resolveKey(key);
    if (!absolute) return null;

    await fs.mkdir(this.basePath, { recursive: true });
    const realBasePath = await fs.realpath(this.basePath);
    const relativePath = path.relative(this.basePath, absolute);
    const segments = relativePath.split(path.sep);
    const fileName = segments.pop();
    if (!fileName) return null;

    let realParent = realBasePath;
    for (const segment of segments) {
      const candidateDirectory = path.join(realParent, segment);
      let stats = await fs
        .lstat(candidateDirectory)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (!stats) {
        await fs
          .mkdir(candidateDirectory)
          .catch((error: NodeJS.ErrnoException) => {
            // Multiple photo workers may upload into the same newly-created
            // directory concurrently. Losing the mkdir race is harmless; the
            // lstat below still verifies that the winner created a real
            // directory rather than a symlink or file.
            if (error.code !== "EEXIST") throw error;
          });
        stats = await fs.lstat(candidateDirectory);
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) return null;
      const realDirectory = await fs.realpath(candidateDirectory);
      if (!this.isWithinBasePath(realDirectory, realBasePath)) return null;
      realParent = realDirectory;
    }

    return path.join(realParent, fileName);
  }

  private async walkAllObjectsDetailed(
    progressCallback?: ProgressCallback,
  ): Promise<StorageListing> {
    const objects: StorageObject[] = [];
    let filesScanned = 0;
    let complete = true;
    const failures: string[] = [];

    let realBasePath: string;
    try {
      realBasePath = await fs.realpath(this.basePath);
      const baseStats = await fs.stat(realBasePath);
      if (!baseStats.isDirectory()) {
        throw new Error(
          `Local photo path is not a directory: ${this.basePath}`,
        );
      }
    } catch (error) {
      const message = `Local photo directory cannot be scanned: ${this.basePath} - ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.fs.error(message);
      return {
        objects,
        complete: false,
        reason: { code: "provider-error", message },
      };
    }

    const markIncomplete = (directory: string, error: unknown) => {
      complete = false;
      const message = `Local photo scan became incomplete at ${directory}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      failures.push(message);
      logger.fs.error(message);
    };

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        markIncomplete(dir, error);
        return;
      }

      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          try {
            const realDirectory = await fs.realpath(absolute);
            if (!this.isWithinBasePath(realDirectory, realBasePath)) {
              markIncomplete(
                absolute,
                new Error("directory resolves outside the configured root"),
              );
              continue;
            }
            await walk(realDirectory);
          } catch (error) {
            markIncomplete(absolute, error);
          }
          continue;
        }
        if (!entry.isFile()) continue;

        let stats;
        try {
          stats = await fs.lstat(absolute);
          if (!stats.isFile() || stats.isSymbolicLink()) {
            markIncomplete(
              absolute,
              new Error("file type changed while scanning"),
            );
            continue;
          }
        } catch (error) {
          markIncomplete(absolute, error);
          continue;
        }
        const key = path
          .relative(realBasePath, absolute)
          .split(path.sep)
          .join("/");
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

    await walk(realBasePath);

    // 稳定排序：文件系统 readdir 顺序平台相关，排序后 diff/配对结果可复现。
    objects.sort((a, b) => a.key.localeCompare(b.key));
    return {
      objects,
      complete,
      ...(complete
        ? {}
        : {
            reason: {
              code: "provider-error" as const,
              message: failures.join("; "),
            },
          }),
    };
  }

  async getFile(key: string, signal?: AbortSignal): Promise<Buffer | null> {
    if (signal?.aborted) return null;
    const safePath = await this.resolveExistingKey(key);
    if (!safePath) {
      logger.fs.warn(`Rejected key outside the photo directory: ${key}`);
      return null;
    }

    let handle: fs.FileHandle | undefined;
    try {
      signal?.throwIfAborted();
      handle = await fs.open(
        safePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      if (!(await handle.stat()).isFile()) return null;
      const content = await handle.readFile();
      return signal?.aborted ? null : content;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      // 与 S3 provider 的契约一致：最终失败返回 null，由上层按"该照片处理失败"处理。
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.fs.warn(`Local file does not exist: ${key}`);
      } else {
        logger.fs.error(`Failed to read local file: ${key}`, error);
      }
      return null;
    } finally {
      await handle?.close();
    }
  }

  async listImages(): Promise<StorageObject[]> {
    const objects = await this.listAllFiles();
    return objects.filter((obj) => isSupportedImageKey(obj.key));
  }

  async listAllFiles(
    progressCallback?: ProgressCallback,
  ): Promise<StorageObject[]> {
    return (await this.listAllFilesDetailed(progressCallback)).objects;
  }

  async listAllFilesDetailed(
    progressCallback?: ProgressCallback,
  ): Promise<StorageListing> {
    const listing = await this.walkAllObjectsDetailed(progressCallback);
    return {
      ...listing,
      objects: listing.objects.filter((obj) => !this.isExcluded(obj.key)),
    };
  }

  generatePublicUrl(key: string): string {
    return joinPublicUrl(this.config.baseUrl ?? DEFAULT_LOCAL_BASE_URL, key);
  }

  detectLivePhotos(allObjects: StorageObject[]): Map<string, StorageObject> {
    return detectLivePhotoPairs(allObjects);
  }

  async deleteFile(key: string): Promise<void> {
    const safePath = await this.resolveSafeParent(key);
    if (!safePath) {
      logger.fs.warn(`Rejected key outside the photo directory: ${key}`);
      return;
    }

    try {
      await fs.unlink(safePath);
    } catch (error) {
      // 与 S3 DeleteObject 对不存在 key 也返回成功的语义保持一致。
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  async listObjectKeys(prefix: string): Promise<string[]> {
    // 契约要求不应用 exclude（见 StorageProvider.listObjectKeys 注释），
    // 这里直接用原始列举。
    const listing = await this.walkAllObjectsDetailed();
    if (!listing.complete) {
      throw new Error(
        listing.reason?.message ?? "Local object listing is incomplete",
      );
    }
    return listing.objects
      .map((obj) => obj.key)
      .filter((key) => key.startsWith(prefix));
  }

  async uploadFile(
    key: string,
    data: Buffer,
    _options?: StorageUploadOptions,
  ): Promise<StorageObject> {
    const safePath = await this.resolveSafeParent(key);
    if (!safePath) {
      throw new Error(`Rejected key outside the photo directory: ${key}`);
    }

    // 本地文件系统没有对象元数据，contentType/cacheControl 无处存放，忽略。
    const existingStats = await fs
      .lstat(safePath)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (existingStats?.isSymbolicLink()) {
      throw new Error(`Refusing to replace a symbolic link: ${key}`);
    }
    await writeFileAtomic(safePath, data);
    const stats = await fs.stat(safePath);

    return {
      key,
      size: stats.size,
      lastModified: stats.mtime,
      etag: `${stats.mtimeMs}-${stats.size}`,
    };
  }

  dispose(): void {
    // The local provider owns no long-lived handles.
  }
}
