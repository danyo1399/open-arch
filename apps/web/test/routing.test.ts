import { describe, expect, it } from "vitest";
import type { Point } from "../src/canvas/autoLayout.js";
import { placeLabels, routeLinks, type Box, type Link } from "../src/canvas/routing.js";

const W = 220;
const H = 120;
const at = (x: number, y: number): Box => ({ x, y, w: W, h: H });
const link = (from: string, to: string): Link => ({ id: `${from}->${to}`, from, to });

const segments = (points: Point[]) => points.slice(1).map((b, k) => [points[k]!, b] as const);

/** Whether a horizontal or vertical run passes through the inside of a box. */
function cuts([a, b]: readonly [Point, Point], box: Box) {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const overlaps = (lo: number, hi: number, start: number, end: number) => (lo === hi ? lo > start && lo < end : lo < end && hi > start);
  return overlaps(x0, x1, box.x, box.x + box.w) && overlaps(y0, y1, box.y, box.y + box.h);
}

function onBorder(p: Point, box: Box) {
  const inX = p.x >= box.x && p.x <= box.x + box.w;
  const inY = p.y >= box.y && p.y <= box.y + box.h;
  return (inX && (p.y === box.y || p.y === box.y + box.h)) || (inY && (p.x === box.x || p.x === box.x + box.w));
}

function crossings(routes: Point[][]) {
  let count = 0;
  routes.forEach((r, i) => {
    for (const other of routes.slice(i + 1)) {
      for (const [a, b] of segments(r)) {
        for (const [c, d] of segments(other)) {
          const [h, v] = a.y === b.y ? [[a, b], [c, d]] : [[c, d], [a, b]];
          const [h0, h1, v0, v1] = [h[0]!, h[1]!, v[0]!, v[1]!];
          if (h0.y !== h1.y || v0.x !== v1.x) continue;
          const x = v0.x;
          const y = h0.y;
          if (x > Math.min(h0.x, h1.x) && x < Math.max(h0.x, h1.x) && y > Math.min(v0.y, v1.y) && y < Math.max(v0.y, v1.y)) count++;
        }
      }
    }
  });
  return count;
}

function check(boxes: Map<string, Box>, links: Link[], frames: Box[] = []) {
  const routes = routeLinks(boxes, links, frames);
  for (const l of links) {
    const points = routes.get(l.id)!;
    expect(points.length, l.id).toBeGreaterThanOrEqual(2);
    expect(onBorder(points[0]!, boxes.get(l.from)!), `${l.id} starts on its source`).toBe(true);
    expect(onBorder(points[points.length - 1]!, boxes.get(l.to)!), `${l.id} ends on its target`).toBe(true);
    for (const s of segments(points)) {
      expect(s[0].x === s[1].x || s[0].y === s[1].y, `${l.id} runs straight across or down`).toBe(true);
      for (const [id, box] of boxes) expect(cuts(s, box), `${l.id} goes through ${id}`).toBe(false);
    }
  }
  return routes;
}

describe("routeLinks", () => {
  it("goes around a box in the way", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(0, 250)],
      ["c", at(0, 500)],
    ]);
    const routes = check(boxes, [link("a", "c")]);
    expect(routes.get("a->c")!.length).toBeGreaterThan(2);
  });

  it("draws a straight line between boxes that face each other", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(0, 300)],
    ]);
    expect(check(boxes, [link("a", "b")]).get("a->b")).toEqual([
      { x: 110, y: 120 },
      { x: 110, y: 300 },
    ]);
  });

  it("keeps arrows going both ways between two boxes apart", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(0, 300)],
    ]);
    const routes = check(boxes, [link("a", "b"), link("b", "a")]);
    const xs = (id: string) => routes.get(id)!.map((p) => p.x);
    expect(new Set([...xs("a->b"), ...xs("b->a")]).size).toBe(2);
  });

  it("goes around the side that avoids a crossing", () => {
    // a, b and c in a row, d below b: a->c can pass over or under b, and under crosses b->d.
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(300, 0)],
      ["c", at(600, 0)],
      ["d", at(300, 300)],
    ]);
    const routes = check(boxes, [link("a", "c"), link("b", "d")]);
    expect(crossings([...routes.values()])).toBe(0);
    expect(Math.max(...routes.get("a->c")!.map((p) => p.y))).toBeLessThanOrEqual(0);
  });

  it("keeps off the sides of a boundary frame", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(0, 400)],
    ]);
    expect(check(boxes, [link("a", "b")]).get("a->b")!.map((p) => p.x)).toEqual([110, 110]);
    // A frame whose left side runs 5px from that straight line.
    const frame = { x: 105, y: -100, w: 400, h: 800 };
    const route = check(boxes, [link("a", "b")], [frame]).get("a->b")!;
    for (const [p, q] of segments(route)) {
      if (p.x === q.x) expect(Math.abs(p.x - frame.x), `runs down the frame's side at x=${p.x}`).toBeGreaterThanOrEqual(16);
    }
  });

  it("attaches where a route already lines up, rather than jogging to the middle of a side", () => {
    // b is shifted right of a, so a->b can drop straight down off-centre.
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(40, 300)],
    ]);
    expect(check(boxes, [link("a", "b")]).get("a->b")).toHaveLength(2);
  });

  it("routes a busy diagram without going through boxes", () => {
    const boxes = new Map<string, Box>();
    for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) boxes.set(`n${row}${col}`, at(col * 320, row * 260));
    const ids = [...boxes.keys()];
    const links = ids.flatMap((id, k) => [link(id, ids[(k + 7) % ids.length]!), link(id, ids[(k + 3) % ids.length]!)]);
    check(boxes, links);
  });

  it("falls back to a straight line when there's no way out", () => {
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 500, h: 400 }],
      ["b", { x: 150, y: 150, w: 100, h: 60 }],
    ]);
    expect(routeLinks(boxes, [link("a", "b")]).get("a->b")).toHaveLength(2);
  });
});

describe("placeLabels", () => {
  const route = [
    { x: 0, y: 0 },
    { x: 0, y: 400 },
  ];
  const size = { w: 100, h: 40 };

  it("puts a label in the middle of its route when nothing's in the way", () => {
    expect(placeLabels(new Map([["r", route]]), new Map([["r", size]]), []).get("r")).toEqual({ x: 0, y: 200 });
  });

  it("moves a label off a box beside the route", () => {
    const box = { x: 20, y: 150, w: 200, h: 100 };
    const at = placeLabels(new Map([["r", route]]), new Map([["r", size]]), [box]).get("r")!;
    expect(at.y + size.h / 2 <= box.y || at.y - size.h / 2 >= box.y + box.h).toBe(true);
  });

  it("keeps labels on parallel routes from covering each other", () => {
    const routes = new Map([
      ["a", route],
      ["b", route.map((p) => ({ ...p, x: 50 }))],
    ]);
    const labels = placeLabels(routes, new Map([["a", size], ["b", size]]), []);
    expect(Math.abs(labels.get("a")!.y - labels.get("b")!.y)).toBeGreaterThanOrEqual(size.h);
  });
});
