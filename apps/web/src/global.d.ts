import type { AfilmoryBrowserRuntime } from "./runtime/browser-runtime";

declare global {
  interface Window {
    __AFILMORY__?: AfilmoryBrowserRuntime;
  }
}

declare module "react" {
  export interface AriaAttributes {
    "data-testid"?: string;
    "data-hide-in-print"?: boolean;
  }
}
