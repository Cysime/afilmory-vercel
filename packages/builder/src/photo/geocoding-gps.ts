import { parseExifCoordinates } from "@afilmory/schema";

import type { LocationInfo, PickedExif } from "../types/photo.js";
import type { GeocodingProvider } from "./geocoding-providers.js";
import { getPhotoProcessingLoggers } from "./logger-adapter.js";

interface GPSLogger {
  error?: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  success?: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export function parseGPSCoordinates(exif: PickedExif): {
  latitude?: number;
  longitude?: number;
} {
  return parseExifCoordinates(exif) ?? {};
}

export type GeocodingLookupResult =
  | { status: "found"; location: LocationInfo }
  | { status: "not-found" }
  | { status: "invalid" }
  | { status: "error"; error: unknown };

export async function lookupLocationFromGPS(
  latitude: number,
  longitude: number,
  provider: GeocodingProvider,
  logger?: GPSLogger,
): Promise<GeocodingLookupResult> {
  const log = logger ?? getPhotoProcessingLoggers().location;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    log.warn("Invalid GPS coordinates");
    return { status: "invalid" };
  }

  log.info("Reverse geocoding privacy-filtered coordinates");

  try {
    const location = await provider.reverseGeocode(latitude, longitude);
    if (!location) {
      log.warn("No location info found");
      return { status: "not-found" };
    }
    log.success?.(`Location found: ${location.city}, ${location.country}`);
    return { status: "found", location };
  } catch (error) {
    log.error?.("Location extraction failed:", error);
    return { status: "error", error };
  }
}
