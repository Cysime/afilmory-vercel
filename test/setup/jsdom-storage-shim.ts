// Node 22 exposes an experimental global localStorage getter that warns unless
// --localstorage-file is configured. Vitest deliberately preserves that global
// while installing jsdom, so application reads still hit Node's getter. A tiny
// in-memory Storage keeps browser-test semantics without touching that getter.
class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#values.set(String(key), String(value));
  }
}

if (typeof window !== "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: true,
    value: new MemoryStorage(),
    writable: false,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    enumerable: true,
    value: new MemoryStorage(),
    writable: false,
  });
}
