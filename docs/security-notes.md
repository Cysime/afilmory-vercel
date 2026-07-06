# Security Notes

Working notes for security-relevant configuration that is intentionally *not*
in its ideal end state yet. Each section explains what the current state is,
why it is that way, and what a verified path forward looks like.

## CSP: why `script-src` still contains `'unsafe-inline'`

Status: **documented trade-off, no config change yet.** Any change to the CSP
can only be validated on a real Vercel deployment (headers come from
`vercel.json`, which local dev and preview servers do not apply), so this
section is the design basis for a future deploy-tested change — not a TODO to
be done blind.

### Current policy

`vercel.json` sends on every path:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval'
             https://static.cloudflareinsights.com https://va.vercel-scripts.com;
  worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' blob: data: https:;
  connect-src 'self' blob: https:;
  media-src 'self' blob: https:;
  object-src 'none'; base-uri 'self'; form-action 'self';
```

### Why `'unsafe-inline'` is currently required

The production `index.html` deliberately carries inline `<script>` content
(see `apps/web/index.html` and `apps/web/plugins/vite/data-inject.ts`):

| Inline content | Source | Stable across builds? |
| --- | --- | --- |
| `#startup-metrics` script | authored in `index.html` | yes (changes only when the file is edited) |
| `#config` script | authored in `index.html` | yes |
| `#config-runtime` script | injected at build from `site.config.build.ts` | no — embeds site config JSON, which can derive from env (`SITE_URL`, …) |
| `#manifest` script | injected at build (`manifest-inline-snippet.ts`) | **no — embeds the per-build hashed manifest URL** `/assets/photos-manifest.<sha256-prefix>.json` |
| `onload="this.onload=null;this.rel='stylesheet'"` on the Google Fonts preload `<link>` | authored in `index.html` | yes, but it is an inline *event handler*, see below |

The `#manifest` script is the important one: it is the manifest
early-discovery mechanism. It starts a `fetch()` for the manifest while the
HTML is still being parsed, before any bundle loads. It was deliberately
chosen over `<link rel="preload">` because the preload duplicated the
download (~86 KB twice — the request parameters of a preload cannot match the
runtime `fetch`). Removing the inline script means either giving up early
discovery or paying an extra render-blocking request (option C below).

Because the manifest URL contains a hash of the manifest *content*, and the
manifest is produced by the photo builder at build time, the exact bytes of
this inline script are unknowable before the build runs.

### Why `'unsafe-eval'` must stay regardless

HEIC/HEIF originals are decoded client-side via `heic-to` (libheif compiled
to WebAssembly). Compiling that wasm requires eval-class permissions in
`script-src`. **`'wasm-unsafe-eval'` is not sufficient — it was tried and it
breaks HEIC decode** (see project memory / audit 2026-06-30); only the full
`'unsafe-eval'` keyword works with the current decoder. This is only
observable on a real Vercel deployment. So the realistic target policy is
"no `'unsafe-inline'`, keep `'unsafe-eval'`" — a meaningful improvement
(inline-injection XSS is the primary vector; `eval` is secondary hardening),
but not a pristine CSP.

### Why hash-based CSP is non-trivial here

1. **Static config vs per-build content.** `vercel.json` is a static file
   committed to the repository, while the `#manifest` (and `#config-runtime`)
   inline scripts change per build. Their `sha256-…` hashes cannot be
   pre-committed; they exist only after `pnpm build` has run.
2. **Hashes are all-or-nothing per directive.** In CSP2+, the presence of any
   hash or nonce in `script-src` makes browsers *ignore* `'unsafe-inline'`.
   There is no incremental migration: the moment one hash is added, every
   inline script that is not hashed stops executing. A partial rollout would
   take down the manifest bootstrap in production.
3. **Inline event handlers are not covered by hashes.** Script hashes
   authorize inline `<script>` *elements* only. The fonts-preload
   `onload="…"` attribute would additionally need `'unsafe-hashes'` (weaker,
   and still hash-maintenance) or a refactor to remove the inline handler.
4. **`style-src 'unsafe-inline'` is a separate problem.** The splash screen
   uses inline `<style>` blocks and `style=""` attributes, and React sets
   style attributes at runtime; those are unaffected by script hashes and are
   out of scope here.

