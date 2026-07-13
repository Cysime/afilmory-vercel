import "react";

declare module "react" {
  export interface AriaAttributes {
    "data-testid"?: string;
    "data-hide-in-print"?: boolean;
  }
}
