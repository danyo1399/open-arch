import { describe, expect, it } from "vitest";
import { NODE_W, placeStickies, STICKY, stickyHeight, TOUCH_STICKY } from "../src/canvas/autoLayout.js";

describe("placeStickies", () => {
  it("keeps saved positions and stacks the rest, in order, right of everything else", () => {
    const boxes = [
      { x: 0, y: 40 },
      { x: 300, y: 200 },
    ];
    const at = placeStickies(
      [
        { id: "placed", text: "Here", at: [700, 0] },
        { id: "first", text: "One line" },
        { id: "second", text: "Two\nlines" },
      ],
      boxes,
    );
    expect(at.placed).toEqual({ x: 700, y: 0 });
    expect(at.first).toEqual({ x: 700 + STICKY.width + 80, y: 40 });
    expect(at.second).toEqual({ x: 700 + STICKY.width + 80, y: 40 + stickyHeight("One line") + 24 });
  });

  it("leaves room for the bigger notes on a touch screen", () => {
    const text = "A note long enough to wrap onto a few lines of text.";
    const at = placeStickies(
      [
        { id: "placed", text: "Here", at: [700, 0] },
        { id: "first", text },
        { id: "second", text },
      ],
      [{ x: 0, y: 40 }],
      TOUCH_STICKY,
    );
    expect(at.first).toEqual({ x: 700 + TOUCH_STICKY.width + 80, y: 40 });
    expect(at.second).toEqual({ x: 700 + TOUCH_STICKY.width + 80, y: 40 + stickyHeight(text, TOUCH_STICKY) + 24 });
  });

  it("puts notes at the origin of an empty view", () => {
    expect(placeStickies([{ id: "a", text: "Hi" }], [])).toEqual({ a: { x: 0, y: 0 } });
    expect(placeStickies([{ id: "a", text: "Hi" }], [{ x: 10, y: 10 }]).a).toEqual({ x: 10 + NODE_W + 80, y: 10 });
  });
});

describe("stickyHeight", () => {
  it("grows with lines and with long lines that wrap", () => {
    expect(stickyHeight("a\nb")).toBeGreaterThan(stickyHeight("a"));
    expect(stickyHeight("x".repeat(60))).toBeGreaterThan(stickyHeight("x".repeat(10)));
  });

  it("is taller on a touch screen, where the text is bigger", () => {
    // 50 characters fit on two lines of 13px text, but take three at 16px, and each line is taller.
    expect(stickyHeight("x".repeat(50))).toBe(26 + 2 * 18);
    expect(stickyHeight("x".repeat(50), TOUCH_STICKY)).toBe(26 + 3 * 22);
  });
});
