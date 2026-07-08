import type { Buffer } from "node:buffer";

/**
 * Key under which the photo pipeline publishes thumbnail data in
 * `context.pluginData`.
 *
 * Lifetime contract: `buffer` is only guaranteed to be non-null while the
 * `afterPhotoProcess` hook runs (this plugin uploads it there). As soon as
 * that hook completes, `processPhotoWithPipeline` nulls `buffer` in place so
 * the JPEG becomes collectable immediately and never rides cluster IPC —
 * later consumers (e.g. `beforeAddManifestItem`) only ever see the
 * buffer-less projection.
 */
export const THUMBNAIL_PLUGIN_DATA_KEY = "afilmory:thumbnail-storage:data";

/**
 * Unique symbol identifier for the thumbnail storage plugin.
 * Used for reliable plugin detection without fragile string matching.
 */
export const THUMBNAIL_PLUGIN_SYMBOL = Symbol.for("afilmory:thumbnail-storage");

export interface ThumbnailPluginData {
  photoId: string;
  fileName: string;
  /** Non-null only until afterPhotoProcess completes; see THUMBNAIL_PLUGIN_DATA_KEY. */
  buffer: Buffer | null;
  localUrl: string | null;
}
export const DEFAULT_DIRECTORY = ".afilmory/thumbnails";
export const DEFAULT_CONTENT_TYPE = "image/jpeg";
