export function encodeStorageKeyForUrl(key: string): string {
  return key
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function isSafeHttpBaseUrl(value: string): boolean {
  if (value !== value.trim() || /[\\\s]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.href.includes("?") &&
      !url.href.includes("#")
    );
  } catch {
    return false;
  }
}

export function assertSafeHttpBaseUrl(value: string, name: string): void {
  if (!isSafeHttpBaseUrl(value)) {
    throw new Error(
      `${name} must be an http(s) URL without credentials, query parameters, or a fragment`,
    );
  }
}

export function joinPublicUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${encodeStorageKeyForUrl(key)}`;
}
