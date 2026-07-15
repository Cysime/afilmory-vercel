import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MapPopover,
  MapPopoverContent,
  MapPopoverTrigger,
} from "../MapPopover";

const renderPopover = () =>
  render(
    <MapPopover>
      <MapPopoverTrigger>
        <button type="button">Open details</button>
      </MapPopoverTrigger>
      <MapPopoverContent aria-label="Photo details">
        <a href="/photos/one">View photo</a>
      </MapPopoverContent>
    </MapPopover>,
  );

describe("MapPopover", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens an interactive dialog and moves focus into it", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));

    expect(screen.getByRole("dialog", { name: "Photo details" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View photo" })).toBe(
      document.activeElement,
    );
  });

  it("closes on Escape and restores focus to the marker trigger", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    renderPopover();
    const trigger = screen.getByRole("button", { name: "Open details" });
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
