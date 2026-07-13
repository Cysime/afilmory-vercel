/* eslint-disable no-console */

import { readFileSync } from "node:fs";

import type { PhotoManifestItem } from "@afilmory/schema";
import { assertManifest } from "@afilmory/schema";

import { resolveBuildManifestPath } from "./manifest-path.ts";

const manifestPath = resolveBuildManifestPath();

class BuildTimePhotoLoader {
  private photoMap: Map<string, PhotoManifestItem> | null = null;
  private photos: PhotoManifestItem[] | null = null;

  private loadPhotos(): PhotoManifestItem[] {
    if (this.photos) return this.photos;

    const manifestContent = readFileSync(manifestPath, "utf-8");
    const manifest = assertManifest(JSON.parse(manifestContent));
    this.photos = manifest.photos;
    this.photoMap = new Map(this.photos.map((photo) => [photo.id, photo]));

    console.info(`📚 Loaded ${this.photos.length} photos from manifest`);
    return this.photos;
  }

  getPhotos() {
    return this.loadPhotos();
  }

  getPhoto(id: string) {
    this.loadPhotos();
    return this.photoMap?.get(id);
  }
}

export const buildTimePhotoLoader = new BuildTimePhotoLoader();
