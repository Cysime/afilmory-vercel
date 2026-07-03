import { handleDeletedPhotos, saveManifest } from "../../manifest/manager.js";
import type { CameraInfo, LensInfo } from "../../types/manifest.js";
import type { PhotoManifestItem } from "../../types/photo.js";
import { ManifestAssembler } from "./manifest-assembler.js";
import type { BuildSession } from "./session.js";

export interface ArtifactWriteResult {
  cameras: CameraInfo[];
  lenses: LensInfo[];
  deletedCount: number;
}

export class ArtifactWriter {
  private readonly assembler = new ManifestAssembler();

  async write(
    session: BuildSession,
    manifest: PhotoManifestItem[],
    options?: { keepPhotoIds?: ReadonlySet<string> },
  ): Promise<ArtifactWriteResult> {
    // keepPhotoIds = 存储中仍存在的照片全集：处理失败的照片不在 manifest 里，
    // 但缩略图必须保留（见 handleDeletedPhotos 的注释）。
    const deletedCount = await handleDeletedPhotos(
      manifest,
      options?.keepPhotoIds,
    );

    await session.emit("afterCleanup", {
      options: session.options,
      manifest,
      deletedCount,
    });

    const cameras = this.assembler.generateCameraCollection(manifest);
    const lenses = this.assembler.generateLensCollection(manifest);

    await session.emit("beforeSaveManifest", {
      options: session.options,
      manifest,
      cameras,
      lenses,
    });

    await saveManifest(manifest, cameras, lenses, session.getManifestSource());

    await session.emit("afterSaveManifest", {
      options: session.options,
      manifest,
      cameras,
      lenses,
    });

    return {
      cameras,
      lenses,
      deletedCount,
    };
  }
}
