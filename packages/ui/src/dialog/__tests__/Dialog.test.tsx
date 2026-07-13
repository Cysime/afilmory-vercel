import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "..";

function renderDialog(props: React.ComponentProps<typeof Dialog>) {
  return render(
    <Dialog {...props}>
      <DialogTrigger asChild>
        <button type="button">trigger</button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>dialog title</DialogTitle>
        <DialogDescription>dialog description</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("works uncontrolled: opens via trigger", () => {
    renderDialog({});

    expect(screen.queryByText("dialog title")).toBeNull();

    fireEvent.click(screen.getByText("trigger"));

    expect(screen.getByText("dialog title")).toBeTruthy();
  });

  it("respects defaultOpen when uncontrolled", () => {
    renderDialog({ defaultOpen: true });

    expect(screen.getByText("dialog title")).toBeTruthy();
  });

  it("works controlled: follows the open prop", () => {
    const { rerender } = renderDialog({ open: false });

    expect(screen.queryByText("dialog title")).toBeNull();

    rerender(
      <Dialog open>
        <DialogTrigger asChild>
          <button type="button">trigger</button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>dialog title</DialogTitle>
          <DialogDescription>dialog description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText("dialog title")).toBeTruthy();
  });

  it("notifies onOpenChange when the trigger is clicked", () => {
    const onOpenChange = vi.fn();
    renderDialog({ open: false, onOpenChange });

    fireEvent.click(screen.getByText("trigger"));

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText("dialog title")).toBeNull();
  });
});
