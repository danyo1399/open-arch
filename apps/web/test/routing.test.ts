import { describe, expect, it } from "vitest";
import type { Point } from "../src/canvas/autoLayout.js";
import { crossings, layoutArrows, MARGIN, placeLabels, routeLinks, type Box, type Link } from "../src/canvas/routing.js";

const W = 220;
const H = 120;
const at = (x: number, y: number): Box => ({ x, y, w: W, h: H });
const link = (from: string, to: string): Link => ({ id: `${from}->${to}`, from, to });

const segments = (points: readonly Point[]) => points.slice(1).map((b, k) => [points[k]!, b] as const);

type Label = Point & { w: number; h: number };
/** How far apart two labels, centred where they're placed, are: corner to corner where neither is level with the other. */
const gapBetween = (a: Label, b: Label) =>
  Math.hypot(Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2), Math.max(0, Math.abs(a.y - b.y) - (a.h + b.h) / 2));

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

function crossingCount(routes: (readonly Point[])[]) {
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

/** Runs of different routes that go the same way closer together than `apart`, alongside each other, but not on the same line. */
function beside(routes: (readonly Point[])[], apart: number) {
  const out: string[] = [];
  const overlap = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
  routes.forEach((route, k) => {
    for (const other of routes.slice(k + 1)) {
      for (const [p, q] of segments(route)) {
        for (const [r, t] of segments(other)) {
          if (
            (p.x === q.x && r.x === t.x && p.x !== r.x && Math.abs(p.x - r.x) < apart && overlap(p.y, q.y, r.y, t.y) > 0) ||
            (p.y === q.y && r.y === t.y && p.y !== r.y && Math.abs(p.y - r.y) < apart && overlap(p.x, q.x, r.x, t.x) > 0)
          )
            out.push(`${JSON.stringify([p, q])} beside ${JSON.stringify([r, t])}`);
        }
      }
    }
  });
  return out;
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

  it("attaches at the middle of a side, rather than nearer a corner to save a little line", () => {
    // b is up and to the left of a: a->b would be a little shorter into b's right side near its bottom corner.
    const up = new Map([
      ["a", { x: 428, y: 297, w: 220, h: 99 }],
      ["b", { x: 260, y: 43, w: 220, h: 99 }],
    ]);
    expect(check(up, [link("a", "b")]).get("a->b")).toEqual([
      { x: 538, y: 297 },
      { x: 538, y: 93 },
      { x: 480, y: 93 },
    ]);
    // d is down and to the left of c: c->d would be a little shorter down from near c's left corner.
    const down = new Map([
      ["c", at(300, 0)],
      ["d", at(0, 300)],
    ]);
    expect(check(down, [link("c", "d")]).get("c->d")).toEqual([
      { x: 410, y: 120 },
      { x: 410, y: 360 },
      { x: 220, y: 360 },
    ]);
  });

  it("leaves a box by the side that faces where the arrow's going", () => {
    // From a container view: each agent's arrows leave by its top for the computer above and by
    // its bottom for the API below, from the middle, not out of a side and turning up or down.
    const boxes = new Map([
      ["computer", { x: 260, y: 43, w: 220, h: 99 }],
      ["windows", { x: 80, y: 304, w: 220, h: 99 }],
      ["mac", { x: 428, y: 297, w: 220, h: 99 }],
      ["api", { x: 206, y: 623, w: 220, h: 99 }],
    ]);
    const links = [link("windows", "computer"), link("mac", "computer"), link("windows", "api"), link("mac", "api")];
    const routes = check(boxes, links, [{ x: 41, y: 241, w: 647, h: 520 }]);
    expect(routes.get("windows->computer")![0], "windows leaves by the middle of its top").toEqual({ x: 190, y: 304 });
    expect(routes.get("mac->computer")![0], "mac leaves by the middle of its top").toEqual({ x: 538, y: 297 });
    expect(routes.get("mac->api")![0], "mac leaves by the middle of its bottom").toEqual({ x: 538, y: 396 });
    expect(routes.get("windows->api"), "windows goes straight down to the api").toHaveLength(2);
  });

  it("spreads arrows out along a side whose middle another arrow has", () => {
    // From the tour's context view, with boxes close above and below p, so all three arrows
    // have to share its left side. support's arrow is straight, into the middle of that side,
    // though r's is shorter and routed first would have taken it. r's and m's attach either
    // side of it.
    const boxes = new Map([
      ["r", { x: 0, y: 0, w: 220, h: 103 }],
      ["p", { x: 320, y: 260, w: 220, h: 114 }],
      ["m", { x: 0, y: 520, w: 220, h: 100 }],
      ["support", { x: -440, y: 260, w: 220, h: 100 }],
      ["above", { x: 320, y: 120, w: 220, h: 100 }],
      ["below", { x: 320, y: 414, w: 220, h: 100 }],
    ]);
    const routes = check(boxes, [link("r", "p"), link("support", "p"), link("p", "m")]);
    expect(routes.get("support->p"), "support goes straight across").toHaveLength(2);
    const ys = [routes.get("r->p")!.at(-1)!, routes.get("support->p")!.at(-1)!, routes.get("p->m")![0]!].map((p) => {
      expect(p.x, "attaches to p's left side").toBe(320);
      return p.y;
    });
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
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
    expect(beside([...check(boxes, links).values()], 10)).toEqual([]);
  });

  it("keeps arrows apart where there's room, rather than running them close beside each other", () => {
    // From a diagram where both of b's arrows left its left side 25px apart and ran side
    // by side for 270px, with their labels crowded together. b->a goes over the top instead.
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 100 }],
      ["b", { x: 700, y: 200, w: 220, h: 100 }],
      ["c", { x: 320, y: 520, w: 220, h: 100 }],
    ]);
    const routes = check(boxes, [link("b", "a"), link("b", "c")]);
    expect(beside([...routes.values()], 50)).toEqual([]);
    expect(routes.get("b->a")![0]!.y, "leaves b's top").toBe(200);
    expect(routes.get("b->a")!.at(-1)!.x, "enters a's right side").toBe(220);
  });

  it("routes two crossing arrows again the other way round, where then neither crosses", () => {
    // From the tour's containers view. customer-app's arrow, routed first, takes the left side of
    // api that support's needs, so support's crosses it to reach api's top. Routed the other way
    // round, support's goes into api's left side and customer-app's into its top.
    const boxes = new Map([
      ["customer", { x: 0, y: 0, w: 220, h: 103 }],
      ["payments", { x: -460, y: 480, w: 220, h: 100 }],
      ["support", { x: -460, y: 240, w: 220, h: 100 }],
      ["courier-app", { x: 840, y: 240, w: 220, h: 117 }],
      ["customer-app", { x: 0, y: 240, w: 220, h: 117 }],
      ["api", { x: 210, y: 480, w: 220, h: 100 }],
    ]);
    const links = [link("courier-app", "api"), link("customer", "customer-app"), link("customer-app", "api"), link("api", "payments"), link("support", "api")];
    const routes = check(boxes, links);
    expect(crossingCount([...routes.values()])).toBe(0);
    expect(routes.get("support->api")!.at(-1)!.x, "support's enters api's left side").toBe(210);
    expect(routes.get("customer-app->api")!.at(-1)!.y, "customer-app's enters api's top").toBe(480);
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

  it("never runs an arrow across or along the stretch where another arrow goes into its box", () => {
    // An arrow's last MARGIN pixels, between its stub and its box, aren't on the grid, so nothing
    // but keeping other routes out of the box's clear space keeps them off it. Crossing at the
    // stub itself is on the grid, and costed, so it's allowed.
    let seed = 11;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
    let layouts = 0;
    while (layouts < 500) {
      const n = 5 + Math.floor(random() * 4);
      const boxes = new Map<string, Box>();
      for (let k = 0; k < n; k++) boxes.set(`b${k}`, { x: Math.round(random() * 700), y: Math.round(random() * 520), w: 60 + Math.round(random() * 170), h: 60 + Math.round(random() * 60) });
      const all = [...boxes.values()];
      if (all.some((a, i) => all.slice(i + 1).some((b) => a.x < b.x + b.w + 10 && b.x < a.x + a.w + 10 && a.y < b.y + b.h + 10 && b.y < a.y + a.h + 10))) continue;
      layouts++;
      const ids = [...boxes.keys()];
      const links = Array.from({ length: n + Math.floor(random() * n) }, (_, k) => {
        const from = ids[Math.floor(random() * n)]!;
        let to = ids[Math.floor(random() * n)]!;
        if (to === from) to = ids[(ids.indexOf(from) + 1) % n]!;
        return { id: `${from}->${to}#${k}`, from, to };
      });
      for (const [how, routes] of [
        ["routeLinks", routeLinks(boxes, links)],
        ["layoutArrows", layoutArrows(boxes, links, new Map(links.map((l) => [l.id, [{ w: 190, h: 37 }]]))).routes],
      ] as const) {
        // None of these routes is boxed in, so none falls back to a diagonal line, which this
        // couldn't check. If a change of seed, sizes or MARGIN makes one, look at it here.
        for (const [id, points] of routes) for (const [p, q] of segments(points)) expect(p.x === q.x || p.y === q.y, `${how}: ${id} runs straight across or down`).toBe(true);
        const ends = [...routes].flatMap(([id, points]) =>
          (
            [
              [points[0]!, points[1]!],
              [points[points.length - 1]!, points[points.length - 2]!],
            ] as const
          ).map(([at, next]) => {
            const d = Math.hypot(next.x - at.x, next.y - at.y);
            return { id, at, stub: { x: at.x + ((next.x - at.x) * Math.min(MARGIN, d)) / d, y: at.y + ((next.y - at.y) * Math.min(MARGIN, d)) / d } };
          }),
        );
        for (const [id, points] of routes) {
          for (const [p, q] of segments(points)) {
            for (const end of ends) {
              // Arrows sharing a place to attach share that stretch too.
              if (end.id === id || same(points[0]!, end.at) || same(points[points.length - 1]!, end.at)) continue;
              const [x0, x1, y0, y1] = [Math.max(Math.min(p.x, q.x), Math.min(end.at.x, end.stub.x)), Math.min(Math.max(p.x, q.x), Math.max(end.at.x, end.stub.x)), Math.max(Math.min(p.y, q.y), Math.min(end.at.y, end.stub.y)), Math.min(Math.max(p.y, q.y), Math.max(end.at.y, end.stub.y))];
              const meets = x0 <= x1 && y0 <= y1 && !(x0 === x1 && y0 === y1 && same({ x: x0, y: y0 }, end.stub));
              expect(meets, `${how}: ${id} ${JSON.stringify(points)} meets the end of ${end.id}`).toBe(false);
            }
          }
        }
      }
    }
  }, 30_000);

  it("goes under a note dropped over a box, rather than leave its arrows no way out", () => {
    // Going round the note would put every place to attach to a inside its clear space.
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 120 }],
      ["b", { x: 600, y: 300, w: 220, h: 120 }],
      ["c", { x: 300, y: 150, w: 100, h: 60 }],
    ]);
    const note = { x: -20, y: -20, w: 260, h: 160 };
    const links = [link("a", "b")];
    expect(routeLinks(boxes, links, [], [note])).toEqual(check(boxes, links));
    expect(layoutArrows(boxes, links, new Map([["a->b", [{ w: 190, h: 37 }]]]), { notes: [note] }).routes.get("a->b")!.length).toBeGreaterThan(2);
  });

  it("still goes round a note in the way while going under another dropped over a box", () => {
    // d->e runs down through the second note unless it goes round it.
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 120 }],
      ["b", { x: 600, y: 300, w: 220, h: 120 }],
      ["c", { x: 300, y: 150, w: 100, h: 60 }],
      ["d", { x: 0, y: 800, w: 220, h: 120 }],
      ["e", { x: 0, y: 1200, w: 220, h: 120 }],
    ]);
    const [overA, betweenDE] = [
      { x: -20, y: -20, w: 260, h: 160 },
      { x: 60, y: 980, w: 100, h: 80 },
    ];
    const links = [link("a", "b"), link("d", "e")];
    for (const [how, routes] of [
      ["routeLinks", routeLinks(boxes, links, [], [overA, betweenDE])],
      ["layoutArrows", layoutArrows(boxes, links, new Map(links.map((l) => [l.id, [{ w: 190, h: 37 }]])), { notes: [overA, betweenDE] }).routes],
    ] as const) {
      for (const s of segments(routes.get("d->e")!)) expect(cuts(s, betweenDE), `${how}: d->e goes under the note between d and e`).toBe(false);
      const ab = routes.get("a->b")!;
      expect(ab.length, `${how}: a->b has a route of its own`).toBeGreaterThan(2);
      for (const [p, q] of segments(ab)) {
        expect(p.x === q.x || p.y === q.y, `${how}: a->b runs straight across or down`).toBe(true);
        expect(cuts([p, q], boxes.get("c")!), `${how}: a->b goes through c`).toBe(false);
      }
    }
  });

  it("keeps an arrow straight between two boxes under the same note, while others go round it", () => {
    // c->d would run straight across the note, so the note goes on the grid, but a and b are both under it.
    const boxes = new Map([
      ["a", { x: 100, y: 50, w: 200, h: 100 }],
      ["b", { x: 100, y: 700, w: 200, h: 100 }],
      ["c", { x: 700, y: 400, w: 200, h: 100 }],
      ["d", { x: -500, y: 400, w: 200, h: 100 }],
    ]);
    const note = { x: 0, y: 0, w: 400, h: 900 };
    const routes = routeLinks(boxes, [link("a", "b"), link("c", "d")], [], [note]);
    expect(routes.get("a->b")).toHaveLength(2);
    for (const s of segments(routes.get("c->d")!)) expect(cuts(s, note), "c->d goes under the note").toBe(false);
  });

  it("never leaves a box with no way out between notes, but goes under them", () => {
    // Notes 10px off both sides of b, and boxes 30px above and below it, close every way out.
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 120 }],
      ["b", { x: 300, y: 300, w: 220, h: 120 }],
      ["u", { x: 300, y: 150, w: 220, h: 120 }],
      ["d", { x: 300, y: 450, w: 220, h: 120 }],
    ]);
    const notes = [
      { x: 240, y: 100, w: 50, h: 500 },
      { x: 530, y: 100, w: 50, h: 500 },
    ];
    for (const s of segments(routeLinks(boxes, [link("a", "b")], [], notes).get("a->b")!)) {
      expect(s[0].x === s[1].x || s[0].y === s[1].y, "a->b runs straight across or down").toBe(true);
      for (const [id, box] of boxes) expect(cuts(s, box), `a->b goes through ${id}`).toBe(false);
    }
    // Going under those notes, it still goes round one well out of its way.
    boxes.set("a", { x: -1200, y: 300, w: 220, h: 120 });
    const far = { x: -600, y: 320, w: 100, h: 80 };
    for (const s of segments(routeLinks(boxes, [link("a", "b")], [], [...notes, far]).get("a->b")!)) expect(cuts(s, far), "a->b goes under the note out of its way").toBe(false);
  });

  it("goes under a note in a narrow gap rather than have no route, when boxes close in every other way", () => {
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 120 }],
      ["b", { x: 40, y: 166, w: 220, h: 120 }],
      ["aLeft", { x: -130, y: 0, w: 100, h: 120 }],
      ["aRight", { x: 250, y: 0, w: 100, h: 120 }],
      ["aTop", { x: 0, y: -150, w: 220, h: 120 }],
      ["bLeft", { x: -90, y: 166, w: 100, h: 120 }],
      ["bRight", { x: 290, y: 166, w: 100, h: 120 }],
      ["bBottom", { x: 40, y: 316, w: 220, h: 120 }],
    ]);
    const note = { x: 30, y: 121, w: 200, h: 44 };
    for (const s of segments(routeLinks(boxes, [link("a", "b")], [], [note]).get("a->b")!)) expect(s[0].x === s[1].x || s[0].y === s[1].y, "a->b runs straight across or down").toBe(true);
  });

  it("doesn't go through a box in the gap between two boxes exactly two clear spaces apart", () => {
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 120 }],
      ["b", { x: 0, y: 168, w: 220, h: 120 }],
      ["c", { x: 100, y: 139, w: 20, h: 10 }],
    ]);
    check(boxes, [link("a", "b")]);
  });

  it("goes round a note between two boxes close together", () => {
    for (const gap of [30, 48]) {
      const boxes = new Map([
        ["a", { x: 0, y: 0, w: 220, h: 120 }],
        ["b", { x: 0, y: 120 + gap, w: 220, h: 120 }],
      ]);
      const note = { x: 90, y: 122, w: 40, h: gap - 4 };
      for (const s of segments(routeLinks(boxes, [link("a", "b")], [], [note]).get("a->b")!)) expect(cuts(s, note), `${gap}px apart: a->b goes under the note`).toBe(false);
    }
  });

  it("goes round however many notes are in the way", () => {
    // A note between each of 34 pairs of boxes.
    const boxes = new Map<string, Box>();
    const notes: Box[] = [];
    const links: Link[] = [];
    for (let k = 0; k < 34; k++) {
      boxes.set(`t${k}`, at(300 * k, 0));
      boxes.set(`b${k}`, at(300 * k, 420));
      notes.push({ x: 300 * k + 60, y: 210, w: 100, h: 80 });
      links.push(link(`t${k}`, `b${k}`));
    }
    const routes = routeLinks(boxes, links, [], notes);
    links.forEach((l, k) => {
      for (const s of segments(routes.get(l.id)!)) expect(cuts(s, notes[k]!), `${l.id} goes under its note`).toBe(false);
    });
  });

  it("goes round a note on a box for links that don't start or end there", () => {
    // The note covers a and reaches across c->d's way: a's arrows go under it, c->d goes round.
    const boxes = new Map([
      ["a", { x: 0, y: 0, w: 220, h: 120 }],
      ["b", { x: 0, y: 400, w: 220, h: 120 }],
      ["c", { x: 500, y: -300, w: 200, h: 100 }],
      ["d", { x: 500, y: 300, w: 200, h: 100 }],
    ]);
    const note = { x: 0, y: -20, w: 800, h: 160 };
    const routes = routeLinks(boxes, [link("a", "b"), link("c", "d")], [], [note]);
    for (const s of segments(routes.get("c->d")!)) expect(cuts(s, note), "c->d goes under the note").toBe(false);
    expect(routes.get("a->b"), "a->b goes straight down, under the note on a").toHaveLength(2);
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

  it("spreads labels on parallel routes apart, rather than stopping as soon as they're clear", () => {
    // Three routes 60px apart, too close for their labels to sit side by side.
    const label = { w: 108, h: 37 };
    const routes = new Map(["a", "b", "c"].map((id, k) => [id, route.map((p) => ({ ...p, x: 60 * k }))]));
    const labels = placeLabels(routes, new Map([...routes.keys()].map((id) => [id, label])), []);
    const [a, b, c] = ["a", "b", "c"].map((id) => ({ ...labels.get(id)!, ...label }));
    expect(gapBetween(a!, b!)).toBeGreaterThanOrEqual(20);
    expect(gapBetween(b!, c!)).toBeGreaterThanOrEqual(20);
  });

  it("draws a label narrower where it would cover an arrow, even with room further along", () => {
    // q runs beside r for most of the way, and p beside its middle. Drawn as wide as
    // it can be, r's label covers q wherever it's near the middle, and p too in the
    // middle, and has room only near r's ends. Narrower, it fits in the middle.
    const routes = new Map([
      ["r", [{ x: 0, y: 0 }, { x: 0, y: 800 }]],
      ["q", [{ x: 60, y: 100 }, { x: 60, y: 700 }]],
      ["p", [{ x: -80, y: 380 }, { x: -80, y: 420 }]],
    ]);
    const at = placeLabels(routes, new Map([["r", [{ w: 186, h: 51 }, { w: 104, h: 51 }]]]), []).get("r");
    expect(at).toEqual({ x: 0, y: 400 });
  });
});

