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
    const pending = sem.acquire({ signal: controller.signal });

    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    release();

    const nextRelease = await sem.acquire();
    nextRelease();
  });

  it("rejects an already-aborted acquire with the abort reason", async () => {
    const sem = new Semaphore(1);
    const controller = new AbortController();
    controller.abort(new Error("too late"));

    await expect(sem.acquire({ signal: controller.signal })).rejects.toThrow(
      "too late",
    );
  });

  it("blocks a weighted acquire until enough permits are released", async () => {
    const sem = new Semaphore(4);
    const releaseA = await sem.acquire({ weight: 3 });

    let acquired = false;
    const pending = sem.acquire({ weight: 2 }).then((release) => {
      acquired = true;
      return release;
    });

    await Promise.resolve();
    expect(acquired).toBe(false);

    releaseA();
    const releaseB = await pending;
    expect(acquired).toBe(true);
    releaseB();

    // The full budget must be back: a max-weight acquire succeeds immediately.
    const releaseC = await sem.acquire({ weight: 4 });
    releaseC();
  });

  it("does not let a light waiter overtake a blocked heavy waiter (strict FIFO)", async () => {
    const sem = new Semaphore(4);
    const releaseA = await sem.acquire({ weight: 2 });

    let heavyAcquired = false;
    let lightAcquired = false;
    const heavy = sem.acquire({ weight: 3 }).then((release) => {
      heavyAcquired = true;
      return release;
    });
    const light = sem.acquire({ weight: 1 }).then((release) => {
      lightAcquired = true;
      return release;
    });

    // The light waiter would fit (2 + 1 <= 4) but must wait behind the heavy
    // head so large reservations are never starved.
    await Promise.resolve();
    expect(heavyAcquired).toBe(false);
    expect(lightAcquired).toBe(false);

    releaseA();
    const releaseHeavy = await heavy;
    const releaseLight = await light;
    expect(heavyAcquired).toBe(true);
    expect(lightAcquired).toBe(true);
    releaseHeavy();
    releaseLight();
  });

  it("unblocks queued waiters when the heavy waiter ahead of them aborts", async () => {
    const sem = new Semaphore(4);
    const releaseA = await sem.acquire({ weight: 2 });

    const controller = new AbortController();
    const heavy = sem.acquire({ weight: 3, signal: controller.signal });
    let lightAcquired = false;
    const light = sem.acquire({ weight: 2 }).then((release) => {
      lightAcquired = true;
      return release;
    });

    await Promise.resolve();
    expect(lightAcquired).toBe(false);

    // No release happens here: removing the aborted head alone must drain
    // the queue and grant the waiter behind it.
    controller.abort(new Error("cancelled"));
    await expect(heavy).rejects.toThrow("cancelled");
    const releaseLight = await light;
    expect(lightAcquired).toBe(true);
    releaseLight();
    releaseA();
  });

  it("ignores duplicate release calls instead of minting extra permits", async () => {
    const sem = new Semaphore(2);
    const release = await sem.acquire();
    release();
    release();

    const release1 = await sem.acquire();
    const release2 = await sem.acquire();
    let acquired3 = false;
    const pending = sem.acquire().then((r) => {
      acquired3 = true;
      return r;
    });

    // If the duplicate release had leaked a permit, this acquire would have
    // been granted immediately.
    await Promise.resolve();
    expect(acquired3).toBe(false);

    release1();
    (await pending)();
    release2();
  });

  it("rejects weights that are invalid or can never be satisfied", async () => {
    const sem = new Semaphore(4);
    await expect(sem.acquire({ weight: 5 })).rejects.toThrow(
      /exceeds the total permit count/,
    );
    await expect(sem.acquire({ weight: 0 })).rejects.toThrow(
      /positive integer/,
    );
    await expect(sem.acquire({ weight: 1.5 })).rejects.toThrow(
      /positive integer/,
    );
  });
});
