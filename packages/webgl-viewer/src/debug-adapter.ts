import type { DebugInfo } from "./interface";
import type { TileInfo, TileKey } from "./tile-cache";
import { MAX_TILES_PER_FRAME, TILE_CACHE_SIZE, TILE_SIZE } from "./tile-cache";

/** RGBA8 textures: 4 bytes per pixel. */
const BYTES_PER_PIXEL = 4;

export interface WebGLDebugAdapterInput {
  scale: number;
  translateX: number;
  translateY: number;
  currentLOD: number;
  lodLevelCount: number;
  canvasWidth: number;
  canvasHeight: number;
  imageWidth: number;
  imageHeight: number;
  fitToScreenScale: number;
  userMaxScale: number;
  effectiveMaxScale: number;
  originalSizeScale: number;
  /** Real frame counter maintained by the engine (increments per render). */
  renderCount: number;
  maxTextureSize: number;
  quality: "high" | "medium" | "low" | "unknown";
  isLoading: boolean;
  tileOutlineEnabled: boolean;
  /** Actual pixel dimensions of the uploaded base texture, if any. */
  baseTextureSize: { width: number; height: number } | null;
  tileCache: ReadonlyMap<TileKey, TileInfo>;
  currentVisibleTiles: ReadonlySet<TileKey>;
  loadingTiles: ReadonlyMap<TileKey, { priority: number }>;
  pendingTileRequests: ReadonlyMap<TileKey, number>;
}

export function createWebGLDebugInfo(input: WebGLDebugAdapterInput): DebugInfo {
  // 逐瓦片按真实尺寸累加（边缘瓦片小于 512×512），而不是拍脑袋的每片常数。
  let tileTextureBytes = 0;
  for (const tileInfo of input.tileCache.values()) {
    if (!tileInfo.texture) continue;
    tileTextureBytes += tileInfo.byteSize;
  }

  const baseTextureBytes = input.baseTextureSize
    ? input.baseTextureSize.width *
      input.baseTextureSize.height *
      BYTES_PER_PIXEL
    : 0;

  return {
    scale: input.scale,
    relativeScale: input.scale / input.fitToScreenScale,
    translateX: input.translateX,
    translateY: input.translateY,
    currentLOD: input.currentLOD,
    lodLevels: input.lodLevelCount,
    canvasSize: { width: input.canvasWidth, height: input.canvasHeight },
    imageSize: { width: input.imageWidth, height: input.imageHeight },
    fitToScreenScale: input.fitToScreenScale,
    userMaxScale: input.userMaxScale,
    effectiveMaxScale: input.effectiveMaxScale,
    originalSizeScale: input.originalSizeScale,
    renderCount: input.renderCount,
    maxTextureSize: input.maxTextureSize,
    quality: input.quality,
    isLoading: input.isLoading,
    memory: {
      tileTextureBytes,
      baseTextureBytes,
      totalBytes: tileTextureBytes + baseTextureBytes,
      activeLODs: input.baseTextureSize ? 1 : 0,
    },
    tileOutlinesEnabled: input.tileOutlineEnabled,
    tileSystem: {
      cacheSize: input.tileCache.size,
      visibleTiles: input.currentVisibleTiles.size,
      loadingTiles: input.loadingTiles.size,
      pendingRequests: input.pendingTileRequests.size,
      cacheLimit: TILE_CACHE_SIZE,
      maxTilesPerFrame: MAX_TILES_PER_FRAME,
      tileSize: TILE_SIZE,
      cacheKeys: Array.from(input.tileCache.keys()),
      visibleKeys: Array.from(input.currentVisibleTiles),
      loadingKeys: Array.from(input.loadingTiles.keys()),
      pendingKeys: Array.from(input.pendingTileRequests.keys()),
    },
  };
}
