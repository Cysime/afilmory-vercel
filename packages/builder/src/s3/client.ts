import http from "node:http";
import https from "node:https";

import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import type { S3Config } from "../storage/interfaces";
import { assertSafeHttpBaseUrl } from "../storage/url.js";

/**
 * 推导 S3 客户端的寻址风格（path-style vs virtual-hosted-style）。
 *
 * 不变量：客户端下载对象所用的 URL 风格必须与
 * S3StorageProvider.generatePublicUrl 对外公布的 URL 风格一致，
 * 否则「构建期能读到对象、访客拿到的公开 URL 却 404」（或反过来）。
 * generatePublicUrl 的分支逻辑（见 storage/providers/s3-provider.ts）：
 *
 * - endpoint 未设置或 hostname 为 AWS endpoint → AWS virtual-hosted-style
 *   （`bucket.s3.region.amazonaws.com/key`）→ forcePathStyle: false
 * - endpoint hostname 为 aliyuncs.com 或其子域 → 阿里云 OSS 把 bucket 插入 host，
 *   同样是 virtual-hosted-style → forcePathStyle: false
 * - 其余自定义 endpoint（MinIO 等自建服务）→ path-style
 *   （`endpoint/bucket/key`）→ forcePathStyle: true
 *
 * 显式配置 config.forcePathStyle 时不做推导，以配置为准。
 * 注意 customDomain 只影响公开 URL（走 CDN），不影响客户端取数，
 * 因此不参与推导。
 */
export function resolveForcePathStyle(
  config: Pick<S3Config, "endpoint" | "forcePathStyle">,
): boolean {
  if (config.forcePathStyle !== undefined) {
    return config.forcePathStyle;
  }

  const { endpoint } = config;
  if (!endpoint) {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    // The caller's URL validator reports the actionable configuration error.
    // A malformed string must never accidentally opt into virtual hosting.
    return true;
  }
  const isDomainOrSubdomain = (domain: string) =>
    hostname === domain || hostname.endsWith(`.${domain}`);
  if (
    ["amazonaws.com", "amazonaws.com.cn", "aliyuncs.com"].some(
      isDomainOrSubdomain,
    )
  ) {
    return false;
  }
  return true;
}

function assertOptionalPositiveInteger(
  name: string,
  value: number | undefined,
  max: number,
): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new Error(`${name} must be a positive integer <= ${max}`);
  }
}

// 创建 S3 客户端
export function createS3Client(config: S3Config): S3Client {
  if (config.provider !== "s3") {
    throw new Error("Storage provider is not s3");
  }

  const { accessKeyId, secretAccessKey } = config;
  // Config loading treats an empty optional URL as unset. Keep direct API
  // usage consistent instead of handing an invalid empty endpoint to the SDK.
  const endpoint = config.endpoint || undefined;
  const region = config.region ?? "us-east-1";
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      "accessKeyId and secretAccessKey must either both be provided or both be omitted",
    );
  }
  if (endpoint) assertSafeHttpBaseUrl(endpoint, "S3 endpoint");
  assertOptionalPositiveInteger("maxSockets", config.maxSockets, 10_000);
  assertOptionalPositiveInteger("maxAttempts", config.maxAttempts, 10);
  assertOptionalPositiveInteger(
    "connectionTimeoutMs",
    config.connectionTimeoutMs,
    86_400_000,
  );
  assertOptionalPositiveInteger(
    "socketTimeoutMs",
    config.socketTimeoutMs,
    86_400_000,
  );

  const keepAlive = config.keepAlive ?? true;
  const maxSockets = config.maxSockets ?? 64;
  const connectionTimeout = config.connectionTimeoutMs ?? 5_000;
  const socketTimeout = config.socketTimeoutMs ?? 30_000;
  const maxAttempts = config.maxAttempts ?? 3;
  const retryMode =
    (config.retryMode as S3ClientConfig["retryMode"]) ?? "standard";

  const httpAgent = new http.Agent({ keepAlive, maxSockets });
  const httpsAgent = new https.Agent({ keepAlive, maxSockets });

  const s3ClientConfig: S3ClientConfig = {
    region,
    // Omitting credentials activates the AWS SDK's standard provider chain
    // (environment, shared config/SSO, web identity, ECS/EC2 roles). Explicit
    // credentials remain useful for non-AWS S3-compatible services.
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
    // from https://github.com/aws/aws-sdk-js-v3/issues/6810
    // some non AWS services like backblaze or cloudflare don't expect the new headers
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    endpoint,
    forcePathStyle: resolveForcePathStyle({
      ...config,
      endpoint,
    }),
    requestHandler: new NodeHttpHandler({
      httpAgent,
      httpsAgent,
      connectionTimeout,
      socketTimeout,
    }),
    maxAttempts,
    retryMode,
  };

  return new S3Client(s3ClientConfig);
}
