import type { SiteConfig } from "@config";
import defaultSiteConfig from "@config";
import { merge } from "es-toolkit/compat";

import { getExistingBrowserRuntime } from "~/runtime/browser-runtime";

const runtimeSiteConfig = getExistingBrowserRuntime()?.config?.site ?? {};

export const siteConfig: SiteConfig = merge(
  defaultSiteConfig,
  runtimeSiteConfig,
);
