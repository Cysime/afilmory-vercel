import { handleDeletedPhotos, saveManifest } from "../../manifest/manager.js";
import { assertSafeThumbnailOutputDirectory } from "../../output-paths.js";
import type {
  AfilmoryManifest,
  CameraInfo,
  LensInfo,
} from "../../types/manifest.js";
import type { PhotoManifestItem } from "../../types/photo.js";
import { ManifestAssembler } from "./manifest-assembler.js";
import type { BuildSession } from "./session.js";

export interface ArtifactWriteResult {
  cameras: CameraInfo[];
  lenses: LensInfo[];
  deletedCount: number;
  manifest: AfilmoryManifest;
  manifestChanged: boolean;
}

export class ArtifactWriter {
  private readonly assembler = new ManifestAssembler();

  async write(
    session: BuildSession,
    manifest: PhotoManifestItem[],
    options?: {
      forceManifestRewrite?: boolean;
      keepPhotoIds?: ReadonlySet<string>;
      previousManifest?: AfilmoryManifest;
    },
  ): Promise<ArtifactWriteResult> {
    const { output } = session.config;
    // BuildSession is internal but can be constructed directly in tests or
    // integrations. Reassert this before the manifest commit so bypassing the
    // normal config-normalization entry point cannot make cleanup target cwd.
    assertSafeThumbnailOutputDirectory(output.thumbnailsDir);
    let cameras = this.assembler.generateCameraCollection(manifest);
    let lenses = this.assembler.generateLensCollection(manifest);

    await session.emit("beforeSaveManifest", {
      options: session.options,
      manifest,
      cameras,
      lenses,
    });

    // Plugins may mutate photo metadata in beforeSaveManifest. Indexes are
    // derived data, so rebuild them after the last mutation point and validate
    // the complete candidate before the atomic manifest switch.
    cameras = this.assembler.generateCameraCollection(manifest);
    lenses = this.assembler.generateLensCollection(manifest);
    const saved = await saveManifest(
      output,
      manifest,
      cameras,
      lenses,
      session.getManifestSource(),
      {
        previousManifest: options?.previousManifest,
        forceWrite: options?.forceManifestRewrite,
      },
    );

    // Expose exactly the normalized/sorted gallery that was committed (or
    // proven byte-equivalent), not the pre-validation mutable work array.
    manifest.splice(0, manifest.length, ...saved.manifest.photos);

    await session.emit("afterSaveManifest", {
      options: session.options,
      manifest,
      cameras,
      lenses,
    });

    // Transaction order: all new thumbnail assets already exist, candidate is
    // strictly valid, and manifest has atomically switched. Only now may old
    // immutable assets be garbage-collected. A failure before this point leaves
    // the previous successful deployment fully intact.
    const deletedCount = await handleDeletedPhotos(
      output,
      manifest,
      options?.keepPhotoIds,
      new Set(options?.previousManifest?.photos.map((item) => item.id) ?? []),
    );

    await session.emit("afterCleanup", {
      options: session.options,
      manifest,
      deletedCount,
    });

    return {
      cameras,
      lenses,
      deletedCount,
      manifest: saved.manifest,
      manifestChanged: saved.written,
    };
  }
}
