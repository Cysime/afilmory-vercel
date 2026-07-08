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
 * Static deployment config - uses S3 storage by default
 *
 * This config targets static site deployment (Vercel, Netlify, GitHub Pages, etc.).
 * Photos are stored in S3-compatible object storage.
 *
 * How to use:
 * 1. Set the S3 environment variables in .env (required).
 * 2. Optional: set REPO_URL and REPO_TOKEN so the deploy script enables the
 *    remote artifact cache.
 * 3. Run pnpm build:manifest to generate the manifest and thumbnails.
 * 4. Then run pnpm build:web or pnpm build to bundle the static site.
 * 5. Deploy the apps/web/dist directory to your hosting platform.
 *
 * Zero-credential local runs (provider: "local"):
 * If you would rather not configure S3, swap storage for the local filesystem
 * provider:
 *
 *   storage: {
 *     provider: "local",
 *     // photos source directory; the repo-root photos/ dir is exactly the one
 *     // apps/web/plugins/vite/photos-static.ts serves at /photos/* in dev
 *     basePath: path.resolve(__dirname, "photos"),
 *     // originalUrl prefix, defaults to "/photos", matching the Vite plugin's path convention
 *     // baseUrl: "/photos",
 *     // excludeRegex: "^drafts/",
 *   },
 *
 * With this, pnpm build:manifest needs no object-storage credentials at all;
 * the manifest's originalUrl values look like /photos/..., and pnpm dev serves
 * the local originals directly through the Vite plugin.
 * See the "Local filesystem provider" section in packages/builder/README.md.
 */
export default defineBuilderConfig(() => ({
  output: {
    manifestPath: path.resolve(__dirname, "generated/photos-manifest.json"),
    thumbnailsDir: path.resolve(__dirname, "apps/web/public/thumbnails"),
    originalsDir: path.resolve(__dirname, "apps/web/public/originals"),
  },

  // Use S3 storage
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
    // S3 client addressing style (path-style vs virtual-hosted-style).
    // Auto-derived from the endpoint by default, matching how public URLs are
    // generated: AWS / Alibaba Cloud OSS -> virtual-hosted-style; any other
    // custom endpoint (MinIO and similar self-hosted services) -> path-style.
    // Only set this explicitly when the derivation does not match your actual
    // service; see packages/builder/src/storage/providers/README.md.
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
      worker: {
        // An environment variable can temporarily lower concurrency: when local
        // bandwidth is limited, CPU x 2 workers x concurrency 2 can push large
        // S3 downloads into the 60s timeout (see the s3-provider retry logs).
        workerCount: env.BUILDER_WORKER_COUNT
          ? Number(env.BUILDER_WORKER_COUNT)
          : os.cpus().length * 2,
        timeout: 30_000,
        useClusterMode: env.BUILDER_USE_CLUSTER_MODE !== "false",
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
