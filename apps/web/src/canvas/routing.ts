/**
 * Routes arrows as horizontal and vertical runs that go around boxes instead
 * of through them, and that avoid crossing or running along each other.
 *
 * Each arrow is the cheapest path on a grid of lines just outside every box's
 * sides, through the points where arrows attach, and down the middle of the
 * gaps between boxes. Corners, crossings, shared runs and runs close beside
 * another arrow add to a path's cost, so a slightly longer path wins when it's
 * tidier, and arrows spread out where there's room. So do attaching off the middle
 * of a side, and leaving a box by a side that faces away from where the arrow's
 * going. Arrows that could be straight are routed first, then the rest, each
 * shortest first, then all routed again so the early ones can make way for the rest.
 * Two arrows that still cross are routed again, each first in turn, as either
 * might have taken the way the other needed.
 *
 * Crossings are costed by the arms routes have at each point of the grid: a
 * route going straight through a point has two arms there along its axis, and
 * one turning there has one along each axis. Each arm costs a quarter of a
 * crossing for each arm of another route across it, so two routes going straight
 * through a point across each other pay one crossing between them, and one
 * turning onto another's line pays half. That's the same whichever way a route
 * runs and whichever is routed first, and is charged a step at a time, so the
 * search still finds the cheapest route.
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

/** Space kept clear around each box. Arrows go in and out of it only at their own ends. */
export const MARGIN = 24;
/** Fractions along each side that always get a grid line, so every side has places for arrows to attach. */
const ANCHORS = [0.25, 0.5, 0.75];
/** Arrows attach at least this fraction of a side's length from its ends, clear of rounded corners. */
const CORNER_INSET = 0.2;
/** Arrows attached to the same side closer together than this cost extra. */
const PORT_SPACING = 24;

// Costs, in pixels of line length.
/** A corner. It's more than attaching off the middle of a side costs, so an arrow does that to save one. */
const BEND = 100;
const CROSSING = 300;
/** Per pixel run alongside another arrow. */
const OVERLAP = 3;
/** Runs this close beside another arrow's count as running along it: they'd look like one thick line. */
const NEAR = 10;
/**
 * Runs closer than this beside another arrow cost extra too, the more the closer, so
 * arrows spread out where there's room, and so do their labels. Arrows bunched together
 * are hard to tell apart, and leave their labels no room.
 */
const APART = 50;
/** Per pixel run NEAR beside another arrow, falling to nothing at APART. */
const CLOSE = 0.8;
/**
 * For attaching anywhere but the middle of a side, on top of a pixel for each pixel
 * from it. Moving off the middle saves at most that much line, so an arrow doesn't
 * do it just to be shorter: only to keep straight or to save a corner.
 */
const OFF_MIDDLE = 10;
/**
 * Per pixel from the middle of a side, instead, where another arrow already attaches at
 * the middle, so arrows sharing a side spread out along it. Two arrows that could each
 * have the middle of a side to themselves don't pull each other off it, as neither is there.
 */
const BESIDE_MIDDLE = 0.2;
/**
 * For leaving a box by a side square to the way the arrow's going, and twice this by
 * the side facing away (see `leaving`).
 */
const TURNED_AWAY = 20;
/**
 * For leaving a box by its left or right side: automatic layout runs top to bottom,
 * so where the two ways are otherwise even, as for a box diagonally across, an arrow
 * leaves by the top or bottom.
 */
const SIDEWAYS = 1;
const SHARED_PORT = 200;
/** Runs closer than this to a boundary frame's side cost as much as running along another arrow. There's a lane this far outside each side. */
const FRAME_GAP = 16;
/**
 * Per pixel run under a note, for a link that can't get round the notes in its way at all: then
 * it goes under as little of them as it can, rather than having no route.
 */
const UNDER_NOTE = 10;
/** A step shorter than this, between two runs going the same way, is straightened out where that keeps clear of boxes. */
const JOG = 12;
/**
 * How many pairs of arrows that cross are routed again, each first in turn, in one
 * layout (see routeAround). Each pair costs four searches, which add up on a busy
 * diagram with many crossings, where trying them all rarely helps.
 */
const UNTANGLES = 8;

/** Directions of movement, which are also the axis of a run. */
const H = 0;
const V = 1;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Side = "top" | "bottom" | "left" | "right";

interface Port {
  /** The box. */
  id: string;
  edge: Side;
  /** The box and side together, such as `api:top`. */
  side: string;
  /** Where along the side: x for the top and bottom, y for the left and right. */
  pos: number;
  /** On the box's border. */
  at: Readonly<Point>;
  /** Just outside the box, where the route on the grid starts or ends. */
  stub: Readonly<Point>;
  /** Axis of the run between `at` and `stub`. */
  axis: typeof H | typeof V;
  /** How far it is from the middle of its side. */
  offset: number;
  /** What leaving by this side costs an arrow heading another way (see `leaving`): none where the port isn't an arrow's start. */
  away: number;
}

/** A route, which isn't changed once made: its ports and points are shared with other routes and with the grid. */
interface Route {
  /** Grid points from the start's stub to the end's, each next to the last. None for a route straight across a gap too narrow for the grid. */
  readonly cells: readonly number[];
  readonly ports: readonly [Port, Port];
  readonly points: readonly Readonly<Point>[];
  readonly cost: number;
}

/** A box's sides in whole pixels, so the grid lines built from them match exactly. */
function rect(b: Box): Rect {
  return { left: Math.round(b.x), top: Math.round(b.y), right: Math.round(b.x + b.w), bottom: Math.round(b.y + b.h) };
}

function inflate(r: Rect): Rect {
  return { left: r.left - MARGIN, top: r.top - MARGIN, right: r.right + MARGIN, bottom: r.bottom + MARGIN };
}

/** Whether the run at column `i`, row `j` along `axis` is inside `span`, a clear space's first and last column and row. */
function runIn([i0, i1, j0, j1]: readonly [number, number, number, number], i: number, j: number, axis: typeof H | typeof V): boolean {
  return axis === H ? j > j0 && j < j1 && i >= i0 && i < i1 : i > i0 && i < i1 && j >= j0 && j < j1;
}

/** Whether two rects overlap, more than just touching. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Whether note `n` is on box `a` or box `b`, the ends of a link, so that link can go under it. */
function onEnds(n: Rect, a: Rect, b: Rect): boolean {
  return overlaps(n, a) || overlaps(n, b);
}

/** How far the point (`x`, `y`) is from `r`, across and down: none inside it. */
function distanceTo(x: number, y: number, r: Rect): number {
  return Math.max(0, r.left - x, x - r.right) + Math.max(0, r.top - y, y - r.bottom);
}

