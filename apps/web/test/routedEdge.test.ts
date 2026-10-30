import { describe, expect, it } from "vitest";
import { pathThrough } from "../src/canvas/RoutedEdge.js";

describe("pathThrough", () => {
  it("hops over the top of an arrow it crosses, whichever way it runs", () => {
    expect(pathThrough([{ x: 0, y: 100 }, { x: 300, y: 100 }], [{ x: 150, y: 100 }])).toBe("M 0 100 L 145 100 A 5 5 0 0 1 155 100 L 300 100");
    expect(pathThrough([{ x: 300, y: 100 }, { x: 0, y: 100 }], [{ x: 150, y: 100 }])).toBe("M 300 100 L 155 100 A 5 5 0 0 0 145 100 L 0 100");
  });

  it("draws a crossing too near a corner, or right after another hop, as a plain crossing", () => {
    const route = [
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ];
    const path = pathThrough(route, [
      { x: 100, y: 100 },
      { x: 106, y: 100 },
      { x: 290, y: 100 },
    ]);
    expect(path.match(/ A /g)).toHaveLength(1);
  });
});
