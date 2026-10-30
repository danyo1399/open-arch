/**
 * Routes arrows as horizontal and vertical runs that go around boxes instead
 * of through them, and that avoid crossing or running along each other.
 *
 * Each arrow is the cheapest path on a grid of lines just outside every box's
 * sides, through the points where arrows attach, and down the middle of the
 * gaps between boxes. Corners, crossings and shared runs add to a path's cost,
 * so a slightly longer path wins when it's tidier. Arrows are routed shortest
 * first, then all routed again so the early ones can make way for the rest.
 */
import type { Point } from "./autoLayout.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Link {
  id: string;
  from: string;
  to: string;
}

/** Space kept clear around each box. */
const MARGIN = 24;
/** Fractions along each side that always get a grid line, so every side has places for arrows to attach. */
const ANCHORS = [0.25, 0.5, 0.75];
/** Arrows attach at least this fraction of a side's length from its ends, clear of rounded corners. */
const CORNER_INSET = 0.2;
/** Arrows attached to the same side closer together than this cost extra. */
const PORT_SPACING = 24;

// Costs, in pixels of line length.
const BEND = 40;
const CROSSING = 120;
/** Per pixel run alongside another arrow. */
const OVERLAP = 3;
/** Runs this close beside another arrow's count as running along it: they'd look like one thick line. */
const NEAR = 10;
/** Per pixel an attachment point is from the middle of its side. */
const OFF_CENTRE = 0.2;
const SHARED_PORT = 200;
/** Runs closer than this to a boundary frame's side cost as much as running along another arrow. There's a lane this far outside each side. */
const FRAME_GAP = 16;
/** A step shorter than this, between two runs going the same way, is straightened out where that keeps clear of boxes. */
const JOG = 12;

/** Directions of movement, which are also the axis of a run. */
const H = 0;
const V = 1;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Port {
  /** The box and side, such as `api:top`. */
  side: string;
  /** Where along the side: x for the top and bottom, y for the left and right. */
  pos: number;
  /** On the box's border. */
  at: Point;
  /** Just outside the box, where the route on the grid starts or ends. */
  stub: Point;
  /** Axis of the run between `at` and `stub`. */
  axis: typeof H | typeof V;
  cost: number;
}

interface Route {
  /** Grid points from the start's stub to the end's, each next to the last. None for a route straight across a gap too narrow for the grid. */
  cells: number[];
  ports: [Port, Port];
  points: Point[];
  cost: number;
}

/** A box's sides in whole pixels, so the grid lines built from them match exactly. */
function rect(b: Box): Rect {
  return { left: Math.round(b.x), top: Math.round(b.y), right: Math.round(b.x + b.w), bottom: Math.round(b.y + b.h) };
}

function inflate(r: Rect): Rect {
  return { left: r.left - MARGIN, top: r.top - MARGIN, right: r.right + MARGIN, bottom: r.bottom + MARGIN };
}

/** Where along a side, from `from` to `to`, there's always a grid line for arrows to attach at. */
function anchorsOf(from: number, to: number): number[] {
  return ANCHORS.map((f) => Math.round(from + (to - from) * f));
}

/** The stretch of a side, from `from` to `to`, where arrows can attach: away from its corners. */
function inset(from: number, to: number): [number, number] {
  return [from + (to - from) * CORNER_INSET, to - (to - from) * CORNER_INSET];
}

/** Sorted grid lines: the given ones, plus one down the middle of each gap between a box's far side and the next box's near side. */
function lines(near: Set<number>, far: Set<number>, others: number[]): number[] {
  const sorted = [...new Set([...near, ...far, ...others])].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((v, k) => {
    const next = sorted[k + 1];
    out.push(v);
    if (next !== undefined && far.has(v) && near.has(next)) out.push((v + next) / 2);
  });
  return out;
}

class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size() {
    return this.keys.length;
  }

  push(key: number, value: number) {
    const { keys, values } = this;
    let k = keys.length;
    keys.push(key);
    values.push(value);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (keys[parent]! <= key) break;
      keys[k] = keys[parent]!;
      values[k] = values[parent]!;
      k = parent;
    }
    keys[k] = key;
    values[k] = value;
  }

  pop(): number {
    const { keys, values } = this;
    const top = values[0]!;
    const key = keys.pop()!;
    const value = values.pop()!;
    const n = keys.length;
    if (n === 0) return top;
    let k = 0;
    for (;;) {
      let child = 2 * k + 1;
      if (child >= n) break;
      if (child + 1 < n && keys[child + 1]! < keys[child]!) child++;
      if (keys[child]! >= key) break;
      keys[k] = keys[child]!;
      values[k] = values[child]!;
      k = child;
    }
    keys[k] = key;
    values[k] = value;
    return top;
  }
}

/**
 * The routing grid. Point `p` is column `p % nx`, row `p / nx`. Runs are
 * indexed by their left or upper end. A search state is a point and the axis
 * the route is moving along there: `p * 2 + axis`.
 */
class Grid {
  /** Everything routes go around. */
  readonly rects: Rect[];
  readonly xs: number[];
  readonly ys: number[];
  readonly nx: number;
  readonly ny: number;
  private readonly xIndex: Map<number, number>;
  private readonly yIndex: Map<number, number>;
  /** Runs inside the clear space around some box. */
  readonly blockedH: Uint8Array;
  readonly blockedV: Uint8Array;
  /** How many routed arrows use each run, and how many go straight through each point. */
  readonly usedH: Uint16Array;
  readonly usedV: Uint16Array;
  /** Runs alongside a boundary frame's side. */
  readonly alongFrameH: Uint8Array;
  readonly alongFrameV: Uint8Array;
  readonly throughH: Uint16Array;
  readonly throughV: Uint16Array;
  /** For each row, and each column, the steps to the runs on the others closer than NEAR, which would look like the same line. */
  private readonly besideRows: number[][];
  private readonly besideCols: number[][];
  /** Where routed arrows attach on each side, by `Port.side`. */
  private readonly attached = new Map<string, number[]>();
  // Search state, reused between searches.
  private readonly cost: Float64Array;
  private readonly prev: Int32Array;
  private readonly done: Uint8Array;

