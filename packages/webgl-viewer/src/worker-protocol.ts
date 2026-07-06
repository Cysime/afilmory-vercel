import type { TileKey } from "./tile-cache";

/**
 * Messages posted by texture.worker.js back to the main thread.
 *
 * texture.worker.js is plain JS, so this discriminated union is the single
 * typed description of the protocol — keep it in sync with the worker's
 * `self.postMessage` calls.
 */
export type TextureWorkerMessage =
  | { type: "init-done" }
  | {
      type: "image-loaded";
      payload: {
        imageBitmap: ImageBitmap;
        imageWidth: number;
        imageHeight: number;
        lodLevel: number;
      };
    }
  | { type: "load-error"; payload: { error: unknown } }
  | {
      type: "tile-created";
      payload: { key: TileKey; imageBitmap: ImageBitmap; lodLevel: number };
    }
  | { type: "tile-error"; payload: { key: TileKey; error: unknown } };
