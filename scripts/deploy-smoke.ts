/* eslint-disable no-console */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertManifest } from "@afilmory/schema";

import { createE2EWebEnvironment } from "./e2e-web-environment.js";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixturesDir = path.join(rootDir, "apps/web/e2e/fixtures");

export const createDeploySmokeEnvironment = (
  source: NodeJS.ProcessEnv = process.env,
  localPhotosPath = path.join(fixturesDir, "thumbnails"),
): NodeJS.ProcessEnv => ({
  ...createE2EWebEnvironment({ embedManifest: false, source }),
  LOCAL_PHOTOS_BASE_URL: "/originals",
  LOCAL_PHOTOS_PATH: localPhotosPath,
  PHOTO_STORAGE_PROVIDER: "local",
  REPO_TOKEN: "",
  REPO_URL: "",
  REQUIRE_FRESH_BUILD: "true",
  SKIP_MANIFEST_BUILD: "true",
});

const runDeployEntrypoint = async (localPhotosPath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("sh", ["scripts/build-static.sh"], {
      cwd: rootDir,
      env: createDeploySmokeEnvironment(process.env, localPhotosPath),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-static.sh exited with code ${code}`));
    });
  });

const createLocalPhotoFixture = async (): Promise<string> => {
  const fixtureRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "afilmory-deploy-smoke-"),
  );
  const manifest = assertManifest(
    JSON.parse(
      await fs.readFile(
        path.join(fixturesDir, "photos-manifest.json"),
        "utf-8",
      ),
    ),
  );
  const sourceDirectory = path.join(fixturesDir, "thumbnails");
  const copyMedia = async (sourceName: string, destinationKey: string) => {
    const destination = path.resolve(fixtureRoot, destinationKey);
    if (
      destination !== fixtureRoot &&
      !destination.startsWith(`${fixtureRoot}${path.sep}`)
    ) {
      throw new Error(`synthetic media key escapes fixture: ${destinationKey}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(sourceDirectory, sourceName), destination);
  };
  for (const photo of manifest.photos) {
    await copyMedia(`${photo.id}.jpg`, photo.s3Key);
    if (photo.video?.type === "live-photo") {
      await copyMedia(`${photo.id}.webm`, photo.video.s3Key);
    }
  }
  return fixtureRoot;
};

const verifyDeployOutput = async (): Promise<void> => {
  const dist = path.join(rootDir, "apps/web/dist");
  const required = ["index.html", "feed.xml", "sitemap.xml", "sw.js"];
  for (const relativePath of required) {
    await fs.access(path.join(dist, relativePath));
  }
  const assets = await fs.readdir(path.join(dist, "assets"));
  if (
    !assets.some((name) =>
      /^(?:gallery-index|photos-manifest)\.[0-9a-f]{10}\.json$/.test(name),
    )
  ) {
    throw new Error("deploy output is missing its hashed delivery manifest");
  }
  const photoShell = path.join(dist, "photos", "SYNTH0001", "index.html");
  await fs.access(photoShell);
  await fs.access(path.join(dist, "originals/fixtures/SYNTH0001.jpg"));
};

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const localPhotoFixture = await createLocalPhotoFixture();
  try {
    await runDeployEntrypoint(localPhotoFixture);
    await verifyDeployOutput();
    console.info("Hermetic deployment smoke passed.");
  } finally {
    await fs.rm(localPhotoFixture, { force: true, recursive: true });
  }
}