  /** `aligned` holds extra lines, such as ones a straight arrow between two boxes could run along. */
  constructor(rects: Rect[], frames: Rect[], aligned: { xs: number[]; ys: number[] }) {
    this.rects = rects;
    const near = { x: new Set<number>(), y: new Set<number>() };
    const far = { x: new Set<number>(), y: new Set<number>() };
    for (const r of rects.map(inflate)) {
      near.x.add(r.left);
      far.x.add(r.right);
      near.y.add(r.top);
      far.y.add(r.bottom);
    }
    const lanes = frames.map((f) => ({ left: f.left - FRAME_GAP, top: f.top - FRAME_GAP, right: f.right + FRAME_GAP, bottom: f.bottom + FRAME_GAP }));
    this.xs = lines(near.x, far.x, [...rects.flatMap((r) => anchorsOf(r.left, r.right)), ...lanes.flatMap((l) => [l.left, l.right]), ...aligned.xs]);
    this.ys = lines(near.y, far.y, [...rects.flatMap((r) => anchorsOf(r.top, r.bottom)), ...lanes.flatMap((l) => [l.top, l.bottom]), ...aligned.ys]);
    this.nx = this.xs.length;
    this.ny = this.ys.length;
    const beside = (values: number[], unit: number) =>
      values.map((v, k) => {
        const out: number[] = [];
        for (let m = k - 1; m >= 0 && v - values[m]! < NEAR; m--) out.push((m - k) * unit);
        for (let m = k + 1; m < values.length && values[m]! - v < NEAR; m++) out.push((m - k) * unit);
        return out;
      });
    this.besideRows = beside(this.ys, this.nx);
    this.besideCols = beside(this.xs, 1);
    this.xIndex = new Map(this.xs.map((x, i) => [x, i]));
    this.yIndex = new Map(this.ys.map((y, j) => [y, j]));

    const n = this.nx * this.ny;
    this.blockedH = new Uint8Array(n);
    this.blockedV = new Uint8Array(n);
    this.usedH = new Uint16Array(n);
    this.usedV = new Uint16Array(n);
    this.alongFrameH = new Uint8Array(n);
    this.alongFrameV = new Uint8Array(n);
    this.throughH = new Uint16Array(n);
    this.throughV = new Uint16Array(n);
    this.cost = new Float64Array(2 * n + 1);
    this.prev = new Int32Array(2 * n + 1);
    this.done = new Uint8Array(2 * n + 1);

    const { xs, ys, nx, ny } = this;
    const closeTo = (v: number, a: number, b: number) => Math.abs(v - a) < FRAME_GAP || Math.abs(v - b) < FRAME_GAP;
    for (const f of frames) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const p = j * nx + i;
          if (i + 1 < nx && xs[i]! < f.right && xs[i + 1]! > f.left && closeTo(ys[j]!, f.top, f.bottom)) this.alongFrameH[p] = 1;
          if (j + 1 < ny && ys[j]! < f.bottom && ys[j + 1]! > f.top && closeTo(xs[i]!, f.left, f.right)) this.alongFrameV[p] = 1;
        }
      }
    }

    // Box sides are grid lines, so a run is either wholly inside a box's clear space or wholly outside it.
    for (const r of rects.map(inflate)) {
      const [i0, i1, j0, j1] = [this.xIndex.get(r.left)!, this.xIndex.get(r.right)!, this.yIndex.get(r.top)!, this.yIndex.get(r.bottom)!];
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const p = j * nx + i;
          if (j > j0 && j < j1 && i < i1) this.blockedH[p] = 1;
          if (i > i0 && i < i1 && j < j1) this.blockedV[p] = 1;
        }
      }
    }
  }

  point(at: Point): number {
    const i = this.xIndex.get(at.x);
    const j = this.yIndex.get(at.y);
    return i === undefined || j === undefined ? -1 : j * this.nx + i;
  }

  at(p: number): Point {
    return { x: this.xs[p % this.nx]!, y: this.ys[Math.floor(p / this.nx)]! };
  }

  /** Where an arrow can attach to a box: where the lines `at` meet its sides, away from the corners. */
  portsOf(id: string, r: Rect, at: { xs: Set<number>; ys: Set<number> }): Port[] {
    const out: Port[] = [];
    const o = inflate(r);
    const [left, right] = inset(r.left, r.right);
    const [top, bottom] = inset(r.top, r.bottom);
    for (const x of this.xs) {
      if (!at.xs.has(x) || x < left || x > right) continue;
      const cost = OFF_CENTRE * Math.abs(x - (r.left + r.right) / 2);
      out.push(
        { side: `${id}:top`, pos: x, at: { x, y: r.top }, stub: { x, y: o.top }, axis: V, cost },
        { side: `${id}:bottom`, pos: x, at: { x, y: r.bottom }, stub: { x, y: o.bottom }, axis: V, cost },
      );
    }
    for (const y of this.ys) {
      if (!at.ys.has(y) || y < top || y > bottom) continue;
      const cost = OFF_CENTRE * Math.abs(y - (r.top + r.bottom) / 2);
      out.push(
        { side: `${id}:left`, pos: y, at: { x: r.left, y }, stub: { x: o.left, y }, axis: H, cost },
        { side: `${id}:right`, pos: y, at: { x: r.right, y }, stub: { x: o.right, y }, axis: H, cost },
      );
    }
    return out;
  }

  /** What attaching at `port` costs, given the arrows already attached beside it. */
  portCost(port: Port) {
    let cost = port.cost;
    for (const pos of this.attached.get(port.side) ?? []) cost += SHARED_PORT * Math.max(0, 1 - Math.abs(pos - port.pos) / PORT_SPACING);
    return cost;
  }

  /** The cheapest route from any of `starts` to any of `goals`, as grid points. */
  search(starts: Port[], goals: Port[], target: Rect): { cells: number[]; ports: [Port, Port]; cost: number } | undefined {
    const { nx, ny, xs, ys, cost, prev, done } = this;
    const goal = 2 * nx * ny;
    cost.fill(Infinity);
    prev.fill(-1);
    done.fill(0);
    const heap = new MinHeap();
    // Distance to the target's clear space, which every route has to reach.
    const estimate = (p: number) => {
      const x = xs[p % nx]!;
      const y = ys[Math.floor(p / nx)]!;
      return Math.max(0, target.left - x, x - target.right) + Math.max(0, target.top - y, y - target.bottom);
    };
    const relax = (s: number, c: number, from: number, h: number) => {
      if (c >= cost[s]!) return;
      cost[s] = c;
      prev[s] = from;
      heap.push(c + h, s);
    };

    const startPorts = new Map<number, Port>();
    for (const port of starts) {
      const p = this.point(port.stub);
      if (p < 0) continue;
      const s = p * 2 + port.axis;
      if (this.portCost(port) < cost[s]!) startPorts.set(s, port);
      relax(s, this.portCost(port), -1, estimate(p));
    }
    const goalPorts = new Map<number, Port>();
    for (const port of goals) {
      const p = this.point(port.stub);
      if (p < 0) continue;
      const s = p * 2 + port.axis;
      const existing = goalPorts.get(s);
      if (!existing || this.portCost(port) < this.portCost(existing)) goalPorts.set(s, port);
    }

    while (heap.size) {
      const s = heap.pop();
      if (done[s]) continue;
      done[s] = 1;
      if (s === goal) break;
      const c = cost[s]!;
      const p = s >> 1;
      const axis = s & 1;
      const arriving = goalPorts.get(s);
      if (arriving) relax(goal, c + this.portCost(arriving), s, 0);
      relax(p * 2 + (1 - axis), c + BEND, s, estimate(p));
      const i = p % nx;
      const j = (p - i) / nx;
      const near = axis === H ? this.besideRows[j]! : this.besideCols[i]!;
      const step = (q: number, run: number, length: number, used: Uint16Array, along: Uint8Array, crossed: Uint16Array) => {
        let beside = 0;
        for (const off of near) beside += used[run + off]!;
        relax(q * 2 + axis, c + length + OVERLAP * length * (used[run]! + along[run]! + beside) + CROSSING * crossed[q]!, s, estimate(q));
      };
      if (axis === H) {
        if (i + 1 < nx && !this.blockedH[p]) step(p + 1, p, xs[i + 1]! - xs[i]!, this.usedH, this.alongFrameH, this.throughV);
        if (i > 0 && !this.blockedH[p - 1]) step(p - 1, p - 1, xs[i]! - xs[i - 1]!, this.usedH, this.alongFrameH, this.throughV);
      } else {
        if (j + 1 < ny && !this.blockedV[p]) step(p + nx, p, ys[j + 1]! - ys[j]!, this.usedV, this.alongFrameV, this.throughH);
        if (j > 0 && !this.blockedV[p - nx]) step(p - nx, p - nx, ys[j]! - ys[j - 1]!, this.usedV, this.alongFrameV, this.throughH);
      }
    }
    if (prev[goal] === -1) return undefined;

    const states: number[] = [];
    for (let s = prev[goal]!; s !== -1; s = prev[s]!) states.push(s);
    states.reverse();
    const cells = states.map((s) => s >> 1).filter((p, k, all) => k === 0 || p !== all[k - 1]);
    return { cells, ports: [startPorts.get(states[0]!)!, goalPorts.get(states[states.length - 1]!)!], cost: cost[goal]! };
  }

  /** What the search would charge for a route through `cells` between `ports`, given the routes on the grid now. */
  costOf(cells: number[], [start, end]: [Port, Port]): number {
    const { nx, xs, ys } = this;
    let cost = this.portCost(start) + this.portCost(end);
    let axis = start.axis;
    for (let k = 1; k < cells.length; k++) {
      const [p, q] = [cells[k - 1]!, cells[k]!];
      const along = Math.abs(q - p) === 1 ? H : V;
      if (along !== axis) cost += BEND;
      axis = along;
      const run = Math.min(p, q);
      const length = along === H ? Math.abs(xs[q % nx]! - xs[p % nx]!) : Math.abs(ys[Math.floor(q / nx)]! - ys[Math.floor(p / nx)]!);
      const [used, frame, crossed, near] =
        along === H ? [this.usedH, this.alongFrameH, this.throughV, this.besideRows[Math.floor(run / nx)]!] : [this.usedV, this.alongFrameV, this.throughH, this.besideCols[run % nx]!];
      let beside = 0;
      for (const off of near) beside += used[run + off]!;
      cost += length + OVERLAP * length * (used[run]! + frame[run]! + beside) + CROSSING * crossed[q]!;
    }
    return axis === end.axis ? cost : cost + BEND;
  }

  /** The grid points of a route through `points` between `ports`, from stub to stub, or undefined where it runs off the grid's lines. */
  cellsOf(points: Point[], [start, end]: [Port, Port]): number[] | undefined {
    const { nx } = this;
    const cells: number[] = [];
    for (const at of [start.stub, ...points.slice(1, -1), end.stub]) {
      const p = this.point(at);
      if (p < 0) return undefined;
      const last = cells[cells.length - 1];
      if (last === undefined) {
        cells.push(p);
        continue;
      }
      const [i0, j0, i1, j1] = [last % nx, Math.floor(last / nx), p % nx, Math.floor(p / nx)];
      if (i0 !== i1 && j0 !== j1) return undefined;
      const by = i0 !== i1 ? Math.sign(i1 - i0) : Math.sign(j1 - j0) * nx;
      for (let c = last; c !== p; ) cells.push((c += by));
    }
    return cells;
  }

  /** Records a route's runs and ports, so later routes avoid them; `by` is 1 to add, -1 to remove. */
  mark(route: Route, by: 1 | -1) {
    const cells = route.cells;
    const axes = cells.slice(1).map((p, k) => (Math.abs(p - cells[k]!) === 1 ? H : V));
    axes.forEach((axis, k) => {
      const run = Math.min(cells[k]!, cells[k + 1]!);
      (axis === H ? this.usedH : this.usedV)[run]! += by;
      if (k > 0 && axes[k - 1] === axis) (axis === H ? this.throughH : this.throughV)[cells[k]!]! += by;
    });
    for (const port of route.ports) {
      const list = this.attached.get(port.side) ?? [];
      if (by === 1) list.push(port.pos);
      else list.splice(list.indexOf(port.pos), 1);
      this.attached.set(port.side, list);
    }
  }
}

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (b && b.x === p.x && b.y === p.y) continue;
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

