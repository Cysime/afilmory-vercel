const expandHex = (hex: string): string | null => {
  const value = hex.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(value)) {
    return value
      .split("")
      .map((character) => `${character}${character}`)
      .join("");
  }
  return /^[\da-f]{6}$/i.test(value) ? value : null;
};

const toLinearChannel = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

/** Selects the higher-contrast black/white foreground for a CSS hex color. */
export function getReadableTextColor(
  backgroundColor: string,
  fallback = "#ffffff",
): "#000000" | "#ffffff" | string {
  const hex = expandHex(backgroundColor);
  if (!hex) return fallback;

  const [red, green, blue] = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  const luminance =
    0.2126 * toLinearChannel(red) +
    0.7152 * toLinearChannel(green) +
    0.0722 * toLinearChannel(blue);

  // WCAG contrast equality point: (L + .05) / .05 = 1.05 / (L + .05).
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
