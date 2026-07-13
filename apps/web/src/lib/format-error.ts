export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error === null) return "null";
  if (error === undefined) return "Unknown error";

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(error, (_key, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
    if (serialized) return serialized;
  } catch {
    // Fall through to a best-effort string conversion.
  }

  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
}
