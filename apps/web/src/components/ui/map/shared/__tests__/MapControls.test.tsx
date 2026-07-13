import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MapControls } from "../MapControls";

const mocks = vi.hoisted(() => ({
  easeTo: vi.fn(),
  flyTo: vi.fn(),
  reduceMotion: true,
}));

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    useReducedMotion: () => mocks.reduceMotion,
  };
});

vi.mock("react-map-gl/maplibre", () => ({
  useMap: () => ({
    current: {
      easeTo: mocks.easeTo,
      flyTo: mocks.flyTo,
      getZoom: () => 5,
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("MapControls reduced motion", () => {
  beforeEach(() => {
    mocks.easeTo.mockClear();
    mocks.flyTo.mockClear();
    mocks.reduceMotion = true;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          success: (position: GeolocationPosition) => void,
        ) =>
          success({
            coords: { longitude: 121.5, latitude: 31.2 },
          } as GeolocationPosition),
      },
    });
  });

  it("uses zero-duration camera transitions for every control", () => {
    render(<MapControls />);

    fireEvent.click(
      screen.getByRole("button", { name: "explore.controls.zoom.in" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "explore.controls.zoom.out" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "explore.controls.compass" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "explore.controls.locate" }),
    );

    expect(mocks.easeTo).toHaveBeenNthCalledWith(1, {
      zoom: 6,
      duration: 0,
    });
    expect(mocks.easeTo).toHaveBeenNthCalledWith(2, {
      zoom: 4,
      duration: 0,
    });
    expect(mocks.easeTo).toHaveBeenNthCalledWith(3, {
      bearing: 0,
      pitch: 0,
      duration: 0,
    });
    expect(mocks.flyTo).toHaveBeenCalledWith({
      center: [121.5, 31.2],
      zoom: 14,
      duration: 0,
    });
  });
});
