import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useModalIsolation } from "~/hooks/useModalIsolation";

const IsolationHarness = ({ isOpen }: { isOpen: boolean }) => {
  useModalIsolation(isOpen);
  return null;
};

describe("useModalIsolation", () => {
  afterEach(() => {
    document.querySelector("#main-content")?.remove();
    document.body.style.overflow = "";
  });

  it("isolates the gallery and restores its previous state", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.setAttribute("aria-hidden", "false");
    document.body.append(main);
    document.body.style.overflow = "auto";

    const view = render(<IsolationHarness isOpen />);

    expect(main.hasAttribute("inert")).toBe(true);
    expect(main.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(<IsolationHarness isOpen={false} />);

    expect(main.hasAttribute("inert")).toBe(false);
    expect(main.getAttribute("aria-hidden")).toBe("false");
    expect(document.body.style.overflow).toBe("auto");
  });

  it("keeps isolation active until the final modal closes", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.append(main);

    const first = render(<IsolationHarness isOpen />);
    const second = render(<IsolationHarness isOpen />);

    first.unmount();
    expect(main.hasAttribute("inert")).toBe(true);
    expect(main.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    second.unmount();
    expect(main.hasAttribute("inert")).toBe(false);
    expect(main.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("preserves pre-existing inert and hidden state", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.setAttribute("inert", "");
    main.setAttribute("aria-hidden", "true");
    document.body.append(main);

    const view = render(<IsolationHarness isOpen />);
    view.unmount();

    expect(main.hasAttribute("inert")).toBe(true);
    expect(main.getAttribute("aria-hidden")).toBe("true");
  });
});
