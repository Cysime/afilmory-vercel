import TextureWorkerRaw from "./texture.worker?raw";
import { SIMPLE_LOD_LEVELS, TILE_SIZE } from "./tile-cache";

/**
 * 等比缩小到给定上限内的最大尺寸；maxSize 不合法（0/负数）时原样返回。
 *
 * 注意：函数体必须自包含（只引用参数与 Math）——它会通过 `toString()` 注入
 * worker 预置代码，压缩改名不影响注入后的绑定名。
 */
export function clampDimensionsToFit(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (!maxSize || maxSize <= 0 || (width <= maxSize && height <= maxSize)) {
    return { width, height };
  }
  const ratio = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}

/**
 * texture.worker.js is instantiated from raw text, so we prepend the shared
 * constants as a generated prelude. tile-cache.ts is the single source of
 * truth for TILE_SIZE / SIMPLE_LOD_LEVELS — no hand-kept copies in the worker.
 * clampDimensionsToFit is injected the same way (single implementation, unit
 * tested here); the per-context MAX_TEXTURE_SIZE cap itself travels in the
 * load-image message, not the prelude.
 */
export function buildTextureWorkerSource(): string {
  const prelude =
    `const TILE_SIZE = ${TILE_SIZE};\n` +
    `const SIMPLE_LOD_LEVELS = ${JSON.stringify(SIMPLE_LOD_LEVELS)};\n` +
    `const clampDimensionsToFit = ${clampDimensionsToFit.toString()};\n`;
  return prelude + TextureWorkerRaw;
}

export class TextureWorkerBridge {
  private readonly workerUrl: string;
  private readonly worker: Worker;

  constructor(input: {
    onMessage: (event: MessageEvent) => void;
    onError?: (event: ErrorEvent) => void;
  }) {
    this.workerUrl = URL.createObjectURL(
      new Blob([buildTextureWorkerSource()]),
    );
    this.worker = new Worker(this.workerUrl, {
      name: "texture-worker",
    });
    this.worker.onmessage = input.onMessage;
    this.worker.onerror =
      input.onError ??
      ((event) => {
        console.error("[Worker] Error:", event.message, event.error);
      });
  }

  loadImage(input: {
    url: string;
    blob: Blob | null;
    /** gl.MAX_TEXTURE_SIZE of the target context; 0 = unknown (no clamp). */
    maxTextureSize: number;
  }): void {
    this.worker.postMessage({
      type: "load-image",
      payload: input,
    });
  }

  createTile(input: {
    x: number;
    y: number;
    lodLevel: number;
    lodConfig: { scale: number };
    imageWidth: number;
    imageHeight: number;
    key: string;
  }): void {
    this.worker.postMessage({
      type: "create-tile",
      payload: input,
    });
  }

  dispose(): void {
    this.worker.terminate();
    URL.revokeObjectURL(this.workerUrl);
  }
}
