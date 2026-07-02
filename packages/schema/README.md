# @afilmory/schema

The manifest contract. This package defines the `photos-manifest.json` types
and the parsing/validation logic that every producer (builder, scripts) and
consumer (web app, Vite plugins) must agree on.

## Parsing: strict vs lenient

There are two deliberate entry points, and they are not interchangeable:

- **`assertManifest` / `parseManifest` (strict)** — gates freshly built
  manifests. If the builder just produced it, it must validate; a failure here
  is a bug and should abort the build.
- **`parseManifestLenient`** — for untrusted or stale input: cached artifacts,
  previously deployed manifests, hand-edited files. It salvages every valid
  photo, reports the rest as `skippedPhotos`, and never throws on bad items.

Rule of thumb: fresh output → strict; anything read back from storage → lenient.

## Constraints

- **Zero runtime dependencies.** This package is imported by the browser
  bundle, the builder, and one-off scripts; keep it dependency-free.
- No build step: exports raw TypeScript (`./src/index.ts`).

## Subpaths

- `@afilmory/schema` — the manifest contract described above.
- `@afilmory/schema/types` — type-only imports of the manifest shapes.
- `@afilmory/schema/geo` — shared geo heuristics (locale scoring, admin-region
  normalization, geo filter matching). Deliberately a separate subpath: it is
  cross-package UI/locale logic, not part of the manifest contract, and is not
  re-exported from the barrel.
