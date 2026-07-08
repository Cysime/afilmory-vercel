import en from "@locales/app/en.json";
import { describe, expect, it } from "vitest";

// Characterization guard against locale-key drift.
//
// The custom eslint rules (check-i18n-json/valid-i18n-keys, no-extra-keys)
// only compare locale JSON files against each other — nothing compares
// en.json with what the code actually references. This test does a
// grep-level scan of apps/web/src and diffs both directions:
//
//   1. missing — a key referenced in code but absent from en.json renders
//      as the raw key string in the UI;
//   2. orphans — en.json keys no code references are dead weight shipped in
//      every locale bundle, and they re-accumulate after feature removals.
//
// How to fix a failure:
//   - new orphan after removing a feature: delete the key from ALL files in
//     locales/app/ (no-extra-keys requires non-English locales to stay a
//     subset of en.json, so remove en.json entries last or together);
//   - missing key after adding a t() call: add the key to en.json (other
//     locales fall back to en until translated);
//   - new dynamic t(`...${x}`) call: add its static prefix to
//     TEMPLATE_KEY_PREFIXES below with a comment naming the call site.

// Raw text of every module under apps/web/src, resolved at transform time
// (same mechanism i18n.ts uses for locale bundles — works in jsdom where
// import.meta.url is not a file: URL).
const rawSources = import.meta.glob<string>("../**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});

// Tests and test infrastructure must not keep a key alive: a key only
// mentioned by a test is still dead weight in the production bundle.
const isExcludedSource = (relativePath: string): boolean =>
  relativePath.includes("/__tests__/") ||
  relativePath.includes("/__mocks__/") ||
  relativePath.startsWith("../test/") ||
  /\.test\.tsx?$/.test(relativePath);

// Any quoted string literal. Deliberately generous for the orphan direction:
// a key mentioned anywhere in production source counts as referenced — this
// also covers keys that reach t() indirectly, e.g. FloatingActionButton's
// typed `title: "action.view.settings"` config or ternaries inside t(...).
const STRING_LITERAL_RE = /(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;

// Literal first argument of a t() call — the \b boundary matches bare `t(`,
// `translator.t(`, `i18n.t(` alike. Used for the strict "missing" direction.
const T_CALL_RE = /\bt\(\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;

// Template-literal t() calls build keys at runtime; each one's static prefix
// must be covered by TEMPLATE_KEY_PREFIXES (asserted below).
const T_TEMPLATE_CALL_RE = /\bt\(\s*`([^`]*)`/g;

// `translationKey: "..."` / `translationKey="..."` flow into t(translationKey)
// via ExifFieldGroup (RawExifViewer category headers), so they count as
// strict key usages too.
const TRANSLATION_KEY_PROP_RE =
  /\btranslationKey\s*[:=]\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;

interface TemplateCall {
  file: string;
  staticPrefix: string;
  template: string;
}

interface ScanResult {
  files: string[];
  referencedLiterals: Set<string>;
  templateCalls: TemplateCall[];
  /** key -> source files (relative to src) that reference it via t()-style calls */
  usedKeys: Map<string, string[]>;
}

const scanSources = (): ScanResult => {
  const files = Object.keys(rawSources).filter(
    (relativePath) => !isExcludedSource(relativePath),
  );
  const referencedLiterals = new Set<string>();
  const usedKeys = new Map<string, string[]>();
  const templateCalls: TemplateCall[] = [];

  const recordUsedKey = (key: string, file: string) => {
    const existing = usedKeys.get(key);
    if (existing) {
      if (!existing.includes(file)) existing.push(file);
    } else {
      usedKeys.set(key, [file]);
    }
  };

  for (const filePath of files) {
    const source = rawSources[filePath];
    const relativePath = filePath.replace(/^\.\.\//, "");

    for (const match of source.matchAll(STRING_LITERAL_RE)) {
      referencedLiterals.add(match[2]);
    }
    for (const match of source.matchAll(T_CALL_RE)) {
      recordUsedKey(match[2], relativePath);
    }
    for (const match of source.matchAll(TRANSLATION_KEY_PROP_RE)) {
      recordUsedKey(match[2], relativePath);
    }
    for (const match of source.matchAll(T_TEMPLATE_CALL_RE)) {
      templateCalls.push({
        file: relativePath,
        staticPrefix: match[1].split("${")[0],
        template: match[1],
      });
    }
  }

  return { files, referencedLiterals, templateCalls, usedKeys };
};

// ---------------------------------------------------------------------------
// Allowlist of dynamically-built key prefixes (orphan direction only).
// Keys under these prefixes are assembled from runtime values, so a static
// scan cannot see them. Every entry documents the call site that builds it.
// ---------------------------------------------------------------------------
const TEMPLATE_KEY_PREFIXES = [
  // components/ui/date-range-indicator/DateRangeIndicator.tsx —
  // t(`date.day.${day}`): ordinal day-of-month labels (date.day.1 … 31).
  "date.day.",
  // components/ui/date-range-indicator/DateRangeIndicator.tsx —
  // t(`date.month.${month}`): month names (date.month.1 … 12).
  "date.month.",
  // components/ui/map/MapInfoPanel.tsx —
  // t(`explore.region.level.${regionLevel}`): level comes from geocoding data.
  "explore.region.level.",
];

// components/ui/photo-viewer/formatExifData.ts builds
// `exif.${category}.${normalizedValue}` keys from runtime EXIF values, one
// translator per createTranslator("<category>") call (exposure.mode,
// white.balance, flash, fujirecipe-*, …). Derive the category list from the
// source itself so renaming or adding a category cannot silently orphan (or
// falsely orphan) its value keys.
const formatExifDataSource =
  rawSources["../components/ui/photo-viewer/formatExifData.ts"] ?? "";
const exifValuePrefixes = [
  ...formatExifDataSource.matchAll(/createTranslator\(\s*["']([^"']+)["']/g),
].map((match) => `exif.${match[1]}.`);

const DYNAMIC_KEY_PREFIXES = [...TEMPLATE_KEY_PREFIXES, ...exifValuePrefixes];

// i18next pluralization: t("k", { count }) resolves to k_one / k_other
// (CLDR plural categories), so the base key never appears in en.json and
// the suffixed keys never appear in code.
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];
const PLURAL_SUFFIX_RE = /_(?:zero|one|two|few|many|other)$/;

// ---------------------------------------------------------------------------
// Pinned baseline of pre-existing orphans found when this test was introduced
// (2026-07-08). They ship as dead weight in all six locale bundles. This list
// is shrink-only: never add to it — delete entries (and the keys from
// locales/app/*.json) as they get cleaned up.
// ---------------------------------------------------------------------------
const KNOWN_ORPHANS = new Set([
  "action.camera.clear",
  "action.camera.empty",
  "action.camera.not-found",
  "action.camera.search",
  "action.lens.clear",
  "action.lens.empty",
  "action.lens.not-found",
  "action.lens.search",
  "action.search.filter.no-results",
  "action.search.filter.placeholder",
  "action.search.hint",
  "action.search.preset.all",
  "action.search.results",
  "action.search.title",
  "action.tag.clear",
  "action.tag.empty",
  "action.tag.not-found",
  "action.tag.search",
  "action.view.github",
  "action.view.layout",
  "error.feedback",
  "error.reload",
  "error.submit.issue",
  "error.temporary.description",
  "error.title",
  "exif.auto.white.balance.grb",
  "exif.blue.adjustment",
  "exif.custom.rendered.normal",
  "exif.custom.rendered.special",
  "exif.custom.rendered.type",
  "exif.digital.zoom",
  "exif.gps.location.name",
  "exif.gps.view.map",
  "exif.red.adjustment",
  "exif.resolution.unit.cm",
  "exif.resolution.unit.inches",
  "exif.resolution.unit.none",
  "exif.standard.white.balance.grb",
  "exif.unknown",
  "explore.clear.selection",
  "explore.cluster.locations_one",
  "explore.cluster.locations_other",
  "explore.range.separator",
  "gallery.photos_one",
  "gallery.photos_other",
  "photo.conversion.webcodecs",
  "photo.live.converting.detail",
  "photo.live.converting.video",
  "photo.reaction.success",
  "video.format.mov.not.supported",
  "video.format.mov.supported",
]);

const enKeys = new Set(Object.keys(en));
const scan = scanSources();

describe("i18n key drift between en.json and apps/web/src", () => {
  it("treats en.json as a flat string-to-string bundle (scan relies on this shape)", () => {
    expect(enKeys.size).toBeGreaterThan(0);
    expect(Object.values(en).every((value) => typeof value === "string")).toBe(
      true,
    );
  });

  it("scans a non-trivial amount of source (guards against a silent no-op scanner)", () => {
    expect(scan.files.length).toBeGreaterThan(100);
    expect(scan.usedKeys.size).toBeGreaterThan(100);
    // formatExifData.ts declares one translator per EXIF category; losing
    // them all means the derivation above broke, not that they were removed.
    expect(exifValuePrefixes.length).toBeGreaterThanOrEqual(8);
  });

  it("covers every dynamic t(`...`) call with an allowlisted prefix", () => {
    const uncovered = scan.templateCalls
      .filter(
        ({ staticPrefix }) =>
          !TEMPLATE_KEY_PREFIXES.some((prefix) =>
            staticPrefix.startsWith(prefix),
          ),
      )
      .map(({ file, template }) => `\`${template}\` in ${file}`);

    expect(
      uncovered,
      "dynamic t() calls whose prefix is not in TEMPLATE_KEY_PREFIXES — document and allowlist them",
    ).toEqual([]);
  });

  it("references no key that is missing from en.json (missing keys render as raw key strings)", () => {
    const missing = [...scan.usedKeys.entries()]
      .filter(
        ([key]) =>
          !enKeys.has(key) &&
          // plural usage: t("k", { count }) is satisfied by k_one / k_other
          !PLURAL_SUFFIXES.some((suffix) => enKeys.has(`${key}_${suffix}`)),
      )
      .map(([key, files]) => `${key} (referenced in ${files.join(", ")})`)
      .sort();

    expect(missing, "keys used in code but absent from en.json").toEqual([]);
  });

  it("keeps en.json free of unreferenced keys beyond the pinned baseline", () => {
    const isReferenced = (key: string): boolean =>
      scan.referencedLiterals.has(key) ||
      // plural forms are referenced through their base key
      scan.referencedLiterals.has(key.replace(PLURAL_SUFFIX_RE, "")) ||
      DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

    const orphans = new Set([...enKeys].filter((key) => !isReferenced(key)));

    const newOrphans = [...orphans]
      .filter((key) => !KNOWN_ORPHANS.has(key))
      .sort();
    expect(
      newOrphans,
      "newly orphaned en.json keys — delete them from all locales/app/*.json files (or allowlist their dynamic prefix)",
    ).toEqual([]);

    const staleBaseline = [...KNOWN_ORPHANS]
      .filter((key) => !orphans.has(key))
      .sort();
    expect(
      staleBaseline,
      "baseline entries that are no longer orphans — remove them from KNOWN_ORPHANS",
    ).toEqual([]);
  });
});
