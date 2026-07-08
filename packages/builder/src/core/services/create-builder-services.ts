import type { ExifReaderService } from "../../image/exif.js";
import type { Logger } from "../../logger/index.js";
import type { StorageManager } from "../../storage/index.js";
import type { StorageConfig } from "../../storage/interfaces.js";
import type { BuilderConfig } from "../../types/config.js";
import type { PhotoManifestItem } from "../../types/photo.js";
import type {
  BuilderServices,
  PhotoIdService,
  StorageService,
} from "../contracts/services.js";

/**
 * Backing object that AfilmoryBuilder (and Worker bootstrap) supplies to
 * createBuilderServices. Using a record of getters keeps this layer
 * decoupled from the AfilmoryBuilder class — anything matching the shape
 * works (real builder, mocks, alternative implementations).
 */
export interface BuilderServicesBacking {
  config: BuilderConfig;
  logger: Logger;
  getStorageConfig: () => StorageConfig;
  getStorageManager: () => StorageManager;
  getExifService: () => ExifReaderService;
  createStorageManager: (config: StorageConfig) => StorageManager;
  getPhotoIdForKey: (key: string, existingItem?: PhotoManifestItem) => string;
}

export function createBuilderServices(
  backing: BuilderServicesBacking,
): BuilderServices {
  const storage: StorageService = {
    createManager: (config) => backing.createStorageManager(config),
    getConfig: () => backing.getStorageConfig(),
    getManager: () => backing.getStorageManager(),
  };

  const photoId: PhotoIdService = {
    getIdForKey: (key, existingItem) =>
      backing.getPhotoIdForKey(key, existingItem),
  };

  return {
    exif: backing.getExifService(),
    storage,
    photoId,
    config: backing.config,
    logger: backing.logger,
  };
}
