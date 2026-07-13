import crypto from "node:crypto";

export const DEFAULT_COLLISION_DIGEST_LENGTH = 8;
const MAX_BASE_ID_BYTES = 96;

function truncatePortableStem(stem: string): string {
  if (Buffer.byteLength(stem, "utf8") <= MAX_BASE_ID_BYTES) return stem;
  const suffix = crypto
    .createHash("sha256")
    .update(stem)
    .digest("hex")
    .slice(0, 12);
  const budget = MAX_BASE_ID_BYTES - suffix.length - 1;
  let prefix = "";
  for (const character of stem) {
    if (Buffer.byteLength(prefix + character, "utf8") > budget) break;
    prefix += character;
  }
  return `${prefix}_${suffix}`;
}

function getPortableFileStem(storageKey: string): string {
  // Storage keys are POSIX/URL-like even when the builder runs on Windows.
  const normalizedKey = storageKey.replaceAll("\\", "/");
  const fileName = normalizedKey.slice(normalizedKey.lastIndexOf("/") + 1);
  const extensionIndex = fileName.lastIndexOf(".");
  const rawStem =
    extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;

  // IDs are materialised as thumbnail filenames. Make new IDs portable across
  // Windows, macOS and Linux while existing manifest IDs remain compatible via
  // AfilmoryBuilder.getPhotoIdForKey's reuse path.
  let stem = [...rawStem.normalize("NFC")]
    .map((character) =>
      (character.codePointAt(0) ?? 0) <= 0x1f ? "_" : character,
    )
    .join("")
    .replaceAll(/[<>:"/\\|?*]/g, "_")
    .replaceAll(/[. ]+$/g, "");
  if (!stem) stem = "photo";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) {
    stem = `_${stem}`;
  }
  return truncatePortableStem(stem);
}

export function getPhotoIdBaseName(storageKey: string): string {
  return getPortableFileStem(storageKey);
}

export function createPhotoId(
  storageKey: string,
  options: {
    digestSuffixLength?: number;
    forceDigest?: boolean;
  } = {},
): string {
  const baseName = getPhotoIdBaseName(storageKey);
  const configuredLength = options.digestSuffixLength ?? 0;
  const digestLength =
    configuredLength > 0
      ? configuredLength
      : options.forceDigest
        ? DEFAULT_COLLISION_DIGEST_LENGTH
        : 0;

  if (digestLength <= 0) {
    return baseName;
  }

  const digestSuffix = crypto
    .createHash("sha256")
    .update(storageKey)
    .digest("hex")
    .slice(0, digestLength);
  return `${baseName}_${digestSuffix}`;
}

export function findPhotoIdCollisionKeys(storageKeys: string[]): Set<string> {
  const keysByBaseName = new Map<string, string[]>();

  for (const key of storageKeys) {
    // Case-fold + Unicode-normalise for case-insensitive/APFS/NTFS targets.
    const collisionKey = getPhotoIdBaseName(key).normalize("NFC").toLowerCase();
    const keys = keysByBaseName.get(collisionKey);

    if (keys) {
      keys.push(key);
    } else {
      keysByBaseName.set(collisionKey, [key]);
    }
  }

  const collisionKeys = new Set<string>();

  for (const keys of keysByBaseName.values()) {
    if (keys.length <= 1) continue;

    for (const key of keys) {
      collisionKeys.add(key);
    }
  }

  return collisionKeys;
}
