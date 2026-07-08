import { describe, expect, it, vi } from "vitest";

// Import through the package entry so a future move of the manager class into
// its own module (with an index re-export) does not break these tests.
import { ImageConverterManager } from "~/lib/image-convert";
import type {
  ConversionResult,
  ImageConverterStrategy,
} from "~/lib/image-convert/type";

vi.mock("~/lib/debug-log", () => ({
  debugLog: vi.fn(),
}));

// The manager only needs `t` for the queue-waiting message; returning the key
// keeps assertions locale-independent (same idiom as the react-i18next stubs).
vi.mock("~/i18n", () => ({
  getI18n: () => ({ t: (key: string) => key }),
}));

// Detection is driven by the blob's own MIME type so each test controls
// strategy dispatch by constructing blobs — no file-type parsing, no wasm.
vi.mock("~/lib/file-type", () => ({
  detectFileTypeFromBlob: vi.fn(async (blob: Blob) =>
    blob.type ? { ext: "bin", mime: blob.type } : undefined,
  ),
}));

const STUB_MIME = "image/x-stub";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush every pending microtask chain (real timers, zero-delay macrotask). */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const stubBlob = (mime: string = STUB_MIME) =>
  new Blob(["raw"], { type: mime });

function conversionResult(label: string): ConversionResult {
  const blob = new Blob([label], { type: "image/jpeg" });
  return {
    blob,
    convertedSize: blob.size,
    format: "image/jpeg",
    originalSize: 42,
  };
}

/**
 * A conversion strategy whose convert() blocks on a per-invocation gate while
 * tracking how many conversions run simultaneously — tests observe (not just
 * infer) the pipeline's concurrency and settle each conversion explicitly.
 */
function createStubStrategy(
  overrides: Partial<
    Pick<ImageConverterStrategy, "convert" | "shouldConvert">
  > = {},
  {
    name = "Stub",
    formats = [STUB_MIME],
  }: {
    name?: string;
    formats?: string[];
  } = {},
) {
  const convertCalls: string[] = [];
  const gates: Deferred<ConversionResult>[] = [];
  let active = 0;
  let maxActive = 0;

  const strategy: ImageConverterStrategy = {
    getName: () => name,
    getSupportedFormats: () => formats,
    shouldConvert: async () => true,
    convert: async (_blob, originalUrl) => {
      convertCalls.push(originalUrl);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const gate = createDeferred<ConversionResult>();
      gates.push(gate);
      try {
        return await gate.promise;
      } finally {
        active -= 1;
      }
    },
    ...overrides,
  };

  return {
    strategy,
    convertCalls,
    gates,
    activeCount: () => active,
    maxActiveCount: () => maxActive,
  };
}

