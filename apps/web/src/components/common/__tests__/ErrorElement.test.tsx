import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ButtonHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorElement } from "../ErrorElement";

const routeError = vi.hoisted(() => ({
  current: new Error("Failed to fetch dynamically imported module: /chunk.js"),
}));

const recovery = vi.hoisted(() => ({
  clearStaleRuntimeReloadAttempt: vi.fn(),
  isStaleRuntimeError: vi.fn(),
  recoverFromStaleRuntimeError: vi.fn(),
  recoverStaleRuntime: vi.fn(),
}));

vi.mock("@afilmory/ui", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@pkg", () => ({
  repository: {
    url: "https://github.com/vsxd/afilmory-vercel",
  },
}));

vi.mock("react-router", () => ({
  isRouteErrorResponse: () => false,
  useRouteError: () => routeError.current,
}));

// Key-identity t(): assertions on raw keys prove every label flows through i18n.
vi.mock("~/i18n", () => ({
  getI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("~/lib/stale-runtime-recovery", () => recovery);

describe("ErrorElement", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    routeError.current = new Error(
      "Failed to fetch dynamically imported module: /chunk.js",
    );
    recovery.clearStaleRuntimeReloadAttempt.mockReset();
    recovery.isStaleRuntimeError.mockReset();
    recovery.recoverFromStaleRuntimeError.mockReset();
    recovery.recoverStaleRuntime.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("automatically recovers from stale runtime route errors", async () => {
    recovery.isStaleRuntimeError.mockReturnValue(true);
    recovery.recoverFromStaleRuntimeError.mockResolvedValue({
      reloadRequested: true,
    });

    render(<ErrorElement />);

    await waitFor(() => {
      expect(recovery.recoverFromStaleRuntimeError).toHaveBeenCalledWith(
        "Failed to fetch dynamically imported module: /chunk.js",
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("error.title")).toBeNull();
    });
  });

  it("clears stale runtime reload state for ordinary route errors", async () => {
    routeError.current = new Error("404 Not Found");
    recovery.isStaleRuntimeError.mockReturnValue(false);

    render(<ErrorElement />);

    await waitFor(() => {
      expect(recovery.clearStaleRuntimeReloadAttempt).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("error.title")).not.toBeNull();
  });

  it("uses stale runtime cleanup for the reload button", () => {
    routeError.current = new Error("404 Not Found");
    recovery.isStaleRuntimeError.mockReturnValue(false);
    recovery.recoverStaleRuntime.mockResolvedValue({ reloadRequested: true });

    render(<ErrorElement />);
    fireEvent.click(screen.getByRole("button", { name: "error.reload" }));

    expect(recovery.recoverStaleRuntime).toHaveBeenCalledWith({ force: true });
  });

  it("resolves every visible label through i18n", () => {
    routeError.current = new Error("404 Not Found");
    recovery.isStaleRuntimeError.mockReturnValue(false);

    render(<ErrorElement />);

    expect(screen.getByRole("heading", { name: "error.title" })).not.toBeNull();
    expect(screen.getByText("error.temporary.description")).not.toBeNull();
    expect(screen.getByRole("button", { name: "error.reload" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "error.go.back" }),
    ).not.toBeNull();
    expect(screen.getByText("error.feedback")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "error.submit.issue" }),
    ).not.toBeNull();
  });
});
