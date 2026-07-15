import { fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { useDialogFocusManagement } from "~/hooks/useDialogFocusManagement";

const DialogHarness = ({
  focusContainerOnOpen = false,
  isOpen,
  opener,
}: {
  focusContainerOnOpen?: boolean;
  isOpen: boolean;
  opener: HTMLElement;
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusManagement({
    dialogRef,
    focusContainerOnOpen,
    initialFocusSelector: "[data-photo-viewer-close]",
    isOpen,
    returnFocusElement: opener,
  });

  return isOpen ? (
    <div ref={dialogRef} role="dialog" tabIndex={-1}>
      <button type="button" data-photo-viewer-close>
        Close
      </button>
      <button type="button">Last action</button>
    </div>
  ) : null;
};

describe("useDialogFocusManagement", () => {
  it("focuses the preferred control, traps Tab, and restores the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const view = render(<DialogHarness isOpen opener={opener} />);
    const close = view.getByRole("button", { name: "Close" });
    const last = view.getByRole("button", { name: "Last action" });
    await waitFor(() => expect(document.activeElement).toBe(close));

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    view.rerender(<DialogHarness isOpen={false} opener={opener} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("can focus the dialog container without opening a mobile keyboard", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const view = render(
      <DialogHarness focusContainerOnOpen isOpen opener={opener} />,
    );
    const dialog = view.getByRole("dialog");
    const last = view.getByRole("button", { name: "Last action" });

    await waitFor(() => expect(document.activeElement).toBe(dialog));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
