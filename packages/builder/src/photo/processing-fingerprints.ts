import type {
  PhotoManifestItem,
  PhotoProcessingFingerprints,
} from "../types/photo.js";

/**
 * Bump only the stage whose output contract or algorithm changed. This keeps
 * incremental rebuilds precise instead of turning every builder upgrade into
 * an unconditional full rebuild.
 */
export interface CoreProcessingFingerprints {
  thumbnail: string;
  exif: string;
  tone: string;
  media: string;
  privacy: string;
}

export const CURRENT_CORE_PROCESSING_FINGERPRINTS: Readonly<CoreProcessingFingerprints> =
  Object.freeze({
    // Encoding parameters also have a global on-disk marker; this stage version
    // covers changes to the per-photo thumbnail/thumbhash contract itself.
    thumbnail: "thumbnail:v2",
    exif: "exif:v2",
    tone: "tone:v2",
    media: "media-detection:v2",
    privacy: "location-privacy:v1:coarse",
  }) satisfies Readonly<PhotoProcessingFingerprints>;

export type CoreProcessingStage = keyof CoreProcessingFingerprints;

export type LocationMode = "strip" | "coarse" | "exact";

export function getCurrentCoreProcessingFingerprints(
  locationMode: LocationMode = "coarse",
): CoreProcessingFingerprints {
  return {
    ...CURRENT_CORE_PROCESSING_FINGERPRINTS,
    privacy: `location-privacy:v1:${locationMode}`,
  };
}

export function getStaleCoreProcessingStages(
  item: PhotoManifestItem | undefined,
  locationMode: LocationMode = "coarse",
): ReadonlySet<CoreProcessingStage> {
  const current = getCurrentCoreProcessingFingerprints(locationMode);
  if (!item) {
    return new Set(Object.keys(current) as CoreProcessingStage[]);
  }

  const stale = new Set<CoreProcessingStage>();
  for (const [stage, fingerprint] of Object.entries(current) as Array<
    [CoreProcessingStage, string]
  >) {
    if (item.processing?.[stage] !== fingerprint) stale.add(stage);
  }
  return stale;
}

export function hasStaleCoreProcessingStages(
  item: PhotoManifestItem | undefined,
  locationMode: LocationMode = "coarse",
): boolean {
  return getStaleCoreProcessingStages(item, locationMode).size > 0;
}
