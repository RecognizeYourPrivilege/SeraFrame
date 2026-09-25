import { describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  nextPan,
  nextPinchScale,
  swipeStep,
  touchDistance,
} from "./lightboxZoom";

describe("lightbox pinch zoom", () => {
  it("scales with finger distance and stays inside 1 to 4", () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(100);
    expect(nextPinchScale(1, 100, 200)).toBe(2);
    expect(nextPinchScale(2, 100, 50)).toBe(1);
    expect(nextPinchScale(1, 100, 20)).toBe(ZOOM_MIN);
    expect(nextPinchScale(3, 100, 400)).toBe(ZOOM_MAX);
    expect(nextPinchScale(1, 0, 100)).toBe(1);
  });

  it("swipes only for a horizontal one-finger move at the fitted size", () => {
    expect(swipeStep(-80, 10, 1, false)).toBe(1);
    expect(swipeStep(80, 10, 1, false)).toBe(-1);
    expect(swipeStep(-20, 0, 1, false)).toBe(0);
    expect(swipeStep(-80, 90, 1, false)).toBe(0);
    expect(swipeStep(-80, 10, 2, false)).toBe(0);
    expect(swipeStep(-80, 10, 1.2, true)).toBe(0);
  });

  it("pans a zoomed image and keeps a fitted image still", () => {
    expect(nextPan({ x: 0, y: 0 }, -40, 10, 2, { width: 200, height: 100 })).toEqual({ x: -40, y: 10 });
    expect(nextPan({ x: 0, y: 0 }, -500, 0, 2, { width: 200, height: 100 })).toEqual({ x: -100, y: 0 });
    expect(nextPan({ x: 40, y: 0 }, 0, 0, 1, { width: 200, height: 100 })).toEqual({ x: 0, y: 0 });
  });
});