/**
 * A route with each short step between two runs going the same way taken out, by
 * moving one of the runs onto the other's line: grid lines a few pixels apart, such
 * as one just outside a box and one through a point on another box's side, would
 * otherwise leave a little kink. The moved run keeps at least half the usual space
 * from boxes, an end moved along its box's side stays clear of the corners, and a
 * change is only kept if the search would have charged less for it, so a run isn't
 * moved beside another arrow or along a frame.
 */
function straighten(grid: Grid, route: Route, from: Rect, to: Rect): Route {
  const onSide = (p: Point, r: Rect) => {
    const [lo, hi] = p.x === r.left || p.x === r.right ? inset(r.top, r.bottom) : inset(r.left, r.right);
    const pos = p.x === r.left || p.x === r.right ? p.y : p.x;
    return pos >= lo && pos <= hi;
  };
  const near = grid.rects.map((r) => ({ r, clear: { left: r.left - MARGIN / 2, top: r.top - MARGIN / 2, right: r.right + MARGIN / 2, bottom: r.bottom + MARGIN / 2 } }));
  const clear = (pts: Point[]) =>
    onSide(pts[0]!, from) &&
    onSide(pts[pts.length - 1]!, to) &&
    pts.slice(1).every((b, k) => near.every(({ r, clear }) => (k === 0 && r === from) || (k === pts.length - 2 && r === to) || !runsThrough([pts[k]!, b], clear)));
  // Moves the run from point `i` to point `i + 1` across, onto the line `to`, if the runs either side of it still go the way they did.
  const move = (pts: Point[], i: number, across: boolean, line: number) => {
    const out = pts.map((p, k) => (k === i || k === i + 1 ? (across ? { x: p.x, y: line } : { x: line, y: p.y }) : p));
    const way = (a: Point, b: Point) => Math.sign(across ? b.y - a.y : b.x - a.x);
    for (const k of [i - 1, i + 1]) {
      const [a, b, c, d] = [pts[k], pts[k + 1], out[k], out[k + 1]];
      if (a && b && c && d && way(c, d) !== 0 && way(c, d) !== way(a, b)) return undefined;
    }
    return out;
  };
  // The port an end attaches at once it's moved to `at` along its side.
  const movedTo = (port: Port, r: Rect, at: Point): Port => {
    if (at.x === port.at.x && at.y === port.at.y) return port;
    const pos = port.axis === V ? at.x : at.y;
    const centre = port.axis === V ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2;
    const stub = port.axis === V ? { x: pos, y: port.stub.y } : { x: port.stub.x, y: pos };
    return { ...port, pos, at, stub, cost: OFF_CENTRE * Math.abs(pos - centre) };
  };
  let best = route;
  for (let k = 1; k + 2 < best.points.length; k++) {
    const pts = best.points;
    const [a, b, c, d] = [pts[k - 1]!, pts[k]!, pts[k + 1]!, pts[k + 2]!];
    const across = a.y === b.y;
    const step = across ? c.y - b.y : c.x - b.x;
    const way = (p: Point, q: Point) => Math.sign(across ? q.x - p.x : q.y - p.y);
    if (step === 0 || Math.abs(step) >= JOG || way(a, b) === 0 || way(a, b) !== way(c, d)) continue;
    for (const option of [move(pts, k - 1, across, across ? c.y : c.x), move(pts, k + 1, across, across ? b.y : b.x)]) {
      if (!option || !clear(option)) continue;
      const points = simplify(option);
      const ports: [Port, Port] = [movedTo(best.ports[0], from, points[0]!), movedTo(best.ports[1], to, points[points.length - 1]!)];
      const cells = grid.cellsOf(points, ports);
      if (!cells) continue;
      const cost = grid.costOf(cells, ports);
      if (cost >= best.cost) continue;
      best = { cells, ports, points, cost };
      k = 0;
      break;
    }
  }
  return best;
}

