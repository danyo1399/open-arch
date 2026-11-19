import { describe, expect, it } from "vitest";
import { elkLayout, gridLayout, layOut, loadOnce, NODE_H, NODE_W, placeMissing, placeStickies, ROW_GAP, rowGap, STICKY, stickyHeight, TOUCH_STICKY } from "../src/canvas/autoLayout.js";

describe("layOut", () => {
  const nodes = [
    { id: "customer", inside: false },
    { id: "api", inside: true },
    { id: "web", inside: true },
  ];

  it("uses ELK's positions", async () => {
    const positions = { customer: { x: 0, y: 0 }, api: { x: 0, y: 300 }, web: { x: 300, y: 300 } };
    expect(await layOut(nodes, [], async () => positions)).toEqual({ positions, failed: false });
  });

  it("still places every box when ELK can't be loaded", async () => {
    // As when the app was updated after the page was opened, and ELK's file is gone.
    const result = await layOut(nodes, [{ from: "customer", to: "api" }], () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    expect(result).toEqual({ positions: gridLayout(nodes), failed: true });
    expect(Object.keys(result.positions).sort()).toEqual(["api", "customer", "web"]);
  });

  it("places a box added to a laid out view beside the others when ELK can't be loaded", async () => {
    const saved = { api: { x: 500, y: 400 }, web: { x: 800, y: 400 } };
    const { positions } = await layOut(nodes, [], () => Promise.reject(new Error("no ELK")));
    const placed = placeMissing(["customer", "api", "web"], saved, positions);
    expect(placed.api).toEqual(saved.api);
    expect(placed.web).toEqual(saved.web);
    const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;
    expect(overlaps(placed.customer!, saved.api) || overlaps(placed.customer!, saved.web)).toBe(false);
  });
});

describe("rowGap", () => {
  const label = (h: number, w = 120) => ({ w, h });

  it("is the usual gap when no arrow has a label, or a short label on its own fits in it", () => {
    expect(rowGap([])).toBe(ROW_GAP);
    expect(rowGap([{ from: "a", to: "b" }, { from: "a", to: "c" }])).toBe(ROW_GAP);
    expect(rowGap([{ from: "a", to: "b", label: label(24) }])).toBe(ROW_GAP);
    // Labels on arrows that share no box each have a gap of their own.
    expect(rowGap([{ from: "a", to: "b", label: label(24) }, { from: "b", to: "c", label: label(24) }, { from: "c", to: "d", label: label(24) }])).toBe(ROW_GAP);
  });

  it("is more for a label on its own too tall for the usual gap", () => {
    // Three lines or so: the label, and the room at each end of its arrow.
    expect(rowGap([{ from: "a", to: "b", label: label(80) }])).toBe(80 + 2 * 24);
    // The tallest it can be and still fit.
    expect(rowGap([{ from: "a", to: "b", label: label(ROW_GAP - 2 * 24) }])).toBe(ROW_GAP);
  });

  it("makes room for the labels of the arrows leaving one box, one above the other", () => {
    const two = [{ from: "a", to: "b", label: label(24) }, { from: "a", to: "c", label: label(24) }];
    // Two labels, the space between them, and the room at each end of the arrows.
    expect(rowGap(two)).toBe(24 + 24 + 24 + 2 * 24);
    expect(rowGap([...two, { from: "a", to: "d", label: label(24) }])).toBe(3 * 24 + 2 * 24 + 2 * 24);
    // An arrow with no label needs no room.
    expect(rowGap([...two, { from: "a", to: "d" }])).toBe(rowGap(two));
  });

  it("makes the same room for the labels of the arrows arriving at one box", () => {
    expect(rowGap([{ from: "a", to: "d", label: label(24) }, { from: "b", to: "d", label: label(24) }, { from: "c", to: "d", label: label(24) }])).toBe(3 * 24 + 2 * 24 + 2 * 24);
  });

  it("makes room for three labels at most, the tallest ones", () => {
    const heights = [24, 40, 24, 56, 24];
    const fan = heights.map((h, k) => ({ from: "a", to: `b${k}`, label: label(h) }));
    expect(rowGap(fan)).toBe(56 + 40 + 24 + 2 * 24 + 2 * 24);
    // A label that wraps onto part of a pixel still fits.
    expect(rowGap([{ from: "a", to: "b", label: label(50.4) }, { from: "a", to: "c", label: label(50.4) }])).toBe(173);
  });

  it("makes room for the widest label where the boxes are in columns", () => {
    const links = [{ from: "a", to: "b", label: label(24, 40) }, { from: "a", to: "c", label: label(24, 190) }];
    expect(rowGap(links, false)).toBe(190 + 2 * 24);
    expect(rowGap([{ from: "a", to: "b", label: label(24, 40) }], false)).toBe(ROW_GAP);
    expect(rowGap([{ from: "a", to: "b" }], false)).toBe(ROW_GAP);
  });
});

describe("elkLayout", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id, inside: false }));
  const fan = (label?: { w: number; h: number }) => ["b", "c", "d"].map((to) => ({ from: "a", to, ...(label && { label }) }));

  it("puts the rows further apart when the arrows between them have labels to fit", async () => {
    const plain = await elkLayout(nodes, fan());
    expect(plain.b!.y - plain.a!.y).toBe(NODE_H + ROW_GAP);
    const labelled = await elkLayout(nodes, fan({ w: 120, h: 24 }));
    expect(labelled.b!.y - labelled.a!.y).toBe(NODE_H + 168);
    // Only the rows move apart: the boxes in a row are as they were.
    for (const id of ["b", "c", "d"]) expect(labelled[id]!.x).toBe(plain[id]!.x);
  });

  it("puts the boxes inside the frame further apart too", async () => {
    const inside = nodes.map((n) => ({ ...n, inside: true }));
    const labelled = await elkLayout(inside, fan({ w: 120, h: 24 }));
    expect(labelled.b!.y - labelled.a!.y).toBe(NODE_H + 168);
  });

  it("puts columns further apart for a wide label", async () => {
    const across = { "elk.direction": "RIGHT" };
    const plain = await elkLayout(nodes, fan(), across);
    expect(plain.b!.x - plain.a!.x).toBe(NODE_W + ROW_GAP);
    const labelled = await elkLayout(nodes, fan({ w: 190, h: 24 }), across);
    expect(labelled.b!.x - labelled.a!.x).toBe(NODE_W + 190 + 48);
  });
});

