import "dotenv-expand/config";

/* eslint-disable no-console */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertManifest } from "@afilmory/schema";

export interface ArtifactCacheConfig {
  allowHistoryRewrite: boolean;
  cacheDir: string;
  locationMode: "coarse" | "exact" | "strip";
  repoBranch: string;
  repoToken: string;
  repoUrl: string;
  rootDir: string;
  sourceRepoUrl?: string;
}

interface ArtifactPathPair {
  cachePath: string;
  label: string;
  targetPath: string;
  validate?: (filePath: string) => Promise<void>;
}

export const DEFAULT_CACHE_BRANCH = "afilmory-cache";
const PROTECTED_BRANCH_NAMES = new Set([
  "develop",
  "development",
  "main",
  "master",
  "production",
  "trunk",
]);
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_GEOCODING_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 32 * 1024 * 1024;
const MAX_THUMBNAIL_COUNT = 250_000;
const MAX_THUMBNAIL_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export const createConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ArtifactCacheConfig | null => {
  const repoUrl = env.REPO_URL || env.BUILDER_REPO_URL || "";
  const repoToken = env.REPO_TOKEN || env.GIT_TOKEN || "";

  if (!repoUrl || !repoToken) {
    return null;
  }

  return {
    allowHistoryRewrite: env.REPO_CACHE_ALLOW_HISTORY_REWRITE === "true",
    cacheDir: path.join(rootDir, "apps/web/assets-git"),
    locationMode:
      env.PHOTO_LOCATION_MODE === "exact" || env.PHOTO_LOCATION_MODE === "strip"
        ? env.PHOTO_LOCATION_MODE
        : "coarse",
    repoBranch:
      env.REPO_CACHE_BRANCH?.trim() ||
      env.REPO_BRANCH?.trim() ||
      DEFAULT_CACHE_BRANCH,
    repoToken,
    repoUrl,
    rootDir,
    sourceRepoUrl:
      env.REPO_SOURCE_URL ||
      (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}.git`
        : env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
          ? `https://github.com/${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}.git`
          : undefined),
  };
};

const geocodingCachePair = (config: ArtifactCacheConfig): ArtifactPathPair => ({
  cachePath: path.join(config.cacheDir, "geocoding-cache.json"),
  label: "geocoding cache",
  targetPath: path.join(config.rootDir, "generated/geocoding-cache.json"),
  validate: validateGeocodingCacheFile,
});

const artifactPairs = (config: ArtifactCacheConfig): ArtifactPathPair[] => [
  {
    cachePath: path.join(config.cacheDir, "photos-manifest.json"),
    label: "photos manifest",
    targetPath: path.join(config.rootDir, "generated/photos-manifest.json"),
    validate: validateManifestFile,
  },
  ...(config.locationMode === "exact" ? [geocodingCachePair(config)] : []),
  {
    cachePath: path.join(config.cacheDir, "thumbnails"),
    label: "thumbnails",
    targetPath: path.join(config.rootDir, "apps/web/public/thumbnails"),
    validate: validateThumbnailDirectory,
  },
];

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const validateManifestFile = async (filePath: string): Promise<void> => {
  await assertRegularFileWithinLimit(
    filePath,
    MAX_MANIFEST_BYTES,
    "photos manifest",
  );
  const content = await fs.readFile(filePath, "utf-8");
  assertManifest(JSON.parse(content));
};

