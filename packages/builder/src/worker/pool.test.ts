import { afterEach, describe, expect, it, vi } from "vitest";

import { setConsoleForwarding } from "../logger/index.js";
import { WorkerPool } from "./pool.js";

describe("WorkerPool", () => {
  afterEach(() => {
    vi.useRealTimers();
    setConsoleForwarding(true);
  });

  it("rejects invalid scheduling parameters instead of silently deadlocking", () => {
    expect(() => new WorkerPool({ concurrency: 0, totalTasks: 1 })).toThrow(
      /positive integer/,
    );
    expect(() => new WorkerPool({ concurrency: 1.5, totalTasks: 1 })).toThrow(
      /positive integer/,
    );
    expect(() => new WorkerPool({ concurrency: 1, totalTasks: -1 })).toThrow(
      /non-negative integer/,
    );
    expect(
      () => new WorkerPool({ concurrency: 1, timeoutMs: 0, totalTasks: 1 }),
    ).toThrow(/timeoutMs/);
  });

  it("stops taking new work after the first failure and waits for in-flight work", async () => {
    setConsoleForwarding(false);
    let releaseInFlight!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    const started: number[] = [];
    let settled = false;
    const pool = new WorkerPool<string>({
      concurrency: 2,
      timeoutMs: 1000,
      totalTasks: 3,
    });

    const run = pool
      .execute(async (taskIndex) => {
        started.push(taskIndex);
        if (taskIndex === 0) throw new Error("first task failed");
        await inFlight;
        return `task-${taskIndex}`;
      })
      .finally(() => {
        settled = true;
      });

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    expect(settled).toBe(false);
    releaseInFlight();

    await expect(run).rejects.toThrow("first task failed");
    expect(started).toEqual([0, 1]);
  });

  it("fails a hung task through the configured watchdog", async () => {
    setConsoleForwarding(false);
    vi.useFakeTimers();
    const pool = new WorkerPool<string>({
      concurrency: 1,
      timeoutMs: 25,
      totalTasks: 1,
    });
    const run = pool.execute(async () => await new Promise<string>(() => {}));
    const rejection = expect(run).rejects.toThrow("timed out after 25ms");

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("can drain a cooperatively aborted task before rejecting", async () => {
    setConsoleForwarding(false);
    vi.useFakeTimers();
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    let aborted = false;
    let settled = false;
    const pool = new WorkerPool<string>({
      concurrency: 1,
      drainTimedOutTasks: true,
      timeoutMs: 25,
      totalTasks: 1,
    });
    const run = pool
      .execute(
        async (_taskIndex, _workerId, signal) =>
          await new Promise<string>((resolve) => {
            signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                void cleanup.then(() => resolve("cleaned"));
              },
              { once: true },
            );
          }),
      )
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(25);
    expect(aborted).toBe(true);
    expect(settled).toBe(false);
    finishCleanup();

    await expect(run).rejects.toThrow("timed out after 25ms");
    expect(settled).toBe(true);
  });
});
