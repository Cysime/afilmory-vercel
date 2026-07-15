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
  const lastKnownEntry = { locales: {} };
  if (shouldOverwriteExisting) {
    // Keep a composition-only fallback for locales whose forced refresh is
    // inconclusive. It must not be inserted into the working cache (which
    // would suppress the provider lookup), nor persisted (which would turn a
    // transient failure into a cache hit on the next build).
    seedCacheEntryFromExistingLocation(
      lastKnownEntry,
      item.location,
      latitude,
      longitude,
    );
  }
  // In overwrite mode the existing item is precisely the value being
  // refreshed. Seeding it into an empty cache would make every requested
  // locale look resolved and silently turn --force-manifest into a no-op.
  const seededFromExisting =
    !shouldOverwriteExisting &&
    seedCacheEntryFromExistingLocation(
      cacheEntry,
      item.location,
      latitude,
      longitude,
    );
  let cacheChanged = seededFromExisting;
  const deletedLocales: string[] = [];
  const confirmedNotFoundThisRun = new Set<string>();
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
      confirmedNotFoundThisRun.add(locale);
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
    shouldOverwriteExisting
      ? {
          ...cacheEntry,
          locales: {
            ...lastKnownEntry.locales,
            ...cacheEntry.locales,
          },
        }
      : cacheEntry,
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

  const everyLocaleConfirmedNotFound =
    settings.locales.length > 0 &&
    settings.locales.every(
      (locale) =>
        cacheEntry.locales[locale] === null &&
        (confirmedNotFoundThisRun.has(locale) ||
          isFreshNegativeCacheEntry(cacheEntry, locale)),
    );
  // A forced refresh may clear a stale location only when providers (or a
  // still-fresh negative cache entry) confirmed that every requested locale
  // has no result. Authentication/network/timeouts and missing providers are
  // inconclusive and must preserve the last known-good manifest value.
  if (shouldOverwriteExisting && everyLocaleConfirmedNotFound) {
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
