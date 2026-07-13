import {
  createLocationInfo,
  normalizeCountryCode,
  normalizeGeoValue,
  normalizeLocalizedAdminValue,
} from "@afilmory/schema/geo";

import type { LocationAdminInfo, LocationInfo } from "../types/photo.js";
import { sleep } from "../utils/backoff.js";
import type { SequentialRateLimiter } from "./geocoding-rate-limiter.js";
import {
  applyInterprocessRateLimit,
  getRateLimiter,
} from "./geocoding-rate-limiter.js";
import { getPhotoProcessingLoggers } from "./logger-adapter.js";

export type GeocodingProviderName = "mapbox" | "nominatim" | "auto";

export interface GeocodingProvider {
  reverseGeocode: (lat: number, lon: number) => Promise<LocationInfo | null>;
}

export type GeocodingErrorKind =
  | "authentication"
  | "client"
  | "invalid-response"
  | "network"
  | "rate-limit"
  | "server"
  | "timeout";

export class GeocodingProviderError extends Error {
  constructor(
    message: string,
    readonly kind: GeocodingErrorKind,
    readonly retryable: boolean,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GeocodingProviderError";
    this.status = options.status;
  }

  readonly status?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

async function runWithRequestTimeout<T>(
  callback: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  providerName: string,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const request = callback(controller.signal).catch((error: unknown) => {
    if (error instanceof GeocodingProviderError) throw error;
    if (timedOut || controller.signal.aborted) {
      throw new GeocodingProviderError(
        `${providerName} request timed out after ${timeoutMs}ms`,
        "timeout",
        true,
        { cause: error },
      );
    }
    throw new GeocodingProviderError(
      `${providerName} network request failed`,
      "network",
      true,
      { cause: error },
    );
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new GeocodingProviderError(
          `${providerName} request timed out after ${timeoutMs}ms`,
          "timeout",
          true,
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createHttpError(
  providerName: string,
  response: Response,
): GeocodingProviderError {
  const { status, statusText } = response;
  if (status === 401 || status === 403) {
    return new GeocodingProviderError(
      `${providerName} authentication failed (${status} ${statusText})`,
      "authentication",
      false,
      { status },
    );
  }
  if (status === 429) {
    return new GeocodingProviderError(
      `${providerName} rate limit exceeded (429 ${statusText})`,
      "rate-limit",
      true,
      { status },
    );
  }
  if (status === 408 || status === 425 || status >= 500) {
    return new GeocodingProviderError(
      `${providerName} temporary server error (${status} ${statusText})`,
      "server",
      true,
      { status },
    );
  }
  return new GeocodingProviderError(
    `${providerName} request rejected (${status} ${statusText})`,
    "client",
    false,
    { status },
  );
}

function normalizeProviderError(
  providerName: string,
  error: unknown,
): GeocodingProviderError {
  if (error instanceof GeocodingProviderError) return error;
  return new GeocodingProviderError(
    `${providerName} returned an invalid response`,
    "invalid-response",
    true,
    { cause: error },
  );
}

const getBackoffDelay = (attempt: number, baseDelay: number): number => {
  const exponential = baseDelay * 2 ** (attempt - 1);
  const jitter = Math.random() * baseDelay;
  return exponential + jitter;
};

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  return normalizeGeoValue(value);
};

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const normalized = cleanString(value);
    if (normalized) return normalized;
  }
  return undefined;
};

const firstLocalizedAdminString = (
  language: string | null,
  ...values: unknown[]
): string | undefined => {
  for (const value of values) {
    const normalized = normalizeLocalizedAdminValue(value, language);
    if (normalized) return normalized;
  }
  return undefined;
};

export class MapboxGeocodingProvider implements GeocodingProvider {
  private readonly accessToken: string;
  private readonly language: string | null;
  private readonly baseUrl = "https://api.mapbox.com";
  private readonly rateLimitMs = 100;
  private readonly rateLimiter: SequentialRateLimiter;
  private readonly interprocessKey: string;
  private readonly maxRetries = 3;
  private readonly retryBaseDelayMs = 500;
  private readonly requestTimeoutMs: number;

  constructor(
    accessToken: string,
    language?: string | null,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    this.accessToken = accessToken;
    this.language = language ?? null;
    this.rateLimiter = getRateLimiter(
      `mapbox:${accessToken}`,
      this.rateLimitMs,
    );
    this.interprocessKey = `mapbox:${accessToken}`;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async reverseGeocode(lat: number, lon: number): Promise<LocationInfo | null> {
    const log = getPhotoProcessingLoggers().location;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.applyRateLimit();

        const url = new URL("/search/geocode/v6/reverse", this.baseUrl);
        url.searchParams.set("access_token", this.accessToken);
        url.searchParams.set("longitude", lon.toString());
        url.searchParams.set("latitude", lat.toString());
        if (this.language) {
          url.searchParams.set("language", this.language);
        }

        log.info(`Calling Mapbox API: ${lat}, ${lon}`);

        const lookup = await runWithRequestTimeout(
          async (signal) => {
            const response = await fetch(url.toString(), { signal });
            if (!response.ok) {
              if (response.status === 404) return { notFound: true as const };
              throw createHttpError("Mapbox", response);
            }
            try {
              return {
                notFound: false as const,
                data: await response.json(),
              };
            } catch (error) {
              throw new GeocodingProviderError(
                "Mapbox returned invalid JSON",
                "invalid-response",
                true,
                { cause: error },
              );
            }
          },
          this.requestTimeoutMs,
          "Mapbox",
        );
        if (lookup.notFound) return null;
        const { data } = lookup;

        if (!data || !data.features || data.features.length === 0) {
          log.warn("Mapbox API returned no results");
          return null;
        }

        const feature = data.features[0];
        const properties = feature.properties || {};
        const context = properties.context || {};

        const admin: LocationAdminInfo = {
          country: cleanString(context.country?.name),
          countryCode: normalizeCountryCode(
            context.country?.country_code ??
              context.country?.country_code_alpha_2,
          ),
          region: cleanString(context.region?.name),
          city: firstString(context.place?.name, context.locality?.name),
          district: firstString(
            context.district?.name,
            context.neighborhood?.name,
          ),
        };

        const locationName = firstString(
          properties.full_address,
          properties.place_formatted,
          properties.name,
        );

        log.success(`Location resolved: ${admin.city}, ${admin.country}`);

        return createLocationInfo({
          latitude: lat,
          longitude: lon,
          admin,
          locationName,
        });
      } catch (error) {
        const providerError = normalizeProviderError("Mapbox", error);
        const isLastAttempt = attempt === this.maxRetries;
        if (isLastAttempt || !providerError.retryable) {
          log.error("Mapbox reverse geocoding failed:", providerError);
          throw providerError;
        }

        const delay = getBackoffDelay(attempt, this.retryBaseDelayMs);
        log.warn(
          `Mapbox API call failed, retrying in ${Math.round(delay)}ms (${attempt}/${this.maxRetries})`,
          providerError,
        );
        await sleep(delay);
      }
    }

    throw new GeocodingProviderError(
      "Mapbox reverse geocoding exhausted its retry budget",
      "network",
      false,
    );
  }

  private async applyRateLimit(): Promise<void> {
    await this.rateLimiter.wait();
    await applyInterprocessRateLimit(this.interprocessKey, this.rateLimitMs);
  }
}

export class NominatimGeocodingProvider implements GeocodingProvider {
  private readonly baseUrl: string;
  private readonly language: string | null;
  private readonly userAgent: string;
  private readonly rateLimitMs = 1000;
  private readonly rateLimiter: SequentialRateLimiter;
  private readonly interprocessKey: string;
  private readonly maxRetries = 3;
  private readonly retryBaseDelayMs = 1000;
  private readonly requestTimeoutMs: number;

