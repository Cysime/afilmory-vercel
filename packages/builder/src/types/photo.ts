export type {
  FujiRecipe,
  LocationAdminInfo,
  LocationInfo,
  PhotoInfo,
  PhotoManifestItem,
  PhotoProcessingFingerprints,
  PickedExif,
  SonyRecipe,
  ToneAnalysis,
  ToneType,
  VideoSource,
} from "@afilmory/schema/types";

export interface ProcessPhotoResult {
  item: import("@afilmory/schema/types").PhotoManifestItem | null;
  type: "processed" | "skipped" | "new" | "failed";
  pluginData?: Record<string, unknown>;
  failure?: PhotoProcessingFailure;
}

export interface PhotoProcessingFailure {
  code: string;
  message: string;
  stage: string;
}
