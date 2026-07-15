import type {
  AfilmoryManifest,
  CameraInfo,
  LensInfo,
  PhotoManifestItem,
} from "@afilmory/schema";
import { createEmptyManifest } from "@afilmory/schema";

import { debugLog } from "~/lib/debug-log";
import {
  appendMediaVersion,
  getVersionedOriginalUrl,
} from "~/lib/media-version-url";

import type { WebDeliveryRuntimeDescriptor } from "./delivery-manifest";
import {
  mergePhotoDetail,
  parseWebMapDetailShard,
  parseWebPhotoDetailShard,
} from "./delivery-manifest";
import {
  buildManifestRequestInit,
  MANIFEST_REQUEST_TIMEOUT_MS,
} from "./manifest-fetch-options";

export interface PhotoRepositoryOptions {
  delivery?: WebDeliveryRuntimeDescriptor;
  fetcher?: typeof fetch;
}

export class PhotoRepository {
  private photos: PhotoManifestItem[];
  private readonly photoMap: Map<string, PhotoManifestItem>;
  private readonly cameras: CameraInfo[];
  private readonly lenses: LensInfo[];
  private readonly detailShardByPhotoId = new Map<string, string>();
  private readonly photoIdsByDetailShard = new Map<string, Set<string>>();
  private readonly loadedDetailPhotoIds = new Set<string>();
  private readonly pendingShardLoads = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly activeControllers = new Set<AbortController>();
  private readonly ignoredMapPhotoIds: ReadonlySet<string>;
  private readonly fetcher: typeof fetch | null;
  private readonly mapUrl?: string;
  private mapLoaded = false;
  private version = 0;
  private disposed = false;
  private readonly generatedAt: string;

  constructor(
    manifest: AfilmoryManifest = createEmptyManifest(),
    options: PhotoRepositoryOptions = {},
  ) {
    this.generatedAt = manifest.generatedAt;
    this.fetcher =
      options.fetcher ??
      (typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null);
    this.mapUrl = options.delivery?.mapUrl;
    this.ignoredMapPhotoIds = new Set(options.delivery?.ignoredPhotoIds ?? []);
    for (const shard of options.delivery?.detailShards ?? []) {
      this.photoIdsByDetailShard.set(
        shard.url,
        new Set([...shard.photoIds, ...(shard.ignoredPhotoIds ?? [])]),
      );
      for (const photoId of shard.photoIds) {
        this.detailShardByPhotoId.set(photoId, shard.url);
      }
    }
    this.photos = manifest.photos.map((photo) => {
      const originalUrl = getVersionedOriginalUrl(photo);
      return {
        ...photo,
        originalUrl,
        ...(photo.video?.type === "live-photo"
          ? {
              video: {
                ...photo.video,
                videoUrl: appendMediaVersion(
                  photo.video.videoUrl,
                  photo.video.version ||
                    `${manifest.generatedAt}:${photo.video.s3Key}:video`,
                ),
              },
            }
          : {}),
      };
    });
    this.cameras = manifest.indexes.cameras;
    this.lenses = manifest.indexes.lenses;
    this.photoMap = new Map(
      this.photos.flatMap((photo) => (photo?.id ? [[photo.id, photo]] : [])),
    );

    debugLog(
      `[PhotoRepository] Loaded ${this.photos.length} photos from manifest`,
    );
  }

  getPhotos(): PhotoManifestItem[] {
    return this.photos;
  }

  getPhoto(id: string): PhotoManifestItem | undefined {
    return this.photoMap.get(id);
  }

