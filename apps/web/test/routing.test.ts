import { describe, expect, it } from "vitest";
import type { Point } from "../src/canvas/autoLayout.js";
import { crossings, layoutArrows, placeLabels, routeLinks, type Box, type Link } from "../src/canvas/routing.js";

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

function crossingCount(routes: Point[][]) {
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
    expect(crossingCount([...routes.values()])).toBe(0);
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

  it("draws a straight line between boxes whose facing sides only just line up", () => {
    // b is 58px higher than a: the only stretch where both sides can take an arrow is 2px tall.
    const boxes = new Map([
      ["a", { x: 0, y: 480, w: 220, h: 100 }],
      ["b", { x: 640, y: 422, w: 220, h: 100 }],
    ]);
    const route = check(boxes, [link("a", "b")]).get("a->b")!;
    expect(route).toHaveLength(2);
    expect(route[0]!.y).toBe(route[1]!.y);
  });

  it("gives two arrows their own straight lines where boxes face along room for both", () => {
    // a and b face each other along 50px: two lines 24px apart fit.
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 120 }],
      ["b", { x: 82, y: 150, w: 220, h: 120 }],
    ]);
    const routes = check(boxes, [link("a", "b"), link("b", "a")]);
    const [ab, ba] = [routes.get("a->b")!, routes.get("b->a")!];
    expect(ab).toHaveLength(2);
    expect(ba).toHaveLength(2);
    expect(Math.abs(ab[0]!.x - ba[0]!.x)).toBeGreaterThanOrEqual(24);
  });

  it("draws a straight line between facing boxes closer together than the space kept around them", () => {
    for (const gap of [10, 40]) {
      const boxes = new Map([
        ["a", at(0, 0)],
        ["b", at(30, H + gap)],
        ["c", at(400, 0)],
        ["d", at(400 + W + gap, 30)],
      ]);
      const routes = check(boxes, [link("a", "b"), link("d", "c")]);
      expect(routes.get("a->b"), `${gap}px apart, one above the other`).toHaveLength(2);
      expect(routes.get("d->c"), `${gap}px apart, side by side`).toHaveLength(2);
    }
  });

  it("keeps two arrows between close boxes apart", () => {
    // From wide apart to only just facing each other: b at x=130 faces a along 2px.
    for (const x of [20, 120, 128, 130]) {
      const boxes = new Map([
        ["a", { x: 0, y: 0, w: 220, h: 120 }],
        ["b", { x, y: 150, w: 220, h: 120 }],
      ]);
      const routes = check(boxes, [link("a", "b"), link("b", "a")]);
      // With plenty of room where they face, both are straight.
      if (x === 20) for (const id of ["a->b", "b->a"]) expect(routes.get(id), id).toHaveLength(2);
      for (const [p, q] of segments(routes.get("a->b")!)) {
        for (const [r, t] of segments(routes.get("b->a")!)) {
          const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
          const together =
            (p.x === q.x && r.x === t.x && Math.abs(p.x - r.x) < 10 && overlap(p.y, q.y, r.y, t.y) > 0) ||
            (p.y === q.y && r.y === t.y && Math.abs(p.y - r.y) < 10 && overlap(p.x, q.x, r.x, t.x) > 0);
          expect(together, `b at x=${x}: ${JSON.stringify([p, q])} on or beside ${JSON.stringify([r, t])}`).toBe(false);
        }
      }
    }
  });

  it("doesn't leave a 1px kink between boxes that face each other along less than a pixel", () => {
    // No straight line fits, so the route has to step: both ends are as close to lining up as
    // their sides allow, 11px apart, which reads as a step rather than a glitch.
    const boxes = new Map([
      ["b0", { x: 639, y: 282, w: 223, h: 106 }],
      ["b1", { x: 288, y: 207, w: 213, h: 121 }],
    ]);
    for (const route of check(boxes, [link("b0", "b1"), link("b1", "b0")]).values()) {
      segments(route).forEach(([p, q], k, all) => {
        if (k > 0 && k < all.length - 1) expect(Math.hypot(q.x - p.x, q.y - p.y), JSON.stringify(route)).toBeGreaterThanOrEqual(10);
      });
    }
  });

  it("leaves arrows alone when a note moves around out of their way", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(300, 300)],
      ["c", at(600, 0)],
    ]);
    const links = [link("a", "b"), link("c", "b"), link("a", "c")];
    const without = check(boxes, links);
    // Notes below the boxes, lined up with b's sides in different places.
    for (let x = 200; x <= 500; x += 30) expect(routeLinks(boxes, links, [], [{ x, y: 600, w: 200, h: 150 }])).toEqual(without);
  });

  it("leaves arrows alone when a box they don't touch moves past", () => {
    // c slides along under b, its sides lining up with b's in different places.
    const boxes = (x: number) =>
      new Map([
        ["a", at(0, 0)],
        ["b", at(300, 300)],
        ["d", at(700, 0)],
        ["c", at(x, 700)],
      ]);
    const links = [link("a", "b"), link("d", "b"), link("a", "d")];
    const first = routeLinks(boxes(200), links);
    for (let x = 208; x <= 520; x += 8) {
      const now = routeLinks(boxes(x), links);
      for (const l of links) expect(now.get(l.id), `${l.id} with c at x=${x}`).toEqual(first.get(l.id));
    }
  });

  it("keeps arrows from running just beside each other", () => {
    // Without the rule, b->c turns along y=288, 3px from d->a along y=291.
    const boxes = new Map([
      ["a", at(275, 268)],
      ["b", at(433, 37)],
      ["c", at(584, 509)],
      ["d", at(595, 213)],
    ]);
    const links = [link("a", "c"), link("b", "c"), link("d", "a")];
    const routes = [...check(boxes, links).values()];
    routes.forEach((route, k) => {
      for (const other of routes.slice(k + 1)) {
        for (const [p, q] of segments(route)) {
          for (const [r, t] of segments(other)) {
            const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
            const beside =
              (p.x === q.x && r.x === t.x && p.x !== r.x && Math.abs(p.x - r.x) < 10 && overlap(p.y, q.y, r.y, t.y) > 0) ||
              (p.y === q.y && r.y === t.y && p.y !== r.y && Math.abs(p.y - r.y) < 10 && overlap(p.x, q.x, r.x, t.x) > 0);
            expect(beside, `${JSON.stringify([p, q])} beside ${JSON.stringify([r, t])}`).toBe(false);
          }
        }
      }
    });
  });

  it("goes around a note in the way", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(0, 400)],
    ]);
    const note = { x: 50, y: 200, w: 120, h: 80 };
    const route = routeLinks(boxes, [link("a", "b")], [], [note]).get("a->b")!;
    for (const s of segments(route)) expect(cuts(s, note), "goes under the note").toBe(false);
  });

  it("doesn't straighten a route into crossing another by its arrowhead", () => {
    // Straightening b2->b0 by turning it 20px off b2's side, inside b2's clear space, would cross b0->b2 just before it reaches b2.
    const boxes = new Map([
      ["b0", { x: 398, y: 140, w: 214, h: 91 }],
      ["b1", { x: 97, y: 46, w: 214, h: 120 }],
      ["b2", { x: 217, y: 279, w: 226, h: 95 }],
      ["b3", { x: 8, y: 271, w: 163, h: 112 }],
      ["b4", { x: 368, y: 2, w: 203, h: 97 }],
    ]);
    const links = [
      link("b0", "b1"),
      link("b2", "b4"),
      link("b4", "b0"),
      link("b3", "b4"),
      link("b0", "b2"),
      link("b2", "b0"),
      link("b2", "b1"),
      link("b0", "b4"),
    ];
    expect(crossings(check(boxes, links)).size).toBe(0);
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

  it("slides a label along its route to keep clear of a label beside it", () => {
    // Two routes 40px apart, side by side: labels at both middles would overlap.
    const routes = new Map([
      ["a", [{ x: 0, y: 0 }, { x: 600, y: 0 }]],
      ["b", [{ x: 0, y: 40 }, { x: 600, y: 40 }]],
    ]);
    const sizes = new Map([["a", size], ["b", size]]);
    const labels = placeLabels(routes, sizes, []);
    const [la, lb] = [labels.get("a")!, labels.get("b")!];
    expect(Math.abs(la.x - lb.x)).toBeGreaterThanOrEqual(size.w);
  });

  it("keeps a label off another arrow where it can", () => {
    // b runs down past the middle of a.
    const routes = new Map([
      ["a", [{ x: 0, y: 0 }, { x: 600, y: 0 }]],
      ["b", [{ x: 300, y: -200 }, { x: 300, y: 200 }]],
    ]);
    const at = placeLabels(routes, new Map([["a", size]]), []).get("a")!;
    expect(Math.abs(at.x - 300)).toBeGreaterThanOrEqual(size.w / 2);
  });

  it("draws a label narrower to fit between boxes too close for it", () => {
    const boxes = [
      { x: -250, y: -50, w: 220, h: 100 },
      { x: 30, y: -50, w: 220, h: 100 },
    ];
    const route = [
      { x: -30, y: 0 },
      { x: 30, y: 0 },
    ];
    const wide = { w: 190, h: 51 };
    const narrow = { w: 50, h: 80 };
    expect(placeLabels(new Map([["r", route]]), new Map([["r", [wide, narrow]]]), boxes).get("r")).toEqual({ x: 0, y: 0 });
    const at = layoutArrows(
      new Map([["a", boxes[0]!], ["b", boxes[1]!]]),
      [link("a", "b")],
      new Map([["a->b", [wide, narrow]]]),
    ).labels.get("a->b")!;
    expect(at.w).toBe(50);
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

describe("layoutArrows", () => {
  const labelled = (links: Link[]) => new Map(links.map((l) => [l.id, [{ w: 190, h: 37 }]]));

  it("takes a route with room for its label over one that squeezes it in", () => {
    // From the containers view: a leaves its right side for c's top, so its label
    // has to share the gap above c with b's. Leaving a's bottom for c's left side
    // costs nothing more, and its label has the space below a to itself.
    const boxes = new Map([
      ["a", { x: 46, y: 28, w: 220, h: 103 }],
      ["b", { x: 441, y: 52, w: 220, h: 103 }],
      ["c", { x: 320, y: 260, w: 220, h: 113 }],
    ]);
    const links = [link("a", "c"), link("b", "c")];
    expect(routeLinks(boxes, links).get("a->c")![0]!.x).toBe(266);
    const { routes, labels } = layoutArrows(boxes, links, labelled(links));
    const a = routes.get("a->c")!;
    expect(a[0]!.y, "leaves a's bottom").toBe(131);
    expect(a[a.length - 1]!.x, "enters c's left side").toBe(320);
    const [la, lb] = [labels.get("a->c")!, labels.get("b->c")!];
    expect(Math.abs(la.x - lb.x) >= 190 || Math.abs(la.y - lb.y) >= 37).toBe(true);
  });

  it("doesn't reroute an arrow for its label's sake under a note", () => {
    // Without the check, b1->b2's label pulls it onto a route under the note.
    const boxes = new Map([
      ["b0", { x: 386, y: 1, w: 220, h: 110 }],
      ["b1", { x: 557, y: 170, w: 220, h: 110 }],
      ["b2", { x: 372, y: 565, w: 220, h: 110 }],
      ["b3", { x: 458, y: 400, w: 220, h: 110 }],
    ]);
    const note = { x: 273, y: 184, w: 120, h: 80 };
    const links = [link("b0", "b2"), link("b1", "b2"), link("b3", "b0"), link("b1", "b3")];
    const { routes } = layoutArrows(boxes, links, labelled(links), { notes: [note] });
    for (const [id, route] of routes) for (const s of segments(route)) expect(cuts(s, note), `${id} goes under the note`).toBe(false);
  });

  it("leaves arrows and labels alone when a note moves around out of their way", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(300, 300)],
      ["c", at(600, 0)],
    ]);
    const links = [link("a", "b"), link("c", "b"), link("a", "c")];
    const without = layoutArrows(boxes, links, labelled(links));
    for (let x = 200; x <= 500; x += 30) expect(layoutArrows(boxes, links, labelled(links), { notes: [{ x, y: 600, w: 200, h: 150 }] })).toEqual(without);
  });

  it("still reroutes an arrow it can help when arrows it can't help are more crowded", () => {
    // As above, plus pairs of boxes 30px apart whose labels are squeezed between them:
    // any other route between them would be far too long, so they don't take a turn.
    const boxes = new Map([
      ["a", { x: 46, y: 28, w: 220, h: 103 }],
      ["b", { x: 441, y: 52, w: 220, h: 103 }],
      ["c", { x: 320, y: 260, w: 220, h: 113 }],
    ]);
    const links = [link("a", "c"), link("b", "c")];
    for (let k = 0; k < 10; k++) {
      boxes.set(`p${k}`, { x: 1000 + 300 * k, y: 0, w: 220, h: 120 });
      boxes.set(`q${k}`, { x: 1000 + 300 * k, y: 150, w: 220, h: 120 });
      links.push(link(`p${k}`, `q${k}`));
    }
    expect(layoutArrows(boxes, links, labelled(links)).routes.get("a->c")![0]!.y, "leaves a's bottom").toBe(131);
  });

  it("keeps a straight arrow between boxes too close for its label", () => {
    const boxes = new Map([
      ["a", at(0, 0)],
      ["b", at(0, H + 50)],
    ]);
    const links = [link("a", "b")];
    expect(layoutArrows(boxes, links, labelled(links)).routes.get("a->b")).toHaveLength(2);
  });
});

