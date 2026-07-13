import { normalizeLocationInfoAdminAliases } from "@afilmory/schema/geo";

import type { GeocodingProvider } from "../photo/geocoding.js";
import {
  lookupLocationFromGPS,
  parseGPSCoordinates,
} from "../photo/geocoding.js";
import type { PhotoManifestItem, PickedExif } from "../types/photo.js";
import type {
  GeocodingCacheDelta,
  GeocodingCacheLogger,
  GeocodingCacheState,
} from "./geocoding-cache.js";
import {
  buildCacheKey,
  composeLocalizedLocation,
  ensurePersistentCacheLoaded,
  hasRequiredLocalizedLocation,
  isFreshNegativeCacheEntry,
  normalizeCachePath,
  seedCacheEntryFromExistingLocation,
} from "./geocoding-cache.js";
import type { ResolvedGeocodingSettings } from "./geocoding-options.js";

export interface LocationResolutionResult {
  attempted: boolean;
  updated: boolean;
  cacheDelta?: GeocodingCacheDelta;
}

export type GeocodingProviderResolver = (
  locale: string,
) => GeocodingProvider | null;

export async function resolveLocationForItem({
  item,
  exif,
  state,
  settings,
  shouldOverwriteExisting,
  logger,
  getProvider,
}: {
  item: PhotoManifestItem;
  exif: PickedExif | null | undefined;
  state: GeocodingCacheState;
  settings: ResolvedGeocodingSettings;
  shouldOverwriteExisting: boolean;
  logger: GeocodingCacheLogger;
  getProvider: GeocodingProviderResolver;
}): Promise<LocationResolutionResult> {
  const cachePath = normalizeCachePath(settings.cachePath);
  await ensurePersistentCacheLoaded(state, cachePath, logger);
  const wasComplete = hasRequiredLocalizedLocation(
    item.location,
    settings.locales,
  );

  if (wasComplete && !shouldOverwriteExisting) {
    return { attempted: false, updated: false };
  }

  if (!exif) {
    if (shouldOverwriteExisting) {
      item.location = null;
    }
    return { attempted: false, updated: false };
  }

  const { latitude, longitude } = parseGPSCoordinates(exif);
  if (latitude === undefined || longitude === undefined) {
    if (shouldOverwriteExisting) {
      item.location = null;
    }
    return { attempted: false, updated: false };
  }

  const cacheKey = buildCacheKey(latitude, longitude, settings);
  const cacheEntry = state.cache.get(cacheKey) ?? { locales: {} };
  const seededFromExisting = seedCacheEntryFromExistingLocation(
    cacheEntry,
    item.location,
    latitude,
    longitude,
  );
  let cacheChanged = seededFromExisting;
  const deletedLocales: string[] = [];
  if (seededFromExisting) {
    cacheEntry.updatedAt ??= new Date().toISOString();
    state.cacheDirty = true;
  }

  let attempted = false;
  for (const locale of settings.locales) {
    if (locale in cacheEntry.locales) {
      if (
        cacheEntry.locales[locale] !== null ||
        isFreshNegativeCacheEntry(cacheEntry, locale)
      ) {
        continue;
      }
      // Legacy null entries had no TTL and stale negative entries must be
      // retried. Never let a temporary outage become a permanent no-result.
      delete cacheEntry.locales[locale];
      deletedLocales.push(locale);
      if (cacheEntry.notFoundExpiresAt) {
        delete cacheEntry.notFoundExpiresAt[locale];
      }
      cacheChanged = true;
      state.cacheDirty = true;
    }

    const provider = getProvider(locale);
    if (!provider) {
      continue;
    }

    attempted = true;
    const lookup = await lookupLocationFromGPS(
      latitude,
      longitude,
      provider,
      logger,
    );
    if (lookup.status === "error" || lookup.status === "invalid") {
      continue;
    }
    if (lookup.status === "found") {
      cacheEntry.locales[locale] = normalizeLocationInfoAdminAliases(
        lookup.location,
        locale,
      );
      if (cacheEntry.notFoundExpiresAt) {
        delete cacheEntry.notFoundExpiresAt[locale];
      }
    } else {
      cacheEntry.locales[locale] = null;
      cacheEntry.notFoundExpiresAt ??= {};
      cacheEntry.notFoundExpiresAt[locale] = new Date(
        Date.now() + settings.negativeCacheTtlMs,
      ).toISOString();
    }
    cacheEntry.updatedAt = new Date().toISOString();
    state.cacheDirty = true;
    cacheChanged = true;
  }

  state.cache.set(cacheKey, cacheEntry);
  const localizedLocation = composeLocalizedLocation(
    latitude,
    longitude,
    cacheEntry,
  );

  if (localizedLocation) {
    item.location = localizedLocation;
    return {
      attempted: attempted || !wasComplete,
      updated: true,
      ...(cacheChanged
        ? {
            cacheDelta: {
              key: cacheKey,
              entry: cacheEntry,
              ...(deletedLocales.length > 0 ? { deletedLocales } : {}),
            },
          }
        : {}),
    };
  }

  if (shouldOverwriteExisting) {
    item.location = null;
  }

  return {
    attempted,
    updated: false,
    ...(cacheChanged
      ? {
          cacheDelta: {
            key: cacheKey,
            entry: cacheEntry,
            ...(deletedLocales.length > 0 ? { deletedLocales } : {}),
          },
        }
      : {}),
  };
}
