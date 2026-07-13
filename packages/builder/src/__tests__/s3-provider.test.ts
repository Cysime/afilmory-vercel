import { Buffer } from "node:buffer";
import { PassThrough, Readable } from "node:stream";

import type {
  DeleteObjectCommand,
  DeleteObjectCommandOutput,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
  PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  S3ClientLike,
  S3GetObjectOutput,
  S3SendOptions,
} from "../storage/providers/s3-provider.js";
import { S3StorageProvider } from "../storage/providers/s3-provider.js";

type MockS3Command =
  | DeleteObjectCommand
  | GetObjectCommand
  | ListObjectsV2Command
  | PutObjectCommand;

// The AWS SDK types a streamed Body as SdkStream (mixin methods the provider
// never touches); the mock seam widens it to any Node readable so tests can
// exercise the streaming branch without casting.
type MockGetObjectOutput = Omit<S3GetObjectOutput, "Body"> & {
  Body?: Buffer | NodeJS.ReadableStream;
};

type MockS3Response =
  | DeleteObjectCommandOutput
  | MockGetObjectOutput
  | ListObjectsV2CommandOutput
  | PutObjectCommandOutput;

type MockS3Send = (
  command: MockS3Command,
  options?: S3SendOptions,
) => Promise<MockS3Response>;

class MockS3Client implements S3ClientLike {
  destroy?: () => void;

  constructor(private readonly sendMock: MockS3Send) {}

  send(
    command: DeleteObjectCommand,
    options?: S3SendOptions,
  ): Promise<DeleteObjectCommandOutput>;
  send(
    command: GetObjectCommand,
    options?: S3SendOptions,
  ): Promise<S3GetObjectOutput>;
  send(
    command: ListObjectsV2Command,
    options?: S3SendOptions,
  ): Promise<ListObjectsV2CommandOutput>;
  send(
    command: PutObjectCommand,
    options?: S3SendOptions,
  ): Promise<PutObjectCommandOutput>;
  async send(
    command: MockS3Command,
    options?: S3SendOptions,
  ): Promise<MockS3Response> {
    return await this.sendMock(command, options);
  }
}

function createGetObjectResponse(
  response: Omit<MockGetObjectOutput, "$metadata">,
): MockGetObjectOutput {
  return { $metadata: {}, ...response };
}

function createListObjectsResponse(
  response: Omit<ListObjectsV2CommandOutput, "$metadata">,
): ListObjectsV2CommandOutput {
  return { $metadata: {}, ...response };
}