/** A straight line between the borders of two boxes, for when there's no way around. */
function straight(from: Box, to: Box): Point[] {
  const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const border = (b: Box, toward: Point) => {
    const c = centre(b);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const scale = 1 / Math.max(Math.abs(dx) / (b.w / 2), Math.abs(dy) / (b.h / 2));
    return { x: c.x + dx * scale, y: c.y + dy * scale };
  };
  return [border(from, centre(to)), border(to, centre(from))];
}

/**
 * Lines spread evenly across the stretch where two sides, from `a0` to `a1` and
 * from `b0` to `b1`, both have places for arrows to attach: one for each of the
 * `count` arrows between them, or none when there's no such stretch.
 */
function facing(a0: number, a1: number, b0: number, b1: number, count: number): number[] {
  const [[alo, ahi], [blo, bhi]] = [inset(a0, a1), inset(b0, b1)];
  const [lo, hi] = [Math.max(alo, blo), Math.min(ahi, bhi)];
  if (lo > hi) return [];
  return [...new Set(Array.from({ length: count }, (_, k) => Math.round(lo + ((hi - lo) * (k + 1)) / (count + 1))))];
}

/** Whether any run of a route goes through the inside of `r`. */
function runsThrough(points: Point[], r: Rect): boolean {
  return points.slice(1).some((b, k) => {
    const a = points[k]!;
    return Math.min(a.x, b.x) < r.right && Math.max(a.x, b.x) > r.left && Math.min(a.y, b.y) < r.bottom && Math.max(a.y, b.y) > r.top;
  });
}