describe("gridLayout", () => {
  it("puts boxes in rows of four that don't overlap, with the ones inside the frame below the rest", () => {
    const nodes = [
      ...["a", "b", "c", "d", "e"].map((id) => ({ id, inside: false })),
      ...["x", "y"].map((id) => ({ id, inside: true })),
    ];
    const at = gridLayout(nodes);
    expect(new Set(["a", "b", "c", "d"].map((id) => at[id]!.y)).size).toBe(1);
    expect(at.e!.y).toBeGreaterThan(at.a!.y);
    const boxes = Object.values(at);
    for (const [i, p] of boxes.entries()) {
      for (const q of boxes.slice(i + 1)) expect(Math.abs(p.x - q.x) >= NODE_W || Math.abs(p.y - q.y) >= NODE_H).toBe(true);
    }
    // The frame starts 56px above the boxes inside it.
    const lowestOutside = Math.max(...["a", "b", "c", "d", "e"].map((id) => at[id]!.y + NODE_H));
    expect(Math.min(at.x!.y, at.y!.y) - 56).toBeGreaterThan(lowestOutside);
  });

  it("starts the boxes inside the frame at the top when there are none outside it", () => {
    expect(gridLayout([{ id: "x", inside: true }])).toEqual({ x: { x: 0, y: 0 } });
  });
});

describe("loadOnce", () => {
  it("loads once and keeps what it loaded", async () => {
    let loads = 0;
    const load = loadOnce(async () => ++loads);
    expect(await load()).toBe(1);
    expect(await load()).toBe(1);
    expect(loads).toBe(1);
  });

  it("loads again after a load that failed", async () => {
    let loads = 0;
    const load = loadOnce(async () => {
      if (++loads === 1) throw new Error("offline");
      return "ELK";
    });
    await expect(load()).rejects.toThrow("offline");
    expect(await load()).toBe("ELK");
    expect(loads).toBe(2);
  });
});

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
