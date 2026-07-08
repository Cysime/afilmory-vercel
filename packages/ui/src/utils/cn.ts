// Tremor Raw cx [v0.0.0]

import type { ClassValue } from "clsx";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

export const clsxm = (...args: ClassValue[]) => {
  return twMerge(clsx(args));
};

// Shared focus ring, in the app-wide accent idiom. Box-shadow ring
// utilities on purpose: the app resets `outline` on :focus-visible
// globally, so outline-based rings never paint. The offset color matches
// the (dark) background token, as elsewhere in the app.

export const focusRing = [
  // base
  "focus-visible:ring-2 focus-visible:ring-offset-2",
  // ring + offset color
  "focus-visible:ring-accent/45 focus-visible:ring-offset-background",
];
