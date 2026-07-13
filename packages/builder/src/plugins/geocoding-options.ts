import type { GeocodingProviderName } from "../photo/geocoding.js";

export const DEFAULT_CACHE_PRECISION = 4;
export const DEFAULT_GEOCODING_LOCALES = ["en", "zh-CN"] as const;
export const CANONICAL_GEOCODING_LOCALE = "en";
export const DEFAULT_GEOCODING_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_GEOCODING_NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60_000;

export interface GeocodingPluginOptions {
  enable?: boolean;
  provider?: GeocodingProviderName;
  mapboxToken?: string;
  nominatimBaseUrl?: string;
  nominatimUserAgent?: string;
  cachePath?: string;
  cachePrecision?: number;
  /** Per-request network timeout. */
  requestTimeoutMs?: number;
  /** How long a confirmed no-result response is cached. */
  negativeCacheTtlMs?: number;
  /**
   * Preferred languages for geocoding results (BCP47). Accepts comma-separated string or array.
   */
  language?: string | string[];
  /**
   * Locales to precompute for runtime localized geographic names.
   */
  locales?: string | string[];
}

export type GeocodingPluginOptionsResolved = Required<
  Pick<GeocodingPluginOptions, "enable" | "provider">
> &
  Pick<
    GeocodingPluginOptions,
    | "mapboxToken"
    | "nominatimBaseUrl"
    | "nominatimUserAgent"
    | "cachePath"
    | "cachePrecision"
    | "requestTimeoutMs"
    | "negativeCacheTtlMs"
  > & {
    locales: string[];
  };

export interface ResolvedGeocodingSettings {
  provider: GeocodingProviderName;
  mapboxToken?: string;
  nominatimBaseUrl?: string;
  nominatimUserAgent?: string;
  cachePath?: string;
  cachePrecision: number;
  requestTimeoutMs: number;
  negativeCacheTtlMs: number;
  locales: string[];
}

function normalizeCachePrecision(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_CACHE_PRECISION;
  }

  const rounded = Math.round(value);
  return Math.max(0, Math.min(10, rounded));
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseLocaleList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : String(value).split(",");
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function normalizeGeocodingLocales(
  locales?: string | string[],
  legacyLanguage?: string | string[],
): string[] {
  const requested =
    parseLocaleList(locales).length > 0
      ? parseLocaleList(locales)
      : parseLocaleList(legacyLanguage).length > 0
        ? parseLocaleList(legacyLanguage)
        : [...DEFAULT_GEOCODING_LOCALES];

  const deduped = Array.from(new Set(requested));
  return [
    CANONICAL_GEOCODING_LOCALE,
    ...deduped.filter((locale) => locale !== CANONICAL_GEOCODING_LOCALE),
  ];
}

export function resolveGeocodingOptions(
  options: GeocodingPluginOptions,
): GeocodingPluginOptionsResolved {
  return {
    enable: options.enable ?? false,
    provider: options.provider ?? "nominatim",
    mapboxToken: options.mapboxToken,
    nominatimBaseUrl: options.nominatimBaseUrl,
    nominatimUserAgent: options.nominatimUserAgent,
    cachePath: options.cachePath,
    cachePrecision: normalizeCachePrecision(
      options.cachePrecision ?? DEFAULT_CACHE_PRECISION,
    ),
    requestTimeoutMs: normalizeBoundedInteger(
      options.requestTimeoutMs,
      DEFAULT_GEOCODING_REQUEST_TIMEOUT_MS,
      1,
      60_000,
    ),
    negativeCacheTtlMs: normalizeBoundedInteger(
      options.negativeCacheTtlMs,
      DEFAULT_GEOCODING_NEGATIVE_CACHE_TTL_MS,
      0,
      30 * 24 * 60 * 60_000,
    ),
    locales: normalizeGeocodingLocales(options.locales, options.language),
  };
}

export function createResolvedGeocodingSettings(
  options: GeocodingPluginOptionsResolved,
): ResolvedGeocodingSettings {
  return {
    provider: options.provider,
    mapboxToken: options.mapboxToken,
    nominatimBaseUrl: options.nominatimBaseUrl,
    nominatimUserAgent: options.nominatimUserAgent,
    cachePath: options.cachePath,
    cachePrecision: options.cachePrecision ?? DEFAULT_CACHE_PRECISION,
    requestTimeoutMs:
      options.requestTimeoutMs ?? DEFAULT_GEOCODING_REQUEST_TIMEOUT_MS,
    negativeCacheTtlMs:
      options.negativeCacheTtlMs ?? DEFAULT_GEOCODING_NEGATIVE_CACHE_TTL_MS,
    locales: options.locales,
  };
}
