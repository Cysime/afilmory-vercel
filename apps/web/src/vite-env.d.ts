/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "virtual:afilmory-routes" {
  export const globTree: Record<string, () => Promise<unknown>>;
}