describe("ImageConverterManager", () => {
  it("shares one in-flight conversion for the same image and converts anew after it settles", async () => {
    const manager = new ImageConverterManager();
    const stub = createStubStrategy();
    manager.registerStrategy(stub.strategy);
    const url = "https://example.com/photo.bin";

    const first = manager.convertImage(stubBlob(), url);
    await tick();
    const second = manager.convertImage(stubBlob(), url);
    await tick();

    // The second request joined the pending task instead of converting again.
    expect(stub.convertCalls).toEqual([url]);

    const result = conversionResult("converted");
    stub.gates[0].resolve(result);
    await expect(first).resolves.toBe(result);
    await expect(second).resolves.toBe(result);

    // The pending entry was cleaned up on settle: a later request converts again.
    const third = manager.convertImage(stubBlob(), url);
    await tick();
    expect(stub.convertCalls).toEqual([url, url]);

    const secondPass = conversionResult("second pass");
    stub.gates[1].resolve(secondPass);
    await expect(third).resolves.toBe(secondPass);
  });

  it("drops the pending entry when a conversion rejects so a retry converts again", async () => {
    const manager = new ImageConverterManager();
    const stub = createStubStrategy();
    manager.registerStrategy(stub.strategy);
    const url = "https://example.com/retry.bin";

    const first = manager.convertImage(stubBlob(), url);
    const firstRejection = expect(first).rejects.toThrow("decode exploded");
    await tick();
    stub.gates[0].reject(new Error("decode exploded"));
    await firstRejection;

    const retry = manager.convertImage(stubBlob(), url);
    await tick();
    expect(stub.convertCalls).toEqual([url, url]);

    const result = conversionResult("retry");
    stub.gates[1].resolve(result);
    await expect(retry).resolves.toBe(result);
  });

  it("never runs more conversions than the pipeline concurrency limit", async () => {
    const manager = new ImageConverterManager({ maxConcurrent: 2 });
    const stub = createStubStrategy();
    manager.registerStrategy(stub.strategy);

    const urls = ["a", "b", "c", "d"].map(
      (n) => `https://example.com/${n}.bin`,
    );
    const conversions = urls.map((url) =>
      manager.convertImage(stubBlob(), url),
    );
    await tick();

    expect(stub.activeCount()).toBe(2);
    expect(stub.convertCalls).toEqual(urls.slice(0, 2));
    expect(manager.getPipelineStats()).toEqual({ active: 2, pending: 2 });

    stub.gates[0].resolve(conversionResult("a"));
    await tick();

    // A freed slot admits exactly one queued conversion.
    expect(stub.activeCount()).toBe(2);
    expect(stub.convertCalls).toEqual(urls.slice(0, 3));
    expect(manager.getPipelineStats()).toEqual({ active: 2, pending: 1 });

    stub.gates[1].resolve(conversionResult("b"));
    stub.gates[2].resolve(conversionResult("c"));
    await tick();
    stub.gates[3].resolve(conversionResult("d"));

    const results = await Promise.all(conversions);
    expect(results.map((r) => r?.format)).toEqual(
      Array.from({ length: 4 }, () => "image/jpeg"),
    );
    expect(stub.maxActiveCount()).toBe(2);
    expect(manager.getPipelineStats()).toEqual({ active: 0, pending: 0 });
  });

  it("releases the conversion slot on rejection so queued conversions still run", async () => {
    const manager = new ImageConverterManager({ maxConcurrent: 1 });
    const stub = createStubStrategy();
    manager.registerStrategy(stub.strategy);
    const failingUrl = "https://example.com/fails.bin";
    const queuedUrl = "https://example.com/queued.bin";

    const failing = manager.convertImage(stubBlob(), failingUrl);
    const failingRejection =
      expect(failing).rejects.toThrow("wasm decode failed");
    await tick();
    const queued = manager.convertImage(stubBlob(), queuedUrl);
    await tick();
    // The queued conversion waits for the single slot.
    expect(stub.convertCalls).toEqual([failingUrl]);

    stub.gates[0].reject(new Error("wasm decode failed"));
    await failingRejection;
    await tick();

    // The rejection released the slot: the queued conversion ran.
    expect(stub.convertCalls).toEqual([failingUrl, queuedUrl]);
    const result = conversionResult("queued");
    stub.gates[1].resolve(result);
    await expect(queued).resolves.toBe(result);
    expect(manager.getPipelineStats()).toEqual({ active: 0, pending: 0 });
  });

  it("surfaces a throwing strategy as a conversion error instead of a stuck queue", async () => {
    const manager = new ImageConverterManager({ maxConcurrent: 1 });
    const throwing = createStubStrategy(
      {
        convert: () => {
          throw new Error("strategy threw before returning a promise");
        },
      },
      { name: "Throwing", formats: ["image/x-throwing"] },
    );
    const healthy = createStubStrategy(
      {},
      { name: "Healthy", formats: ["image/x-healthy"] },
    );
    manager.registerStrategy(throwing.strategy);
    manager.registerStrategy(healthy.strategy);

    await expect(
      manager.convertImage(
        stubBlob("image/x-throwing"),
        "https://example.com/boom.bin",
      ),
    ).rejects.toThrow("strategy threw before returning a promise");

    // The failure released its pipeline slot: the next conversion still runs.
    const after = manager.convertImage(
      stubBlob("image/x-healthy"),
      "https://example.com/after.bin",
    );
    await tick();
    expect(healthy.convertCalls).toEqual(["https://example.com/after.bin"]);

    const result = conversionResult("after");
    healthy.gates[0].resolve(result);
    await expect(after).resolves.toBe(result);
    expect(manager.getPipelineStats()).toEqual({ active: 0, pending: 0 });
  });

  it("returns null without invoking any strategy for formats no converter handles", async () => {
    const manager = new ImageConverterManager();
    const stub = createStubStrategy();
    manager.registerStrategy(stub.strategy);

    // Detected format with no registered strategy.
    await expect(
      manager.convertImage(
        stubBlob("image/x-unhandled"),
        "https://example.com/a.bin",
      ),
    ).resolves.toBeNull();

    // Undetectable blob (file-type finds nothing).
    await expect(
      manager.convertImage(new Blob(["raw"]), "https://example.com/b.bin"),
    ).resolves.toBeNull();

    expect(stub.convertCalls).toHaveLength(0);
    expect(manager.getPipelineStats()).toEqual({ active: 0, pending: 0 });
  });

  it("returns null when the matching strategy declines the conversion", async () => {
    const manager = new ImageConverterManager();
    const stub = createStubStrategy({ shouldConvert: async () => false });
    manager.registerStrategy(stub.strategy);

    await expect(
      manager.convertImage(stubBlob(), "https://example.com/native.bin"),
    ).resolves.toBeNull();
    expect(stub.convertCalls).toHaveLength(0);
  });

  it("reports queue waiting to loading callbacks while the pipeline is saturated", async () => {
    const manager = new ImageConverterManager({ maxConcurrent: 1 });
    const stub = createStubStrategy();
    manager.registerStrategy(stub.strategy);
    const activeUrl = "https://example.com/active.bin";
    const waitingUrl = "https://example.com/waiting.bin";

    const first = manager.convertImage(stubBlob(), activeUrl);
    await tick();
    expect(stub.activeCount()).toBe(1);

    const onLoadingStateUpdate = vi.fn();
    const queued = manager.convertImage(stubBlob(), waitingUrl, {
      onLoadingStateUpdate,
    });
    await tick();

    expect(onLoadingStateUpdate).toHaveBeenCalledWith({
      isConverting: true,
      isQueueWaiting: true,
      conversionMessage: "loading.queue.waiting",
    });
    expect(stub.convertCalls).toEqual([activeUrl]);

    stub.gates[0].resolve(conversionResult("active"));
    await tick();

    // Once a slot frees, the queued task clears the waiting state and converts.
    expect(onLoadingStateUpdate).toHaveBeenLastCalledWith({
      isQueueWaiting: false,
      conversionMessage: undefined,
    });
    expect(stub.convertCalls).toEqual([activeUrl, waitingUrl]);

    stub.gates[1].resolve(conversionResult("waiting"));
    await expect(Promise.all([first, queued])).resolves.toHaveLength(2);
  });
});
