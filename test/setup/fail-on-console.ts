import { inspect } from "node:util";

import { afterAll, afterEach } from "vitest";

type GuardedConsoleMethod = "error" | "warn";

interface UnexpectedConsoleCall {
  args: unknown[];
  method: GuardedConsoleMethod;
  stack: string;
}

const originalConsole = {
  error: console.error,
  warn: console.warn,
};
const calls: UnexpectedConsoleCall[] = [];

const guards = Object.fromEntries(
  (["warn", "error"] as const).map((method) => [
    method,
    (...args: unknown[]) => {
      calls.push({
        args,
        method,
        stack: new Error(`Unexpected console.${method}`).stack ?? "",
      });
    },
  ]),
) as Record<GuardedConsoleMethod, (...args: unknown[]) => void>;

const installGuards = () => {
  console.warn = guards.warn;
  console.error = guards.error;
};

const takeFailure = () => {
  if (calls.length === 0) return;

  const unexpectedCalls = calls.splice(0);
  const details = unexpectedCalls
    .map(({ args, method, stack }, index) => {
      const renderedArgs = args.map((arg) => inspect(arg)).join(" ");
      const callSite = stack
        .split("\n")
        .filter((line) => !line.includes("fail-on-console.ts"))
        .slice(1, 4)
        .join("\n");
      return `${index + 1}. console.${method}: ${renderedArgs}\n${callSite}`;
    })
    .join("\n\n");

  return new Error(
    `Unexpected console warning/error. ` +
      `If the output is part of the behavior under test, spy on that console method explicitly.\n\n${details}`,
  );
};

// Setup files execute before the test module, so this also covers module-level
// output and beforeAll hooks. These are plain functions rather than Vitest
// spies: vi.restoreAllMocks() in application tests cannot disable the guard.
installGuards();

afterEach(() => {
  // A test may have intentionally replaced the guard with its own spy. Restore
  // ours after that test's cleanup hooks, then report everything it did not own.
  installGuards();
  const failure = takeFailure();
  if (failure) throw failure;
});

afterAll(() => {
  // With Vitest's stack hook order this runs after file-level afterAll hooks,
  // covering warnings/errors emitted outside an individual test lifecycle.
  installGuards();
  const failure = takeFailure();
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  if (failure) throw failure;
});
