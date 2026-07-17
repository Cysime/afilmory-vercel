import type {
  AfilmoryManifest,
  LocationInfo,
  PhotoManifestItem,
  PickedExif,
} from "./types.ts";

export type LocationPrivacyMode = "strip" | "coarse" | "exact";

// 3 位小数 ≈ 110 m：街区级精度，地图图钉落点基本准确，但反推不出具体
// 门牌/楼栋。2 位（~1.1 km）对地图可用性损伤明显，4 位（~11 m）接近门牌级。
export const COARSE_LOCATION_DECIMAL_PLACES = 3;

/**
 * privacy 处理阶段的指纹，builder 的增量决策与发布层盖章共用这一个来源。
 * 取整精度或键保留规则变化时指纹必须变化：取整不可逆，旧照片只能重走
 * 源文件 EXIF 提取才能获得新精度。coarse 把小数位编进指纹，调整
 * COARSE_LOCATION_DECIMAL_PLACES 时无需手动记得升版本号。
 * （v2 = coarse 保留海拔 + 精度 2→3 位；strip/exact 语义未变，留在 v1，
 * 避免让这两种模式的用户白付一次全量重提取。）
 */
export const locationPrivacyFingerprint = (
  mode: LocationPrivacyMode,
): string =>
  mode === "coarse"
    ? `location-privacy:v2:coarse-d${COARSE_LOCATION_DECIMAL_PLACES}`
    : `location-privacy:v1:${mode}`;

// coarse 只针对水平定位能力：坐标取整重写、GPSCoordinates（内嵌全精度
// 经纬度的组合键）删除；海拔不暴露水平位置，予以保留。strip 全部删除。
const GPS_COORDINATE_KEYS = [
  "GPSCoordinates",
  "GPSLatitude",
  "GPSLatitudeRef",
  "GPSLongitude",
  "GPSLongitudeRef",
] as const satisfies ReadonlyArray<keyof PickedExif>;

const GPS_ALTITUDE_KEYS = [
  "GPSAltitude",
  "GPSAltitudeRef",
] as const satisfies ReadonlyArray<keyof PickedExif>;

const roundCoordinate = (value: number): number => {
  const factor = 10 ** COARSE_LOCATION_DECIMAL_PLACES;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Signed decimal GPS coordinates from EXIF, or null when absent/non-finite. */
export const parseExifCoordinates = (
  exif: PickedExif,
): { latitude: number; longitude: number } | null => {
  if (exif.GPSLatitude === undefined || exif.GPSLongitude === undefined) {
    return null;
  }

  let latitude = Number(exif.GPSLatitude);
  let longitude = Number(exif.GPSLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  if (exif.GPSLatitudeRef === "S" || exif.GPSLatitudeRef === "South") {
    latitude = -Math.abs(latitude);
  }
  if (exif.GPSLongitudeRef === "W" || exif.GPSLongitudeRef === "West") {
    longitude = -Math.abs(longitude);
  }

  return { latitude, longitude };
};

export function applyExifLocationPrivacy(
  exif: PickedExif | null,
  mode: LocationPrivacyMode,
): PickedExif | null {
  if (!exif || mode === "exact") return exif;

  const result: PickedExif = { ...exif };
  const coordinates = parseExifCoordinates(exif);
  for (const key of GPS_COORDINATE_KEYS) delete result[key];
  if (mode === "strip") {
    for (const key of GPS_ALTITUDE_KEYS) delete result[key];
  }

  if (mode === "coarse" && coordinates) {
    const latitude = roundCoordinate(coordinates.latitude);
    const longitude = roundCoordinate(coordinates.longitude);
    result.GPSLatitude = Math.abs(latitude);
    result.GPSLatitudeRef = latitude < 0 ? "S" : "N";
    result.GPSLongitude = Math.abs(longitude);
    result.GPSLongitudeRef = longitude < 0 ? "W" : "E";
  }

  return result;
}

export function applyLocationPrivacy(
  location: LocationInfo | null,
  mode: LocationPrivacyMode,
): LocationInfo | null {
  if (!location || mode === "exact") return location;
  if (mode === "strip") return null;
  return {
    ...location,
    latitude: roundCoordinate(location.latitude),
    longitude: roundCoordinate(location.longitude),
  };
}

export function applyPhotoLocationPrivacy(
  photo: PhotoManifestItem,
  mode: LocationPrivacyMode,
): PhotoManifestItem {
  return {
    ...photo,
    exif: applyExifLocationPrivacy(photo.exif, mode),
    location: applyLocationPrivacy(photo.location, mode),
    processing: {
      ...photo.processing,
      privacy: locationPrivacyFingerprint(mode),
    },
  };
}

/**
 * Enforce the selected policy on every publication path, including legacy
 * manifests that predate processing fingerprints.
 */
export function applyManifestLocationPrivacy(
  manifest: AfilmoryManifest,
  mode: LocationPrivacyMode,
): AfilmoryManifest {
  return {
    ...manifest,
    photos: manifest.photos.map((photo) =>
      applyPhotoLocationPrivacy(photo, mode),
    ),
  };
}
