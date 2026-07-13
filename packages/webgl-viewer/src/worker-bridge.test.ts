import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIMPLE_LOD_LEVELS, TILE_SIZE } from "./tile-cache";
import {
  buildTextureWorkerSource,
  clampDimensionsToFit,
  TextureWorkerBridge,
} from "./worker-bridge";

class WorkerMock {
  static instances: WorkerMock[] = [];
  static throwOnConstruct = false;

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  url: string;
  options?: WorkerOptions;

  constructor(url: string, options?: WorkerOptions) {
    if (WorkerMock.throwOnConstruct) {
      throw new Error("worker construction failed");
    }
    this.url = url;
    this.options = options;
    WorkerMock.instances.push(this);
  }
}

describe("clampDimensionsToFit", () => {
  it("keeps dimensions that already fit", () => {
    expect(clampDimensionsToFit(4000, 3000, 4096)).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it("scales oversized dimensions down to the cap, preserving aspect ratio", () => {
    // 10000px 原图 → 0.5x 底图 5000px：老 GPU 的 4096 上限会让 texImage2D 失败
    expect(clampDimensionsToFit(5000, 3750, 4096)).toEqual({
      width: 4096,
      height: 3072,
    });
    // 高度主导的情况
    expect(clampDimensionsToFit(1000, 8192, 4096)).toEqual({
      width: 500,
      height: 4096,
    });
  });

  it("never produces a dimension below 1", () => {
    expect(clampDimensionsToFit(10_000, 1, 4096)).toEqual({
      width: 4096,
      height: 1,
    });
  });

  it("passes dimensions through when the cap is unknown (0 / negative)", () => {
    expect(clampDimensionsToFit(9000, 9000, 0)).toEqual({
      width: 9000,
      height: 9000,
    });
    expect(clampDimensionsToFit(9000, 9000, -1)).toEqual({
      width: 9000,
      height: 9000,
    });
  });

  it("also caps the RGBA allocation by byte budget", () => {
    expect(clampDimensionsToFit(8192, 8192, 16384, 64 * 1024 * 1024)).toEqual({
      width: 4096,
      height: 4096,
    });
  });
});

describe("buildTextureWorkerSource", () => {
  it("prepends the shared constants from tile-cache.ts to the worker source", () => {
    const source = buildTextureWorkerSource();

    expect(source.startsWith(`const TILE_SIZE = ${TILE_SIZE};`)).toBe(true);
    expect(source).toContain(
      `const SIMPLE_LOD_LEVELS = ${JSON.stringify(SIMPLE_LOD_LEVELS)};`,
    );
    // The clamp helper is injected with a stable binding name (survives
    // minifier renames because it is assigned, not referenced by name).
    expect(source).toContain("const clampDimensionsToFit = ");
    // The worker body itself must not re-declare the injected constants.
    const [, workerBody] = source.split("\nlet originalImage");
    expect(workerBody).toBeDefined();
    expect(workerBody).not.toContain("const TILE_SIZE");
    expect(workerBody).not.toContain("const SIMPLE_LOD_LEVELS");
    // The actual worker code still follows the prelude.
    expect(source).toContain("self.onmessage");
  });

  it("produces the source handed to the worker Blob", async () => {
    vi.stubGlobal("Worker", WorkerMock);
    const realCreateObjectURL = URL.createObjectURL;
    const createObjectURL = vi.fn((_blob: Blob) => "blob:texture-worker");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });

    try {
      new TextureWorkerBridge({ onMessage: vi.fn() });

      const blob = createObjectURL.mock.calls[0]![0];
      await expect(blob.text()).resolves.toBe(buildTextureWorkerSource());
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: realCreateObjectURL,
      });
    }
  });
});

describe("TextureWorkerBridge", () => {
  const originalWorker = globalThis.Worker;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    WorkerMock.instances = [];
    WorkerMock.throwOnConstruct = false;
    vi.stubGlobal("Worker", WorkerMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:texture-worker"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.Worker = originalWorker;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  });

  it("creates a texture worker and wires message handlers", () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onMessageError = vi.fn();

    new TextureWorkerBridge({ onError, onMessage, onMessageError });

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(WorkerMock.instances).toHaveLength(1);
    expect(WorkerMock.instances[0]).toMatchObject({
      onerror: onError,
      onmessageerror: onMessageError,
      onmessage: onMessage,
      options: { name: "texture-worker" },
      url: "blob:texture-worker",
    });
  });

  it("posts image and tile messages with stable payloads", () => {
    const bridge = new TextureWorkerBridge({ onMessage: vi.fn() });
    const worker = WorkerMock.instances[0];
    const blob = new Blob(["photo"], { type: "image/jpeg" });

    bridge.loadImage({
      blob,
      sessionId: 7,
      maxTextureSize: 4096,
      maxTextureBytes: 64 * 1024 * 1024,
      url: "https://example.com/photo.jpg",
    });
    bridge.createTile({
      sessionId: 7,
      imageHeight: 3000,
      imageWidth: 4000,
      key: "1-2-3",
      lodConfig: { scale: 0.5 },
      lodLevel: 3,
      x: 1,
      y: 2,
    });

    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      payload: {
        blob,
        sessionId: 7,
        maxTextureSize: 4096,
        maxTextureBytes: 64 * 1024 * 1024,
        url: "https://example.com/photo.jpg",
      },
      type: "load-image",
    });
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      payload: {
        imageHeight: 3000,
        imageWidth: 4000,
        sessionId: 7,
        key: "1-2-3",
        lodConfig: { scale: 0.5 },
        lodLevel: 3,
        x: 1,
        y: 2,
      },
      type: "create-tile",
    });
  });

  it("terminates the worker and revokes the object URL on dispose", () => {
    const bridge = new TextureWorkerBridge({ onMessage: vi.fn() });
    const worker = WorkerMock.instances[0];

    bridge.dispose();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:texture-worker");
  });

  it("revokes the generated URL when Worker construction fails", () => {
    WorkerMock.throwOnConstruct = true;

    expect(() => new TextureWorkerBridge({ onMessage: vi.fn() })).toThrow(
      /worker construction failed/,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:texture-worker");
  });
});