interface Routing {
  grid: Grid;
  /** Where arrows can attach to each box. */
  ports: Map<string, Port[]>;
  routes: Map<string, Route>;
}

/** The cheapest route for a link from any of `starts` to any of `goals`, given the routes already on the grid. */
function routeOne(grid: Grid, starts: Port[], goals: Port[], from: Rect, to: Rect): Route | undefined {
  const found = grid.search(starts, goals, inflate(to));
  if (!found) return undefined;
  const [start, end] = found.ports;
  return straighten(grid, { ...found, points: simplify([start.at, ...found.cells.map((p) => grid.at(p)), end.at]) }, from, to);
}

/**
 * A straight route between two boxes that face each other across a gap too narrow
 * for the grid, where their clear spaces overlap, along whichever of `lines` (the
 * ones across where they face) costs least, given the arrows already attached.
 * Undefined when they don't face each other that closely, or something else is in the gap.
 */
function acrossGap(grid: Grid, from: Rect, to: Rect, starts: Port[], goals: Port[], lines: { xs: number[]; ys: number[] }): Route | undefined {
  let best: Route | undefined;
  const gap = (sides: [string, string], candidates: number[], a: number, b: number) => {
    if (b <= a || b - a >= 2 * MARGIN) return;
    for (const line of candidates) {
      const start = starts.find((p) => p.side.endsWith(`:${sides[0]}`) && p.pos === line);
      const end = goals.find((p) => p.side.endsWith(`:${sides[1]}`) && p.pos === line);
      if (!start || !end) continue;
      const points = [start.at, end.at];
      if (grid.rects.some((r) => r !== from && r !== to && runsThrough(points, r))) continue;
      const cost = b - a + grid.portCost(start) + grid.portCost(end);
      if (!best || cost < best.cost) best = { cells: [], ports: [start, end], points, cost };
    }
  };
  gap(["bottom", "top"], lines.xs, from.bottom, to.top);
  gap(["top", "bottom"], lines.xs, to.bottom, from.top);
  gap(["right", "left"], lines.ys, from.right, to.left);
  gap(["left", "right"], lines.ys, to.right, from.left);
  return best;
}

/** Routes for the links that have one, around the boxes and `obstacles`, shortest first. */
function routeAround(rects: Map<string, Rect>, obstacles: Rect[], links: Link[], frames: Rect[]): Routing {
  // Arrows attach to a box only at its own anchors, and at lines across where it
  // faces a box it's linked to, one for each arrow between the two, so those arrows
  // can be straight. Lines from boxes it has nothing to do with would give it places
  // to attach that come and go as those boxes move.
  const at = new Map([...rects].map(([id, r]) => [id, { xs: new Set(anchorsOf(r.left, r.right)), ys: new Set(anchorsOf(r.top, r.bottom)) }]));
  const pairs = new Map<string, Link[]>();
  for (const l of links) {
    const key = [l.from, l.to].sort().join("\n");
    pairs.set(key, [...(pairs.get(key) ?? []), l]);
  }
  const across = new Map<string, { xs: number[]; ys: number[] }>();
  const aligned = { xs: [] as number[], ys: [] as number[] };
  for (const pair of pairs.values()) {
    const { from, to } = pair[0]!;
    const [a, b] = [rects.get(from)!, rects.get(to)!];
    const lines = { xs: facing(a.left, a.right, b.left, b.right, pair.length), ys: facing(a.top, a.bottom, b.top, b.bottom, pair.length) };
    for (const l of pair) across.set(l.id, lines);
    for (const id of [from, to]) {
      for (const x of lines.xs) at.get(id)!.xs.add(x);
      for (const y of lines.ys) at.get(id)!.ys.add(y);
    }
    aligned.xs.push(...lines.xs);
    aligned.ys.push(...lines.ys);
  }
  const grid = new Grid([...rects.values(), ...obstacles], frames, aligned);
  const ports = new Map([...rects].map(([id, r]) => [id, grid.portsOf(id, r, at.get(id)!)]));

  const routes = new Map<string, Route>();
  for (let pass = 0; pass < 2; pass++) {
    for (const link of links) {
      const old = routes.get(link.id);
      if (old) grid.mark(old, -1);
      const [from, to, starts, goals] = [rects.get(link.from)!, rects.get(link.to)!, ports.get(link.from)!, ports.get(link.to)!];
      const route = acrossGap(grid, from, to, starts, goals, across.get(link.id)!) ?? routeOne(grid, starts, goals, from, to);
      if (!route) {
        routes.delete(link.id);
        continue;
      }
      grid.mark(route, 1);
      routes.set(link.id, route);
    }
  }
  return { grid, ports, routes };
}

