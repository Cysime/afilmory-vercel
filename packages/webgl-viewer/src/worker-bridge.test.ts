import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIMPLE_LOD_LEVELS, TILE_SIZE } from "./tile-cache";
import { buildTextureWorkerSource, TextureWorkerBridge } from "./worker-bridge";

class WorkerMock {
  static instances: WorkerMock[] = [];

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  url: string;
  options?: WorkerOptions;

  constructor(url: string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    WorkerMock.instances.push(this);
  }
}

describe("buildTextureWorkerSource", () => {
  it("prepends the shared constants from tile-cache.ts to the worker source", () => {
    const source = buildTextureWorkerSource();

    expect(source.startsWith(`const TILE_SIZE = ${TILE_SIZE};`)).toBe(true);
    expect(source).toContain(
      `const SIMPLE_LOD_LEVELS = ${JSON.stringify(SIMPLE_LOD_LEVELS)};`,
    );
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

    new TextureWorkerBridge({ onError, onMessage });

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(WorkerMock.instances).toHaveLength(1);
    expect(WorkerMock.instances[0]).toMatchObject({
      onerror: onError,
      onmessage: onMessage,
      options: { name: "texture-worker" },
      url: "blob:texture-worker",
    });
  });

  it("posts image and tile messages with stable payloads", () => {
    const bridge = new TextureWorkerBridge({ onMessage: vi.fn() });
    const worker = WorkerMock.instances[0];
    const blob = new Blob(["photo"], { type: "image/jpeg" });

    bridge.loadImage({ blob, url: "https://example.com/photo.jpg" });
    bridge.createTile({
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
        url: "https://example.com/photo.jpg",
      },
      type: "load-image",
    });
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      payload: {
        imageHeight: 3000,
        imageWidth: 4000,
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
});
