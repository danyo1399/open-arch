import { describe, expect, it } from "vitest";
import { GRID, snapMove, snapResize } from "../src/canvas/snap.js";

const box = (x: number, y: number, w = 200, h = 100) => ({ x, y, w, h });
const both = { guides: true, grid: true, reach: 6 };
const guidesOnly = { guides: true, grid: false, reach: 6 };
const gridOnly = { guides: false, grid: true, reach: 6 };

describe("snapMove", () => {
  it("lines a box's left edge up with another's, with a guide down both", () => {
    expect(snapMove([box(304, 250)], [box(300, 0, 300)], guidesOnly)).toEqual({ dx: -4, dy: 0, guides: [{ axis: "x", at: 300, from: 0, to: 350 }] });
  });

  it("lines up either edge with either edge, and middles with middles", () => {
    // Its left edge goes to the other's right edge.
    expect(snapMove([box(603, 250)], [box(300, 0, 300)], guidesOnly)).toEqual({ dx: -3, dy: 0, guides: [{ axis: "x", at: 600, from: 0, to: 350 }] });
    // A narrower box's middle goes to the other's middle.
    expect(snapMove([box(352, 250, 100)], [box(300, 0)], guidesOnly)).toEqual({ dx: -2, dy: 0, guides: [{ axis: "x", at: 400, from: 0, to: 350 }] });
    // And across: its top goes to the other's top.
    expect(snapMove([box(600, 4)], [box(0, 0, 200, 60)], guidesOnly)).toEqual({ dx: 0, dy: -4, guides: [{ axis: "y", at: 0, from: 0, to: 800 }] });
    // Not an edge with a middle: its top is 2 below the other's middle, and stays there.
    expect(snapMove([box(600, 52)], [box(0, 0)], guidesOnly)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("draws a guide along each line two boxes the same size share", () => {
    expect(snapMove([box(303, 250)], [box(300, 0)], guidesOnly).guides).toEqual([
      { axis: "x", at: 300, from: 0, to: 350 },
      { axis: "x", at: 400, from: 0, to: 350 },
      { axis: "x", at: 500, from: 0, to: 350 },
    ]);
  });

  it("goes to the nearest line within reach, and leaves a box out of reach where it is", () => {
    expect(snapMove([box(305, 250)], [box(300, 0), box(307, 500)], guidesOnly)).toMatchObject({ dx: 2 });
    expect(snapMove([box(307, 250)], [box(300, 0)], guidesOnly)).toEqual({ dx: 0, dy: 0, guides: [] });
    // Reach is on the diagram: further when zoomed out.
    expect(snapMove([box(307, 250)], [box(300, 0)], { ...guidesOnly, reach: 12 })).toMatchObject({ dx: -7 });
  });

  it("draws one guide for boxes lined up on the same line", () => {
    const { guides } = snapMove([box(302, 250, 150)], [box(300, 0), box(300, 600, 120)], guidesOnly);
    expect(guides).toEqual([{ axis: "x", at: 300, from: 0, to: 700 }]);
  });

  it("moves boxes dragged together by the same amount, when any of them lines up", () => {
    expect(snapMove([box(0, 0), box(497, 203)], [box(800, 200)], guidesOnly)).toMatchObject({ dx: 0, dy: -3 });
    // The first isn't near anything, and the second's right edge is 3 short of the other's left.
    expect(snapMove([box(0, 0), box(597, 400)], [box(800, 200)], guidesOnly)).toMatchObject({ dx: 3, dy: 0 });
  });

  it("puts the top left corner on the grid, and lines up first when both are on", () => {
    expect(GRID).toBe(20);
    expect(snapMove([box(313, 248)], [], gridOnly)).toEqual({ dx: 7, dy: -8, guides: [] });
    expect(snapMove([box(-9, -11)], [], gridOnly)).toEqual({ dx: 9, dy: -9, guides: [] });
    // 3 right of another box, it lines up with it across. Down, it lines up with nothing, so it goes to the grid.
    expect(snapMove([box(303, 248)], [box(300, 0, 300)], both)).toEqual({ dx: -3, dy: -8, guides: [{ axis: "x", at: 300, from: 0, to: 340 }] });
    // Boxes dragged together keep their places among each other: the top left of them all goes to the grid.
    expect(snapMove([box(113, 248), box(405, 501)], [], gridOnly)).toMatchObject({ dx: 7, dy: -8 });
  });

  it("shows a guide where the grid happens to line a box up with another, unless guides are off", () => {
    expect(snapMove([box(309, 248)], [box(300, 0, 300)], both)).toEqual({ dx: -9, dy: -8, guides: [{ axis: "x", at: 300, from: 0, to: 340 }] });
    expect(snapMove([box(309, 248)], [box(300, 0, 300)], gridOnly)).toEqual({ dx: -9, dy: -8, guides: [] });
  });

  it("leaves what's dragged as it is with both off, or with nothing dragged", () => {
    expect(snapMove([box(303, 248)], [box(300, 0)], { guides: false, grid: false, reach: 6 })).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(snapMove([], [box(300, 0)], both)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe("snapResize", () => {
  const sized = { reach: 6, min: 20 };

  it("lines the edge being dragged up with another box's edge, with a guide along it alone", () => {
    // Its right edge, at 397, goes to the other's right edge, at 400. Its left edge, at 0, lines up with the other's too, but stays as it is, with no guide.
    expect(snapResize(box(0, 300, 397), { x: "end" }, [box(0, 0, 400)], { ...guidesOnly, ...sized })).toEqual({
      rect: box(0, 300, 400),
      guides: [{ axis: "x", at: 400, from: 0, to: 400 }],
    });
    // Its bottom, at 204, goes to the other's top, at 200.
    expect(snapResize(box(500, 0, 200, 204), { y: "end" }, [box(0, 200)], { ...guidesOnly, ...sized })).toEqual({
      rect: box(500, 0, 200, 200),
      guides: [{ axis: "y", at: 200, from: 0, to: 700 }],
    });
  });

  it("moves its left or top edge, and keeps its right and bottom where they are", () => {
    // Dragged by its top left corner: its left goes to 300, its top to 0.
    expect(snapResize(box(303, -2, 297, 102), { x: "start", y: "start" }, [box(300, -400, 50, 50), box(0, 0)], { ...guidesOnly, ...sized }).rect).toEqual(box(300, 0, 300, 100));
  });

  it("lines up an edge with edges, not with middles", () => {
    // Its right edge is 2 from the other's middle, and stays where it is.
    expect(snapResize(box(0, 300, 98), { x: "end" }, [box(0, 0)], { ...guidesOnly, ...sized })).toEqual({ rect: box(0, 300, 98), guides: [] });
  });

  it("puts the edge being dragged on the grid, and lines up first when both are on", () => {
    expect(snapResize(box(10, 10, 133, 77), { x: "end", y: "end" }, [], { ...gridOnly, ...sized }).rect).toEqual(box(10, 10, 130, 70));
    expect(snapResize(box(13, 10, 133, 77), { x: "start" }, [], { ...gridOnly, ...sized }).rect).toEqual(box(20, 10, 126, 77));
    // Its right edge lines up with the other's left, 3 away, not the grid line 3 the other way.
    expect(snapResize(box(0, 300, 503), { x: "end" }, [box(506, 0)], { ...both, ...sized }).rect).toEqual(box(0, 300, 506));
  });

  it("doesn't make the box smaller than it can be", () => {
    // Snapping to the grid at 20 would make it 10 across.
    expect(snapResize(box(10, 10, 19, 100), { x: "end" }, [], { ...gridOnly, ...sized }).rect).toEqual(box(10, 10, 19, 100));
    // Lining up with the other's right edge would make it 5 across; its left edge, 4 further, isn't in reach.
    expect(snapResize(box(0, 300, 21), { x: "end" }, [box(-200, 0, 205)], { ...guidesOnly, ...sized }).rect).toEqual(box(0, 300, 21));
  });

  it("leaves it as it is with both off, or when no edge has moved", () => {
    expect(snapResize(box(0, 300, 397), { x: "end" }, [box(0, 0, 400)], { guides: false, grid: false, ...sized })).toEqual({ rect: box(0, 300, 397), guides: [] });
    expect(snapResize(box(3, 303, 397), {}, [box(0, 0, 400)], { ...both, ...sized })).toEqual({ rect: box(3, 303, 397), guides: [] });
  });
});