/** Routes every link it can, in the order they were routed, going around notes only where they're in the way (see routeLinks). */
function routeAll(boxes: Map<string, Box>, links: Link[], frames: Box[], notes: Box[]): Routing & { rects: Map<string, Rect>; routable: Link[] } {
  const rects = new Map([...boxes].map(([id, b]) => [id, rect(b)]));
  const frameRects = frames.map(rect);

  const distance = (l: Link) => {
    const a = rects.get(l.from)!;
    const b = rects.get(l.to)!;
    return Math.abs(a.left + a.right - b.left - b.right) + Math.abs(a.top + a.bottom - b.top - b.bottom);
  };
  const routable = links
    .filter((l) => l.from !== l.to && rects.has(l.from) && rects.has(l.to))
    .sort((a, b) => distance(a) - distance(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Route ignoring the notes, then again around any a route runs under, until none is in the way.
  let ignored = notes.map(rect);
  const avoided: Rect[] = [];
  let routing = routeAround(rects, avoided, routable, frameRects);
  for (;;) {
    const inTheWay = ignored.filter((n) => [...routing.routes.values()].some((r) => runsThrough(r.points, inflate(n))));
    if (!inTheWay.length) break;
    avoided.push(...inTheWay);
    ignored = ignored.filter((n) => !inTheWay.includes(n));
    routing = routeAround(rects, avoided, routable, frameRects);
  }
  return { ...routing, rects, routable };
}

/** Each link's points: its route, or a straight line between its boxes when it has none. */
function pointsOf(boxes: Map<string, Box>, links: Link[], routes: Map<string, Route>): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const link of links) {
    const from = boxes.get(link.from);
    const to = boxes.get(link.to);
    if (from && to) out.set(link.id, routes.get(link.id)?.points ?? straight(from, to));
  }
  return out;
}

/**
 * Each link's route, from a point on its source box's border to one on its target's.
 * Routes cross `frames` (boundaries drawn around boxes) freely but keep off their sides.
 * They go around `notes`, boxes no arrow starts or ends at, only where one is in the
 * way: every obstacle adds grid lines right across the diagram, so a note out in empty
 * space would otherwise move arrows nowhere near it as it's dragged.
 */
export function routeLinks(boxes: Map<string, Box>, links: Link[], frames: Box[] = [], notes: Box[] = []): Map<string, Point[]> {
  return pointsOf(boxes, links, routeAll(boxes, links, frames, notes).routes);
}

/** How much of `a` lies inside `b`. */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * How badly a label at `a` covers `b`: the area, with deeper overlaps counting
 * for more, so a label that can't help covering boxes covers each a little
 * rather than one a lot.
 */
function covers(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h * (1 + Math.min(w, h) / 10) : 0;
}

/** The part of a line from `from`, moving `d` along one axis, that lies between `lo` and `hi` on that axis, as fractions of the line. */
function within(from: number, d: number, lo: number, hi: number, t: [number, number]): void {
  if (d === 0) {
    if (from <= lo || from >= hi) t[1] = -1;
    return;
  }
  const [a, b] = [(lo - from) / d, (hi - from) / d];
  t[0] = Math.max(t[0], Math.min(a, b));
  t[1] = Math.min(t[1], Math.max(a, b));
}

/** How long a stretch of a route lies inside `b`. */
function lengthInside(points: Point[], b: Box): number {
  let sum = 0;
  const t: [number, number] = [0, 1];
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1]!;
    const q = points[k]!;
    t[0] = 0;
    t[1] = 1;
    within(p.x, q.x - p.x, b.x, b.x + b.w, t);
    within(p.y, q.y - p.y, b.y, b.y + b.h, t);
    if (t[1] > t[0]) sum += (t[1] - t[0]) * Math.hypot(q.x - p.x, q.y - p.y);
  }
  return sum;
}

