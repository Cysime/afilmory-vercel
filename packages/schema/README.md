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

## Versioning

`CURRENT_MANIFEST_VERSION` is pinned in `src/version.ts`, and **both** parsers
hard-reject any other version. There is no migration code, deliberately:

- **Version bump = full rebuild.** The builder discards any cached manifest
  that fails to parse and regenerates from scratch; the web app surfaces a
  `BootstrapError` diagnostic page on a version mismatch. This is cheap because
  thumbnails regenerate incrementally via the `.encoding` signature marker and
  the artifact cache — only the manifest itself is rebuilt.
- **Bumping the version** therefore never needs migration logic, but the bump
  must be propagated. Grep list:
  - `packages/schema/src/version.ts` (the constant itself),
  - test fixtures and assertions across packages
    (grep `version: 2` / `"version": 2` / `toBe(2)`),
  - `apps/web/e2e/fixtures/photos-manifest.json` — regenerate it with
    `scripts/create-synthetic-e2e-fixture.ts` (`pnpm fixture:e2e`).

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