/**
 * The axis a route through `cells` moves along into each of them, and out of the
 * last: it comes out of its start box, and goes into its end box, along its ports'
 * axes. Its arms at cell `k` are along the axes into and out of it, `k` and `k + 1`:
 * the same where it goes straight through, and one of each where it turns.
 */
function movesOf(cells: readonly number[], start: Port, end: Port): (typeof H | typeof V)[] {
  return [start.axis, ...cells.slice(1).map((q, k) => (Math.abs(q - cells[k]!) === 1 ? H : V)), end.axis];
}

/** Where along a side, from `from` to `to`, there's always a grid line for arrows to attach at. */
function anchorsOf(from: number, to: number): number[] {
  return ANCHORS.map((f) => Math.round(from + (to - from) * f));
}

/** The stretch of a side, from `from` to `to`, where arrows can attach: away from its corners. */
function inset(from: number, to: number): [number, number] {
  return [from + (to - from) * CORNER_INSET, to - (to - from) * CORNER_INSET];
}

/** Whether two ports are the same place on the same side. */
function samePort(a: Port, b: Port): boolean {
  return a.side === b.side && a.pos === b.pos;
}

/** Where an arrow attaches at `pos` along one side of box `id`, for an arrow that pays `away` to leave by that side. */
function portAt(id: string, r: Rect, edge: Side, pos: number, away = 0): Port {
  const o = inflate(r);
  if (edge === "top" || edge === "bottom") {
    const [y, out] = edge === "top" ? [r.top, o.top] : [r.bottom, o.bottom];
    return { id, edge, side: `${id}:${edge}`, pos, at: { x: pos, y }, stub: { x: pos, y: out }, axis: V, offset: Math.abs(pos - (r.left + r.right) / 2), away };
  }
  const [x, out] = edge === "left" ? [r.left, o.left] : [r.right, o.right];
  return { id, edge, side: `${id}:${edge}`, pos, at: { x, y: pos }, stub: { x: out, y: pos }, axis: H, offset: Math.abs(pos - (r.top + r.bottom) / 2), away };
}

/**
 * Box `from`'s `ports`, for an arrow leaving it for box `to`: each costs more the more
 * its side faces away from the way the arrow's going, from the middle of one box to the
 * middle of the other. So an arrow heads off toward where it's going: out of the top of
 * a box when its target is mostly above, rather than out of a side and turning up. The
 * left and right sides cost SIDEWAYS more.
 */
