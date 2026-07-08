import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../button";

// The app globally resets `outline` on :focus-visible (tailwind.css), so the
// shared Button must ship a box-shadow ring in the app-wide accent idiom to
// keep a visible focus affordance without help from callers.
describe("Button focus ring", () => {
  // vitest globals are off in this project, so RTL cannot auto-cleanup.
  afterEach(cleanup);

  it("carries the accent box-shadow ring classes", () => {
    const { getByRole } = render(<Button>Reload Application</Button>);
    const { className } = getByRole("button");

    expect(className).toContain("focus-visible:ring-2");
    expect(className).toContain("focus-visible:ring-accent/45");
    expect(className).toContain("focus-visible:ring-offset-2");
    expect(className).toContain("focus-visible:ring-offset-background");
  });

  it("does not depend on outline utilities the app reset would kill", () => {
    const { getByRole } = render(<Button>Reload Application</Button>);

    expect(getByRole("button").className).not.toMatch(/outline/);
  });

  it("lets callers override the ring color via className", () => {
    const { getByRole } = render(
      <Button className="focus-visible:ring-red-500">Delete</Button>,
    );
    const { className } = getByRole("button");

    expect(className).toContain("focus-visible:ring-red-500");
    expect(className).not.toContain("focus-visible:ring-accent/45");
  });
});
