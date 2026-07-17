import {
  applyLocationPrivacy,
  applyPhotoLocationPrivacy,
  locationPrivacyFingerprint,
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
    /^location-privacy:v\d+:(strip|coarse|exact)/,
  )?.[1] as LocationMode | undefined;
  const sanitized = applyPhotoLocationPrivacy(item, mode);
  item.exif = sanitized.exif;
  item.location = sanitized.location;
  const processing = sanitized.processing ?? {};
  item.processing = processing;

  // Redaction can only move data toward less precision without source bytes.
  // 发布层可以从三种前置状态推导出当前目标：strip 目标（删光总是可行）、
  // exact 来源（保留了全部源级数据）、指纹完全一致（同模式同版本同参数）。
  // 其余组合（含同为 coarse 但旧版本/旧精度——取整不可逆，无法凭发布数据
  // 提高精度）都必须保留旧指纹，让下一次健康的增量构建重走源文件提取。
  const canDeriveTarget =
    mode === "strip" ||
    previousMode === "exact" ||
    previousPrivacy === locationPrivacyFingerprint(mode);
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
