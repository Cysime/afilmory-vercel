import {
  applyLocationPrivacy,
  applyPhotoLocationPrivacy,
} from "@afilmory/schema";

import type {
  LocationInfo,
  PhotoManifestItem,
  PickedExif,
} from "../types/photo.js";
import { parseGPSCoordinates } from "./geocoding-gps.js";
import type { LocationMode } from "./processing-fingerprints.js";

export {
  applyExifLocationPrivacy,
  applyLocationPrivacy as applyManifestLocationPrivacy,
  COARSE_LOCATION_DECIMAL_PLACES,
} from "@afilmory/schema";

/**
 * A privacy transition must not carry coordinates produced under the previous
 * policy. The caller supplies EXIF freshly extracted from source bytes; use it
 * to rebuild coordinates while retaining reusable administrative labels.
 * Missing coordinates become null instead of silently publishing stale
 * precision.
 */
export function rebuildLocationForPrivacyTransition(
  existingLocation: LocationInfo | null,
  exif: PickedExif | null,
  mode: LocationMode,
  privacyModeChanged: boolean,
): LocationInfo | null {
  if (!privacyModeChanged) {
    return applyLocationPrivacy(existingLocation, mode);
  }
  if (mode === "strip" || !exif) return null;

  const { latitude, longitude } = parseGPSCoordinates(exif);
  if (latitude === undefined || longitude === undefined) return null;
  const reusableLocation = applyLocationPrivacy(existingLocation, mode);
  return {
    ...reusableLocation,
    latitude,
    longitude,
  };
}

/** Apply the policy at the publication boundary, including fallback items. */
export function enforcePhotoLocationPrivacy(
  item: PhotoManifestItem,
  mode: LocationMode,
): void {
  const hadProcessingMetadata = item.processing !== undefined;
  const previousPrivacy = item.processing?.privacy;
  const previousMode = previousPrivacy?.match(
    /^location-privacy:v\d+:(strip|coarse|exact)$/,
  )?.[1] as LocationMode | undefined;
  const sanitized = applyPhotoLocationPrivacy(item, mode);
  item.exif = sanitized.exif;
  item.location = sanitized.location;
  const processing = sanitized.processing ?? {};
  item.processing = processing;

  // Redaction can safely move data toward a stricter policy without source
  // bytes. The reverse direction cannot reconstruct coordinates that were
  // previously removed or rounded. Preserve the old fingerprint on fallback
  // items so the next healthy incremental build retries source extraction.
  const privacyRank: Record<LocationMode, number> = {
    exact: 0,
    coarse: 1,
    strip: 2,
  };
  const canDeriveTarget =
    previousMode === mode ||
    (previousMode !== undefined &&
      privacyRank[mode] >= privacyRank[previousMode]) ||
    mode === "strip";
  if (!canDeriveTarget) {
    if (previousPrivacy) {
      processing.privacy = previousPrivacy;
    } else {
      delete processing.privacy;
    }
    if (!hadProcessingMetadata && Object.keys(processing).length === 0) {
      delete item.processing;
    }
  }
}
