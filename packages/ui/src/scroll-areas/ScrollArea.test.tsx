import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScrollArea } from "./ScrollArea";

describe("ScrollArea", () => {
  it("puts a visible-ring scroll viewport in the keyboard tab order", () => {
    const { container } = render(
      <ScrollArea>
        <div>content</div>
      </ScrollArea>,
    );

    expect(screen.getByText("content")).toBeTruthy();
    const viewport = container.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    expect(viewport?.getAttribute("tabindex")).toBe("0");
    expect(viewport?.className).toContain("focus-visible:ring-2");
  });

  it("removes an explicitly non-focusable viewport from the tab order", () => {
    const { container } = render(
      <ScrollArea focusable={false}>
        <div>content</div>
      </ScrollArea>,
    );

    expect(
      container
        .querySelector("[data-radix-scroll-area-viewport]")
        ?.getAttribute("tabindex"),
    ).toBe("-1");
  });
});
