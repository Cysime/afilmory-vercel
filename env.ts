import "dotenv-expand/config";

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // S3 storage config (required; this project only supports S3 storage)
    S3_REGION: z.string().default("us-east-1"),
    // May be empty when building the frontend; the builder validates strictly at runtime
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    S3_ENDPOINT: z.string().default("https://s3.us-east-1.amazonaws.com"),
    S3_BUCKET_NAME: z.string().default(""),
    S3_PREFIX: z.string().default(""),
    S3_CUSTOM_DOMAIN: z.string().default(""),
    S3_EXCLUDE_REGEX: z.string().optional(),

    // Remote repository cache config (optional)
    REPO_URL: z.string().optional(),
    REPO_TOKEN: z.string().optional(),
    BUILDER_REPO_URL: z.string().optional(),
    GIT_TOKEN: z.string().optional(),

    // Basic site config (optional; falls back to the defaults in site.config.ts when unset)
    SITE_NAME: z.string().optional(),
    SITE_TITLE: z.string().optional(),
    SITE_DESCRIPTION: z.string().optional(),
    SITE_URL: z.string().optional(),
    SITE_ACCENT_COLOR: z.string().optional(),
    SITE_LANGUAGE: z.string().optional(),

    // Author info (optional)
    AUTHOR_NAME: z.string().optional(),
    AUTHOR_URL: z.string().optional(),
    AUTHOR_AVATAR: z.string().optional(),

    // Social media (optional)
    SOCIAL_GITHUB: z.string().optional(),
    SOCIAL_TWITTER: z.string().optional(),
    SOCIAL_RSS: z.enum(["true", "false"]).optional(), // 'true' or 'false'

    // Feed config (optional)
    FEED_FOLO_FEED_ID: z.string().optional(),
    FEED_FOLO_USER_ID: z.string().optional(),

    // Map config (optional)
    MAP_STYLE: z.string().optional(), // 'builtin' or custom
    MAP_PROJECTION: z.enum(["globe", "mercator"]).optional(),

    // Build-time reverse geocoding (optional)
    // The boolean switch is enum-constrained so a typo fails immediately at build
    // time instead of being silently treated as true by `!== "false"`.
    GEOCODING_ENABLED: z.enum(["true", "false"]).default("true"),
    GEOCODING_PROVIDER: z.enum(["nominatim", "mapbox", "auto"]).optional(),
    GEOCODING_LOCALES: z.string().optional(),
    GEOCODING_LANGUAGE: z.string().optional(),
    GEOCODING_USER_AGENT: z.string().optional(),
    GEOCODING_CACHE_PATH: z.string().optional(),
    GEOCODING_CACHE_PRECISION: z.coerce.number().optional(),
    GEOCODING_NOMINATIM_BASE_URL: z.string().optional(),
    MAPBOX_TOKEN: z.string().optional(),

    // Builder performance config (optional)
    BUILDER_USE_CLUSTER_MODE: z.enum(["true", "false"]).optional(),
    BUILDER_WORKER_COUNT: z.coerce.number().int().positive().optional(),
  },
  runtimeEnv: process.env,
  isServer: typeof window === "undefined",
});
