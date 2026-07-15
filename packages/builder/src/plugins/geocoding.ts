import type { EmitPluginEventFn } from "../core/contracts/execution-context.js";
import type { BuilderServices } from "../core/contracts/services.js";
import type { Logger } from "../logger/index.js";
import {
  createPhotoExecutionContext,
  getPhotoExecutionContext,
  runWithPhotoExecutionContext,
} from "../photo/execution-context.js";
import type { GeocodingProvider } from "../photo/geocoding.js";
import { createGeocodingProvider } from "../photo/geocoding.js";
import type { GeocodingCacheState } from "./geocoding-cache.js";
import {
  createGeocodingCacheState,
  ensurePersistentCacheLoaded,
  hasRequiredLocalizedLocation,
  mergeGeocodingCacheDelta,
  normalizeCachePath,
  savePersistentCacheIfNeeded,
} from "./geocoding-cache.js";
import { resolveLocationForItem } from "./geocoding-location-resolver.js";
import type {
  GeocodingPluginOptions,
  ResolvedGeocodingSettings,
} from "./geocoding-options.js";
import {
  createResolvedGeocodingSettings,
  resolveGeocodingOptions,
} from "./geocoding-options.js";
import type { BuilderPlugin } from "./types.js";

const PLUGIN_NAME = "afilmory:geocoding";
const RUN_STATE_KEY = "geocodingState";
const CACHE_DELTA_PLUGIN_DATA_KEY = "afilmory:geocoding:cache-delta";
const GEOCODING_PROCESSING_VERSION = "geocoding:v2";

type LocationLogger = Logger["main"];

interface GeocodingState {
  providers: Map<string, GeocodingProvider>;
  cache: GeocodingCacheState;
}

function getOrCreateState(runShared: Map<string, unknown>): GeocodingState {
  const existing = runShared.get(RUN_STATE_KEY) as GeocodingState | undefined;
  if (existing) {
    return existing;
  }

  const next: GeocodingState = {
    providers: new Map(),
    cache: createGeocodingCacheState(),
  };
  runShared.set(RUN_STATE_KEY, next);
  return next;
}

function buildProviderKey(
  settings: ResolvedGeocodingSettings,
  locale: string,
): string {
  return `${settings.provider}:${settings.mapboxToken ?? ""}:${settings.nominatimBaseUrl ?? ""}:${settings.nominatimUserAgent ?? ""}:${settings.requestTimeoutMs}:${locale}`;
}

function getLocationFingerprint(settings: ResolvedGeocodingSettings): string {
  // Credentials, cache paths and timeout policy do not affect the derived
  // location data contract and therefore are deliberately excluded.
  return [
    GEOCODING_PROCESSING_VERSION,
    settings.provider,
    settings.cachePrecision,
    settings.locales.join(","),
    settings.nominatimBaseUrl ?? "",
  ].join(":");
}

function ensureProvider(
  state: GeocodingState,
  settings: ResolvedGeocodingSettings,
  locale: string,
  logger: LocationLogger,
): GeocodingProvider | null {
  const providerKey = buildProviderKey(settings, locale);
  const existing = state.providers.get(providerKey);
  if (existing) {
    return existing;
  }

  const provider = createGeocodingProvider(
    settings.provider,
    settings.mapboxToken,
    settings.nominatimBaseUrl,
    locale,
    settings.nominatimUserAgent,
    settings.requestTimeoutMs,
  );

  if (!provider) {
    logger.warn(
      "Failed to create geocoding provider; check your geocoding config and token",
    );
    return null;
  }

  state.providers.set(providerKey, provider);
  return provider;
}

async function ensurePhotoContext<T>(
  services: BuilderServices,
  emitPluginEvent: EmitPluginEventFn,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    getPhotoExecutionContext();
  } catch {
    return await runWithPhotoExecutionContext(
      createPhotoExecutionContext(services, emitPluginEvent, 0),
      fn,
    );
  }
  // Keep callback failures outside the context-probe catch. Otherwise a
  // provider/plugin exception is mistaken for "no AsyncLocalStorage context"
  // and the whole geocoding operation is executed a second time.
  return await fn();
}

