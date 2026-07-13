import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import { getStorageNS } from "~/lib/ns";

export type GallerySortOrder = "asc" | "desc";

export interface GallerySetting {
  sortOrder: GallerySortOrder;
  selectedTags: string[];
  selectedCameras: string[];
  selectedLenses: string[];
  selectedGeoCountries: string[];
  selectedGeoRegions: string[];
  selectedGeoCities: string[];
  selectedGeoDistricts: string[];
}

export const gallerySettingAtom = atom<GallerySetting>({
  sortOrder: "desc",
  selectedTags: [],
  selectedCameras: [],
  selectedLenses: [],
  selectedGeoCountries: [],
  selectedGeoRegions: [],
  selectedGeoCities: [],
  selectedGeoDistricts: [],
});

// 纯视图偏好，独立于 gallerySettingAtom：filterAndSortPhotos 按后者的
// 对象标识做 WeakMap 备忘，列数混进去会让每次调列数都击穿过滤缓存。
export const galleryColumnsAtom = atomWithStorage<number | "auto">(
  getStorageNS("gallery-columns:v1"),
  "auto",
);

// Command Palette state
export const isCommandPaletteOpenAtom = atom(false);