const assertRegularFileWithinLimit = async (
  filePath: string,
  maxBytes: number,
  label: string,
): Promise<number> => {
  const stats = await fs.lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte safety limit`);
  }
  return stats.size;
};

const validateGeocodingCacheFile = async (filePath: string): Promise<void> => {
  await assertRegularFileWithinLimit(
    filePath,
    MAX_GEOCODING_CACHE_BYTES,
    "geocoding cache",
  );
  const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf-8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("geocoding cache must contain a JSON object");
  }
};

const hasThumbnailMagicBytes = (name: string, bytes: Buffer): boolean => {
  const extension = path.extname(name).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg": {
      return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    }
    case ".png": {
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    case ".gif": {
      return /^(?:GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString("ascii"));
    }
    case ".webp": {
      return (
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP"
      );
    }
    case ".avif": {
      return (
        bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
        /^(?:avif|avis)$/.test(bytes.subarray(8, 12).toString("ascii"))
      );
    }
    case ".webm": {
      return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    }
    case ".mp4": {
      return bytes.subarray(4, 8).toString("ascii") === "ftyp";
    }
    default: {
      return false;
    }
  }
};

const validateThumbnailDirectory = async (
  directoryPath: string,
): Promise<void> => {
  const directoryStats = await fs.lstat(directoryPath);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error("thumbnails must be a regular directory");
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  if (entries.length > MAX_THUMBNAIL_COUNT) {
    throw new Error("thumbnail cache contains too many files");
  }

  let totalBytes = 0;
  for (const entry of entries) {
    const filePath = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`unsupported thumbnail cache entry: ${entry.name}`);
    }

    if (entry.name === ".encoding") {
      const size = await assertRegularFileWithinLimit(
        filePath,
        256,
        "thumbnail encoding marker",
      );
      totalBytes += size;
      const marker = await fs.readFile(filePath, "utf-8");
      if (!/^jpeg-w\d+-q\d+-mozjpeg\n?$/.test(marker)) {
        throw new Error("invalid thumbnail encoding marker");
      }
      continue;
    }

    if (
      !/^\w[\w.-]{0,199}\.(?:avif|gif|jpe?g|mp4|png|webm|webp)$/i.test(
        entry.name,
      )
    ) {
      throw new Error(`invalid thumbnail filename: ${entry.name}`);
    }
    const size = await assertRegularFileWithinLimit(
      filePath,
      MAX_THUMBNAIL_BYTES,
      `thumbnail ${entry.name}`,
    );
    totalBytes += size;
    if (totalBytes > MAX_THUMBNAIL_TOTAL_BYTES) {
      throw new Error("thumbnail cache exceeds the total-size safety limit");
    }
    const header = Buffer.alloc(16);
    const handle = await fs.open(filePath, "r");
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    if (!hasThumbnailMagicBytes(entry.name, header)) {
      throw new Error(`thumbnail has invalid magic bytes: ${entry.name}`);
    }
  }
};

const normalizeRepositoryIdentity = (repoUrl: string): string => {
  const trimmed = repoUrl.trim();
  const scpMatch = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(trimmed);
  if (scpMatch && !trimmed.includes("://")) {
    return `${scpMatch[1]}/${scpMatch[2]}`
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }

  try {
    const url = new URL(trimmed);
    return `${url.hostname}${url.pathname}`
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  } catch {
    return trimmed
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
};

export const assertSafeCacheTarget = (
  config: ArtifactCacheConfig,
  sourceRepoUrl?: string,
): void => {
  const branch = config.repoBranch.trim();
  if (!branch || PROTECTED_BRANCH_NAMES.has(branch.toLowerCase())) {
    throw new Error(
      `Refusing to use protected branch "${branch || "(empty)"}" for the artifact cache. ` +
        `Use a dedicated branch such as "${DEFAULT_CACHE_BRANCH}".`,
    );
  }
  if (
    branch.startsWith("-") ||
    branch.includes("..") ||
    /[\s~^:?*[\]\\]/.test(branch)
  ) {
    throw new Error(`Invalid artifact cache branch name: ${branch}`);
  }

  const source = sourceRepoUrl || config.sourceRepoUrl;
  if (
    source &&
    normalizeRepositoryIdentity(source) ===
      normalizeRepositoryIdentity(config.repoUrl)
  ) {
    throw new Error(
      "Refusing to use the Afilmory source repository as its artifact cache. " +
        "Create a separate cache repository with a least-privilege token.",
    );
  }
};

const sanitize = (value: string, config: ArtifactCacheConfig): string =>
  value
    .replaceAll(config.repoToken, "[REPO_TOKEN]")
    .replaceAll(encodeURIComponent(config.repoToken), "[REPO_TOKEN]");

const isLocalhostHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]" ||
  hostname === "::1";

// REPO_TOKEN 通过 GIT_ASKPASS 提供，而不是嵌进 clone/push 的 URL：
// URL 会进入子进程 argv（/proc、ps、CI 进程转储可见）并被持久化到
// clone 的 .git/config，泄漏面太大。token 只进入 git 子进程的环境变量
// （不落盘、不进 argv），askpass 脚本本身不含任何秘密。
const ASKPASS_USERNAME = "x-access-token";
const ASKPASS_PASSWORD_ENV = "AFILMORY_GIT_ASKPASS_PASSWORD";

// URL 里固定写入用户名（用户名不是秘密），这样 git 只会向 askpass 询问
// Password，脚本无需解析提示语（"Username for …"/"Password for …" 可能
// 随 locale 变化），无条件输出 token 即可。
const ASKPASS_SCRIPT = `#!/bin/sh\nprintf '%s\\n' "$${ASKPASS_PASSWORD_ENV}"\n`;

export const createAskpassRepoUrl = (repoUrl: string): string => {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    // Not an http(s) URL (e.g. scp-style git@host:repo) — REPO_TOKEN is not
    // used for ssh auth, so there is nothing to guard or rewrite here.
    return repoUrl;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return repoUrl;
  }

  // Never transmit REPO_TOKEN over plaintext HTTP: even though the token is
  // no longer embedded in the URL, git would still send it as basic-auth in
  // the clear. Allow http only for localhost so local testing against a
  // throwaway git server still works.
  if (url.protocol === "http:" && !isLocalhostHostname(url.hostname)) {
    throw new Error(
      "Refusing to send REPO_TOKEN over plaintext HTTP. " +
        "Use an https:// REPO_URL (http is permitted only for localhost).",
    );
  }

  if (!url.username) {
    url.username = ASKPASS_USERNAME;
  }
  // 即便 REPO_URL 自带密码也剥掉：密码属于秘密，绝不允许进 argv 或
  // .git/config，凭据统一由 askpass 从环境变量提供。
  url.password = "";
  return url.toString();
};

