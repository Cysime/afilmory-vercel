import { execFileSync } from "node:child_process";

export interface ProjectPackageMetadata {
  version?: string;
  repository?: { url?: string } | string;
}

export interface ResolveBuildMetadataOptions {
  env?: NodeJS.ProcessEnv;
  execGit?: (args: string[]) => string;
  metadata?: ProjectPackageMetadata;
  now?: Date;
}

export interface ResolvedBuildMetadata {
  appName: "Afilmory";
  builtDate: string;
  gitCommitHash?: string;
  licenseUrl: string;
  sourceDirty: boolean;
  sourceExact: boolean;
  sourceUrl: string;
  version: string;
}

const DEFAULT_REPOSITORY_URL = "https://github.com/vsxd/afilmory-vercel";

// Only paths capable of changing the shipped program or its reproducible
// build are considered here. Builder output (manifest, thumbnails, originals)
// is content, and precheck is intentionally allowed to refresh it during a
// clean deployment build without invalidating the Project Code revision.
const PROJECT_SOURCE_PATHS = [
  "apps/web/index.html",
  "apps/web/package.json",
  "apps/web/plugins",
  "apps/web/scripts",
  "apps/web/src",
  "apps/web/vite.config.ts",
  "builder.config.ts",
  "env.ts",
  "locales",
  "package.json",
  "packages",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts",
  "site.config.build.ts",
  "site.config.ts",
  "tsconfig.base.json",
  "tsconfig.json",
  "tsconfig.tools.json",
  "vercel.json",
] as const;

const defaultExecGit = (args: string[]): string =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

export function normalizeRepositoryUrl(
  value: string | undefined,
): string | null {
  const candidate = value?.trim().replace(/^git\+/, "");
  if (!candidate) return null;

  const scpMatch = /^(?:[^@]+@)?([^:/]+):(.+)$/.exec(candidate);
  const urlValue =
    scpMatch && !candidate.includes("://")
      ? `https://${scpMatch[1]}/${scpMatch[2]}`
      : candidate;

  try {
    const url = new URL(urlValue);
    if (
      !(["http:", "https:", "ssh:"] as const).includes(url.protocol as never)
    ) {
      return null;
    }
    url.protocol = "https:";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\.git$/i, "").replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizePublicUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // These URLs are published in HTML and must remain durably accessible.
    // Silently stripping a signed query or credentials could turn a private
    // URL into a 404 while still marking it as exact and bypassing CI safety.
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const createRevisionUrl = (
  repositoryUrl: string,
  revision: string,
  kind: "source" | "license",
): string => {
  const host = new URL(repositoryUrl).hostname.toLowerCase();
  const encodedRevision = encodeURIComponent(revision);
  const action = kind === "source" ? "tree" : "blob";
  const prefix = host.includes("gitlab") ? "/-/" : "/";
  const suffix = kind === "license" ? "/LICENSE" : "";
  return `${repositoryUrl}${prefix}${action}/${encodedRevision}${suffix}`;
};

export function resolveBuildMetadata(
  options: ResolveBuildMetadataOptions = {},
): ResolvedBuildMetadata {
  const sourceEnv = options.env ?? process.env;
  const execGit = options.execGit ?? defaultExecGit;
  const repositoryValue =
    typeof options.metadata?.repository === "string"
      ? options.metadata.repository
      : options.metadata?.repository?.url;

  let gitRemoteUrl: string | undefined;
  try {
    gitRemoteUrl = execGit(["remote", "get-url", "origin"]);
  } catch {
    // Source archives and hermetic builds may have no Git metadata.
  }

  const githubRepositoryUrl =
    sourceEnv.GITHUB_REPOSITORY &&
    `${sourceEnv.GITHUB_SERVER_URL || "https://github.com"}/${sourceEnv.GITHUB_REPOSITORY}`;
  const vercelRepositoryUrl =
    sourceEnv.VERCEL_GIT_REPO_OWNER &&
    sourceEnv.VERCEL_GIT_REPO_SLUG &&
    `https://github.com/${sourceEnv.VERCEL_GIT_REPO_OWNER}/${sourceEnv.VERCEL_GIT_REPO_SLUG}`;
  const repositoryUrl = [
    sourceEnv.AFILMORY_SOURCE_URL,
    githubRepositoryUrl || undefined,
    vercelRepositoryUrl || undefined,
    gitRemoteUrl,
    repositoryValue,
    DEFAULT_REPOSITORY_URL,
  ]
    .map(normalizeRepositoryUrl)
    .find(Boolean)!;

  let gitCommitHash =
    sourceEnv.VERCEL_GIT_COMMIT_SHA || sourceEnv.GITHUB_SHA || "";
  if (!gitCommitHash) {
    try {
      gitCommitHash = execGit(["rev-parse", "HEAD"]);
    } catch {
      // A source archive can still link to its configured default branch.
    }
  }
  const sourceRevision =
    gitCommitHash ||
    sourceEnv.VERCEL_GIT_COMMIT_REF ||
    sourceEnv.GITHUB_REF_NAME ||
    "main";
  let sourceDirty = false;
  try {
    sourceDirty = Boolean(
      execGit([
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        ...PROJECT_SOURCE_PATHS,
      ]).trim(),
    );
  } catch {
    // Source archives and CI providers without a .git directory rely on the
    // explicit revision metadata below.
  }

  const correspondingSourceUrl = normalizePublicUrl(
    sourceEnv.AFILMORY_CORRESPONDING_SOURCE_URL,
  );
  const sourceExact = Boolean(
    correspondingSourceUrl || (gitCommitHash && !sourceDirty),
  );
  const licenseUrl =
    normalizePublicUrl(sourceEnv.AFILMORY_LICENSE_URL) ??
    createRevisionUrl(repositoryUrl, sourceRevision, "license");

  return {
    appName: "Afilmory",
    version: options.metadata?.version || "0.0.0",
    builtDate: (options.now ?? new Date()).toISOString(),
    gitCommitHash: gitCommitHash || undefined,
    sourceDirty,
    sourceExact,
    sourceUrl:
      correspondingSourceUrl ??
      (sourceDirty
        ? repositoryUrl
        : createRevisionUrl(repositoryUrl, sourceRevision, "source")),
    licenseUrl,
  };
}

const isEnabled = (value: string | undefined): boolean =>
  ["1", "true", "yes"].includes(value?.trim().toLowerCase() ?? "");

export function assertPublishableSourceMetadata(
  metadata: ResolvedBuildMetadata,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): void {
  const exactSourceRequired =
    isEnabled(sourceEnv.CI) ||
    isEnabled(sourceEnv.VERCEL) ||
    isEnabled(sourceEnv.AFILMORY_REQUIRE_EXACT_SOURCE);
  if (!exactSourceRequired || metadata.sourceExact) return;

  throw new Error(
    "The deployment source is not reproducible from the advertised revision. " +
      "Commit/stage Project Code before publishing, or set " +
      "AFILMORY_CORRESPONDING_SOURCE_URL to a public archive/tree containing the exact deployed source.",
  );
}