describe("crossings", () => {
  it("puts the crossing on the arrow running across, not the one running down", () => {
    const routes = new Map([
      ["across", [{ x: 0, y: 100 }, { x: 300, y: 100 }]],
      ["down", [{ x: 150, y: 0 }, { x: 150, y: 200 }]],
    ]);
    expect(crossings(routes)).toEqual(new Map([["across", [{ x: 150, y: 100 }]]]));
  });

  it("doesn't count arrows that only meet at an end or a corner", () => {
    const routes = new Map([
      ["across", [{ x: 0, y: 100 }, { x: 300, y: 100 }]],
      ["ends-on-it", [{ x: 150, y: 0 }, { x: 150, y: 100 }]],
      ["turns-off-it", [{ x: 300, y: 100 }, { x: 300, y: 300 }]],
    ]);
    expect(crossings(routes).size).toBe(0);
  });

  it("lists crossings in order along the route", () => {
    const routes = new Map([
      ["across", [{ x: 300, y: 100 }, { x: 0, y: 100 }]],
      ["near", [{ x: 250, y: 0 }, { x: 250, y: 200 }]],
      ["far", [{ x: 50, y: 0 }, { x: 50, y: 200 }]],
    ]);
    expect(crossings(routes).get("across")!.map((p) => p.x)).toEqual([250, 50]);
  });
});