function leaving(ports: Port[], from: Rect, to: Rect): Port[] {
  const [dx, dy] = [(to.left + to.right - from.left - from.right) / 2, (to.top + to.bottom - from.top - from.bottom) / 2];
  const length = Math.hypot(dx, dy) || 1;
  const toward: Record<Side, number> = { top: -dy, bottom: dy, left: -dx, right: dx };
  return ports.map((p) => ({ ...p, away: TURNED_AWAY * (1 - toward[p.edge] / length) + (p.axis === H ? SIDEWAYS : 0) }));
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
  /** The boxes routes go around, and the clear space around each. */
  readonly rects: Rect[];
  readonly clears: Rect[];
  /** The notes routes go around, but for those on a route's own boxes, and the clear space around each. */
  readonly notes: Rect[];
  readonly noteClears: Rect[];
  readonly xs: number[];
  readonly ys: number[];
  readonly nx: number;
  readonly ny: number;
  private readonly xIndex: Map<number, number>;
  private readonly yIndex: Map<number, number>;
  /** Runs inside the clear space around some box. */
  readonly blockedH: Uint8Array;
  readonly blockedV: Uint8Array;
  /** How many routed arrows use each run, and how many arms they have at each point along each axis. */
  readonly usedH: Uint16Array;
  readonly usedV: Uint16Array;
  readonly armsH: Uint16Array;
  readonly armsV: Uint16Array;
  /** Runs alongside a boundary frame's side. */
  readonly alongFrameH: Uint8Array;
  readonly alongFrameV: Uint8Array;
  /** How many notes' clear spaces each run is in. */
  readonly notesH: Uint16Array;
  readonly notesV: Uint16Array;
  /** The grid lines each note's clear space runs between: its first and last column and row. */
  private readonly noteSpans: [number, number, number, number][];
  /**
   * For each row, and each column, the steps to the runs on the others closer than APART,
   * and what each costs per pixel run beside an arrow there: as much as running along it
   * closer than NEAR, where they'd look like the same line, and less the further apart.
   */
  private readonly besideRows: { steps: number[]; costs: number[] }[];
  private readonly besideCols: { steps: number[]; costs: number[] }[];
  /** Where routed arrows attach on each side, by `Port.side`. */
  private readonly attached = new Map<string, Port[]>();
  /** The route each link has on the grid, by link ID: the grid's own record, so what's removed is always what was placed. */
  private readonly placed = new Map<string, Route>();
  // Search state, reused between searches.
  private readonly cost: Float64Array;
  private readonly prev: Int32Array;
  private readonly done: Uint8Array;

  /**
   * `rects` are the boxes routes go around, and `notes` the notes, which a route goes round too
   * unless it's on one of the route's own boxes. `aligned` holds extra lines, such as ones a
   * straight arrow between two boxes could run along.
   */
  constructor(rects: Rect[], frames: Rect[], aligned: { xs: number[]; ys: number[] }, notes: Rect[] = []) {
    this.rects = rects;
    this.clears = rects.map(inflate);
    this.notes = [...notes];
    this.noteClears = this.notes.map(inflate);
    const near = { x: new Set<number>(), y: new Set<number>() };
    const far = { x: new Set<number>(), y: new Set<number>() };
    for (const r of [...this.clears, ...this.noteClears]) {
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
        const out = { steps: [] as number[], costs: [] as number[] };
        const add = (m: number) => {
          const d = Math.abs(values[m]! - v);
          out.steps.push((m - k) * unit);
          out.costs.push(d < NEAR ? OVERLAP : CLOSE * (1 - (d - NEAR) / (APART - NEAR)));
        };
        for (let m = k - 1; m >= 0 && v - values[m]! < APART; m--) add(m);
        for (let m = k + 1; m < values.length && values[m]! - v < APART; m++) add(m);
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
    this.notesH = new Uint16Array(n);
    this.notesV = new Uint16Array(n);
    this.armsH = new Uint16Array(n);
    this.armsV = new Uint16Array(n);
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

    // The sides of clear spaces are grid lines, so a run is either wholly inside one or wholly outside it.
    const spanOf = (r: Rect): [number, number, number, number] => [this.xIndex.get(r.left)!, this.xIndex.get(r.right)!, this.yIndex.get(r.top)!, this.yIndex.get(r.bottom)!];
    const inside = (span: [number, number, number, number], mark: (h: boolean, p: number) => void) => {
      const [i0, i1, j0, j1] = span;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (runIn(span, i, j, H)) mark(true, j * nx + i);
          if (runIn(span, i, j, V)) mark(false, j * nx + i);
        }
      }
    };
    for (const r of this.clears) inside(spanOf(r), (h, p) => ((h ? this.blockedH : this.blockedV)[p] = 1));
    this.noteSpans = this.noteClears.map(spanOf);
    for (const span of this.noteSpans) inside(span, (h, p) => (h ? this.notesH : this.notesV)[p]!++);
  }

  /** The notes a route between boxes `a` and `b` can go under, by their place in `notes`: those on either box. */
  notesOn(a: Rect, b: Rect): number[] {
    return this.notes.flatMap((n, k) => (onEnds(n, a, b) ? [k] : []));
  }

  /** How many notes run `run` along `axis` is under, besides the notes `under` a route can go under. */
  private otherNotes(run: number, axis: typeof H | typeof V, under: readonly number[]): number {
    const notes = (axis === H ? this.notesH : this.notesV)[run]!;
    if (!notes || !under.length) return notes;
    const [i, j] = [run % this.nx, Math.floor(run / this.nx)];
    let mine = 0;
    for (const k of under) if (runIn(this.noteSpans[k]!, i, j, axis)) mine++;
    return notes - mine;
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
    const [left, right] = inset(r.left, r.right);
    const [top, bottom] = inset(r.top, r.bottom);
    for (const x of this.xs) if (at.xs.has(x) && x >= left && x <= right) out.push(portAt(id, r, "top", x), portAt(id, r, "bottom", x));
    for (const y of this.ys) if (at.ys.has(y) && y >= top && y <= bottom) out.push(portAt(id, r, "left", y), portAt(id, r, "right", y));
    return out;
  }

  /** What a step costs along the run `run`, `length` long and on `axis`: its length, and more for running along another arrow, beside one or along a frame. */
  private stepCost(run: number, axis: typeof H | typeof V, length: number): number {
    const across = axis === H;
    const used = across ? this.usedH : this.usedV;
    const { steps, costs } = across ? this.besideRows[Math.floor(run / this.nx)]! : this.besideCols[run % this.nx]!;
    let beside = 0;
    for (let k = 0; k < steps.length; k++) beside += costs[k]! * used[run + steps[k]!]!;
    const frame = (across ? this.alongFrameH : this.alongFrameV)[run]!;
    return length + length * (OVERLAP * (used[run]! + frame) + beside);
  }

  /** What attaching at `port` costs, given the arrows already attached to its side. */
  portCost(port: Port) {
    const others = this.attached.get(port.side) ?? [];
    const taken = others.some((other) => other.offset < PORT_SPACING);
    // A side's middle is a whole pixel, so on a side an odd number of pixels long it's half a pixel off.
    const middle = port.offset < 1;
    let cost = port.away + (middle ? 0 : taken ? BESIDE_MIDDLE * port.offset : port.offset + OFF_MIDDLE);
    for (const other of others) cost += SHARED_PORT * Math.max(0, 1 - Math.abs(other.pos - port.pos) / PORT_SPACING);
    return cost;
  }

  /** Whether another arrow already attaches closer to `port` than PORT_SPACING. */
  crowds(port: Port): boolean {
    return (this.attached.get(port.side) ?? []).some((other) => Math.abs(other.pos - port.pos) < PORT_SPACING);
  }

  /**
   * What an arm along `axis` at point `p` costs: a quarter of a crossing for each
   * arm other routes have there across it (see the top of this file). A step pays
   * for an arm at each end, and a route has an arm into its box at each stub.
   */
  private armCost(p: number, axis: typeof H | typeof V): number {
    return (CROSSING / 4) * (axis === H ? this.armsV : this.armsH)[p]!;
  }

  /**
   * The cheapest route from any of `starts` to any of `goals`, as grid points, for a route that can go
   * under the notes `under` and goes round any others, or with `soft`, pays UNDER_NOTE to go under them.
   */
  search(starts: Port[], goals: Port[], target: Rect, under: readonly number[], soft = false): { cells: number[]; ports: [Port, Port]; cost: number } | undefined {
    const { nx, ny, xs, ys, cost, prev, done } = this;
    const goal = 2 * nx * ny;
    cost.fill(Infinity);
    prev.fill(-1);
    done.fill(0);
    const heap = new MinHeap();
    // Distance to the target's clear space, which every route has to reach.
    const estimate = (p: number) => distanceTo(xs[p % nx]!, ys[Math.floor(p / nx)]!, target);
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
      const [s, c] = [p * 2 + port.axis, this.portCost(port) + this.armCost(p, port.axis)];
      if (c < cost[s]!) startPorts.set(s, port);
      relax(s, c, -1, estimate(p));
    }
    const goalPorts = new Map<number, { port: Port; cost: number }>();
    for (const port of goals) {
      const p = this.point(port.stub);
      if (p < 0) continue;
      const [s, c] = [p * 2 + port.axis, this.portCost(port) + this.armCost(p, port.axis)];
      if (c < (goalPorts.get(s)?.cost ?? Infinity)) goalPorts.set(s, { port, cost: c });
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
      if (arriving) relax(goal, c + arriving.cost, s, 0);
      relax(p * 2 + (1 - axis), c + BEND, s, estimate(p));
      const i = p % nx;
      const j = (p - i) / nx;
      const along = axis as typeof H | typeof V;
      const out = this.armCost(p, along);
      const blocked = along === H ? this.blockedH : this.blockedV;
      const step = (q: number, run: number, length: number) => {
        if (blocked[run]) return;
        const notes = this.otherNotes(run, along, under);
        if (notes && !soft) return;
        relax(q * 2 + axis, c + out + this.stepCost(run, along, length) + (notes ? UNDER_NOTE * length : 0) + this.armCost(q, along), s, estimate(q));
      };
      if (axis === H) {
        if (i + 1 < nx) step(p + 1, p, xs[i + 1]! - xs[i]!);
        if (i > 0) step(p - 1, p - 1, xs[i]! - xs[i - 1]!);
      } else {
        if (j + 1 < ny) step(p + nx, p, ys[j + 1]! - ys[j]!);
        if (j > 0) step(p - nx, p - nx, ys[j]! - ys[j - 1]!);
      }
    }
    if (prev[goal] === -1) return undefined;

    const states: number[] = [];
    for (let s = prev[goal]!; s !== -1; s = prev[s]!) states.push(s);
    states.reverse();
    const cells = states.map((s) => s >> 1).filter((p, k, all) => k === 0 || p !== all[k - 1]);
    return { cells, ports: [startPorts.get(states[0]!)!, goalPorts.get(states[states.length - 1]!)!.port], cost: cost[goal]! };
  }

  /**
   * What the search would charge for a route through `cells` between `ports`, given
   * the routes on the grid now. A route with no cells runs straight between its
   * ports, across a gap too narrow for the grid.
   */
  costOf(cells: readonly number[], [start, end]: readonly [Port, Port]): number {
    let cost = this.portCost(start) + this.portCost(end);
    if (!cells.length) return cost + Math.hypot(end.at.x - start.at.x, end.at.y - start.at.y);
    const moves = movesOf(cells, start, end);
    cells.forEach((p, k) => {
      cost += this.armCost(p, moves[k]!) + this.armCost(p, moves[k + 1]!);
      if (moves[k] !== moves[k + 1]) cost += BEND;
      const q = cells[k + 1];
      if (q === undefined) return;
      const [a, b] = [this.at(p), this.at(q)];
      cost += this.stepCost(Math.min(p, q), moves[k + 1]!, Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
    });
    return cost;
  }

  /**
   * The grid points a route through `points` between `ports` runs along, from stub to
   * stub. Undefined where it runs off the grid's lines, through a box's clear space
   * where the search can't go, or turns closer to its box than a stub: the stretch
   * between a box and its stubs isn't on the grid, so crossing another arrow there,
   * by its arrowhead, would cost nothing.
   */
  cellsOf(points: readonly Readonly<Point>[], [start, end]: readonly [Port, Port], under: readonly number[]): number[] | undefined {
    const { nx } = this;
    const between = (p: Point, a: Point, b: Point) => (a.x === b.x && p.x === a.x && (p.y - a.y) * (p.y - b.y) <= 0) || (a.y === b.y && p.y === a.y && (p.x - a.x) * (p.x - b.x) <= 0);
    const [first, second, last, before] = [points[0]!, points[1]!, points[points.length - 1]!, points[points.length - 2]!];
    if (!between(start.stub, first, second) || !between(end.stub, before, last)) return undefined;
    // A straight route has to reach its stubs in order.
    const out = (p: Point) => Math.abs(p.x - first.x) + Math.abs(p.y - first.y);
    if (points.length === 2 && out(end.stub) < out(start.stub)) return undefined;
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
      const axis = i0 !== i1 ? H : V;
      const blocked = axis === H ? this.blockedH : this.blockedV;
      for (let c = last; c !== p; ) {
        const run = Math.min(c, c + by);
        if (blocked[run] || this.otherNotes(run, axis, under)) return undefined;
        cells.push((c += by));
      }
    }
    return cells;
  }

  /** Each link's route on the grid, by link ID, as it is now: it changes as routes are placed and removed. */
  get routes(): ReadonlyMap<string, Route> {
    return this.placed;
  }

  /** Puts `route` on the grid as link `id`'s, in place of any it had. Later routes avoid what's there. */
  place(id: string, route: Route): void {
    this.remove(id);
    this.mark(route, 1);
    this.placed.set(id, route);
  }

  /** Takes link `id`'s route off the grid, if it has one. */
  remove(id: string): void {
    const old = this.placed.get(id);
    if (!old) return;
    this.mark(old, -1);
    this.placed.delete(id);
  }

  /** Records a route's runs, its arms at each point, and its ports; `by` is 1 to add, -1 to remove. */
  private mark(route: Route, by: 1 | -1) {
    const { cells, ports } = route;
    const moves = movesOf(cells, ...ports);
    cells.forEach((p, k) => {
      (moves[k] === H ? this.armsH : this.armsV)[p]! += by;
      (moves[k + 1] === H ? this.armsH : this.armsV)[p]! += by;
      const q = cells[k + 1];
      if (q !== undefined) (moves[k + 1] === H ? this.usedH : this.usedV)[Math.min(p, q)]! += by;
    });
    for (const port of ports) {
      const list = this.attached.get(port.side) ?? [];
      if (by === 1) list.push(port);
      else list.splice(list.indexOf(port), 1);
      this.attached.set(port.side, list);
    }
  }
}

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points: readonly Readonly<Point>[]): Readonly<Point>[] {
  const out: Readonly<Point>[] = [];
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
 * otherwise leave a little kink. A moved route keeps to the runs the search could
 * take, out of every box's clear space, where the stretches between arrows' stubs
 * and their boxes are, off the grid; an end moved along its box's side stays clear
 * of the corners; and a change is only kept if the search would have charged less
 * for it, so a run isn't moved beside another arrow or along a frame.
 */
function straighten(grid: Grid, route: Route, from: Rect, to: Rect, under: readonly number[]): Route {
  const onSide = (p: Point, r: Rect) => {
    const [lo, hi] = p.x === r.left || p.x === r.right ? inset(r.top, r.bottom) : inset(r.left, r.right);
    const pos = p.x === r.left || p.x === r.right ? p.y : p.x;
    return pos >= lo && pos <= hi;
  };
  // Moves the run from point `i` to point `i + 1` across, onto the line `to`, if the runs either side of it still go the way they did.
  const move = (pts: readonly Readonly<Point>[], i: number, across: boolean, line: number) => {
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
    return portAt(port.id, r, port.edge, port.axis === V ? at.x : at.y, port.away);
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
      if (!option || !onSide(option[0]!, from) || !onSide(option[option.length - 1]!, to)) continue;
      const points = simplify(option);
      const ports: [Port, Port] = [movedTo(best.ports[0], from, points[0]!), movedTo(best.ports[1], to, points[points.length - 1]!)];
      // The search found the cheapest route between its ends, so keeping both of those can't help.
      if (samePort(ports[0], route.ports[0]) && samePort(ports[1], route.ports[1])) continue;
      const cells = grid.cellsOf(points, ports, under);
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
 * Lines across the stretch where two sides, from `a0` to `a1` and from `b0` to
 * `b1`, both have places for arrows to attach: one for each of the `count` arrows
 * between them, as many as fit at least PORT_SPACING apart, in the middle of equal
 * shares of the stretch. None when there's no such stretch. Each is a whole pixel
 * inside it.
 */
function facing(a0: number, a1: number, b0: number, b1: number, count: number): number[] {
  const [[alo, ahi], [blo, bhi]] = [inset(a0, a1), inset(b0, b1)];
  const [lo, hi] = [Math.ceil(Math.max(alo, blo)), Math.floor(Math.min(ahi, bhi))];
  if (lo > hi) return [];
  const fit = Math.max(1, Math.min(count, Math.floor((hi - lo) / PORT_SPACING)));
  return Array.from({ length: fit }, (_, k) => Math.round(lo + ((hi - lo) * (k + 0.5)) / fit));
}

/** Whether any run of a route goes through the inside of `r`. */
function runsThrough(points: readonly Readonly<Point>[], r: Rect): boolean {
  return points.slice(1).some((b, k) => {
    const a = points[k]!;
    return Math.min(a.x, b.x) < r.right && Math.max(a.x, b.x) > r.left && Math.min(a.y, b.y) < r.bottom && Math.max(a.y, b.y) > r.top;
  });
}

interface Routing {
  grid: Grid;
  /** Where arrows can attach to each box. */
  ports: Map<string, Port[]>;
  /** Where each link can leave its source, by link ID: its source's ports, costed for where it's going (see `leaving`). */
  starts: Map<string, Port[]>;
  /** Each link's route, as on the grid (see Grid.place). */
  routes: ReadonlyMap<string, Route>;
}

/**
 * The cheapest route for a link from any of `starts` to any of `goals`, given the routes already on the
 * grid, going under the notes `under` (those on its own boxes) and round any others, or with `soft`,
 * under as little of them as it can.
 */
function routeOne(grid: Grid, starts: Port[], goals: Port[], from: Rect, to: Rect, under: readonly number[], soft = false): Route | undefined {
  // A stub inside another box's clear space, or a note's the route has to go round, leads nowhere, as
  // every run from it is shut; but where a start and goal stub are the same point, it would make a
  // route straight through that box or under that note.
  const inside = (c: Rect, x: number, y: number) => x > c.left && x < c.right && y > c.top && y < c.bottom;
  const open = ({ stub: { x, y } }: Port) =>
    !grid.clears.some((c, k) => grid.rects[k] !== from && grid.rects[k] !== to && inside(c, x, y)) && (soft || !grid.noteClears.some((c, k) => !under.includes(k) && inside(c, x, y)));
  const found = grid.search(starts.filter(open), goals.filter(open), inflate(to), under, soft);
  if (!found) return undefined;
  const [start, end] = found.ports;
  const route = { ...found, points: simplify([start.at, ...found.cells.map((p) => grid.at(p)), end.at]) };
  // Straightening keeps to the runs the search could take round the notes, which a soft route doesn't.
  return soft ? route : straighten(grid, route, from, to, under);
}

/**
 * A straight route between two boxes that face each other across a gap too narrow
 * for the grid, where their clear spaces overlap, along whichever of `lines` (the
 * ones across where they face) costs least, given the arrows already attached.
 * Undefined when they don't face each other that closely, or something else is in the
 * gap, but for the notes `under`.
 */
function acrossGap(grid: Grid, from: Rect, to: Rect, starts: Port[], goals: Port[], lines: { xs: number[]; ys: number[] }, under: readonly number[]): Route | undefined {
  let best: Route | undefined;
  const gap = (sides: [Side, Side], candidates: number[], a: number, b: number) => {
    if (b <= a || b - a >= 2 * MARGIN) return;
    for (const line of candidates) {
      const start = starts.find((p) => p.edge === sides[0] && p.pos === line);
      const end = goals.find((p) => p.edge === sides[1] && p.pos === line);
      // A line another arrow already attaches beside would draw the two as one, so leave this one to go round.
      if (!start || !end || grid.crowds(start) || grid.crowds(end)) continue;
      const points = [start.at, end.at];
      if (grid.rects.some((r, k) => r !== from && r !== to && runsThrough(points, grid.clears[k]!))) continue;
      if (grid.noteClears.some((c, k) => !under.includes(k) && runsThrough(points, c))) continue;
      const cost = grid.costOf([], [start, end]);
      if (!best || cost < best.cost) best = { cells: [], ports: [start, end], points, cost };
    }
  };
  gap(["bottom", "top"], lines.xs, from.bottom, to.top);
  gap(["top", "bottom"], lines.xs, to.bottom, from.top);
  gap(["right", "left"], lines.ys, from.right, to.left);
  gap(["left", "right"], lines.ys, to.right, from.left);
  return best;
}

/**
 * Whether a link between boxes `a` and `b` could be a straight line, along one of `lines` (the
 * ones across where they face each other), without going through another of `rects`' clear space.
 */
function couldBeStraight(a: Rect, b: Rect, lines: { xs: number[]; ys: number[] }, rects: Iterable<Rect>): boolean {
  const others = [...rects].filter((r) => r !== a && r !== b).map(inflate);
  const clear = (points: Point[]) => !others.some((c) => runsThrough(points, c));
  const [above, below] = a.top <= b.top ? [a, b] : [b, a];
  const [left, right] = a.left <= b.left ? [a, b] : [b, a];
  return (
    (above.bottom <= below.top && lines.xs.some((x) => clear([{ x, y: above.bottom }, { x, y: below.top }]))) ||
    (left.right <= right.left && lines.ys.some((y) => clear([{ x: left.right, y }, { x: right.left, y }])))
  );
}

/**
 * Routes for the links that have one, around the boxes and the `notes` in the way: those
 * that could be straight first, then the rest, each shortest first, then any two that
 * cross again, each first in turn.
 */
function routeAround(rects: Map<string, Rect>, notes: Rect[], links: Link[], frames: Rect[]): Routing {
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
  const grid = new Grid([...rects.values()], frames, aligned, notes);
  const ports = new Map([...rects].map(([id, r]) => [id, grid.portsOf(id, r, at.get(id)!)]));
  const starts = new Map(links.map((l) => [l.id, leaving(ports.get(l.from)!, rects.get(l.from)!, rects.get(l.to)!)]));
  const everyNote = notes.map((_, k) => k);
  const notesOn = new Map(links.map((l) => [l.id, grid.notesOn(rects.get(l.from)!, rects.get(l.to)!)]));

  // A straight line is the one good way for a link that could be straight, so it goes first,
  // before a link that could go round takes the place where the straight one attaches.
  const straight = new Set(links.filter((l) => couldBeStraight(rects.get(l.from)!, rects.get(l.to)!, across.get(l.id)!, rects.values())));
  const order = [...links.filter((l) => straight.has(l)), ...links.filter((l) => !straight.has(l))];

  /** The cheapest route for `link`, given the routes on the grid now. */
  const routeLink = (link: Link): Route | undefined => {
    const [from, to, leaves, goals] = [rects.get(link.from)!, rects.get(link.to)!, starts.get(link.id)!, ports.get(link.to)!];
    const [lines, under] = [across.get(link.id)!, notesOn.get(link.id)!];
    // With no way round the notes in its way, a link goes under as little of them as it can rather
    // than have no route at all: straight across a narrow gap, or else paying for each pixel under one.
    const blockedByNotes = () => (under.length < everyNote.length ? acrossGap(grid, from, to, leaves, goals, lines, everyNote) ?? routeOne(grid, leaves, goals, from, to, under, true) : undefined);
    return acrossGap(grid, from, to, leaves, goals, lines, under) ?? routeOne(grid, leaves, goals, from, to, under) ?? blockedByNotes();
  };
  for (let pass = 0; pass < 2; pass++) {
    for (const link of order) {
      grid.remove(link.id);
      const route = routeLink(link);
      if (route) grid.place(link.id, route);
    }
  }

  // Each link is routed around the others as they are, so two can end up crossing where, routed
  // the other way round, neither would: the first took the way the second needed. So each pair that
  // crosses is routed again, each first in turn, and kept whichever way the two cost least together.
  let tries = UNTANGLES;
  for (const [k, a] of order.entries()) {
    for (const b of order.slice(k + 1)) {
      if (tries <= 0) break;
      const [routeA, routeB] = [grid.routes.get(a.id), grid.routes.get(b.id)];
      if (!routeA || !routeB || !cross(routeA.points, routeB.points)) continue;
      tries--;
      grid.remove(a.id);
      grid.remove(b.id);
      // The two as they are, costed the way the search would: whichever is placed second pays for what's between them.
      let best = { cost: grid.costOf(routeA.cells, routeA.ports), routes: [[a, routeA] as const, [b, routeB] as const] };
      grid.place(a.id, routeA);
      best.cost += grid.costOf(routeB.cells, routeB.ports);
      grid.remove(a.id);
      for (const [first, second] of [[b, a], [a, b]] as const) {
        const one = routeLink(first);
        if (!one) continue;
        grid.place(first.id, one);
        const two = routeLink(second);
        grid.remove(first.id);
        if (two && one.cost + two.cost < best.cost) best = { cost: one.cost + two.cost, routes: [[first, one], [second, two]] };
      }
      for (const [link, route] of best.routes) grid.place(link.id, route);
    }
  }
  return { grid, ports, starts, routes: grid.routes };
}

/**
 * Routes every link it can, in the order they were routed, going around notes only where they're
 * in the way (see routeLinks). `clear` holds the notes no route was in the way of, which other
 * routes have to keep clear of too, but for those on their own boxes, as the grid doesn't go round them.
 */
function routeAll(boxes: Map<string, Box>, links: Link[], frames: Box[], notes: Box[]): Routing & { rects: Map<string, Rect>; routable: Link[]; clear: Rect[] } {
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

  // Route ignoring the notes, then again going round any a route runs under, until none is newly in
  // the way. A link goes under a note on one of its own boxes, though: it's about that box, and going
  // round it could leave the box's arrows no way out. Other links go round it.
  const noteRects = notes.map(rect);
  const noteClears = new Map(noteRects.map((n) => [n, inflate(n)]));
  const ends = routable.map((l) => ({ id: l.id, a: rects.get(l.from)!, b: rects.get(l.to)! }));
  const avoided: Rect[] = [];
  let routing = routeAround(rects, avoided, routable, frameRects);
  for (;;) {
    const inTheWay = noteRects.filter(
      (n) => !avoided.includes(n) && ends.some(({ id, a, b }) => !onEnds(n, a, b) && runsThrough(routing.routes.get(id)?.points ?? [], noteClears.get(n)!)),
    );
    if (!inTheWay.length) break;
    avoided.push(...inTheWay);
    routing = routeAround(rects, avoided, routable, frameRects);
  }
  const clear = noteRects.filter((n) => !avoided.includes(n));
  return { ...routing, rects, routable, clear };
}

/** Each link's points: its route, or a straight line between its boxes when it has none. Shared with the routes, so read-only. */
function pointsOf(boxes: Map<string, Box>, links: Link[], routes: ReadonlyMap<string, Route>): Map<string, readonly Readonly<Point>[]> {
  const out = new Map<string, readonly Readonly<Point>[]>();
  for (const link of links) {
    const from = boxes.get(link.from);
    const to = boxes.get(link.to);
    if (!from || !to) continue;
    const route = routes.get(link.id);
    out.set(link.id, route ? route.points : straight(from, to));
  }
  return out;
}

/**
 * Each link's route, from a point on its source box's border to one on its target's.
 * Routes cross `frames` (boundaries drawn around boxes) freely but keep off their sides.
 * They go around `notes`, boxes no arrow starts or ends at, only where one is in the
 * way: every obstacle adds grid lines right across the diagram, so a note out in empty
 * space would otherwise move arrows nowhere near it as it's dragged. A link goes under
 * a note on one of its own boxes, which is about that box, and going round which could
 * leave its arrows no way out; other links go round it.
 */
export function routeLinks(boxes: Map<string, Box>, links: Link[], frames: Box[] = [], notes: Box[] = []): Map<string, readonly Readonly<Point>[]> {
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
function lengthInside(points: readonly Readonly<Point>[], b: Box): number {
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
function bounds(points: readonly Readonly<Point>[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Whether two boxes overlap or touch. */
const meet = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

function routeLength(points: readonly Readonly<Point>[]): number {
  return points.slice(1).reduce((sum, b, k) => sum + Math.hypot(b.x - points[k]!.x, b.y - points[k]!.y), 0);
}

/** The point `s` pixels along a route. */
function along(points: readonly Readonly<Point>[], s: number): Point {
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
/**
 * Labels closer together than this cost extra too, the more the closer, so labels
 * spread out where there's room, rather than stopping as soon as they're clear of
 * each other. Labels stacked just clear of each other are hard to tell apart.
 * It's left out while routes are chosen (see layoutArrows).
 */
const LABEL_APART = 24;
/** Roughly the space an arrowhead takes up, back from the end of its route. */
const HEAD = 8;
// Costs of a spot for a label, in pixels along the route from its middle.
/** Per square pixel of a box, or of another label, the label covers (see `covers`). */
const COVERS_BOX = 1;
const COVERS_LABEL = 2;
/** Per pixel of another arrow the label hides, and for the whole of an arrowhead. */
const COVERS_ARROW = 3;
const COVERS_HEAD = 400;
/** Per pixel closer than LABEL_APART to another label. */
const CLOSE_LABEL = 2;
/** Per pixel narrower than its widest a label is drawn. */
const NARROWER = 1;
/** A label whose best spot covers this much or less has room enough where it is. */
const ROOMY = 50;
/** How much cheaper, route and label together, another route has to be before an arrow takes it for its label's sake. */
const WORTH_MOVING = 40;
/**
 * How many arrows, those with the most crowded labels first, are offered other
 * routes in one layout. Each costs up to eight searches, which add up on a big
 * diagram. Arrows that no other route could help, because any would be too long,
 * don't count.
 */
const REROUTES = 8;
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
  routes: Map<string, { points: readonly Readonly<Point>[]; bounds: Box }>;
  heads: Map<string, Box>;
}

const padded = (b: Box): Box => ({ x: b.x - LABEL_GAP, y: b.y - LABEL_GAP, w: b.w + 2 * LABEL_GAP, h: b.h + 2 * LABEL_GAP });

function headOf(points: readonly Readonly<Point>[]): Box {
  const at = along(points, routeLength(points) - HEAD / 2);
  return { x: at.x - HEAD / 2, y: at.y - HEAD / 2, w: HEAD, h: HEAD };
}

function sceneOf(routes: ReadonlyMap<string, readonly Readonly<Point>[]>, obstacles: Box[]): Scene {
  const scene: Scene = { obstacles: obstacles.map(padded), routes: new Map(), heads: new Map() };
  for (const [id, points] of routes) setRoute(scene, id, points);
  return scene;
}

function setRoute(scene: Scene, id: string, points: readonly Readonly<Point>[]): void {
  scene.routes.set(id, { points, bounds: bounds(points) });
  scene.heads.set(id, headOf(points));
}

/**
 * The spots along a route its label could go, each costed by what it covers apart
 * from other labels. `sizes` are the sizes the label can be, widest first: a
 * narrower one is tried only where the best spot at the wider ones has no room, as
 * where it covers another arrow, even if there's room further along the route.
 */
function spotsAlong(id: string, points: readonly Readonly<Point>[], sizes: Size[], scene: Scene): Spot[] {
  const total = routeLength(points);
  const spots: Spot[] = [];
  let best: Spot | undefined;
  // Only what's near the route can be covered by its label.
  const [w, h] = [Math.max(...sizes.map((s) => s.w)), Math.max(...sizes.map((s) => s.h))];
  const b = bounds(points);
  const reach = { x: b.x - w / 2, y: b.y - h / 2, w: b.w + w, h: b.h + h };
  const obstacles = scene.obstacles.filter((o) => meet(o, reach));
  const routes = [...scene.routes].filter(([other, r]) => other !== id && meet(r.bounds, reach)).map(([, r]) => r);
  const heads = [...scene.heads.values()].filter((o) => meet(o, reach));
  for (const size of sizes) {
    if (best && best.cost - best.off - NARROWER * (sizes[0]!.w - best.size.w) <= ROOMY) break;
    const narrower = NARROWER * (sizes[0]!.w - size.w);
    for (let off = 0; off <= total / 2; off += LABEL_STEP) {
      for (const s of off ? [total / 2 - off, total / 2 + off] : [total / 2]) {
        const at = along(points, s);
        const box = { x: at.x - size.w / 2, y: at.y - size.h / 2, w: size.w, h: size.h };
        let cost = off + narrower;
        for (const o of obstacles) cost += COVERS_BOX * covers(box, o);
        for (const route of routes) if (meet(route.bounds, box)) cost += COVERS_ARROW * lengthInside(route.points, box);
        for (const head of heads) cost += (COVERS_HEAD * overlap(box, head)) / (HEAD * HEAD);
        const spot = { at, size, box, off, cost };
        spots.push(spot);
        if (!best || cost < best.cost) best = spot;
      }
    }
  }
  return spots;
}

/** How far apart two boxes are, corner to corner where neither is level with the other: none where they overlap or touch. */
function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * The cheapest of `spots`, given the other labels' boxes, and what it costs. Being
 * closer than LABEL_APART to them costs only where `spread` says so.
 */
function cheapest(spots: Spot[], others: Box[], spread: boolean): { spot: Spot; cost: number } {
  const clear = others.map(padded);
  let best = { spot: spots[0]!, cost: Infinity };
  for (const spot of spots) {
    if (spot.cost >= best.cost) continue;
    let cost = spot.cost;
    others.forEach((o, k) => {
      cost += COVERS_LABEL * covers(spot.box, clear[k]!);
      if (spread) cost += CLOSE_LABEL * Math.max(0, LABEL_APART - gapBetween(spot.box, o));
    });
    if (cost < best.cost) best = { spot, cost };
  }
  return best;
}

/** Each label's spots (see spotsAlong), by link ID, in the order they're placed. */
type Candidates = { id: string; spots: Spot[] }[];

function candidates(sizes: Map<string, Size[]>, scene: Scene): Candidates {
  const labels: (Candidates[number] & { total: number })[] = [];
  for (const [id, { points }] of scene.routes) {
    const size = sizes.get(id);
    if (size?.length && points.length >= 2) labels.push({ id, total: routeLength(points), spots: spotsAlong(id, points, size, scene) });
  }
  // Shortest routes first, as they have the fewest spots to choose from.
  return labels.sort((a, b) => a.total - b.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Places every label, as placeLabels describes, with what each spot costs. They're kept apart from each other only where `spread` says so. */
function placeAll(labels: Candidates, spread: boolean): Map<string, { spot: Spot; cost: number }> {
  // Each label in turn, then each again with all the others placed, so the first ones can make way for the rest.
  const placed = new Map<string, { spot: Spot; cost: number }>();
  for (let pass = 0; pass < 2; pass++) {
    for (const { id, spots } of labels) {
      placed.delete(id);
      placed.set(id, cheapest(spots, [...placed.values()].map((p) => p.spot.box), spread));
    }
  }
  return placed;
}

/**
 * Where to centre each route's label: on the route, as near its middle as it
 * can be without covering `obstacles`, other labels, or other arrows and their
 * arrowheads, and kept apart from other labels where there's room. A label that
 * can't help covering something covers as little of it as it can, drawn narrower
 * where that helps. `sizes` holds each label's size, or the sizes it can be drawn
 * at, widest first, by link ID.
 */
export function placeLabels(routes: ReadonlyMap<string, readonly Readonly<Point>[]>, sizes: Map<string, Size | Size[]>, obstacles: Box[]): Map<string, Point> {
  const options = new Map([...sizes].map(([id, s]) => [id, Array.isArray(s) ? s : [s]]));
  return new Map([...placeAll(candidates(options, sceneOf(routes, obstacles)), true)].map(([id, p]) => [id, p.spot.at]));
}

/**
 * Routes and labels together: links are routed as routeLinks does and their labels
 * placed as placeLabels does, among the boxes, the notes and `keepClear`. Then the
 * arrows whose labels can't find room (up to REROUTES of them, the most crowded
 * first) are offered other routes, leaving their source and entering their target by
 * each side, and take one where it and its label cost less together, such as a
 * route with an extra corner whose label then sits in the clear. Labels are kept
 * apart from each other only once the routes are settled, so spreading them out
 * never changes the way an arrow goes.
 * `sizes` holds the sizes each label can be drawn at, widest first; each label
 * comes back with the size it's drawn at.
 */
export function layoutArrows<S extends Size>(
  boxes: Map<string, Box>,
  links: Link[],
  sizes: Map<string, S[]>,
  { frames = [], notes = [], keepClear = [] }: { frames?: Box[]; notes?: Box[]; keepClear?: Box[] } = {},
): { routes: Map<string, readonly Readonly<Point>[]>; labels: Map<string, Point & S> } {
  const { grid, ports, starts, routes, rects, routable, clear } = routeAll(boxes, links, frames, notes);
  const scene = sceneOf(pointsOf(boxes, links, routes), [...boxes.values(), ...notes, ...keepClear]);
  const first = candidates(sizes, scene);
  const placed = placeAll(first, false);
  // The grid only goes around notes some route was in the way of, so other routes have to be checked against the rest, as routeAll does.
  const clearSpaces = clear.map((n) => [n, inflate(n)] as const);
  const underNote = (r: Route, a: Rect, b: Rect) => clearSpaces.some(([n, c]) => !onEnds(n, a, b) && runsThrough(r.points, c));

  const crowding = (id: string) => {
    const label = placed.get(id);
    return label ? label.cost - label.spot.off : 0;
  };
  // The other ways a link could go, leaving its source or entering its target by each side,
  // that could be short enough: out to a stub, across to the other box's clear space and in.
  const optionsFor = (link: Link) => {
    const [from, to, source, target] = [starts.get(link.id)!, ports.get(link.to)!, rects.get(link.from)!, rects.get(link.to)!];
    const longest = routeLength(routes.get(link.id)!.points) * DETOUR;
    const [sourceClear, targetClear] = [inflate(source), inflate(target)];
    const reach = (list: Port[], space: Rect) => 2 * MARGIN + Math.min(...list.map((p) => distanceTo(p.stub.x, p.stub.y, space)));
    const options: { starts: Port[]; goals: Port[] }[] = [];
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const [leaving, entering] = [from.filter((p) => p.edge === side), to.filter((p) => p.edge === side)];
      if (reach(leaving, targetClear) <= longest) options.push({ starts: leaving, goals: to });
      if (reach(entering, sourceClear) <= longest) options.push({ starts: from, goals: entering });
    }
    return { link, options, longest, source, target };
  };
  const crowded = routable
    .filter((l) => routes.has(l.id) && sizes.get(l.id)?.length && crowding(l.id) > ROOMY)
    .map(optionsFor)
    .filter((c) => c.options.length)
    .sort((a, b) => crowding(b.link.id) - crowding(a.link.id))
    .slice(0, REROUTES);
  let moved = false;
  for (const { link, options, longest, source, target } of crowded) {
    const [size, route] = [sizes.get(link.id)!, routes.get(link.id)!];
    const others = [...placed].filter(([id]) => id !== link.id).map(([, p]) => p.spot.box);
    const clear = others.map(padded);
    // A route's cost, plus its label's, plus what other labels hide of it.
    const total = (r: Route) => {
      setRoute(scene, link.id, r.points);
      const best = cheapest(spotsAlong(link.id, r.points, size, scene), others, false);
      const head = scene.heads.get(link.id)!;
      const hidden = clear.reduce((sum, o) => sum + COVERS_ARROW * lengthInside(r.points, o) + (COVERS_HEAD * overlap(head, o)) / (HEAD * HEAD), 0);
      return { route: r, label: best, cost: r.cost + best.cost + hidden };
    };
    grid.remove(link.id);
    // The route as it stands, costed against the routes as they are now.
    const kept = total({ ...route, cost: grid.costOf(route.cells, route.ports) });
    // Another route, with its label, has to cost no more than this to be worth moving to.
    const bar = kept.cost - WORTH_MOVING;
    let best = kept;
    for (const { starts, goals } of options) {
      // A label costs nothing at best, so a route that costs more on its own can't win.
      const r = routeOne(grid, starts, goals, source, target, grid.notesOn(source, target));
      if (!r || r.cost > bar || r.cost >= best.cost || routeLength(r.points) > longest || underNote(r, source, target)) continue;
      const option = total(r);
      if (option.cost <= bar && option.cost < best.cost) best = option;
    }
    moved ||= best !== kept;
    grid.place(link.id, best.route);
    setRoute(scene, link.id, best.route.points);
    placed.set(link.id, best.label);
  }

  // Every label again, now the routes are settled, and spread apart where there's room. The scene already has the routes as they ended up.
  const labels = placeAll(moved ? candidates(sizes, scene) : first, true);
  return { routes: pointsOf(boxes, links, routes), labels: new Map([...labels].map(([id, p]) => [id, { ...(p.spot.size as S), ...p.spot.at }])) };
}

type Run = readonly [Readonly<Point>, Readonly<Point>];

/** A route's horizontal runs, or its vertical ones. */
function runsOf(points: readonly Readonly<Point>[], horizontal: boolean): Run[] {
  return points.slice(1).flatMap((b, k) => {
    const a = points[k]!;
    return (horizontal ? a.y === b.y && a.x !== b.x : a.x === b.x && a.y !== b.y) ? [[a, b] as const] : [];
  });
}

/** Where horizontal run `[a, b]` crosses vertical run `[c, d]`, if it does: not where they only meet at an end or a corner. */
function crossingOf([a, b]: Run, [c, d]: Run): Point | undefined {
  const [x, y] = [c.x, a.y];
  return x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x) && y > Math.min(c.y, d.y) && y < Math.max(c.y, d.y) ? { x, y } : undefined;
}

/** Whether two routes cross. */
function cross(a: readonly Readonly<Point>[], b: readonly Readonly<Point>[]): boolean {
  const meet = (across: Run[], down: Run[]) => across.some((h) => down.some((v) => crossingOf(h, v)));
  return meet(runsOf(a, true), runsOf(b, false)) || meet(runsOf(b, true), runsOf(a, false));
}

/**
 * Where each route crosses another, by link ID: the points where one of its
 * horizontal runs crosses another route's vertical run, nearest its start first.
 * The horizontal one is the one drawn hopping over the other.
 */
export function crossings(routes: ReadonlyMap<string, readonly Readonly<Point>[]>): Map<string, Point[]> {
  const vertical = [...routes].map(([id, points]) => ({ id, runs: runsOf(points, false) }));
  const out = new Map<string, Point[]>();
  for (const [id, points] of routes) {
    const found: Point[] = [];
    for (const run of runsOf(points, true)) {
      const here: Point[] = [];
      for (const other of vertical) {
        if (other.id === id) continue;
        for (const down of other.runs) {
          const at = crossingOf(run, down);
          if (at) here.push(at);
        }
      }
      found.push(...here.sort((p, q) => Math.abs(p.x - run[0].x) - Math.abs(q.x - run[0].x)));
    }
    if (found.length) out.set(id, found);
  }
  return out;
}
