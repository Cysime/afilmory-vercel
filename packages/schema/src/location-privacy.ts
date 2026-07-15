import type {
  AfilmoryManifest,
  LocationInfo,
  PhotoManifestItem,
  PickedExif,
} from "./types.ts";

export type LocationPrivacyMode = "strip" | "coarse" | "exact";

export const COARSE_LOCATION_DECIMAL_PLACES = 2;

const GPS_KEYS = [
  "GPSAltitude",
  "GPSCoordinates",
  "GPSAltitudeRef",
  "GPSLatitude",
  "GPSLatitudeRef",
  "GPSLongitude",
  "GPSLongitudeRef",
] as const satisfies ReadonlyArray<keyof PickedExif>;

const roundCoordinate = (value: number): number => {
  const factor = 10 ** COARSE_LOCATION_DECIMAL_PLACES;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Signed decimal GPS coordinates from EXIF, or null when absent/non-finite. */
export const parseExifCoordinates = (
  exif: PickedExif,
): { latitude: number; longitude: number } | null => {
  if (exif.GPSLatitude === undefined || exif.GPSLongitude === undefined) {
    return null;
  }

  let latitude = Number(exif.GPSLatitude);
  let longitude = Number(exif.GPSLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  if (exif.GPSLatitudeRef === "S" || exif.GPSLatitudeRef === "South") {
    latitude = -Math.abs(latitude);
  }
  if (exif.GPSLongitudeRef === "W" || exif.GPSLongitudeRef === "West") {
    longitude = -Math.abs(longitude);
  }

  return { latitude, longitude };
};

export function applyExifLocationPrivacy(
  exif: PickedExif | null,
  mode: LocationPrivacyMode,
): PickedExif | null {
  if (!exif || mode === "exact") return exif;

  const result: PickedExif = { ...exif };
  const coordinates = parseExifCoordinates(exif);
  for (const key of GPS_KEYS) delete result[key];

  if (mode === "coarse" && coordinates) {
    const latitude = roundCoordinate(coordinates.latitude);
    const longitude = roundCoordinate(coordinates.longitude);
    result.GPSLatitude = Math.abs(latitude);
    result.GPSLatitudeRef = latitude < 0 ? "S" : "N";
    result.GPSLongitude = Math.abs(longitude);
    result.GPSLongitudeRef = longitude < 0 ? "W" : "E";
  }

  return result;
}

export function applyLocationPrivacy(
  location: LocationInfo | null,
  mode: LocationPrivacyMode,
): LocationInfo | null {
  if (!location || mode === "exact") return location;
  if (mode === "strip") return null;
  return {
    ...location,
    latitude: roundCoordinate(location.latitude),
    longitude: roundCoordinate(location.longitude),
  };
}

export function applyPhotoLocationPrivacy(
  photo: PhotoManifestItem,
  mode: LocationPrivacyMode,
): PhotoManifestItem {
  return {
    ...photo,
    exif: applyExifLocationPrivacy(photo.exif, mode),
    location: applyLocationPrivacy(photo.location, mode),
    processing: {
      ...photo.processing,
      privacy: `location-privacy:v1:${mode}`,
    },
  };
}

/**
 * Enforce the selected policy on every publication path, including legacy
 * manifests that predate processing fingerprints.
 */
export function applyManifestLocationPrivacy(
  manifest: AfilmoryManifest,
  mode: LocationPrivacyMode,
): AfilmoryManifest {
  return {
    ...manifest,
    photos: manifest.photos.map((photo) =>
      applyPhotoLocationPrivacy(photo, mode),
    ),
  };
}