/** The smallest box around a route. */
function bounds(points: Point[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Whether two boxes overlap or touch. */
const meet = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

function routeLength(points: Point[]): number {
  return points.slice(1).reduce((sum, b, k) => sum + Math.hypot(b.x - points[k]!.x, b.y - points[k]!.y), 0);
}

/** The point `s` pixels along a route. */
function along(points: Point[], s: number): Point {
  for (let k = 1; k < points.length; k++) {
    const [p, q] = [points[k - 1]!, points[k]!];
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (s <= length || k === points.length - 1) {
      const t = length ? Math.min(1, Math.max(0, s / length)) : 0;
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    }
    s -= length;
  }
  return points[0]!;
}

/** Spots for a label are tried this far apart along its route, outward from the middle. */
const LABEL_STEP = 10;
/** Labels keep this far from boxes and from each other where they can. */
const LABEL_GAP = 6;
/** Roughly the space an arrowhead takes up, back from the end of its route. */
const HEAD = 8;
// Costs of a spot for a label, in pixels along the route from its middle.
/** Per square pixel of a box, or of another label, the label covers (see `covers`). */
const COVERS_BOX = 1;
const COVERS_LABEL = 2;
/** Per pixel of another arrow the label hides, and for the whole of an arrowhead. */
const COVERS_ARROW = 3;
const COVERS_HEAD = 400;
/** Per pixel narrower than its widest a label is drawn. */
const NARROWER = 1;
/** A label whose best spot covers this much or less has room enough where it is. */
const ROOMY = 50;
/** How much cheaper, route and label together, another route has to be before an arrow takes it for its label's sake. */
const WORTH_MOVING = 40;
/** How much longer than its route another route can be. A long way round is harder to follow than a cramped label, as between two boxes close together. */
const DETOUR = 1.5;

type Size = { w: number; h: number };

interface Spot {
  at: Point;
  size: Size;
  box: Box;
  /** How far along the route from its middle. */
  off: number;
  /** What the spot costs, apart from covering other labels. */
  cost: number;
}

/** What labels are placed among: boxes and the like (with the gap labels keep from them), and every arrow, by link ID. */
interface Scene {
  obstacles: Box[];
  routes: Map<string, { points: Point[]; bounds: Box }>;
  heads: Map<string, Box>;
}

const padded = (b: Box): Box => ({ x: b.x - LABEL_GAP, y: b.y - LABEL_GAP, w: b.w + 2 * LABEL_GAP, h: b.h + 2 * LABEL_GAP });

function headOf(points: Point[]): Box {
  const at = along(points, routeLength(points) - HEAD / 2);
  return { x: at.x - HEAD / 2, y: at.y - HEAD / 2, w: HEAD, h: HEAD };
}

function sceneOf(routes: Map<string, Point[]>, obstacles: Box[]): Scene {
  const scene: Scene = { obstacles: obstacles.map(padded), routes: new Map(), heads: new Map() };
  for (const [id, points] of routes) setRoute(scene, id, points);
  return scene;
}

function setRoute(scene: Scene, id: string, points: Point[]): void {
  scene.routes.set(id, { points, bounds: bounds(points) });
  scene.heads.set(id, headOf(points));
}

/**
 * The spots along a route its label could go, each costed by what it covers apart
 * from other labels. `sizes` are the sizes the label can be, widest first: the
 * narrower ones are tried only where the widest can't find room.
 */
function spotsAlong(id: string, points: Point[], sizes: Size[], scene: Scene): Spot[] {
  const total = routeLength(points);
  const spots: Spot[] = [];
  // Only what's near the route can be covered by its label.
  const [w, h] = [Math.max(...sizes.map((s) => s.w)), Math.max(...sizes.map((s) => s.h))];
  const b = bounds(points);
  const reach = { x: b.x - w / 2, y: b.y - h / 2, w: b.w + w, h: b.h + h };
  const obstacles = scene.obstacles.filter((o) => meet(o, reach));
  const routes = [...scene.routes].filter(([other, r]) => other !== id && meet(r.bounds, reach)).map(([, r]) => r);
  const heads = [...scene.heads.values()].filter((o) => meet(o, reach));
  for (const size of sizes) {
    if (spots.length && spots.some((s) => s.cost - s.off <= ROOMY)) break;
    for (let off = 0; off <= total / 2; off += LABEL_STEP) {
      for (const s of off ? [total / 2 - off, total / 2 + off] : [total / 2]) {
        const at = along(points, s);
        const box = { x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h };
        let cost = off + NARROWER * (sizes[0]!.w - size.w);
        for (const o of obstacles) cost += COVERS_BOX * covers(box, o);
        for (const route of routes) if (meet(route.bounds, box)) cost += COVERS_ARROW * lengthInside(route.points, box);
        for (const head of heads) cost += (COVERS_HEAD * overlap(box, head)) / (HEAD * HEAD);
        spots.push({ at, size, box, off, cost });
      }
    }
  }
  return spots;
}

/** The cheapest of `spots`, given the other labels' boxes (with their gap), and what it costs. */
function cheapest(spots: Spot[], others: Box[]): { spot: Spot; cost: number } {
  let best = { spot: spots[0]!, cost: Infinity };
  for (const spot of spots) {
    if (spot.cost >= best.cost) continue;
    const cost = spot.cost + COVERS_LABEL * others.reduce((sum, o) => sum + covers(spot.box, o), 0);
    if (cost < best.cost) best = { spot, cost };
  }
  return best;
}

/** Places every label, as placeLabels describes, with what each spot costs. */
function placeAll(sizes: Map<string, Size[]>, scene: Scene): Map<string, { spot: Spot; cost: number }> {
  const labels: { id: string; total: number; spots: Spot[] }[] = [];
  for (const [id, { points }] of scene.routes) {
    const size = sizes.get(id);
    if (size?.length && points.length >= 2) labels.push({ id, total: routeLength(points), spots: spotsAlong(id, points, size, scene) });
  }
  // Shortest routes first, as they have the fewest spots to choose from, then each
  // again with all the others placed, so the first ones can make way for the rest.
  labels.sort((a, b) => a.total - b.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed = new Map<string, { spot: Spot; cost: number }>();
  for (let pass = 0; pass < 2; pass++) {
    for (const { id, spots } of labels) {
      placed.delete(id);
      placed.set(id, cheapest(spots, [...placed.values()].map((p) => padded(p.spot.box))));
    }
  }
  return placed;
}

/**
 * Where to centre each route's label: on the route, as near its middle as it
 * can be without covering `obstacles`, other labels, or other arrows and their
 * arrowheads. A label that can't help covering something covers as little of
 * it as it can. `sizes` holds each label's size, or the sizes it can be drawn
 * at, widest first, by link ID.
 */
export function placeLabels(routes: Map<string, Point[]>, sizes: Map<string, Size | Size[]>, obstacles: Box[]): Map<string, Point> {
  const options = new Map([...sizes].map(([id, s]) => [id, Array.isArray(s) ? s : [s]]));
  return new Map([...placeAll(options, sceneOf(routes, obstacles))].map(([id, p]) => [id, p.spot.at]));
}

/**
 * Routes and labels together: links are routed as routeLinks does and their labels
 * placed as placeLabels does, among the boxes, the notes and `keepClear`. Then an
 * arrow whose label can't find room is offered other routes, leaving its source and
 * entering its target by each side, and takes one where it and its label cost less
 * together, such as a route with an extra corner whose label then sits in the clear.
 * `sizes` holds the sizes each label can be drawn at, widest first; each label
 * comes back with the size it's drawn at.
 */
export function layoutArrows<S extends Size>(
  boxes: Map<string, Box>,
  links: Link[],
  sizes: Map<string, S[]>,
  { frames = [], notes = [], keepClear = [] }: { frames?: Box[]; notes?: Box[]; keepClear?: Box[] } = {},
): { routes: Map<string, Point[]>; labels: Map<string, Point & S> } {
  const { grid, ports, routes, rects, routable } = routeAll(boxes, links, frames, notes);
  const scene = sceneOf(pointsOf(boxes, links, routes), [...boxes.values(), ...notes, ...keepClear]);
  const placed = placeAll(sizes, scene);
  // The grid only goes around notes some route was in the way of, so other routes have to be checked against the rest.
  const underNote = (r: Route) => notes.some((n) => runsThrough(r.points, inflate(rect(n))));

  for (const link of routable) {
    const [size, route, label] = [sizes.get(link.id), routes.get(link.id), placed.get(link.id)];
    if (!size?.length || !route || !label || label.cost - label.spot.off <= ROOMY) continue;
    const others = [...placed].filter(([id]) => id !== link.id).map(([, p]) => padded(p.spot.box));
    // A route's cost, plus its label's, plus what other labels hide of it.
    const total = (r: Route) => {
      setRoute(scene, link.id, r.points);
      const best = cheapest(spotsAlong(link.id, r.points, size, scene), others);
      const head = scene.heads.get(link.id)!;
      const hidden = others.reduce((sum, o) => sum + COVERS_ARROW * lengthInside(r.points, o) + (COVERS_HEAD * overlap(head, o)) / (HEAD * HEAD), 0);
      return { route: r, label: best, cost: r.cost + best.cost + hidden };
    };
    grid.mark(route, -1);
    const [from, to, source, target] = [ports.get(link.from)!, ports.get(link.to)!, rects.get(link.from)!, rects.get(link.to)!];
    // The route as it stands, costed against the routes as they are now.
    const kept = total({ ...route, cost: route.cells.length ? grid.costOf(route.cells, route.ports) : route.cost });
    let best = kept;
    const longest = routeLength(route.points) * DETOUR;
    const onSide = (list: Port[], side: string) => list.filter((p) => p.side.endsWith(`:${side}`));
    for (const side of ["top", "bottom", "left", "right"]) {
      for (const r of [routeOne(grid, onSide(from, side), to, source, target), routeOne(grid, from, onSide(to, side), source, target)]) {
        // A label costs nothing at best, so a route that costs more on its own can't win.
        if (!r || r.cost >= best.cost || routeLength(r.points) > longest || underNote(r)) continue;
        const option = total(r);
        if (option.cost < best.cost) best = option;
      }
    }
    if (best.cost > kept.cost - WORTH_MOVING) best = kept;
    grid.mark(best.route, 1);
    routes.set(link.id, best.route);
    setRoute(scene, link.id, best.route.points);
    placed.set(link.id, best.label);
  }

  // Every label again, now each route is settled. The scene already has the routes as they ended up.
  const labels = placeAll(sizes, scene);
  return { routes: pointsOf(boxes, links, routes), labels: new Map([...labels].map(([id, p]) => [id, { ...(p.spot.size as S), ...p.spot.at }])) };
}

/**
 * Where each route crosses another, by link ID: the points where one of its
 * horizontal runs crosses another route's vertical run, nearest its start first.
 * The horizontal one is the one drawn hopping over the other.
 */
export function crossings(routes: Map<string, Point[]>): Map<string, Point[]> {
  const runs = (points: Point[], horizontal: boolean) =>
    points.slice(1).flatMap((b, k) => {
      const a = points[k]!;
      return (horizontal ? a.y === b.y && a.x !== b.x : a.x === b.x && a.y !== b.y) ? [[a, b] as const] : [];
    });
  const vertical = [...routes].map(([id, points]) => ({ id, runs: runs(points, false) }));
  const out = new Map<string, Point[]>();
  for (const [id, points] of routes) {
    const found: Point[] = [];
    for (const [a, b] of runs(points, true)) {
      const here: Point[] = [];
      for (const other of vertical) {
        if (other.id === id) continue;
        for (const [c, d] of other.runs) {
          const [x, y] = [c.x, a.y];
          if (x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x) && y > Math.min(c.y, d.y) && y < Math.max(c.y, d.y)) here.push({ x, y });
        }
      }
      found.push(...here.sort((p, q) => Math.abs(p.x - a.x) - Math.abs(q.x - a.x)));
    }
    if (found.length) out.set(id, found);
  }
  return out;
}
