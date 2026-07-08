import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Slider } from "../slider";

vi.mock("@afilmory/ui", () => ({
  clsxm: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      (
        ({
          "slider.auto": "Auto",
          "slider.columns": `${options?.count} columns`,
          "action.columns.setting": "Column Settings",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

const renderSlider = (
  props: Partial<React.ComponentProps<typeof Slider>> = {},
) => render(<Slider value={5} onChange={vi.fn()} min={3} max={8} {...props} />);

const getHandle = () => screen.getByRole("slider", { name: "Column Settings" });

describe("Slider", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes the WAI-ARIA slider contract on the handle", () => {
    renderSlider({ value: 5 });

    const handle = getHandle();
    expect(handle.getAttribute("tabindex")).toBe("0");
    // "auto" is an extra discrete stop one step below min
    expect(handle.getAttribute("aria-valuemin")).toBe("2");
    expect(handle.getAttribute("aria-valuemax")).toBe("8");
    expect(handle.getAttribute("aria-valuenow")).toBe("5");
    expect(handle.getAttribute("aria-valuetext")).toBe("5 columns");
  });

  it("announces the auto stop as one step below min with a readable valuetext", () => {
    renderSlider({ value: "auto" });

    const handle = getHandle();
    expect(handle.getAttribute("aria-valuenow")).toBe("2");
    expect(handle.getAttribute("aria-valuetext")).toBe("Auto");
  });

  it("steps with arrow keys and commits each step via onPointUp", () => {
    const onChange = vi.fn();
    const onPointUp = vi.fn();
    renderSlider({ value: 5, onChange, onPointUp });
    const handle = getHandle();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(onPointUp).toHaveBeenCalledTimes(4);
  });

  it("jumps to the auto stop with Home and to max with End", () => {
    const onChange = vi.fn();
    renderSlider({ value: 5, onChange });
    const handle = getHandle();

    fireEvent.keyDown(handle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("auto");
    fireEvent.keyDown(handle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(8);
  });

  it("clamps at max without emitting a no-op change", () => {
    const onChange = vi.fn();
    const onPointUp = vi.fn();
    renderSlider({ value: 8, onChange, onPointUp });

    fireEvent.keyDown(getHandle(), { key: "ArrowRight" });
    fireEvent.keyDown(getHandle(), { key: "End" });

    expect(onChange).not.toHaveBeenCalled();
    expect(onPointUp).not.toHaveBeenCalled();
  });

  it("steps below min into the auto stop and stays there", () => {
    const onChange = vi.fn();
    renderSlider({ value: 3, onChange });

    fireEvent.keyDown(getHandle(), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("auto");

    cleanup();
    const onChangeFromAuto = vi.fn();
    renderSlider({ value: "auto", onChange: onChangeFromAuto });

    fireEvent.keyDown(getHandle(), { key: "ArrowLeft" });
    expect(onChangeFromAuto).not.toHaveBeenCalled();
    fireEvent.keyDown(getHandle(), { key: "ArrowRight" });
    expect(onChangeFromAuto).toHaveBeenLastCalledWith(3);
  });

  it("ignores unrelated keys", () => {
    const onChange = vi.fn();
    renderSlider({ value: 5, onChange });

    fireEvent.keyDown(getHandle(), { key: "a" });
    fireEvent.keyDown(getHandle(), { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("updates aria-valuenow/valuetext as the value changes (controlled round-trip)", () => {
    const ControlledSlider = () => {
      const [value, setValue] = useState<number | "auto">(3);
      return <Slider value={value} onChange={setValue} min={3} max={8} />;
    };
    render(<ControlledSlider />);
    const handle = getHandle();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("4");
    expect(handle.getAttribute("aria-valuetext")).toBe("4 columns");

    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe("2");
    expect(handle.getAttribute("aria-valuetext")).toBe("Auto");
  });

  it("is removed from tab order and inert when disabled", () => {
    const onChange = vi.fn();
    renderSlider({ value: 5, onChange, disabled: true });

    const handle = getHandle();
    expect(handle.getAttribute("tabindex")).toBe("-1");
    expect(handle.getAttribute("aria-disabled")).toBe("true");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a visible keyboard focus ring on the handle (global CSS strips outlines)", () => {
    renderSlider({ value: 5 });

    const handle = getHandle();
    expect(handle.className).toContain("focus-visible:ring-2");
    expect(handle.className).toContain("focus-visible:ring-accent/45");
  });
});