  getAllTags(): string[] {
    const tagSet = new Set<string>();
    for (const photo of this.photos) {
      for (const tag of photo.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }

  getAllCameras(): CameraInfo[] {
    return this.cameras;
  }

  getAllLenses(): LensInfo[] {
    return this.lenses;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getVersion = (): number => this.version;

  hasDeferredPhotoDetails(photoId: string): boolean {
    return (
      this.detailShardByPhotoId.has(photoId) &&
      !this.loadedDetailPhotoIds.has(photoId)
    );
  }

  hasDeferredMapDetails(): boolean {
    return Boolean(this.mapUrl) && !this.mapLoaded;
  }

  async ensurePhotoDetails(photoId: string): Promise<void> {
    if (this.disposed || this.loadedDetailPhotoIds.has(photoId)) return;
    const shardUrl = this.detailShardByPhotoId.get(photoId);
    if (!shardUrl) return;

    await this.loadOnce(shardUrl, async () => {
      const input = await this.fetchJson(shardUrl);
      const details = parseWebPhotoDetailShard(input);
      const expectedPhotoIds = this.photoIdsByDetailShard.get(shardUrl);
      if (!expectedPhotoIds) {
        throw new Error(`Photo detail shard ${shardUrl} is not registered.`);
      }
      const detailPhotoIds = Object.keys(details);
      const missingPhotoId = [...expectedPhotoIds].find(
        (expectedPhotoId) => !Object.hasOwn(details, expectedPhotoId),
      );
      if (missingPhotoId) {
        throw new Error(
          `Photo detail shard ${shardUrl} is missing ${missingPhotoId}.`,
        );
      }
      const extraPhotoId = detailPhotoIds.find(
        (detailPhotoId) => !expectedPhotoIds.has(detailPhotoId),
      );
      if (extraPhotoId) {
        throw new Error(
          `Photo detail shard ${shardUrl} contains unexpected ${extraPhotoId}.`,
        );
      }
      let changed = false;
      for (const [detailPhotoId, detail] of Object.entries(details)) {
        const photo = this.photoMap.get(detailPhotoId);
        if (!photo) continue;
        mergePhotoDetail(photo, detail);
        if (photo.video?.type === "live-photo") {
          photo.video.videoUrl = appendMediaVersion(
            photo.video.videoUrl,
            photo.video.version ||
              `${this.generatedAt}:${photo.video.s3Key}:video`,
          );
        }
        this.loadedDetailPhotoIds.add(detailPhotoId);
        changed = true;
      }
      if (changed) this.notify();
    });
  }

  async prefetchPhotoDetails(photoIds: Iterable<string>): Promise<void> {
    const urls = new Map<string, string>();
    for (const photoId of photoIds) {
      const url = this.detailShardByPhotoId.get(photoId);
      if (url && !this.loadedDetailPhotoIds.has(photoId))
        urls.set(url, photoId);
    }
    await Promise.all(
      [...urls.values()].map((photoId) => this.ensurePhotoDetails(photoId)),
    );
  }

  async ensureMapDetails(): Promise<void> {
    if (this.disposed || this.mapLoaded || !this.mapUrl) return;
    await this.loadOnce(this.mapUrl, async () => {
      const input = await this.fetchJson(this.mapUrl!);
      const details = parseWebMapDetailShard(input);
      const unknownPhotoId = Object.keys(details).find(
        (photoId) =>
          !this.photoMap.has(photoId) && !this.ignoredMapPhotoIds.has(photoId),
      );
      if (unknownPhotoId) {
        throw new Error(
          `Map detail shard ${this.mapUrl} references unknown photo ${unknownPhotoId}.`,
        );
      }
      let changed = false;
      for (const [photoId, detail] of Object.entries(details)) {
        const photo = this.photoMap.get(photoId);
        if (!photo) continue;
        photo.location = detail.location;
        if (detail.exif) {
          photo.exif = { ...photo.exif, ...detail.exif };
        }
        changed = true;
      }
      this.mapLoaded = true;
      if (changed) this.notify();
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
    this.pendingShardLoads.clear();
    this.listeners.clear();
  }

  private notify(): void {
    // Publish a fresh collection identity after in-place detail hydration so
    // memoized gallery/map selectors cannot retain results derived from the
    // lightweight startup records.
    this.photos = [...this.photos];
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private async loadOnce(
    url: string,
    load: () => Promise<void>,
  ): Promise<void> {
    const pending = this.pendingShardLoads.get(url);
    if (pending) return await pending;

    const promise = load().finally(() => {
      if (this.pendingShardLoads.get(url) === promise) {
        this.pendingShardLoads.delete(url);
      }
    });
    this.pendingShardLoads.set(url, promise);
    await promise;
  }

  private async fetchJson(url: string): Promise<unknown> {
    if (!this.fetcher) {
      throw new Error(
        "No fetch implementation is available for manifest shards.",
      );
    }
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      MANIFEST_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await this.fetcher(
        url,
        buildManifestRequestInit(controller.signal),
      );
      if (!response.ok) {
        throw new Error(
          `Manifest shard request failed: ${response.status} ${response.statusText}`.trim(),
        );
      }
      return await response.json();
    } finally {
      globalThis.clearTimeout(timeoutId);
      this.activeControllers.delete(controller);
    }
  }
}
