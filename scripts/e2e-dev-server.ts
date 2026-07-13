/** Hermetic Playwright dev-server entrypoint. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createE2EWebEnvironment } from "./e2e-web-environment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "apps/web");
const host = "127.0.0.1";
const port = process.env.E2E_DEV_PORT ?? "1925";

const webRequire = createRequire(path.join(webDir, "package.json"));
const viteBin = path.join(
  path.dirname(webRequire.resolve("vite/package.json")),
  "bin/vite.js",
);

const server = spawn(
  process.execPath,
  [viteBin, "--mode", "e2e", "--host", host, "--port", port, "--strictPort"],
  {
    cwd: webDir,
    env: createE2EWebEnvironment({ embedManifest: true }),
    stdio: "inherit",
  },
);

let stopping = false;

server.once("error", (error) => {
  console.error(`[e2e] Failed to start Vite dev server: ${error.message}`);
  process.exitCode = 1;
});
server.once("exit", (code) => {
  process.exitCode = code ?? 0;
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.kill(signal);
  });
}
