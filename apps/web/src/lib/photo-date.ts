import type { PhotoManifestItem } from "@afilmory/schema";

/**
 * Extract a Date object from a photo's EXIF DateTimeOriginal or lastModified.
 * EXIF date format: "YYYY:MM:DD HH:mm:ss" or ISO string
 */
export function getPhotoDate(photo: PhotoManifestItem): Date {
  if (photo.exif?.DateTimeOriginal) {
    const dateStr = photo.exif.DateTimeOriginal;
    // EXIF date format "YYYY:MM:DD HH:mm:ss" → "YYYY-MM-DD HH:mm:ss"
    const formattedDateStr = dateStr.replace(
      /^(\d{4}):(\d{2}):(\d{2})/,
      "$1-$2-$3",
    );
    const date = new Date(formattedDateStr);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date(photo.lastModified);
}

// 排序时每张照片会被比较 O(log n) 次，按 manifest item 标识备忘解析结果。
const photoSortTimeCache = new WeakMap<PhotoManifestItem, number>();

/**
 * Millisecond timestamp for sorting photos by date. Goes through getPhotoDate
 * so raw-EXIF ("YYYY:MM:DD HH:mm:ss") and ISO dates order consistently;
 * unparsable dates collapse to 0 to keep the comparator consistent.
 */
export function getPhotoSortTime(photo: PhotoManifestItem): number {
  let time = photoSortTimeCache.get(photo);
  if (time === undefined) {
    const parsed = getPhotoDate(photo).getTime();
    time = Number.isNaN(parsed) ? 0 : parsed;
    photoSortTimeCache.set(photo, time);
  }
  return time;
}