// 在临时 0700 目录里落一个 askpass 脚本（内容不含 token），把 token 放进
// gitEnv 传给回调内的每次 git spawn，结束后无论成败都清理临时目录。
const withGitAskpass = async <T>(
  config: ArtifactCacheConfig,
  fn: (gitEnv: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> => {
  const askpassDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "afilmory-askpass-"),
  );
  const askpassPath = path.join(askpassDir, "askpass.sh");
  await fs.writeFile(askpassPath, ASKPASS_SCRIPT, { mode: 0o700 });
  try {
    return await fn({
      GIT_ASKPASS: askpassPath,
      [ASKPASS_PASSWORD_ENV]: config.repoToken,
    });
  } finally {
    await fs.rm(askpassDir, { force: true, recursive: true });
  }
};

const run = async (
  config: ArtifactCacheConfig,
  command: string,
  args: string[],
  gitEnv: NodeJS.ProcessEnv,
  cwd: string = config.rootDir,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...gitEnv,
        GIT_TERMINAL_PROMPT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          sanitize(
            `${command} ${args[0] ?? ""} failed with exit code ${code}.\n${
              stderr || stdout
            }`,
            config,
          ),
        ),
      );
    });
  });

const cloneCacheRepository = async (
  config: ArtifactCacheConfig,
  gitEnv: NodeJS.ProcessEnv,
): Promise<void> => {
  await fs.rm(config.cacheDir, { force: true, recursive: true });
  await fs.mkdir(path.dirname(config.cacheDir), { recursive: true });

  const args = [
    "clone",
    "--depth=1",
    "--single-branch",
    "--branch",
    config.repoBranch,
  ];
  // 无凭据 URL：token 由 GIT_ASKPASS 提供，argv 和 .git/config 里只有
  // 仓库地址和固定用户名。
  args.push(createAskpassRepoUrl(config.repoUrl), config.cacheDir);

  await run(config, "git", args, gitEnv);
};

const readSourceRepoUrl = async (
  config: ArtifactCacheConfig,
  gitEnv: NodeJS.ProcessEnv,
): Promise<string | undefined> => {
  if (config.sourceRepoUrl) return config.sourceRepoUrl;
  try {
    const source = await run(
      config,
      "git",
      ["config", "--get", "remote.origin.url"],
      gitEnv,
      config.rootDir,
    );
    return source.trim() || undefined;
  } catch {
    // An unpacked source archive may not have a Git remote. The dedicated
    // branch guard still applies in that case.
    return undefined;
  }
};

const validateCacheDestination = async (
  config: ArtifactCacheConfig,
  gitEnv: NodeJS.ProcessEnv,
): Promise<void> => {
  assertSafeCacheTarget(config, await readSourceRepoUrl(config, gitEnv));
};

