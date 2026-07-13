import { access, stat } from "node:fs/promises";
import path from "node:path";

import type { Tags } from "exiftool-vendored";
import { describe, expect, it, vi } from "vitest";

import {
  extractExifData,
  extractFujiRecipe,
  extractSonyRecipe,
  handleExifData,
} from "./exif.js";

const exifLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../photo/logger-adapter.js", () => ({
  getPhotoProcessingLoggers: () => ({ exif: exifLogger }),
}));

describe("EXIF normalization helpers", () => {
  it("extracts typed Fuji and Sony recipe fields", () => {
    const tags = {
      ColorChromeFXBlue: "Weak",
      CreativeStyle: "VV",
      DevelopmentDynamicRange: 400,
      DynamicRangeSetting: "Manual",
      FilmMode: "Classic Chrome",
      GrainEffectRoughness: "Strong",
      Hdr: "Auto",
      PictureEffect: "Off",
      SoftSkinEffect: "Off",
      WhiteBalance: 5200,
    } as Tags;

    expect(extractFujiRecipe(tags)).toMatchObject({
      ColorChromeFxBlue: "Weak",
      DevelopmentDynamicRange: 400,
      DynamicRangeSetting: "Manual",
      FilmMode: "Classic Chrome",
      GrainEffectRoughness: "Strong",
      WhiteBalance: "5200",
    });
    expect(extractSonyRecipe(tags)).toEqual({
      CreativeStyle: "VV",
      Hdr: "Auto",
      PictureEffect: "Off",
      SoftSkinEffect: "Off",
    });
  });

  it("keeps only picked manifest fields and normalized recipe data", () => {
    const tags = {
      DateTimeOriginal: "2026-06-06T00:00:00.000Z",
      ExifImageHeight: 200,
      ExifImageWidth: 300,
      FilmMode: "Classic Negative",
      Make: "FUJIFILM",
      Model: "X-T5",
      NonManifestField: "drop-me",
      WhiteBalance: "Auto",
    } as Tags & { NonManifestField: string };

    const normalized = handleExifData(tags);

    expect(normalized).toMatchObject({
      DateTimeOriginal: "2026-06-06T00:00:00.000Z",
      FujiRecipe: {
        FilmMode: "Classic Negative",
        WhiteBalance: "Auto",
      },
      ImageHeight: 200,
      ImageWidth: 300,
      Make: "FUJIFILM",
      Model: "X-T5",
    });
    expect("NonManifestField" in normalized).toBe(false);
  });

  it("uses a private temporary directory and file for source bytes", async () => {
    let tempPath = "";
    let directoryMode = 0;
    let fileMode = 0;
    await extractExifData(
      {
        close: vi.fn(),
        read: vi.fn(async (filePath) => {
          tempPath = filePath;
          directoryMode = (await stat(path.dirname(filePath))).mode & 0o777;
          fileMode = (await stat(filePath)).mode & 0o777;
          return { SourceFile: filePath } as Tags;
        }),
      },
      Buffer.from("jpeg"),
    );

    if (process.platform !== "win32") {
      expect(directoryMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
    }
    await expect(access(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