describe("layoutArrows", () => {
  const labelled = (links: Link[]) => new Map(links.map((l) => [l.id, [{ w: 190, h: 37 }]]));

  it("takes a route with room for its label over one that squeezes it in", () => {
    // From the containers view: a leaves its right side for c's top, so its label
    // has to share the gap above c with b's. Leaving a's bottom for c's left side
    // costs a little more, and its label has the space below a to itself.
    const boxes = new Map([
      ["a", { x: 20, y: 28, w: 220, h: 103 }],
      ["b", { x: 440, y: 52, w: 220, h: 103 }],
      ["c", { x: 320, y: 220, w: 220, h: 113 }],
    ]);
    const links = [link("a", "c"), link("b", "c")];
    expect(routeLinks(boxes, links).get("a->c")![0]!.x).toBe(240);
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
      ["a", { x: 20, y: 28, w: 220, h: 103 }],
      ["b", { x: 440, y: 52, w: 220, h: 103 }],
      ["c", { x: 320, y: 220, w: 220, h: 113 }],
    ]);
    const links = [link("a", "c"), link("b", "c")];
    expect(routeLinks(boxes, links).get("a->c")![0]!.x, "leaves a's right side, before its label is placed").toBe(240);
    for (let k = 0; k < 10; k++) {
      boxes.set(`p${k}`, { x: 1000 + 300 * k, y: 0, w: 220, h: 120 });
      boxes.set(`q${k}`, { x: 1000 + 300 * k, y: 150, w: 220, h: 120 });
      links.push(link(`p${k}`, `q${k}`));
    }
    expect(layoutArrows(boxes, links, labelled(links)).routes.get("a->c")![0]!.y, "leaves a's bottom").toBe(131);
  });

  it("spreads out the labels of arrows leaving a box close together", () => {
    // Roughly a reported diagram: the arrows from Client Website (web) to AWS S3 (s3),
    // Simple Payments (sp) and OZOW (ozow) run down side by side about 65px apart, so
    // their labels are stacked. They were stacked 7px apart, and s3's label covered
    // the arrow to sp.
    const boxes = new Map([
      ["top", { x: 289, y: -159, w: 220, h: 101 }],
      ["topRight", { x: 565, y: -85, w: 216, h: 98 }],
      ["web", { x: 289, y: 55, w: 220, h: 101 }],
      ["peach", { x: 775, y: 158, w: 216, h: 98 }],
      ["ozow", { x: 775, y: 298, w: 216, h: 98 }],
      ["ga", { x: 779, y: 455, w: 216, h: 98 }],
      ["s3", { x: 18, y: 507, w: 216, h: 95 }],
      ["sp", { x: 420, y: 586, w: 215, h: 98 }],
      ["leftA", { x: -318, y: 85, w: 220, h: 98 }],
      ["leftB", { x: -318, y: 265, w: 220, h: 98 }],
      ["leftC", { x: -318, y: 594, w: 220, h: 98 }],
    ]);
    const links = [
      link("top", "web"),
      link("leftA", "web"),
      link("web", "peach"),
      link("web", "ozow"),
      link("web", "ga"),
      link("web", "s3"),
      link("web", "sp"),
      link("leftB", "s3"),
      link("leftC", "sp"),
    ];
    const sizes = new Map(links.map((l) => [l.id, [{ w: 120, h: 37 }]]));
    for (const id of ["web->peach", "web->ozow", "web->sp"]) sizes.set(id, [{ w: 108, h: 37 }]);
    sizes.set("web->ga", [{ w: 135, h: 37 }]);
    // "downloads files, manages uploads" on two lines, or on three.
    sizes.set("web->s3", [
      { w: 186, h: 51 },
      { w: 104, h: 51 },
    ]);
    const { routes, labels } = layoutArrows(boxes, links, sizes);
    const [s3, sp, ozow] = ["web->s3", "web->sp", "web->ozow"].map((id) => labels.get(id)!);
    expect(gapBetween(s3!, sp!), "s3 and sp").toBeGreaterThanOrEqual(20);
    expect(gapBetween(sp!, ozow!), "sp and ozow").toBeGreaterThanOrEqual(20);
    expect(gapBetween(s3!, ozow!), "s3 and ozow").toBeGreaterThanOrEqual(20);
    expect(s3!.w, "s3's label is drawn narrower").toBe(104);
    const s3Box = { x: s3!.x - s3!.w / 2, y: s3!.y - s3!.h / 2, w: s3!.w, h: s3!.h };
    for (const s of segments(routes.get("web->sp")!)) expect(cuts(s, s3Box), "s3's label covers the arrow to sp").toBe(false);
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
