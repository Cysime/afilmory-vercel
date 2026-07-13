export const MAX_CANVAS_DEVICE_PIXEL_RATIO = 2;
export const MAX_CANVAS_BACKING_BYTES = 32 * 1024 * 1024;

const RGBA_BYTES_PER_PIXEL = 4;

/**
 * Resolve a canvas backing store without letting a large viewport/high-DPR
 * display allocate an unbounded framebuffer. The returned DPR is the
 * effective value and must also drive LOD selection.
 */
export function resolveCanvasBackingStore(input: {
  cssWidth: number;
  cssHeight: number;
  requestedDpr: number;
  maxTextureSize: number;
  maxBytes?: number;
  maxDpr?: number;
}): { width: number; height: number; dpr: number; bytes: number } {
  const cssWidth =
    Number.isFinite(input.cssWidth) && input.cssWidth > 0 ? input.cssWidth : 0;
  const cssHeight =
    Number.isFinite(input.cssHeight) && input.cssHeight > 0
      ? input.cssHeight
      : 0;
  const requestedDpr =
    Number.isFinite(input.requestedDpr) && input.requestedDpr > 0
      ? input.requestedDpr
      : 1;
  const maxDpr = Math.max(0.1, input.maxDpr ?? MAX_CANVAS_DEVICE_PIXEL_RATIO);
  const maxBytes = Math.max(1, input.maxBytes ?? MAX_CANVAS_BACKING_BYTES);

  if (cssWidth === 0 || cssHeight === 0) {
    return {
      width: 0,
      height: 0,
      dpr: Math.min(requestedDpr, maxDpr),
      bytes: 0,
    };
  }

  const dimensionDpr =
    input.maxTextureSize > 0
      ? Math.min(
          input.maxTextureSize / cssWidth,
          input.maxTextureSize / cssHeight,
        )
      : Number.POSITIVE_INFINITY;
  const byteDpr = Math.sqrt(
    maxBytes / (cssWidth * cssHeight * RGBA_BYTES_PER_PIXEL),
  );
  const dpr = Math.max(
    Number.EPSILON,
    Math.min(requestedDpr, maxDpr, dimensionDpr, byteDpr),
  );
  const width = Math.max(1, Math.floor(cssWidth * dpr));
  const height = Math.max(1, Math.floor(cssHeight * dpr));

  return {
    width,
    height,
    dpr: Math.min(width / cssWidth, height / cssHeight),
    bytes: width * height * RGBA_BYTES_PER_PIXEL,
  };
}
