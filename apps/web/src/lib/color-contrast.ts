interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const parseHexColor = (hex: string): RgbaColor | null => {
  const value = hex.trim().replace(/^#/, "");
  const expanded = /^[\da-f]{3,4}$/i.test(value)
    ? value
        .split("")
        .map((character) => `${character}${character}`)
        .join("")
    : value;
  if (!/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(expanded)) return null;

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
    alpha:
      expanded.length === 8
        ? Number.parseInt(expanded.slice(6, 8), 16) / 255
        : 1,
  };
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
  const color = parseHexColor(backgroundColor);
  if (!color) return fallback;

  // Accent surfaces in this app are rendered on the dark #1c1c1e canvas.
  // Alpha-bearing CSS hex colors must be composited first: ignoring alpha
  // makes e.g. transparent white incorrectly select black text.
  const darkCanvas = [28, 28, 30];
  const [red, green, blue] = [color.red, color.green, color.blue].map(
    (channel, index) =>
      channel * color.alpha + darkCanvas[index]! * (1 - color.alpha),
  );
  const luminance =
    0.2126 * toLinearChannel(red) +
    0.7152 * toLinearChannel(green) +
    0.0722 * toLinearChannel(blue);

  // WCAG contrast equality point: (L + .05) / .05 = 1.05 / (L + .05).
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