const enforceLocationCacheBoundary = async (
  config: ArtifactCacheConfig,
  removeRemoteCopy: boolean,
  announce = true,
): Promise<void> => {
  if (config.locationMode === "exact") return;
  const pair = geocodingCachePair(config);
  // Legacy caches may use exact coordinates as JSON keys. Never let such a
  // cache cross into coarse/strip builds, and remove it from the cache branch
  // on the next successful save rather than attempting a lossy re-key.
  await fs.rm(pair.targetPath, { force: true });
  if (removeRemoteCopy) await fs.rm(pair.cachePath, { force: true });
  if (announce) {
    console.info(
      `[artifact-cache] Geocoding cache disabled for PHOTO_LOCATION_MODE=${config.locationMode}.`,
    );
  }
};

const copyArtifact = async (
  sourcePath: string,
  targetPath: string,
): Promise<void> => {
  const parentDirectory = path.dirname(targetPath);
  const targetName = path.basename(targetPath);
  const stagingPath = path.join(
    parentDirectory,
    `.${targetName}.afilmory-staging-${process.pid}-${randomUUID()}`,
  );
  const backupPath = path.join(
    parentDirectory,
    `.afilmory-artifact-cache-${targetName}.backup`,
  );
  await fs.mkdir(parentDirectory, { recursive: true });

  // Recover a process interruption between the two rename operations. A
  // remaining target means the staged artifact was already committed; without
  // a target the backup is the last known-good artifact and must be restored.
  if (await pathExists(backupPath)) {
    if (await pathExists(targetPath)) {
      await fs.rm(backupPath, { force: true, recursive: true });
    } else {
      await fs.rename(backupPath, targetPath);
    }
  }

  let movedExistingTarget = false;
  try {
    // Copy completely into a sibling first. Validation has already run against
    // sourcePath; a short write, ENOSPC or permissions failure therefore leaves
    // the live target untouched.
    await fs.cp(sourcePath, stagingPath, {
      errorOnExist: true,
      force: false,
      recursive: true,
      // The cache repository is untrusted. Validation rejects symlinks before
      // this point; the filter is a second boundary against a concurrent swap.
      filter: async (src) => !(await fs.lstat(src)).isSymbolicLink(),
    });

    if (await pathExists(targetPath)) {
      await fs.rename(targetPath, backupPath);
      movedExistingTarget = true;
    }

    try {
      await fs.rename(stagingPath, targetPath);
    } catch (swapError) {
      if (movedExistingTarget && !(await pathExists(targetPath))) {
        try {
          await fs.rename(backupPath, targetPath);
          movedExistingTarget = false;
        } catch (rollbackError) {
          throw new AggregateError(
            [swapError, rollbackError],
            `Could not commit or roll back artifact ${targetName}`,
          );
        }
      }
      throw swapError;
    }

    if (movedExistingTarget) {
      await fs.rm(backupPath, { force: true, recursive: true });
      movedExistingTarget = false;
    }
  } finally {
    // No-op after a successful rename; removes a partial staging tree after any
    // copy/swap failure. Never remove backupPath here: it may be the only healthy
    // copy after an uncatchable process interruption and is recovered above.
    await fs.rm(stagingPath, { force: true, recursive: true });
  }
};

