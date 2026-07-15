import { createHash } from "node:crypto";

import type {
  AfilmoryManifest,
  LocationInfo,
  LocationPrivacyMode,
  PhotoManifestItem,
  PickedExif,
} from "@afilmory/schema";
import { applyManifestLocationPrivacy } from "@afilmory/schema";

import type {
  WebDeliveryManifest,
  WebMapDetailShard,
  WebPhotoDetail,
  WebPhotoDetailShard,
} from "../../../src/data-runtime/delivery-manifest";
import {
  WEB_DELIVERY_MANIFEST_SCHEMA,
  WEB_DELIVERY_MANIFEST_VERSION,
} from "../../../src/data-runtime/delivery-manifest";

const DEFAULT_DETAIL_SHARD_SIZE = 32;
const ESSENTIAL_EXIF_KEYS = [
  "Make",
  "Model",
  "LensMake",
  "LensModel",
  "DateTimeOriginal",
  "FocalLength",
  "FocalLengthIn35mmFormat",
  "ISO",
  "ExposureTime",
  "ShutterSpeedValue",
  "FNumber",
] as const satisfies ReadonlyArray<keyof PickedExif>;

const MAP_EXIF_KEYS = [
  "GPSAltitude",
  "GPSAltitudeRef",
  "GPSLatitude",
  "GPSLatitudeRef",
  "GPSLongitude",
  "GPSLongitudeRef",
] as const satisfies ReadonlyArray<keyof PickedExif>;

const hashJson = (json: string): string =>
  createHash("sha256").update(json).digest("hex").slice(0, 10);

const hashPhotoId = (id: string): Buffer =>
  createHash("sha256").update(id).digest();

interface StablePhotoBucket {
  key: string;
  photos: PhotoManifestItem[];
}

/**
 * Partition details by stable ID-hash prefixes instead of manifest offsets.
 * New photos then invalidate only their own bucket. Oversized buckets split
 * recursively, preserving the hard shard-size bound without moving unrelated
 * buckets when a new item is inserted at the start of the date-sorted gallery.
 */
function createStablePhotoBuckets(
  photos: readonly PhotoManifestItem[],
  maxSize: number,
): StablePhotoBucket[] {
  if (photos.length === 0) return [];

  const hashedPhotos = photos.map((photo) => ({
    hash: hashPhotoId(photo.id),
    photo,
  }));

  const partition = (
    entries: typeof hashedPhotos,
    prefix: string,
  ): StablePhotoBucket[] => {
    if (entries.length <= maxSize) {
      return [
        {
          key: prefix || "root",
          photos: entries
            .map(({ photo }) => photo)
            .toSorted((left, right) => left.id.localeCompare(right.id)),
        },
      ];
    }

    const prefixLength = prefix.length;
    if (prefixLength >= 256) {
      // Cryptographic hash collisions are not a realistic input, but keep the
      // size invariant total even under a deliberately adversarial test case.
      return Array.from(
        { length: Math.ceil(entries.length / maxSize) },
        (_, index) => ({
          key: `${prefix}-${index}`,
          photos: entries
            .map(({ photo }) => photo)
            .toSorted((left, right) => left.id.localeCompare(right.id))
            .slice(index * maxSize, (index + 1) * maxSize),
        }),
      );
    }

    // Split by one hash bit at a time. A hexadecimal (16-way) fan-out leaves
    // most shards almost empty and makes the runtime shard cache churn on
    // larger galleries; binary splitting keeps leaf occupancy near maxSize/2
    // to maxSize while retaining the same stable-prefix property.
    const children = new Map<string, typeof hashedPhotos>();
    for (const entry of entries) {
      const byte = entry.hash[Math.floor(prefixLength / 8)] ?? 0;
      const bit = (byte >> (7 - (prefixLength % 8))) & 1;
      const childPrefix = `${prefix}${bit}`;
      const child = children.get(childPrefix) ?? [];
      child.push(entry);
      children.set(childPrefix, child);
    }

    return [...children.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .flatMap(([childPrefix, childEntries]) =>
        partition(childEntries, childPrefix),
      );
  };

  return partition(hashedPhotos, "");
}

const pickExif = <Key extends keyof PickedExif>(
  exif: PickedExif | null,
  keys: readonly Key[],
): Pick<PickedExif, Key> | null => {
  if (!exif) return null;
  const entries = keys.flatMap((key) =>
    exif[key] === undefined ? [] : [[key, exif[key]] as const],
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as Pick<PickedExif, Key>)
    : null;
};

const summarizeLocation = (
  location: LocationInfo | null,
): LocationInfo | null => {
  if (!location) return null;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    ...(location.admin ? { admin: location.admin } : {}),
    ...(location.adminI18n ? { adminI18n: location.adminI18n } : {}),
    ...(location.adminKey ? { adminKey: location.adminKey } : {}),
    ...(location.country ? { country: location.country } : {}),
    ...(location.city ? { city: location.city } : {}),
    ...(location.locationName ? { locationName: location.locationName } : {}),
    ...(location.locationNameI18n
      ? { locationNameI18n: location.locationNameI18n }
      : {}),
  };
};

