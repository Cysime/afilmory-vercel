import { describe, expect, it } from "vitest";

import {
  createPhotoId,
  findPhotoIdCollisionKeys,
  resolveStablePhotoId,
} from "./id.js";

describe("photo id helpers", () => {
  it("detects basename collisions across different directories", () => {
    expect(
      findPhotoIdCollisionKeys([
        "album-a/IMG_0001.JPG",
        "album-b/IMG_0001.JPG",
        "album-c/IMG_0002.JPG",
      ]),
    ).toEqual(new Set(["album-a/IMG_0001.JPG", "album-b/IMG_0001.JPG"]));
  });

  it("adds a stable digest only when requested", () => {
    expect(createPhotoId("album-a/IMG_0001.JPG")).toBe("IMG_0001");

    const first = createPhotoId("album-a/IMG_0001.JPG", { forceDigest: true });
    const second = createPhotoId("album-b/IMG_0001.JPG", { forceDigest: true });

    expect(first).toMatch(/^IMG_0001_[a-f0-9]{8}$/);
    expect(second).toMatch(/^IMG_0001_[a-f0-9]{8}$/);
    expect(first).not.toBe(second);
  });

  it("uses portable separators and filesystem-safe stems", () => {
    expect(createPhotoId("albums\\trip\\sunset.jpg")).toBe("sunset");
    expect(createPhotoId("albums/a:b?.jpg")).toBe("a_b_");
    expect(createPhotoId("CON.jpg")).toBe("_CON");
    const longId = createPhotoId(`${"摄影".repeat(100)}.jpg`);
    expect(Buffer.byteLength(longId)).toBeLessThanOrEqual(96);
    expect(createPhotoId(`${"摄影".repeat(100)}.jpg`)).toBe(longId);
  });

  it("treats case and Unicode-normalisation aliases as collisions", () => {
    const keys = [
      "a/Photo.jpg",
      "b/photo.png",
      "c/Cafe\u0301.jpg",
      "d/Caf\u00e9.png",
    ];
    expect(findPhotoIdCollisionKeys(keys)).toEqual(new Set(keys));
  });

  it("keeps published IDs stable through a 1 → 2 → 1 basename collision", () => {
    const originalKey = "album-a/sunset.jpg";
    const newcomerKey = "album-b/sunset.jpg";
    const original = { id: resolveStablePhotoId(originalKey) };
    expect(original.id).toBe("sunset");

    const collisionKeys = findPhotoIdCollisionKeys([originalKey, newcomerKey]);
    const originalDuringCollision = resolveStablePhotoId(
      originalKey,
      original,
      { hasCollision: collisionKeys.has(originalKey) },
    );
    const newcomer = resolveStablePhotoId(newcomerKey, undefined, {
      hasCollision: collisionKeys.has(newcomerKey),
    });

    expect(originalDuringCollision).toBe("sunset");
    expect(newcomer).toMatch(/^sunset_[a-f0-9]{8}$/);
    expect(newcomer).not.toBe(originalDuringCollision);
    // Removing the conflicting photo does not migrate the surviving ID or its
    // thumbnail basename back and forth.
    expect(resolveStablePhotoId(originalKey, original)).toBe("sunset");
    expect(resolveStablePhotoId(newcomerKey, { id: newcomer })).toBe(newcomer);
  });
});
