import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { MotionButtonBase } from "./MotionButton";

describe("Button", () => {
  it("keeps an asChild link discoverable but blocks activation while loading", () => {
    const onClick = vi.fn();
    render(
      <Button asChild isLoading loadingText="Saving">
        <a href="/save" onClick={onClick}>
          Save
        </a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: /saving/i });
    expect(link.getAttribute("href")).toBe("/save");
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.getAttribute("aria-busy")).toBe("true");

    fireEvent.click(link);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables native buttons while loading", () => {
    render(<Button isLoading>Save</Button>);

    expect(
      (screen.getByRole("button", { name: /loading/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("defaults motion buttons to type=button", () => {
    render(<MotionButtonBase>Animate</MotionButtonBase>);

    expect(
      (screen.getByRole("button", { name: "Animate" }) as HTMLButtonElement)
        .type,
    ).toBe("button");
  });
});
