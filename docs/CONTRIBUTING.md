# Contributing

## Setup

This repository is a pnpm workspace. The main app is `apps/web`; photo processing lives in `packages/builder`; shared manifest/photo schema lives in `packages/schema`; pure media helpers live in `packages/media`.

Prerequisites:

- Node.js `^20.19.0 || >=22.12.0`
- pnpm 10.19.0

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

## Common Commands

```bash
pnpm dev
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

`pnpm dev` and `pnpm build` run `apps/web/scripts/precheck.ts` first. With `PHOTO_STORAGE_PROVIDER=local`, precheck refreshes from `LOCAL_PHOTOS_PATH` without S3 credentials. In the default S3 mode, `S3_BUCKET_NAME` is required; the access key and secret are optional as a pair, and omitting both uses the AWS SDK default credential chain. Missing required configuration may reuse an existing manifest outside strict production builds.

## Photo Manifest

- `pnpm build:manifest` runs the builder and writes `generated/photos-manifest.json` plus generated thumbnails.
- `pnpm build:web` builds only the Vite app and expects a manifest to already exist.
- `SKIP_MANIFEST_BUILD=true pnpm build` skips the builder intentionally.
- Production web builds load the manifest through `window.__AFILMORY__.manifest`; the default production mode emits a hashed `assets/photos-manifest.<hash>.json` file.
- Local-provider web builds copy `LOCAL_PHOTOS_PATH` into the static output under `LOCAL_PHOTOS_BASE_URL`; S3 originals remain remote.

## Before Opening a PR

Run:

```bash
pnpm lint
pnpm format:check
pnpm type-check
pnpm test
pnpm build
```

For photo viewer or WebGL changes, include the relevant viewer tests and `@afilmory/webgl-viewer` verification in the PR notes.