### Mitigations currently in place

The inline scripts are not raw string concatenation:

- `escapeInlineScriptJson` (`apps/web/plugins/vite/data-inject.ts`) escapes
  `&`, `<`, `>`, U+2028 and U+2029 in every JSON payload injected into inline
  scripts, so a `</script>` breakout or HTML-comment injection cannot be
  smuggled through manifest or site-config data.
- The manifest is validated against the schema (`assertManifest`) before
  injection; the injected data derives from the operator's own photo storage
  and site config — there is **no third-party/user input** in any injected
  JSON. (EXIF strings from the operator's photos do pass through, which is
  exactly why the escaping above exists.)
- The externally-bundled `#manifest` snippet builder
  (`manifest-inline-snippet.ts`) hard-fails the build if the bundled output
  contains `</script` or `<!--`.
- Defense-in-depth headers in `vercel.json`: `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, HSTS with preload, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy`, and CSP
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `index.html` is served with `no-cache, no-store, must-revalidate`, so a
  future CSP/HTML change propagates immediately (no stale-hash window from
  cached HTML).

### Paths forward

**A. Rewrite `vercel.json` with computed hashes during the build.**
`scripts/build-static.sh` (the `buildCommand`) could, after `pnpm build`,
compute `sha256` of every inline script in `apps/web/dist/index.html` and
patch the CSP header value in `vercel.json`.

*Timing caveat — needs deploy verification.* `vercel.json` necessarily gets
parsed **before** the build (it defines `buildCommand` itself). What is not
documented is whether Vercel re-reads `headers`/`routes` from the workspace
copy of `vercel.json` **after** `buildCommand` finishes, or whether the whole
file is snapshotted when the deployment is created. Community reports
conflict, and we found no authoritative statement in Vercel's docs that
mutations made during the build are honored. **Do not assume this works;
verify with a throwaway deploy** (patch the header to a marker value during
build, then inspect the response header). If the snapshot interpretation is
correct, this approach is dead on arrival.

**B. Build Output API (`.vercel/output/config.json`).** This *is* the
documented mechanism for build-time-generated routing and headers: the build
emits `.vercel/output/config.json` (routes with `headers`) plus
`.vercel/output/static/`, and Vercel reads that config after the build by
design. Cost: restructuring the deploy output (today: `outputDirectory:
apps/web/dist` + declarative `vercel.json` headers/rewrites, which would all
need translating into Build Output routes). Bigger change, but it removes
the timing ambiguity of option A entirely. Also needs a verification deploy,
of course.

**C. Move the inline scripts to hashed external files.** Emit
`startup-metrics.[hash].js`, `config-runtime.[hash].js` and a
`manifest-bootstrap.[hash].js` (which contains the per-build manifest URL)
as regular assets; then `script-src 'self' …` covers them with **no hashes
in the header at all**, and `'unsafe-inline'` can be dropped from
`script-src` without touching `vercel.json` at deploy time. Costs:
- the manifest early-discovery fetch now starts only after an extra
  round-trip for the bootstrap script (mitigated on repeat visits by
  immutable caching, but the first-visit win of the inline script is
  reduced — measure before/after with the startup marks);
- `startup-metrics` loses its earliest-possible measurement point;
- the fonts-preload inline `onload` handler must still be removed
  (external hashed files do nothing for event handler attributes).

**D. Nonces: not possible.** This is a fully static deployment; `index.html`
is a cached static file, and there is no per-request server to mint nonces.

### Recommendation

Option C is the only one that keeps `vercel.json` static and needs no
platform-behavior verification beyond the CSP itself; its cost is measurable
startup latency and should be judged against the startup-metrics marks.
Option B is the correct choice if we ever need other build-time-computed
headers. Option A should only be attempted after the marker-value experiment
described above. In every option, the final `script-src` keeps
`'unsafe-eval'` (HEIC wasm) and the third-party analytics hosts, and the
fonts-preload `onload` attribute must be refactored away first.

Any change here **must** be validated on a real Vercel deployment:
load a gallery with HEIC originals (exercises `'unsafe-eval'`), confirm the
manifest bootstrap runs (no CSP violations in the console), and check the
fonts swap.
