import { useMemo } from "react";

import { siteConfig } from "~/config";
import { debugLog } from "~/lib/debug-log";

import { MapContext } from "./map-context";
import { createMapLibreAdapter } from "./MapLibreAdapter";

const maplibreAdapter = createMapLibreAdapter();

const ADAPTERS = [
  {
    name: "maplibre",
    adapter: maplibreAdapter,
    component: maplibreAdapter.MapComponent,
  },
];

/**
 * Get the preferred map adapter based on configuration
 */
const getPreferredAdapter = () => {
  const configuredProviders = siteConfig.map ?? [];
  if (configuredProviders.length === 0) {
    debugLog("Map: Disabled by site configuration");
    return null;
  }

  for (const providerName of configuredProviders) {
    const adapter = ADAPTERS.find(
      (candidate) =>
        candidate.name === providerName && candidate.adapter.isAvailable,
    );
    if (adapter) {
      debugLog(`Map: Selected configured adapter: ${adapter.name}`);
      return adapter;
    }
  }

  console.warn(
    `Map: None of the configured adapters are available (${configuredProviders.join(", ")})`,
  );
  return null;
};

export const MapProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const adapter = useMemo(() => {
    const preferredAdapter = getPreferredAdapter();
    if (preferredAdapter) {
      return {
        ...preferredAdapter.adapter,
        MapComponent: preferredAdapter.component,
      };
    }
    return null;
  }, []);

  const value = useMemo(() => ({ adapter }), [adapter]);

  return <MapContext value={value}>{children}</MapContext>;
};
