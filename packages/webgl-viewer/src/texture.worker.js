/// <reference lib="webworker" />

// TILE_SIZE, SIMPLE_LOD_LEVELS and clampDimensionsToFit are injected by
// worker-bridge.ts as a generated prelude (single source of truth:
// tile-cache.ts / worker-bridge.ts). Do not declare them here.
/* global TILE_SIZE, SIMPLE_LOD_LEVELS, clampDimensionsToFit */

let originalImage = null;

/**
 *
 * @param {MessageEvent} e
 * @returns
 */
self.onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case "load-image": {
      // 上下文恢复会通过同一个存活 worker 重新 loadImage：旧的全尺寸 bitmap
      // （48MP 约 190MB）若等 GC 释放，恰好撞上引发上下文丢失的内存压力窗口。
      // 先置 null 再解码，解码期间到达的 create-tile 会走 !originalImage 守卫安全失败。
      if (originalImage) {
        originalImage.close();
        originalImage = null;
      }
      const { url, blob: sourceBlob, maxTextureSize } = payload;
      try {
        const blob =
          sourceBlob ??
          (await (async () => {
            const response = await fetch(url, { mode: "cors" });
            return await response.blob();
          })());
        originalImage = await createImageBitmap(blob);

        self.postMessage({ type: "init-done" });

        // Create initial LOD texture
        const lodLevel = 1; // Initial LOD level
        const lodConfig = SIMPLE_LOD_LEVELS[lodLevel];
        // 底图按 0.5x 生成：超大原图（如 10000px 宽 → 5000px 底图）会超过老
        // iOS/Android GPU 的 MAX_TEXTURE_SIZE（常见 4096），texImage2D 静默失败、
        // 回退四边形渲染成黑块。按当前上下文的能力等比钳制到能容纳的最大尺寸。
        const { width: finalWidth, height: finalHeight } = clampDimensionsToFit(
          Math.max(1, Math.round(originalImage.width * lodConfig.scale)),
          Math.max(1, Math.round(originalImage.height * lodConfig.scale)),
          maxTextureSize,
        );

        const initialLODBitmap = await createImageBitmap(originalImage, {
          resizeWidth: finalWidth,
          resizeHeight: finalHeight,
          resizeQuality: "medium",
        });

        self.postMessage(
          {
            type: "image-loaded",
            payload: {
              imageBitmap: initialLODBitmap,
              imageWidth: originalImage.width,
              imageHeight: originalImage.height,
              lodLevel,
            },
          },
          [initialLODBitmap],
        );
      } catch (error) {
        console.error("[Worker] Error loading image:", error);
        self.postMessage({ type: "load-error", payload: { error } });
      }
      break;
    }
    case "create-tile": {
      if (!originalImage) {
        console.warn("Worker has not been initialized with an image.");
        return;
      }

      const { x, y, lodLevel, lodConfig, imageWidth, imageHeight, key } =
        payload;

      try {
        const { cols, rows } = getTileGridSize(
          imageWidth,
          imageHeight,
          lodLevel,
          lodConfig,
        );

        // Calculate tile region in the original image
        const sourceWidth = imageWidth / cols;
        const sourceHeight = imageHeight / rows; // Assuming square tiles from a square grid on the image
        const sourceX = x * sourceWidth;
        const sourceY = y * sourceHeight;

        const actualSourceWidth = Math.min(sourceWidth, imageWidth - sourceX);
        const actualSourceHeight = Math.min(
          sourceHeight,
          imageHeight - sourceY,
        );

        const targetWidth = Math.min(
          TILE_SIZE,
          Math.ceil(actualSourceWidth * lodConfig.scale),
        );
        const targetHeight = Math.min(
          TILE_SIZE,
          Math.ceil(actualSourceHeight * lodConfig.scale),
        );

        if (targetWidth <= 0 || targetHeight <= 0) {
          return;
        }

        // Use OffscreenCanvas to draw the tile
        const canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext("2d");

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = lodConfig.scale >= 1 ? "high" : "medium";

        ctx.drawImage(
          originalImage,
          sourceX,
          sourceY,
          actualSourceWidth,
          actualSourceHeight,
          0,
          0,
          targetWidth,
          targetHeight,
        );

        const imageBitmap = canvas.transferToImageBitmap();
        self.postMessage(
          { type: "tile-created", payload: { key, imageBitmap, lodLevel } },
          [imageBitmap],
        );
      } catch (error) {
        console.error("Error creating tile in worker:", error);
        self.postMessage({ type: "tile-error", payload: { key, error } });
      }
      break;
    }
  }
};

/**
 *
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {number} _lodLevel
 * @param {object} lodConfig
 * @returns
 */
function getTileGridSize(imageWidth, imageHeight, _lodLevel, lodConfig) {
  const scaledWidth = imageWidth * lodConfig.scale;
  const scaledHeight = imageHeight * lodConfig.scale;

  const cols = Math.ceil(scaledWidth / TILE_SIZE);
  const rows = Math.ceil(scaledHeight / TILE_SIZE);

  return { cols, rows };
}
