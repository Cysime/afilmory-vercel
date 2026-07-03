# @afilmory/ui

Project-internal design system for `apps/web`. It is not a general-purpose
component library: components exist because the gallery needs them, and their
APIs track the app's needs rather than a public contract.

## Consumers

- `apps/web` — the only real consumer. Its Tailwind entry scans this package
  via `@source "../../node_modules/@afilmory/ui"`, so class names written here
  are picked up without a build step.

## Conventions

- Directory per component (`button/`, `dialog/`, `thumbhash/`, ...), exported
  through the barrel `src/index.ts`.
- Styling is Tailwind utility classes; variants go through `tailwind-variants`.
- Animation uses `motion` (`m.*` components); Radix primitives underneath
  where they earn their keep.

## Rules

- **No app state.** Nothing here may import jotai atoms, i18n, the router, or
  any `apps/web` module — data and user-facing strings come in through props.
- No build step: exports raw TypeScript (`./src/index.ts`). Modules must stay
  import-pure (`sideEffects: false`); module-level caches are fine, global
  mutation on import is not.
