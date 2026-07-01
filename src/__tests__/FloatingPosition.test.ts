import { describe, it, expect } from "vitest";
import { computeFloatingPosition, type Rect, type Size } from "../ui/floating";

const viewport: Size = { width: 1000, height: 800 };

function anchorAt(
  left: number,
  top: number,
  width = 120,
  height = 28,
): Rect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

describe("computeFloatingPosition", () => {
  it("places the box below the anchor, left-aligned, when there is room", () => {
    const anchor = anchorAt(100, 100);
    const pos = computeFloatingPosition(
      anchor,
      { width: 200, height: 150 },
      viewport,
    );
    expect(pos.placedAbove).toBe(false);
    expect(pos.left).toBe(100);
    expect(pos.top).toBe(anchor.bottom + 4); // default gap
  });

  it("right-aligns the box to the anchor with align: end", () => {
    const anchor = anchorAt(700, 100, 120, 28);
    const pos = computeFloatingPosition(
      anchor,
      { width: 200, height: 150 },
      viewport,
      { align: "end" },
    );
    // right edge of anchor is 820, so left = 820 - 200 = 620
    expect(pos.left).toBe(620);
  });

  it("flips above when the box does not fit below and more room is above", () => {
    // anchor near the bottom: bottom at 760, only 40px below in an 800 viewport
    const anchor = anchorAt(100, 732, 120, 28);
    const pos = computeFloatingPosition(
      anchor,
      { width: 200, height: 300 },
      viewport,
    );
    expect(pos.placedAbove).toBe(true);
    expect(pos.top).toBe(anchor.top - 4 - 300);
  });

  it("clamps a box that would overflow the right edge", () => {
    const anchor = anchorAt(950, 100, 40, 28);
    const pos = computeFloatingPosition(
      anchor,
      { width: 300, height: 150 },
      viewport,
    );
    // maxLeft = 1000 - 300 - 8 = 692
    expect(pos.left).toBe(692);
  });

  it("clamps a box that would overflow the left edge to the margin", () => {
    const anchor = anchorAt(2, 100, 40, 28);
    const pos = computeFloatingPosition(
      anchor,
      { width: 300, height: 150 },
      viewport,
      { align: "end" },
    );
    // align end would push left negative; clamp to margin (8)
    expect(pos.left).toBe(8);
  });

  it("respects a custom gap and margin", () => {
    const anchor = anchorAt(100, 100);
    const pos = computeFloatingPosition(
      anchor,
      { width: 200, height: 150 },
      viewport,
      { gap: 10, margin: 20 },
    );
    expect(pos.top).toBe(anchor.bottom + 10);
  });
});
