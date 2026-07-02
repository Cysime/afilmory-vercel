import TextureWorkerRaw from "./texture.worker?raw";
import { SIMPLE_LOD_LEVELS, TILE_SIZE } from "./tile-cache";

/**
 * texture.worker.js is instantiated from raw text, so we prepend the shared
 * constants as a generated prelude. tile-cache.ts is the single source of
 * truth for TILE_SIZE / SIMPLE_LOD_LEVELS — no hand-kept copies in the worker.
 */
export function buildTextureWorkerSource(): string {
  const prelude = `const TILE_SIZE = ${TILE_SIZE};\nconst SIMPLE_LOD_LEVELS = ${JSON.stringify(SIMPLE_LOD_LEVELS)};\n`;
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

  loadImage(input: { url: string; blob: Blob | null }): void {
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
