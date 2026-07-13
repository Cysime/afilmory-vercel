import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTextureWorkerSource } from "./worker-bridge";

interface WorkerScope {
  onmessage: ((e: { data: unknown }) => Promise<void>) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

/**
 * Evaluate the exact source the bridge hands to `new Worker(...)`, with a
 * stubbed `self` standing in for the worker global scope.
 */
function bootWorker(): WorkerScope {
  const scope: WorkerScope = { onmessage: null, postMessage: vi.fn() };
  new Function("self", buildTextureWorkerSource())(scope);
  return scope;
}

const createTileMessage = (key: string) => ({
  data: {
    type: "create-tile",
    payload: {
      sessionId: 1,
      imageHeight: 3000,
      imageWidth: 4000,
      key,
      lodConfig: { scale: 0.5 },
      lodLevel: 2,
      x: 1,
      y: 1,
    },
  },
});

describe("texture.worker create-tile guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts tile-error when a tile is requested before any image is loaded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const worker = bootWorker();

    await worker.onmessage!(createTileMessage("2-1-1"));

    // 静默丢弃会让 key 永远留在引擎的 loadingTiles 里不再被重新请求，
    // 必须以 tile-error 回应（引擎路由 tile-error → markFailed → 重排队）。
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "tile-error",
      sessionId: 1,
      payload: { key: "2-1-1", error: "image not loaded" },
    });
  });

  it("posts tile-error for tiles interleaved with a context-restore reload", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fullBitmap = { close: vi.fn(), height: 3000, width: 4000 };
    const createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(fullBitmap)
      .mockResolvedValueOnce({ height: 1500, width: 2000 })
      // 恢复窗口内的重新解码：保持 pending，模拟大图解码尚未完成
      .mockReturnValueOnce(new Promise(() => {}));
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const worker = bootWorker();
    const loadMessage = {
      data: {
        type: "load-image",
        payload: {
          sessionId: 1,
          blob: new Blob(["x"]),
          maxTextureSize: 4096,
          maxTextureBytes: 64 * 1024 * 1024,
          url: "blob:p",
        },
      },
    };

    await worker.onmessage!(loadMessage);
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "init-done",
      sessionId: 1,
    });

    // Context restore reloads through the same live worker: the old bitmap is
    // closed up front and originalImage stays null until the decode resolves.
    void worker.onmessage!(loadMessage);
    expect(fullBitmap.close).toHaveBeenCalledTimes(1);

    worker.postMessage.mockClear();
    await worker.onmessage!(createTileMessage("2-1-1"));

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "tile-error",
      sessionId: 1,
      payload: { key: "2-1-1", error: "image not loaded" },
    });
  });

  it("drops an older decode that finishes after a newer generation", async () => {
    let resolveOld!: (bitmap: { close: ReturnType<typeof vi.fn> }) => void;
    const oldBitmapPromise = new Promise<{ close: ReturnType<typeof vi.fn> }>(
      (resolve) => {
        resolveOld = resolve;
      },
    );
    const oldBitmap = { close: vi.fn() };
    const currentBitmap = { close: vi.fn(), height: 800, width: 1200 };
    const currentBase = { close: vi.fn(), height: 400, width: 600 };
    vi.stubGlobal(
      "createImageBitmap",
      vi
        .fn()
        .mockReturnValueOnce(oldBitmapPromise)
        .mockResolvedValueOnce(currentBitmap)
        .mockResolvedValueOnce(currentBase),
    );
    const worker = bootWorker();
    const load = (sessionId: number) => ({
      data: {
        type: "load-image",
        payload: {
          sessionId,
          blob: new Blob([String(sessionId)]),
          maxTextureSize: 4096,
          maxTextureBytes: 64 * 1024 * 1024,
          url: `blob:${sessionId}`,
        },
      },
    });

    const staleLoad = worker.onmessage!(load(1));
    await worker.onmessage!(load(2));
    resolveOld(oldBitmap);
    await staleLoad;

    expect(oldBitmap.close).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image-loaded", sessionId: 2 }),
      [currentBase],
    );
    expect(worker.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 1 }),
      expect.anything(),
    );
  });

  it("decodes base and tile bitmaps with the same alpha policy", async () => {
    const decoded = { close: vi.fn(), height: 3000, width: 4000 };
    const base = { close: vi.fn(), height: 1500, width: 2000 };
    const tile = { close: vi.fn(), height: 512, width: 512 };
    const createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(decoded)
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(tile);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const worker = bootWorker();

    await worker.onmessage!({
      data: {
        type: "load-image",
        payload: {
          sessionId: 1,
          blob: new Blob(["photo"]),
          maxTextureSize: 4096,
          maxTextureBytes: 64 * 1024 * 1024,
          url: "blob:photo",
        },
      },
    });
    await worker.onmessage!(createTileMessage("1-1-2"));

    expect(createImageBitmap.mock.calls[0]?.[1]).toMatchObject({
      premultiplyAlpha: "none",
    });
    expect(createImageBitmap.mock.calls[1]?.[1]).toMatchObject({
      premultiplyAlpha: "none",
    });
    expect(createImageBitmap.mock.calls[2]?.at(-1)).toMatchObject({
      premultiplyAlpha: "none",
    });
  });
});
