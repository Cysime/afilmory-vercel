import { describe, expect, it } from "vitest";

import { Semaphore } from "./semaphore.js";

describe("Semaphore", () => {
  it("allows up to `permits` concurrent acquisitions without blocking", async () => {
    const sem = new Semaphore(2);
    const release1 = await sem.acquire();
    const release2 = await sem.acquire();
    expect(typeof release1).toBe("function");
    expect(typeof release2).toBe("function");
    release1();
    release2();
  });

  it("queues acquisitions beyond the permit count until a release happens", async () => {
    const sem = new Semaphore(1);
    const release1 = await sem.acquire();

    let acquired2 = false;
    const pending = sem.acquire().then((release) => {
      acquired2 = true;
      return release;
    });

    // Flush microtasks: the second acquire must still be parked.
    await Promise.resolve();
    expect(acquired2).toBe(false);

    release1();
    const release2 = await pending;
    expect(acquired2).toBe(true);
    release2();
  });

  it("rejects invalid permit counts instead of silently changing scheduling", () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(-1)).toThrow(/positive integer/);
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/);
  });

  it("run() bounds concurrency and returns each fn's result in order", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const task = async (value: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    };

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => sem.run(() => task(n))),
    );

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("releases the permit even when the wrapped fn throws", async () => {
    const sem = new Semaphore(1);

    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // If the permit leaked, this acquire would block forever.
    const release = await sem.acquire();
    expect(typeof release).toBe("function");
    release();
  });

  it("removes an aborted waiter without consuming a permit", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    const controller = new AbortController();
    const pending = sem.acquire(controller.signal);

    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    release();

    const nextRelease = await sem.acquire();
    nextRelease();
  });
});
