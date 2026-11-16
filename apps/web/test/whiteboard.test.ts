import { describe, expect, it } from "vitest";
import { arrowEnds, arrowSketch, contains, edgePoint, penBox, penPath, seedOf, shapeAt, shapeBox, shapeSketch, simplifyLine, textSize, type PlacedShape } from "../src/canvas/whiteboard.js";

const box = { x: 0, y: 0, w: 200, h: 100 };

describe("whiteboard geometry", () => {
  it("puts each kind of shape in its box: its own size, the default size, a pen's points, or its text's", () => {
    expect(shapeBox({ kind: "rectangle", at: [10, 20, 30, 40], points: [], size: "medium" })).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(shapeBox({ kind: "diamond", at: [10, 20], points: [], size: "medium" })).toEqual({ x: 10, y: 20, w: 160, h: 80 });
    expect(shapeBox({ kind: "pen", at: [100, 100], points: [[0, 0], [40, -10], [20, 30]], size: "medium" })).toEqual({ x: 94, y: 84, w: 52, h: 52 });
    expect(penBox([0, 0], [[5, 5], [5, 5]])).toEqual({ x: -1, y: -1, w: 12, h: 12 });
    // Text without a size is as big as the page measured it, or about as big as its text until then.
    expect(shapeBox({ kind: "text", at: [0, 0], points: [], size: "large", text: "Hi" }, { width: 50, height: 60 })).toEqual({ x: 0, y: 0, w: 50, h: 60 });
    expect(shapeBox({ kind: "text", at: [0, 0], points: [], size: "large", text: "Hi\nthere" })).toEqual({ x: 0, y: 0, ...textSize("Hi\nthere", "large") });
    expect(textSize("Hi\nthere", "large").h).toBeGreaterThan(textSize("Hi", "large").h);
    // Text with a size grows taller when what it says doesn't fit.
    expect(shapeBox({ kind: "text", at: [0, 0, 80, 30], points: [], size: "medium", text: "Long" }, { width: 80, height: 70 })).toEqual({ x: 0, y: 0, w: 80, h: 70 });
  });

  it("ends an arrow at the outline of a rectangle, an ellipse or a diamond, a little short of it", () => {
    expect(edgePoint("rectangle", box, { x: 500, y: 50 }, 0)).toEqual({ x: 200, y: 50 });
    expect(edgePoint("rectangle", box, { x: 100, y: -300 }, 0)).toEqual({ x: 100, y: 0 });
    expect(edgePoint("rectangle", box, { x: 500, y: 50 }, 5)).toEqual({ x: 205, y: 50 });
    const corner = edgePoint("ellipse", box, { x: 300, y: 150 }, 0);
    // On the ellipse: (x - 100)² / 100² + (y - 50)² / 50² = 1.
    expect(((corner.x - 100) / 100) ** 2 + ((corner.y - 50) / 50) ** 2).toBeCloseTo(1);
    const diamond = edgePoint("diamond", box, { x: 300, y: 150 }, 0);
    expect(Math.abs(diamond.x - 100) / 100 + Math.abs(diamond.y - 50) / 50).toBeCloseTo(1);
    // Towards its own middle, it's the middle; towards a point inside it, no further than that point.
    expect(edgePoint("rectangle", box, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(edgePoint("rectangle", box, { x: 110, y: 50 })).toEqual({ x: 110, y: 50 });
  });

  it("knows which shape is at a point, from the front, inside its outline", () => {
    expect(contains("ellipse", box, { x: 5, y: 5 })).toBe(false);
    expect(contains("rectangle", box, { x: 5, y: 5 })).toBe(true);
    expect(contains("diamond", box, { x: 100, y: 5 })).toBe(true);
    expect(contains("diamond", box, { x: 20, y: 10 })).toBe(false);
    const shapes: PlacedShape[] = [
      { id: "back", kind: "rectangle", box },
      { id: "front", kind: "rectangle", box: { x: 50, y: 0, w: 50, h: 50 } },
    ];
    expect(shapeAt(shapes, { x: 60, y: 10 })).toBe("front");
    expect(shapeAt(shapes, { x: 60, y: 10 }, "front")).toBe("back");
    expect(shapeAt(shapes, { x: 10, y: 90 })).toBe("back");
    expect(shapeAt(shapes, { x: 500, y: 500 })).toBeUndefined();
  });

  it("draws an arrow between shapes from edge to edge, to and from points, and not from a shape to itself or one that isn't drawn", () => {
    const shapes = new Map<string, PlacedShape>([
      ["a", { id: "a", kind: "rectangle", box }],
      ["b", { id: "b", kind: "rectangle", box: { x: 400, y: 0, w: 200, h: 100 } }],
    ]);
    expect(arrowEnds({ from: "a", to: "b" }, shapes)).toEqual({ from: { x: 205, y: 50 }, to: { x: 395, y: 50 } });
    expect(arrowEnds({ from: [100, 300], to: "a" }, shapes)).toEqual({ from: { x: 100, y: 300 }, to: { x: 100, y: 105 } });
    expect(arrowEnds({ from: [0, 0], to: [10, 10] }, shapes)).toEqual({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    // An end being dragged is where it's dragged to.
    expect(arrowEnds({ from: "a", to: "b" }, shapes, { to: { x: 100, y: 500 } })).toEqual({ from: { x: 100, y: 105 }, to: { x: 100, y: 500 } });
    expect(arrowEnds({ from: "a", to: "a" }, shapes)).toBeNull();
    expect(arrowEnds({ from: "a", to: "gone" }, shapes)).toBeNull();
  });

  it("sketches the same wobble for the same seed, a fill when it's filled, and an arrow's heads", () => {
    expect(seedOf("idea")).toBe(seedOf("idea"));
    expect(seedOf("idea")).not.toBe(seedOf("idean"));
    expect(seedOf("")).toBeGreaterThan(0);
    const one = shapeSketch("rectangle", 160, 80, 7);
    expect(one).toEqual(shapeSketch("rectangle", 160, 80, 7));
    expect(one.fill).toEqual([]);
    // Drawn twice over, as a marker does, unless it's dashed.
    expect(one.stroke.length).toBeGreaterThan(0);
    expect(shapeSketch("rectangle", 160, 80, 7, { dashed: true }).stroke.join(" ").length).toBeLessThan(one.stroke.join(" ").length);
    for (const kind of ["rectangle", "ellipse", "diamond"] as const) {
      const filled = shapeSketch(kind, 160, 80, 7, { filled: true });
      expect(filled.fill).toHaveLength(1);
      expect(filled.stroke.length).toBeGreaterThan(0);
    }
    const line = arrowSketch({ x: 0, y: 0 }, { x: 100, y: 0 }, "none", 3);
    expect(line.line.length).toBeGreaterThan(0);
    expect(line.heads).toEqual([]);
    const head = arrowSketch({ x: 0, y: 0 }, { x: 100, y: 0 }, "end", 3).heads;
    expect(head.length).toBeGreaterThan(0);
    expect(arrowSketch({ x: 0, y: 0 }, { x: 100, y: 0 }, "both", 3).heads).toHaveLength(head.length * 2);
    // An arrow with no length has nowhere to point its head.
    expect(arrowSketch({ x: 5, y: 5 }, { x: 5, y: 5 }, "end", 3).heads).toEqual([]);
  });

  it("smooths a pen's line through its points", () => {
    expect(penPath([[0, 0], [10, 0]])).toBe("M 0 0 L 10 0");
    expect(penPath([[0, 0], [10, 0], [10, 10]], 1, 2)).toBe("M 1 2 Q 11 2 11 7 L 11 12");
    expect(penPath([])).toBe("");
  });

  it("leaves out the points of a pen's line that barely change it, from the corner of its box", () => {
    const straight = Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 5, y: 50 + (i % 2) * 0.4 }));
    expect(simplifyLine(straight)).toEqual({ at: [100, 50], points: [[0, 0], [95, 0]] });
    const corner = [{ x: 0, y: 0 }, { x: 5, y: 0.2 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
    expect(simplifyLine(corner)).toEqual({ at: [0, 0], points: [[0, 0], [10, 0], [10, 10]] });
    // A tap is a dot: a line from a point to itself.
    expect(simplifyLine([{ x: 3.4, y: 4.6 }])).toEqual({ at: [3, 5], points: [[0, 0], [0, 0]] });
    expect(simplifyLine([{ x: 3, y: 4 }, { x: 3.2, y: 4.1 }])).toEqual({ at: [3, 4], points: [[0, 0], [0, 0]] });
  });
});
