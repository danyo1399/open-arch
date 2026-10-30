import { describe, expect, it } from "vitest";
import { NODE_W, placeStickies, STICKY_W, stickyHeight } from "../src/canvas/autoLayout.js";

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
    expect(at.first).toEqual({ x: 700 + STICKY_W + 80, y: 40 });
    expect(at.second).toEqual({ x: 700 + STICKY_W + 80, y: 40 + stickyHeight("One line") + 24 });
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
});
