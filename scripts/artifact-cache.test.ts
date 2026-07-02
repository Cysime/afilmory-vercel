import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArtifactCacheConfig } from "./artifact-cache";
import { createAuthenticatedRepoUrl, saveArtifacts } from "./artifact-cache";

const TOKEN = "secret-token";

// 记录每次 spawn 的完整命令行，并允许每个用例按命令定制退出码/输出，
// 这样无需真实 git 仓库即可验证 save 的命令序列（orphan + force-push）。
const spawnState = vi.hoisted(() => ({
  recorded: [] as string[][],
  respond: (
    _args: string[],
  ): { code: number; stderr: string; stdout: string } => ({
    code: 0,
    stderr: "",
    stdout: "",
  }),
}));

/* eslint-disable unicorn/prefer-event-target -- ChildProcess 本身就是
   EventEmitter，这里刻意用它来模拟 spawn 返回值。 */
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: (command: string, args: string[]) => {
      spawnState.recorded.push([command, ...args]);
      const child = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        stdout: new EventEmitter(),
      });
      const { code, stderr, stdout } = spawnState.respond(args);
      process.nextTick(() => {
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        if (stderr) child.stderr.emit("data", Buffer.from(stderr));
        child.emit("close", code);
      });
      return child;
    },
  };
});
/* eslint-enable unicorn/prefer-event-target */

describe("createAuthenticatedRepoUrl", () => {
  it("embeds the token for https URLs", () => {
    const result = createAuthenticatedRepoUrl(
      "https://github.com/owner/repo.git",
      TOKEN,
    );
    expect(result).toBe(
      `https://x-access-token:${TOKEN}@github.com/owner/repo.git`,
    );
  });

  it("refuses to send the token over plaintext HTTP", () => {
    expect(() =>
      createAuthenticatedRepoUrl("http://example.com/repo.git", TOKEN),
    ).toThrow(/plaintext HTTP/);
  });

  it("does not leak the token in the thrown error message", () => {
    let message = "";
    try {
      createAuthenticatedRepoUrl("http://example.com/repo.git", TOKEN);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(TOKEN);
  });

  it("allows http only for localhost (local testing)", () => {
    expect(
      createAuthenticatedRepoUrl("http://localhost:3000/repo.git", TOKEN),
    ).toBe(`http://x-access-token:${TOKEN}@localhost:3000/repo.git`);
  });

  it("leaves scp-style git URLs untouched (cannot embed credentials)", () => {
    const scp = "git@github.com:owner/repo.git";
    expect(createAuthenticatedRepoUrl(scp, TOKEN)).toBe(scp);
  });
});

describe("saveArtifacts", () => {
  let rootDir: string;
  let config: ArtifactCacheConfig;

  const gitCommands = (): string[][] =>
    spawnState.recorded
      .filter(([command]) => command === "git")
      .map(([, ...args]) => args);

  const setRespond = (overrides: {
    status?: string;
    symbolicRef?: string;
    failPushWith?: string;
  }): void => {
    spawnState.respond = (args) => {
      if (args[0] === "status") {
        return { code: 0, stderr: "", stdout: overrides.status ?? "" };
      }
      if (args[0] === "symbolic-ref") {
        return {
          code: 0,
          stderr: "",
          stdout: overrides.symbolicRef ?? "main\n",
        };
      }
      if (args[0] === "push" && overrides.failPushWith !== undefined) {
        return { code: 128, stderr: overrides.failPushWith, stdout: "" };
      }
      return { code: 0, stderr: "", stdout: "" };
    };
  };

  beforeEach(async () => {
    spawnState.recorded = [];
    setRespond({});
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-cache-test-"));
    config = {
      cacheDir: path.join(rootDir, "apps/web/assets-git"),
      repoBranch: undefined,
      repoToken: TOKEN,
      repoUrl: "https://github.com/owner/cache.git",
      rootDir,
    };
    // 只准备 geocoding cache（无 schema 校验），让至少一个产物被 staged。
    await fs.mkdir(path.join(rootDir, "generated"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "generated/geocoding-cache.json"),
      "{}",
    );
  });

  afterEach(async () => {
    await fs.rm(rootDir, { force: true, recursive: true });
  });

  it("publishes a single orphan commit and force-pushes to the clone's branch", async () => {
    setRespond({ status: " M geocoding-cache.json\n", symbolicRef: "main\n" });

    await saveArtifacts(config);

    const commands = gitCommands();
    expect(commands[0].slice(0, 2)).toEqual(["clone", "--depth=1"]);
    expect(commands[0]).toContain(
      `https://x-access-token:${TOKEN}@github.com/owner/cache.git`,
    );

    // 保留 bot 提交身份。
    expect(commands).toContainEqual([
      "config",
      "user.name",
      "Afilmory Cache Bot",
    ]);
    expect(commands).toContainEqual([
      "config",
      "user.email",
      "afilmory-cache@users.noreply.github.com",
    ]);

    // orphan 提交序列：checkout --orphan -> add --all -> commit -> push --force。
    const names = commands.map((args) => args.join(" "));
    const orphanIndex = names.findIndex((c) =>
      c.startsWith("checkout --orphan"),
    );
    const addAllIndex = names.indexOf("add --all");
    const commitIndex = names.findIndex((c) => c.startsWith("commit"));
    const pushIndex = names.findIndex((c) => c.startsWith("push"));
    expect(orphanIndex).toBeGreaterThan(-1);
    expect(addAllIndex).toBeGreaterThan(orphanIndex);
    expect(commitIndex).toBeGreaterThan(addAllIndex);
    expect(pushIndex).toBeGreaterThan(commitIndex);

    expect(commands[pushIndex]).toEqual([
      "push",
      "--force",
      "origin",
      "HEAD:refs/heads/main",
    ]);
    // 不再向旧历史追加普通 push。
    expect(names).not.toContain("push --set-upstream origin HEAD");
  });

  it("uses the configured branch and skips the symbolic-ref lookup", async () => {
    setRespond({ status: " M geocoding-cache.json\n" });
    config.repoBranch = "cache";

    await saveArtifacts(config);

    const commands = gitCommands();
    expect(commands[0]).toContain("--branch");
    expect(commands[0]).toContain("cache");
    expect(commands.some((args) => args[0] === "symbolic-ref")).toBe(false);
    expect(commands.at(-1)).toEqual([
      "push",
      "--force",
      "origin",
      "HEAD:refs/heads/cache",
    ]);
  });

  it("skips commit and push when the tree matches the fetched HEAD", async () => {
    setRespond({ status: "" });

    await saveArtifacts(config);

    const names = gitCommands().map((args) => args.join(" "));
    expect(names.some((c) => c.startsWith("checkout --orphan"))).toBe(false);
    expect(names.some((c) => c.startsWith("commit"))).toBe(false);
    expect(names.some((c) => c.startsWith("push"))).toBe(false);
    // 无变化时仍会走到 status 检查。
    expect(names).toContain("status --porcelain");
  });

  it("sanitizes the token out of failed subprocess output", async () => {
    setRespond({
      status: " M geocoding-cache.json\n",
      failPushWith: `fatal: could not push https://x:${TOKEN}@github.com/owner/cache.git`,
    });

    let message = "";
    try {
      await saveArtifacts(config);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("[REPO_TOKEN]");
    expect(message).not.toContain(TOKEN);
  });
});
