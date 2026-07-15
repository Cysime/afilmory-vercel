import { describe, expect, it } from "vitest";

import type { S3Config } from "../storage/interfaces";
import { createS3Client, resolveForcePathStyle } from "./client";

describe("resolveForcePathStyle", () => {
  // 默认推导矩阵必须与 S3StorageProvider.generatePublicUrl 的 URL 风格一致：
  // AWS/阿里云 → virtual-hosted-style（false），其余自定义 endpoint → path-style（true）。
  it("defaults to virtual-hosted style when no endpoint is configured (AWS default)", () => {
    expect(resolveForcePathStyle({})).toBe(false);
  });

  it("defaults to virtual-hosted style for AWS endpoints", () => {
    expect(
      resolveForcePathStyle({
        endpoint: "https://s3.us-east-1.amazonaws.com",
      }),
    ).toBe(false);
    expect(
      resolveForcePathStyle({
        endpoint: "https://S3.CN-NORTH-1.AMAZONAWS.COM.CN",
      }),
    ).toBe(false);
  });

  it("defaults to virtual-hosted style for Aliyun OSS endpoints", () => {
    expect(
      resolveForcePathStyle({
        endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      }),
    ).toBe(false);
  });

  it("defaults to path style for custom endpoints (MinIO and other self-hosted services)", () => {
    expect(
      resolveForcePathStyle({ endpoint: "https://minio.example.com:9000" }),
    ).toBe(true);
    expect(resolveForcePathStyle({ endpoint: "http://localhost:9000" })).toBe(
      true,
    );
    expect(
      resolveForcePathStyle({
        endpoint: "https://minio.example.com/amazonaws.com",
      }),
    ).toBe(true);
    expect(
      resolveForcePathStyle({ endpoint: "https://evilamazonaws.com" }),
    ).toBe(true);
  });

  it("honours an explicit forcePathStyle: true even for AWS endpoints", () => {
    expect(
      resolveForcePathStyle({
        endpoint: "https://s3.us-east-1.amazonaws.com",
        forcePathStyle: true,
      }),
    ).toBe(true);
  });

  it("honours an explicit forcePathStyle: false even for custom endpoints", () => {
    expect(
      resolveForcePathStyle({
        endpoint: "https://minio.example.com:9000",
        forcePathStyle: false,
      }),
    ).toBe(false);
  });
});

describe("createS3Client", () => {
  const baseConfig: S3Config = {
    provider: "s3",
    bucket: "bucket",
    region: "us-east-1",
    accessKeyId: "key",
    secretAccessKey: "secret",
  };

  it("threads the derived forcePathStyle into the client config", () => {
    const client = createS3Client({
      ...baseConfig,
      endpoint: "https://minio.example.com:9000",
    });
    try {
      expect(client.config.forcePathStyle).toBe(true);
    } finally {
      client.destroy();
    }
  });

  it("keeps virtual-hosted style for AWS endpoints", () => {
    const client = createS3Client({
      ...baseConfig,
      endpoint: "https://s3.us-east-1.amazonaws.com",
    });
    try {
      expect(client.config.forcePathStyle).toBe(false);
    } finally {
      client.destroy();
    }
  });

  it("lets an explicit forcePathStyle override the derivation", () => {
    const client = createS3Client({
      ...baseConfig,
      endpoint: "https://minio.example.com:9000",
      forcePathStyle: false,
    });
    try {
      expect(client.config.forcePathStyle).toBe(false);
    } finally {
      client.destroy();
    }
  });

  it("uses the AWS default credential chain when explicit keys are omitted", () => {
    const client = createS3Client({
      provider: "s3",
      bucket: "bucket",
      region: "us-east-1",
    });
    client.destroy();
  });

  it("treats an empty endpoint as unset in direct API usage", () => {
    const client = createS3Client({
      ...baseConfig,
      endpoint: "",
    });
    try {
      expect(client.config.forcePathStyle).toBe(false);
    } finally {
      client.destroy();
    }
  });

  it("rejects a partially configured explicit credential pair", () => {
    expect(() =>
      createS3Client({
        provider: "s3",
        bucket: "bucket",
        region: "us-east-1",
        accessKeyId: "key-only",
      }),
    ).toThrow(/must either both be provided or both be omitted/);
  });

  it("rejects invalid transport tuning in direct API usage", () => {
    expect(() => createS3Client({ ...baseConfig, maxSockets: 0 })).toThrow(
      /maxSockets must be a positive integer/,
    );
    expect(() => createS3Client({ ...baseConfig, maxAttempts: 1.5 })).toThrow(
      /maxAttempts must be a positive integer/,
    );
  });
});
