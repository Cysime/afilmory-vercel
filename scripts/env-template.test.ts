import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const templatePath = path.join(rootDir, ".env.template");

describe(".env.template contract", () => {
  it("preserves hash-prefixed values when parsed by dotenv", () => {
    const parsed = parse(fs.readFileSync(templatePath));
    expect(parsed.SITE_ACCENT_COLOR).toBe("#007bff");
  });

  it("passes the real environment schema in a clean subprocess", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        "await import('./env.ts')",
      ],
      {
        cwd: rootDir,
        encoding: "utf-8",
        env: {
          CI: "true",
          DOTENV_CONFIG_PATH: templatePath,
          DOTENV_CONFIG_QUIET: "true",
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