const createGalleryPhoto = (photo: PhotoManifestItem): PhotoManifestItem => ({
  ...photo,
  exif: pickExif(photo.exif, ESSENTIAL_EXIF_KEYS),
  toneAnalysis: null,
  location: summarizeLocation(photo.location),
});

const createPhotoDetail = (photo: PhotoManifestItem): WebPhotoDetail => ({
  exif: photo.exif,
  toneAnalysis: photo.toneAnalysis,
  location: photo.location,
  ...(photo.video ? { video: photo.video } : {}),
  ...(typeof photo.isHDR === "boolean" ? { isHDR: photo.isHDR } : {}),
});

export interface WebDeliveryAsset {
  fileName: string;
  source: string;
}

export interface WebDeliveryArtifacts {
  indexFileName: string;
  assets: WebDeliveryAsset[];
  fullManifestBytes: number;
  indexBytes: number;
}

export function createWebDeliveryArtifacts(
  manifest: AfilmoryManifest,
  detailShardSize = DEFAULT_DETAIL_SHARD_SIZE,
  locationMode: LocationPrivacyMode = "coarse",
): WebDeliveryArtifacts {
  const publicationManifest = applyManifestLocationPrivacy(
    manifest,
    locationMode,
  );
  const normalizedShardSize = Math.max(1, Math.floor(detailShardSize));
  const assets: WebDeliveryAsset[] = [];
  const detailShards: WebDeliveryManifest["delivery"]["detailShards"] = [];

  for (const { key, photos } of createStablePhotoBuckets(
    publicationManifest.photos,
    normalizedShardSize,
  )) {
    const shard: WebPhotoDetailShard = {
      schema: WEB_DELIVERY_MANIFEST_SCHEMA,
      version: WEB_DELIVERY_MANIFEST_VERSION,
      kind: "photo-details",
      photos: Object.fromEntries(
        photos.map((photo) => [photo.id, createPhotoDetail(photo)]),
      ),
    };
    const source = JSON.stringify(shard);
    const fileName = `assets/photo-details.${key}.${hashJson(source)}.json`;
    assets.push({ fileName, source });
    detailShards.push({
      url: `/${fileName}`,
      photoIds: photos.map((photo) => photo.id),
    });
  }

  const mapShard: WebMapDetailShard = {
    schema: WEB_DELIVERY_MANIFEST_SCHEMA,
    version: WEB_DELIVERY_MANIFEST_VERSION,
    kind: "map-details",
    photos: Object.fromEntries(
      publicationManifest.photos
        .filter((photo) => photo.location || photo.exif?.GPSLatitude)
        .map((photo) => [
          photo.id,
          {
            location: photo.location,
            exif: pickExif(photo.exif, MAP_EXIF_KEYS),
          },
        ]),
    ),
  };
  const mapSource = JSON.stringify(mapShard);
  const mapFileName = `assets/map-details.${hashJson(mapSource)}.json`;
  assets.push({ fileName: mapFileName, source: mapSource });

  const galleryManifest: AfilmoryManifest = {
    ...publicationManifest,
    photos: publicationManifest.photos.map(createGalleryPhoto),
  };
  const index: WebDeliveryManifest = {
    schema: WEB_DELIVERY_MANIFEST_SCHEMA,
    version: WEB_DELIVERY_MANIFEST_VERSION,
    kind: "gallery-index",
    manifest: galleryManifest,
    delivery: {
      detailShards,
      mapUrl: `/${mapFileName}`,
    },
  };
  const indexSource = JSON.stringify(index);
  const indexFileName = `assets/gallery-index.${hashJson(indexSource)}.json`;
  assets.push({ fileName: indexFileName, source: indexSource });

  return {
    indexFileName,
    assets,
    fullManifestBytes: Buffer.byteLength(JSON.stringify(publicationManifest)),
    indexBytes: Buffer.byteLength(indexSource),
  };
}
