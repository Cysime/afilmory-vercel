import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineBuilderConfig, geocodingPlugin } from "@afilmory/builder";

import { env } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const requiredS3Vars = {
  S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME: env.S3_BUCKET_NAME,
};

const missingS3Vars = Object.entries(requiredS3Vars)
  .filter(([, value]) => !value)
  .map(([key]) => key);

const geocodingLocales =
  env.GEOCODING_LOCALES || env.GEOCODING_LANGUAGE || "en,zh-CN";
const geocodingCachePath =
  env.GEOCODING_CACHE_PATH ||
  path.resolve(__dirname, "generated/geocoding-cache.json");
const geocodingUserAgent =
  env.GEOCODING_USER_AGENT ||
  `afilmory-vercel/0.1 (${env.SITE_URL || "https://github.com/vsxd/afilmory-vercel"})`;

if (missingS3Vars.length > 0) {
  throw new Error(
    `Missing required S3 environment variables: ${missingS3Vars.join(", ")}`,
  );
}

/**
 * 静态部署配置 - 默认使用 S3 存储
 *
 * 这个配置用于静态站点部署（如 Vercel、Netlify、GitHub Pages 等）
 * 照片存储在 S3 兼容的对象存储中
 *
 * 使用方式：
 * 1. 配置 .env 文件中的 S3 相关环境变量（必填）
 * 2. 可选：配置 REPO_URL 和 REPO_TOKEN，让部署脚本启用远程产物缓存
 * 3. 运行 pnpm build:manifest 生成 manifest 和缩略图
 * 4. 再运行 pnpm build:web 或 pnpm build 打包静态站点
 * 5. 部署 apps/web/dist 目录到托管平台
 *
 * 零凭据本地运行（provider: "local"）：
 * 不想配置 S3 时，可以把 storage 换成本地文件系统 provider——
 *
 *   storage: {
 *     provider: "local",
 *     // 照片源目录；仓库根的 photos/ 目录正是 dev 下
 *     // apps/web/plugins/vite/photos-static.ts 服务 /photos/* 的目录
 *     basePath: path.resolve(__dirname, "photos"),
 *     // originalUrl 前缀，默认 "/photos"，与上述 Vite 插件的路径约定一致
 *     // baseUrl: "/photos",
 *     // excludeRegex: "^drafts/",
 *   },
 *
 * 这样 pnpm build:manifest 不需要任何对象存储凭据，manifest 里的 originalUrl
 * 形如 /photos/...，pnpm dev 时由 Vite 插件直接服务本地原图。
 * 详见 packages/builder/README.md 的 "Local filesystem provider" 一节。
 */
export default defineBuilderConfig(() => ({
  output: {
    manifestPath: path.resolve(__dirname, "generated/photos-manifest.json"),
    thumbnailsDir: path.resolve(__dirname, "apps/web/public/thumbnails"),
    originalsDir: path.resolve(__dirname, "apps/web/public/originals"),
  },

  // 使用 S3 存储
  storage: {
    provider: "s3",
    bucket: env.S3_BUCKET_NAME,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    prefix: env.S3_PREFIX,
    customDomain: env.S3_CUSTOM_DOMAIN,
    excludeRegex: env.S3_EXCLUDE_REGEX,
    // S3 客户端寻址风格（path-style vs virtual-hosted-style）。
    // 默认按 endpoint 自动推导，与公开 URL 生成规则保持一致：
    // AWS / 阿里云 OSS → virtual-hosted-style；其余自定义 endpoint
    // （MinIO 等自建服务）→ path-style。仅当推导不符合实际服务时才需要
    // 显式设置，详见 packages/builder/src/storage/providers/README.md。
    // forcePathStyle: true,
    keepAlive: true,
    maxSockets: 64,
    connectionTimeoutMs: 5_000,
    socketTimeoutMs: 30_000,
    requestTimeoutMs: 20_000,
    idleTimeoutMs: 10_000,
    totalTimeoutMs: 60_000,
    retryMode: "standard",
    maxAttempts: 3,
    downloadConcurrency: 8,
  },

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
          // 支持环境变量临时压低并发：本地带宽有限时，CPU×2 个 worker × 并发 2
          // 会把 S3 大文件下载全部挤到 60s 超时（参见 s3-provider 重试日志）。
          workerCount: env.BUILDER_WORKER_COUNT
            ? Number(env.BUILDER_WORKER_COUNT)
            : os.cpus().length * 2,
          timeout: 30_000,
          useClusterMode: env.BUILDER_USE_CLUSTER_MODE !== "false",
          workerConcurrency: 2,
        },
      },
    },
  },
  plugins: [
    geocodingPlugin({
      enable: env.GEOCODING_ENABLED !== "false",
      provider: env.GEOCODING_PROVIDER || "nominatim",
      mapboxToken: env.MAPBOX_TOKEN,
      nominatimBaseUrl: env.GEOCODING_NOMINATIM_BASE_URL,
      nominatimUserAgent: geocodingUserAgent,
      cachePath: geocodingCachePath,
      cachePrecision: env.GEOCODING_CACHE_PRECISION,
      locales: geocodingLocales,
      language: env.GEOCODING_LANGUAGE,
    }),
  ],
}));