  constructor(
    baseUrl?: string,
    language?: string | null,
    userAgent?: string | null,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl || "https://nominatim.openstreetmap.org";
    this.language = language ?? null;
    this.userAgent = cleanString(userAgent) ?? "afilmory/1.0";
    this.rateLimiter = getRateLimiter(
      `nominatim:${this.baseUrl}`,
      this.rateLimitMs,
    );
    this.interprocessKey = `nominatim:${this.baseUrl}`;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async reverseGeocode(lat: number, lon: number): Promise<LocationInfo | null> {
    const log = getPhotoProcessingLoggers().location;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.applyRateLimit();

        const url = new URL("/reverse", this.baseUrl);
        url.searchParams.set("lat", lat.toString());
        url.searchParams.set("lon", lon.toString());
        url.searchParams.set("format", "json");
        url.searchParams.set("addressdetails", "1");
        if (this.language) {
          url.searchParams.set("accept-language", this.language);
        }

        log.info(`Calling Nominatim API: ${lat}, ${lon}`);

        const lookup = await runWithRequestTimeout(
          async (signal) => {
            const response = await fetch(url.toString(), {
              signal,
              headers: {
                "User-Agent": this.userAgent,
                ...(this.language ? { "Accept-Language": this.language } : {}),
              },
            });
            if (!response.ok) {
              if (response.status === 404) return { notFound: true as const };
              throw createHttpError("Nominatim", response);
            }
            try {
              return {
                notFound: false as const,
                data: await response.json(),
              };
            } catch (error) {
              throw new GeocodingProviderError(
                "Nominatim returned invalid JSON",
                "invalid-response",
                true,
                { cause: error },
              );
            }
          },
          this.requestTimeoutMs,
          "Nominatim",
        );
        if (lookup.notFound) return null;
        const { data } = lookup;

        if (!data) {
          throw new GeocodingProviderError(
            "Nominatim returned an empty response",
            "invalid-response",
            true,
          );
        }
        if (data.error) {
          if (
            /unable to geocode|not found|no result/i.test(String(data.error))
          ) {
            return null;
          }
          throw new GeocodingProviderError(
            `Nominatim returned an error: ${String(data.error)}`,
            "invalid-response",
            false,
          );
        }

        const address = data.address || {};

        const admin: LocationAdminInfo = {
          country: firstLocalizedAdminString(
            this.language,
            address.country,
            address.country_code,
          ),
          countryCode: normalizeCountryCode(address.country_code),
          region: firstLocalizedAdminString(
            this.language,
            address.state,
            address.province,
            address.region,
          ),
          city: firstLocalizedAdminString(
            this.language,
            address.city,
            address.town,
            address.village,
            address.municipality,
          ),
          district: firstLocalizedAdminString(
            this.language,
            address.city_district,
            address.district,
            address.county,
            address.borough,
            address.suburb,
            address.neighbourhood,
          ),
        };

        const locationName = cleanString(data.display_name);

        log.success(`Location resolved: ${admin.city}, ${admin.country}`);

        return createLocationInfo({
          latitude: lat,
          longitude: lon,
          admin,
          locationName,
        });
      } catch (error) {
        const providerError = normalizeProviderError("Nominatim", error);
        const isLastAttempt = attempt === this.maxRetries;
        if (isLastAttempt || !providerError.retryable) {
          log.error("Nominatim reverse geocoding failed:", providerError);
          throw providerError;
        }

        const delay = getBackoffDelay(attempt, this.retryBaseDelayMs);
        log.warn(
          `Nominatim API call failed, retrying in ${Math.round(delay)}ms (${attempt}/${this.maxRetries})`,
          providerError,
        );
        await sleep(delay);
      }
    }

    throw new GeocodingProviderError(
      "Nominatim reverse geocoding exhausted its retry budget",
      "network",
      false,
    );
  }

  private async applyRateLimit(): Promise<void> {
    await this.rateLimiter.wait();
    await applyInterprocessRateLimit(this.interprocessKey, this.rateLimitMs);
  }
}

export function createGeocodingProvider(
  provider: GeocodingProviderName,
  mapboxToken?: string,
  nominatimBaseUrl?: string,
  language?: string | null,
  userAgent?: string | null,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): GeocodingProvider | null {
  if ((provider === "mapbox" || provider === "auto") && mapboxToken) {
    return new MapboxGeocodingProvider(mapboxToken, language, requestTimeoutMs);
  }

  if (provider === "nominatim" || provider === "auto") {
    return new NominatimGeocodingProvider(
      nominatimBaseUrl,
      language,
      userAgent,
      requestTimeoutMs,
    );
  }

  return null;
}
