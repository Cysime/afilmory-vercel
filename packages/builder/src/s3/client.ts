import http from "node:http";
import https from "node:https";

import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

import type { S3Config } from "../storage/interfaces";

/**
 * 推导 S3 客户端的寻址风格（path-style vs virtual-hosted-style）。
 *
 * 不变量：客户端下载对象所用的 URL 风格必须与
 * S3StorageProvider.generatePublicUrl 对外公布的 URL 风格一致，
 * 否则「构建期能读到对象、访客拿到的公开 URL 却 404」（或反过来）。
 * generatePublicUrl 的分支逻辑（见 storage/providers/s3-provider.ts）：
 *
 * - endpoint 未设置或包含 "amazonaws.com" → AWS virtual-hosted-style
 *   （`bucket.s3.region.amazonaws.com/key`）→ forcePathStyle: false
 * - endpoint 包含 "aliyuncs.com" → 阿里云 OSS 把 bucket 插入 host，
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
  if (endpoint.includes("amazonaws.com") || endpoint.includes("aliyuncs.com")) {
    return false;
  }
  return true;
}

// 创建 S3 客户端
export function createS3Client(config: S3Config): S3Client {
  if (config.provider !== "s3") {
    throw new Error("Storage provider is not s3");
  }

  const { accessKeyId, secretAccessKey, endpoint, region } = config;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("accessKeyId and secretAccessKey are required");
  }

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
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // from https://github.com/aws/aws-sdk-js-v3/issues/6810
    // some non AWS services like backblaze or cloudflare don't expect the new headers
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    endpoint,
    forcePathStyle: resolveForcePathStyle(config),
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