export default function geocodingPlugin(
  options: GeocodingPluginOptions = {},
): BuilderPlugin {
  const normalizedOptions = resolveGeocodingOptions(options);
  let settings: ResolvedGeocodingSettings | null = null;

  return {
    name: PLUGIN_NAME,
    serializablePluginReference: {
      plugin: "geocoding",
      options: normalizedOptions,
    },
    hooks: {
      onInit: () => {
        settings = createResolvedGeocodingSettings(normalizedOptions);
      },
      afterManifestLoad: ({ payload }) => {
        if (!settings || !normalizedOptions.enable) return;
        const fingerprint = getLocationFingerprint(settings);
        const staleKeys = payload.manifest.photos
          .filter((item) => item.processing?.location !== fingerprint)
          .map((item) => item.s3Key);
        if (staleKeys.length === 0) return;
        payload.options.derivedReprocessKeys = [
          ...new Set([
            ...(payload.options.derivedReprocessKeys ?? []),
            ...staleKeys,
          ]),
        ];
      },
      afterPhotoProcess: async ({
        services,
        emitPluginEvent,
        payload,
        runShared,
        logger,
      }) => {
        if (!settings || !normalizedOptions.enable) return;

        const { item } = payload.result;
        if (!item) return;

        const privacyModeChanged =
          payload.context.existingItem?.processing?.privacy !==
          item.processing?.privacy;
        const shouldOverwriteExisting =
          payload.options.isForceMode ||
          payload.options.isForceManifest ||
          privacyModeChanged;
        const currentSettings = settings;

        await ensurePhotoContext(services, emitPluginEvent, async () => {
          const state = getOrCreateState(runShared);
          const locationLogger = logger.main.withTag("LOCATION");
          const exif = item.exif ?? payload.context.existingItem?.exif ?? null;
          const resolution = await resolveLocationForItem({
            item,
            exif,
            state: state.cache,
            settings: currentSettings,
            shouldOverwriteExisting,
            logger: locationLogger,
            getProvider: (locale) =>
              ensureProvider(state, currentSettings, locale, locationLogger),
          });
          if (resolution.cacheDelta) {
            // ProcessPhotoResult crosses the cluster IPC boundary, so this
            // small per-photo delta lets the primary process persist cache
            // updates without workers racing to overwrite the same file.
            payload.result.pluginData[CACHE_DELTA_PLUGIN_DATA_KEY] =
              resolution.cacheDelta;
          }
          item.processing ??= {};
          item.processing.location = getLocationFingerprint(currentSettings);
        });
      },
      afterProcessTasks: async ({
        services,
        emitPluginEvent,
        payload,
        runShared,
        logger,
      }) => {
        if (!settings || !normalizedOptions.enable) {
          return;
        }

        const currentSettings = settings;
        const state = getOrCreateState(runShared);
        const locationLogger = logger.main.withTag("LOCATION");

        await runWithPhotoExecutionContext(
          createPhotoExecutionContext(services, emitPluginEvent, 0),
          async () => {
            const cachePath = normalizeCachePath(currentSettings.cachePath);
            await ensurePersistentCacheLoaded(
              state.cache,
              cachePath,
              locationLogger,
            );
            for (const result of payload.results) {
              const delta = result.pluginData?.[CACHE_DELTA_PLUGIN_DATA_KEY];
              if (
                delta &&
                typeof delta === "object" &&
                "key" in delta &&
                "entry" in delta &&
                typeof delta.key === "string"
              ) {
                mergeGeocodingCacheDelta(
                  state.cache,
                  delta as Parameters<typeof mergeGeocodingCacheDelta>[1],
                );
              }
            }

            let attempted = 0;
            let updated = 0;
            const shouldOverwriteExisting =
              payload.options.isForceMode || payload.options.isForceManifest;

            for (const item of payload.manifest) {
              if (!item) continue;
              if (
                hasRequiredLocalizedLocation(
                  item.location,
                  currentSettings.locales,
                ) &&
                !shouldOverwriteExisting
              ) {
                item.processing ??= {};
                item.processing.location =
                  getLocationFingerprint(currentSettings);
                continue;
              }

              const { attempted: didAttempt, updated: didUpdate } =
                await resolveLocationForItem({
                  item,
                  exif: item.exif,
                  state: state.cache,
                  settings: currentSettings,
                  shouldOverwriteExisting,
                  logger: locationLogger,
                  getProvider: (locale) =>
                    ensureProvider(
                      state,
                      currentSettings,
                      locale,
                      locationLogger,
                    ),
                });

              if (didAttempt) {
                attempted++;
                if (didUpdate) {
                  updated++;
                }
              }
              item.processing ??= {};
              item.processing.location =
                getLocationFingerprint(currentSettings);
            }

            if (attempted > 0) {
              locationLogger.info(
                `📍 Attempted to backfill location for ${attempted} photos missing it, ${updated} succeeded`,
              );
            }

            await savePersistentCacheIfNeeded(
              state.cache,
              cachePath,
              locationLogger,
            );
          },
        );
      },
    },
  };
}

export {
  composeLocalizedLocation,
  migrateV1CacheEntry,
  seedCacheEntryFromExistingLocation,
} from "./geocoding-cache.js";
export {
  type GeocodingPluginOptions,
  normalizeGeocodingLocales,
} from "./geocoding-options.js";
