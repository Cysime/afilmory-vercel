# @afilmory/media

Deliberately tiny, zero-dependency leaf package. It exists so that
`@afilmory/ui` can decode thumbhash bytes (hex string → `Uint8Array`) without
depending on `@afilmory/schema` — the manifest contract would otherwise leak
into the design system just for one codec.

## Exports

- `uint8ArrayToHex(bytes)` — encode bytes as a lowercase hex string.
- `hexToUint8Array(hex)` — decode a hex string back into bytes.

The names describe the data shapes, not a use case: this is a generic byte/hex
codec that happens to be used for thumbhash payloads today. Keep it that way —
anything thumbhash- or manifest-specific belongs in the consumer.

## Constraints

- **Zero runtime dependencies**, importable from the browser bundle, the
  builder, and one-off scripts alike.
- No build step: exports raw TypeScript (`./src/index.ts`).
- Stay a leaf: this package must not import any other workspace package,
  otherwise it stops being safe as a lowest-level shared dependency.
