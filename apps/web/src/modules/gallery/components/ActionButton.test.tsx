import { fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MobileActionButton } from "./ActionButton";

const MobileDrawerHarness = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <main id="main-content">
        <MobileActionButton
          icon="test-icon"
          title="Filters"
          open={open}
          onOpenChange={setOpen}
        >
          <button type="button">First action</button>
          <button type="button" onClick={() => setOpen(false)}>
            Close drawer
          </button>
        </MobileActionButton>
      </main>
    </>
  );
};

describe("MobileActionButton", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("isolates the gallery, autofocuses the drawer, and traps focus", async () => {
    const view = render(<MobileDrawerHarness />);
    const trigger = view.getByRole("button", { name: "Filters" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await view.findByRole("dialog", { name: "Filters" });
    const firstAction = view.getByRole("button", { name: "First action" });
    const close = view.getByRole("button", { name: "Close drawer" });
    const main = document.querySelector<HTMLElement>("#main-content")!;

    await waitFor(() => expect(document.activeElement).toBe(firstAction));
    expect(main.hasAttribute("inert")).toBe(true);
    expect(main.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(firstAction);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(close);

    await waitFor(() => {
      expect(trigger.dataset.state).toBe("closed");
      expect(main.hasAttribute("inert")).toBe(false);
      expect(main.hasAttribute("aria-hidden")).toBe(false);
      expect(document.body.style.overflow).toBe("");
    });
  });
});
