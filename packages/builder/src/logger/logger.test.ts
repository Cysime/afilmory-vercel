import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  addLogListener,
  configureLoggerObservability,
  logger,
  setConsoleForwarding,
  setLogListener,
} from "./logger.js";

describe("builder logger observability", () => {
  afterEach(() => {
    setLogListener(null, { forwardToConsole: true });
    configureLoggerObservability({
      level: "info",
      outputToFile: false,
      verbose: false,
    });
  });

  it("allows a persistent sink to coexist with the replaceable TUI sink", () => {
    setConsoleForwarding(false);
    const primary: string[] = [];
    const additional: string[] = [];
    setLogListener((message) => primary.push(message.tag));
    const remove = addLogListener((message) => additional.push(message.tag));

    logger.main.info("hello");
    remove();
    logger.s3.info("after cleanup");

    expect(primary).toEqual(["MAIN", "S3"]);
    expect(additional).toEqual(["MAIN"]);
  });

  it("applies level filtering and writes a private file sink", async () => {
    setConsoleForwarding(false);
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "afilmory-logger-"),
    );
    const logFilePath = path.join(directory, "nested", "builder.log");
    const cleanup = configureLoggerObservability({
      level: "warn",
      logFilePath,
      outputToFile: true,
      verbose: false,
    });

    logger.main.info("not persisted");
    logger.main.warn("persisted warning", { count: 2 });
    cleanup();

    const contents = await fs.readFile(logFilePath, "utf8");
    expect(contents).toContain('persisted warning {"count":2}');
    expect(contents).not.toContain("not persisted");
    if (process.platform !== "win32") {
      expect((await fs.stat(logFilePath)).mode & 0o777).toBe(0o600);
    }
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("lets verbose mode include trace logs", () => {
    const cleanup = configureLoggerObservability({
      level: "error",
      outputToFile: false,
      verbose: true,
    });
    expect(logger.main.level).toBe(5);
    cleanup();
  });
});