// Exported for tests (the fake `git clone` in the spawn recorder populates
// cacheDir with fixtures; the copy/validate/symlink-filter logic runs for real).
export const restoreArtifacts = async (
  config: ArtifactCacheConfig,
): Promise<void> => {
  await enforceLocationCacheBoundary(config, false);
  await withGitAskpass(config, async (gitEnv) => {
    await validateCacheDestination(config, gitEnv);
    await cloneCacheRepository(config, gitEnv);
  });

  for (const pair of artifactPairs(config)) {
    try {
      if (!(await pathExists(pair.cachePath))) {
        console.warn(`[artifact-cache] Missing cached ${pair.label}; skipped.`);
        continue;
      }
      if (pair.validate) {
        await pair.validate(pair.cachePath);
      }
      await copyArtifact(pair.cachePath, pair.targetPath);
      console.info(`[artifact-cache] Restored ${pair.label}.`);
    } catch (error) {
      console.warn(
        `[artifact-cache] Could not restore ${pair.label}; skipped. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};

const ensureCacheReadme = async (
  config: ArtifactCacheConfig,
): Promise<void> => {
  const readmePath = path.join(config.cacheDir, "README.md");
  if (await pathExists(readmePath)) {
    return;
  }
  await fs.writeFile(
    readmePath,
    [
      "# afilmory-metadata-cache",
      "",
      "This repository stores generated Afilmory build artifacts:",
      "",
      "- `photos-manifest.json`",
      "- `geocoding-cache.json` (exact-location mode only; sensitive)",
      "- `thumbnails/`",
      "",
      "It is not a source photo storage backend.",
      "",
    ].join("\n"),
  );
};

// Exported for tests (command sequence is verified with a spawn recorder).
export const saveArtifacts = async (
  config: ArtifactCacheConfig,
): Promise<void> => {
  await enforceLocationCacheBoundary(config, false);
  await withGitAskpass(config, async (gitEnv) => {
    await validateCacheDestination(config, gitEnv);
    await cloneCacheRepository(config, gitEnv);
    await enforceLocationCacheBoundary(config, true, false);

    for (const pair of artifactPairs(config)) {
      if (!(await pathExists(pair.targetPath))) {
        console.warn(`[artifact-cache] Missing local ${pair.label}; skipped.`);
        continue;
      }
      if (pair.validate) {
        await pair.validate(pair.targetPath);
      }
      await copyArtifact(pair.targetPath, pair.cachePath);
      console.info(`[artifact-cache] Staged ${pair.label}.`);
    }

    await ensureCacheReadme(config);
    await run(
      config,
      "git",
      ["config", "user.name", "Afilmory Cache Bot"],
      gitEnv,
      config.cacheDir,
    );
    await run(
      config,
      "git",
      ["config", "user.email", "afilmory-cache@users.noreply.github.com"],
      gitEnv,
      config.cacheDir,
    );
    // `--all` is required to stage removal of a legacy exact-coordinate cache
    // when a deployment switches to coarse/strip mode.
    await run(config, "git", ["add", "--all"], gitEnv, config.cacheDir);

    // 与刚 fetch 下来的远端 HEAD 树比较：产物没变就跳过推送。
    const status = await run(
      config,
      "git",
      ["status", "--porcelain"],
      gitEnv,
      config.cacheDir,
    );
    if (!status.trim()) {
      console.info("[artifact-cache] Remote cache is already up to date.");
      return;
    }

    const branch = config.repoBranch;
    if (!config.allowHistoryRewrite) {
      await run(
        config,
        "git",
        ["commit", "-m", "chore: update afilmory artifact cache"],
        gitEnv,
        config.cacheDir,
      );
      await run(
        config,
        "git",
        ["push", "origin", `HEAD:refs/heads/${branch}`],
        gitEnv,
        config.cacheDir,
      );
      console.info("[artifact-cache] Remote cache updated.");
      return;
    }

    // History compaction is deliberately opt-in. Capture the fetched remote
    // head before creating the orphan commit, then lease exactly that object so
    // a concurrent writer can never be overwritten silently.
    const expectedRemoteHead = (
      await run(config, "git", ["rev-parse", "HEAD"], gitEnv, config.cacheDir)
    ).trim();
    await run(
      config,
      "git",
      ["checkout", "--orphan", "afilmory-cache-tmp"],
      gitEnv,
      config.cacheDir,
    );
    // orphan checkout 会保留 index，这里再 add --all 兜底，确保旧 HEAD
    // 带下来的所有缓存文件都进入新提交。
    await run(config, "git", ["add", "--all"], gitEnv, config.cacheDir);
    await run(
      config,
      "git",
      ["commit", "-m", "chore: update afilmory artifact cache"],
      gitEnv,
      config.cacheDir,
    );
    await run(
      config,
      "git",
      [
        "push",
        `--force-with-lease=refs/heads/${branch}:${expectedRemoteHead}`,
        "origin",
        `HEAD:refs/heads/${branch}`,
      ],
      gitEnv,
      config.cacheDir,
    );
    console.info(
      "[artifact-cache] Remote cache updated (history compacted with a lease).",
    );
  });
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (command !== "restore" && command !== "save") {
    throw new Error(
      "Usage: pnpm exec tsx scripts/artifact-cache.ts <restore|save>",
    );
  }

  const config = createConfig();
  if (!config) {
    console.info(
      "[artifact-cache] REPO_URL/REPO_TOKEN not configured; skipped.",
    );
    return;
  }

  if (command === "restore") {
    await restoreArtifacts(config);
    return;
  }

  await saveArtifacts(config);
};

// Only run when invoked as a script, so the module can be imported in tests
// without executing git commands as a side effect.
const isMainModule =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