describe("S3StorageProvider.getFile", () => {
  const config = {
    provider: "s3" as const,
    bucket: "bucket",
    region: "auto",
    endpoint: "https://example.com",
    accessKeyId: "key",
    secretAccessKey: "secret",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects invalid direct download tuning instead of clamping it", () => {
    expect(
      () =>
        new S3StorageProvider(
          { ...config, downloadConcurrency: 0 },
          { s3Client: new MockS3Client(vi.fn<MockS3Send>()) },
        ),
    ).toThrow(/downloadConcurrency must be a positive integer/);
  });

  it.each([
    { endpoint: "https://user:secret@example.com" },
    { endpoint: "https://example.com?token=secret" },
    { customDomain: "javascript:alert(1)" },
  ])("rejects unsafe public URL configuration", (override) => {
    expect(
      () =>
        new S3StorageProvider(
          { ...config, ...override },
          { s3Client: new MockS3Client(vi.fn<MockS3Send>()) },
        ),
    ).toThrow(/http\(s\) URL without credentials/);
  });

  it("clears the total timeout when the response body is already a Buffer", async () => {
    const send = vi.fn<MockS3Send>().mockResolvedValue(
      createGetObjectResponse({
        Body: Buffer.from("hello"),
        ContentLength: 5,
      }),
    );
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(provider.getFile("image.jpg")).resolves.toEqual(
      Buffer.from("hello"),
    );
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("clears the total timeout when the response body is missing", async () => {
    const send = vi
      .fn<MockS3Send>()
      .mockResolvedValue(createGetObjectResponse({}));
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(provider.getFile("image.jpg")).resolves.toBeNull();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("propagates caller cancellation into the active S3 request", async () => {
    let requestSignal: AbortSignal | undefined;
    const send = vi.fn<MockS3Send>(
      async (_command, options) =>
        await new Promise((_resolve, reject) => {
          requestSignal = options?.abortSignal;
          options?.abortSignal?.addEventListener(
            "abort",
            () => reject(options.abortSignal?.reason),
            { once: true },
          );
        }),
    );
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });
    const controller = new AbortController();
    const download = provider.getFile("image.jpg", controller.signal);

    await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
    controller.abort(new Error("cancel build"));

    await expect(download).rejects.toThrow("cancel build");
    expect(requestSignal?.aborted).toBe(true);
  });

  it("accumulates streamed body chunks into a single Buffer", async () => {
    const send = vi.fn<MockS3Send>().mockResolvedValue(
      createGetObjectResponse({
        Body: Readable.from([Buffer.from("chunk-1:"), Buffer.from("chunk-2")]),
        ContentLength: 15,
      }),
    );
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    await expect(provider.getFile("image.jpg")).resolves.toEqual(
      Buffer.from("chunk-1:chunk-2"),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries once after a transient send failure and returns the retried body", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<MockS3Send>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(
        createGetObjectResponse({ Body: Buffer.from("recovered") }),
      );
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    const result = provider.getFile("image.jpg");

    // The first attempt fails immediately; the retry must wait out the
    // backoff sleep instead of firing synchronously.
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    // backoffDelay(1) is at most 300ms + 30% jitter; 5s comfortably covers it.
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual(Buffer.from("recovered"));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("resolves null instead of rejecting once every attempt has failed", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<MockS3Send>()
      .mockRejectedValue(new Error("connection refused"));
    const provider = new S3StorageProvider(
      { ...config, maxAttempts: 3 },
      { s3Client: new MockS3Client(send) },
    );

    // The build's fault tolerance rests on this: a permanently failing
    // download becomes a "failed" photo, it must never crash the build.
    const result = provider.getFile("image.jpg");
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(3);
    // Every attempt cleared its own total/idle timers on the way out.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry deterministic client-side S3 errors", async () => {
    const forbidden = Object.assign(new Error("forbidden"), {
      $metadata: { httpStatusCode: 403 },
    });
    const send = vi.fn<MockS3Send>().mockRejectedValue(forbidden);
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    await expect(provider.getFile("private.jpg")).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled stream via the idle timeout and retries with a clean slate", async () => {
    vi.useFakeTimers();
    const stalledStream = new PassThrough();
    const signals: (AbortSignal | undefined)[] = [];
    const send = vi.fn<MockS3Send>(async (_command, options) => {
      signals.push(options?.abortSignal);
      if (signals.length === 1) {
        // Mirror the real SDK: aborting the request errors the body stream.
        options?.abortSignal?.addEventListener("abort", () => {
          stalledStream.destroy(new Error("request aborted"));
        });
        return createGetObjectResponse({
          Body: stalledStream,
          ContentLength: 1024,
        });
      }
      return createGetObjectResponse({ Body: Buffer.from("recovered") });
    });
    const provider = new S3StorageProvider(
      { ...config, idleTimeoutMs: 1000, maxAttempts: 2 },
      { s3Client: new MockS3Client(send) },
    );

    const result = provider.getFile("image.jpg");
    // Let the first attempt attach its stream listeners and arm the idle timer.
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    // One chunk arrives, re-arming the idle timer... then the stream stalls.
    stalledStream.write(Buffer.from("partial"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual(Buffer.from("recovered"));
    expect(send).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    // The retry must not inherit the aborted state or a stray idle timer.
    expect(signals[1]?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("paginates through truncated list responses for listAllFiles", async () => {
    const send = vi
      .fn<MockS3Send>()
      .mockResolvedValueOnce(
        createListObjectsResponse({
          Contents: [
            { Key: "a.jpg", Size: 1 },
            { Key: "b.mov", Size: 2 },
          ],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        createListObjectsResponse({
          Contents: [{ Key: "c.heic", Size: 3 }],
          IsTruncated: false,
        }),
      );
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    await expect(provider.listAllFiles()).resolves.toEqual([
      { key: "a.jpg", size: 1, lastModified: undefined, etag: undefined },
      { key: "b.mov", size: 2, lastModified: undefined, etag: undefined },
      { key: "c.heic", size: 3, lastModified: undefined, etag: undefined },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("respects maxFileLimit across paginated list responses", async () => {
    const send = vi
      .fn<MockS3Send>()
      .mockResolvedValueOnce(
        createListObjectsResponse({
          Contents: [{ Key: "a.jpg", Size: 1 }],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        createListObjectsResponse({
          Contents: [
            { Key: "b.jpg", Size: 2 },
            { Key: "c.jpg", Size: 3 },
          ],
          IsTruncated: true,
          NextContinuationToken: "page-3",
        }),
      );
    const provider = new S3StorageProvider(
      {
        ...config,
        maxFileLimit: 2,
      },
      {
        s3Client: new MockS3Client(send),
      },
    );

    await expect(provider.listImages()).resolves.toEqual([
      { key: "a.jpg", size: 1, lastModified: undefined, etag: undefined },
      { key: "b.jpg", size: 2, lastModified: undefined, etag: undefined },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("marks a maxFileLimit-truncated snapshot as incomplete", async () => {
    const send = vi.fn<MockS3Send>().mockResolvedValue(
      createListObjectsResponse({
        Contents: [{ Key: "a.jpg", Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: "more",
      }),
    );
    const provider = new S3StorageProvider(
      { ...config, maxFileLimit: 1 },
      { s3Client: new MockS3Client(send) },
    );

    await expect(provider.listAllFilesDetailed()).resolves.toMatchObject({
      complete: false,
      objects: [expect.objectContaining({ key: "a.jpg" })],
      reason: { code: "max-file-limit" },
    });
  });

  it("marks malformed pagination as incomplete instead of publishing a partial snapshot", async () => {
    const send = vi.fn<MockS3Send>().mockResolvedValue(
      createListObjectsResponse({
        Contents: [{ Key: "a.jpg", Size: 1 }],
        IsTruncated: true,
      }),
    );
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    await expect(provider.listAllFilesDetailed()).resolves.toMatchObject({
      complete: false,
      reason: { code: "pagination-anomaly" },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized body without retrying the deterministic limit failure", async () => {
    const send = vi.fn<MockS3Send>().mockResolvedValue(
      createGetObjectResponse({
        Body: Buffer.from("12345"),
        ContentLength: 5,
      }),
    );
    const provider = new S3StorageProvider(
      {
        ...config,
        downloadMemoryBudgetBytes: 4,
        maxDownloadBytes: 4,
      },
      { s3Client: new MockS3Client(send) },
    );

    await expect(provider.getFile("too-large.jpg")).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("serializes streamed buffers when the provider byte budget is exhausted", async () => {
    const firstStream = new PassThrough();
    const send = vi
      .fn<MockS3Send>()
      .mockResolvedValueOnce(
        createGetObjectResponse({ Body: firstStream, ContentLength: 4 }),
      )
      .mockResolvedValueOnce(
        createGetObjectResponse({
          Body: Readable.from([Buffer.from("next")]),
          ContentLength: 4,
        }),
      );
    const provider = new S3StorageProvider(
      {
        ...config,
        downloadMemoryBudgetBytes: 4,
        maxDownloadBytes: 4,
      },
      { s3Client: new MockS3Client(send) },
    );

    const first = provider.getFile("first.jpg");
    let secondSettled = false;
    const second = provider.getFile("second.jpg").finally(() => {
      secondSettled = true;
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    firstStream.end(Buffer.from("one!"));
    await expect(first).resolves.toEqual(Buffer.from("one!"));
    await expect(second).resolves.toEqual(Buffer.from("next"));
  });

  it("excludes keys matching S3_EXCLUDE_REGEX from both listImages and listAllFiles", async () => {
    const makeSend = () =>
      vi.fn<MockS3Send>().mockResolvedValue(
        createListObjectsResponse({
          Contents: [
            { Key: "keep.jpg", Size: 1 },
            { Key: "drafts/skip.jpg", Size: 2 },
            { Key: "clip.mov", Size: 3 },
          ],
          IsTruncated: false,
        }),
      );

    const imagesProvider = new S3StorageProvider(
      { ...config, excludeRegex: "^drafts/" },
      { s3Client: new MockS3Client(makeSend()) },
    );
    await expect(imagesProvider.listImages()).resolves.toEqual([
      { key: "keep.jpg", size: 1, lastModified: undefined, etag: undefined },
    ]);

    const filesProvider = new S3StorageProvider(
      { ...config, excludeRegex: "^drafts/" },
      { s3Client: new MockS3Client(makeSend()) },
    );
    const allKeys = (await filesProvider.listAllFiles()).map((o) => o.key);
    expect(allKeys).toEqual(["keep.jpg", "clip.mov"]);
  });

  it("ignores an invalid S3_EXCLUDE_REGEX instead of throwing", async () => {
    const send = vi.fn<MockS3Send>().mockResolvedValue(
      createListObjectsResponse({
        Contents: [{ Key: "a.jpg", Size: 1 }],
        IsTruncated: false,
      }),
    );
    const provider = new S3StorageProvider(
      { ...config, excludeRegex: "[" },
      { s3Client: new MockS3Client(send) },
    );
    await expect(provider.listImages()).resolves.toEqual([
      { key: "a.jpg", size: 1, lastModified: undefined, etag: undefined },
    ]);
  });

  it("pairs live photos deterministically regardless of listing order", () => {
    const provider = new S3StorageProvider(config);
    const files = [
      { key: "trip/IMG.heic" },
      { key: "trip/IMG.jpg" },
      { key: "trip/IMG.mov" },
    ] as Parameters<typeof provider.detectLivePhotos>[0];

    const forward = provider.detectLivePhotos(files);
    const reversed = provider.detectLivePhotos([...files].reverse());

    // "IMG.heic" sorts before "IMG.jpg", so it is the deterministic image side.
    expect(forward.get("trip/IMG.heic")?.key).toBe("trip/IMG.mov");
    expect([...reversed.entries()].map(([k, v]) => [k, v.key])).toEqual(
      [...forward.entries()].map(([k, v]) => [k, v.key]),
    );
  });

  it("listObjectKeys paginates and returns all keys under a prefix", async () => {
    const send = vi
      .fn<MockS3Send>()
      .mockResolvedValueOnce(
        createListObjectsResponse({
          Contents: [{ Key: "thumbs/a.jpg" }, { Key: "thumbs/b.jpg" }],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        createListObjectsResponse({
          Contents: [{ Key: "thumbs/c.jpg" }],
          IsTruncated: false,
        }),
      );
    const provider = new S3StorageProvider(config, {
      s3Client: new MockS3Client(send),
    });

    await expect(provider.listObjectKeys("thumbs/")).resolves.toEqual([
      "thumbs/a.jpg",
      "thumbs/b.jpg",
      "thumbs/c.jpg",
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("applies the same retry policy to uploads", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<MockS3Send>()
      .mockRejectedValueOnce(new Error("temporary upload failure"))
      .mockResolvedValueOnce({ $metadata: {}, ETag: '"etag"' });
    const provider = new S3StorageProvider(
      { ...config, maxAttempts: 2 },
      { s3Client: new MockS3Client(send) },
    );
    const upload = provider.uploadFile("thumb.jpg", Buffer.from("jpeg"));

    await vi.advanceTimersByTimeAsync(5000);
    await expect(upload).resolves.toMatchObject({
      etag: '"etag"',
      key: "thumb.jpg",
      size: 4,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("encodes object keys when generating public URLs", () => {
    const provider = new S3StorageProvider({
      ...config,
      customDomain: "https://cdn.example.com/",
    });

    expect(provider.generatePublicUrl("family/2024 #1?.jpg")).toBe(
      "https://cdn.example.com/family/2024%20%231%3F.jpg",
    );
  });

  it("keeps public URL addressing consistent with explicit forcePathStyle", () => {
    const pathStyle = new S3StorageProvider({
      ...config,
      endpoint: "https://s3.us-east-1.amazonaws.com",
      forcePathStyle: true,
      region: "us-east-1",
    });
    expect(pathStyle.generatePublicUrl("folder/photo 1.jpg")).toBe(
      "https://s3.us-east-1.amazonaws.com/bucket/folder/photo%201.jpg",
    );

    const virtualHosted = new S3StorageProvider({
      ...config,
      endpoint: "https://objects.example.com",
      forcePathStyle: false,
    });
    expect(virtualHosted.generatePublicUrl("photo.jpg")).toBe(
      "https://bucket.objects.example.com/photo.jpg",
    );
  });

  it("disposes an owned client exactly once", async () => {
    const client = new MockS3Client(vi.fn<MockS3Send>());
    const destroy = vi.fn();
    client.destroy = destroy;
    const provider = new S3StorageProvider(config, { s3Client: client });

    await provider.dispose();
    await provider.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
