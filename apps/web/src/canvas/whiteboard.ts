/**
 * A whiteboard's geometry and its hand-drawn look: where each shape is, where an arrow meets the
 * edge of a shape, the paths rough.js sketches for a shape or an arrow, and a pen's line, smoothed
 * and with points that barely change it left out. None of it needs a page, so it's tested alone.
 */
import { SHAPE_SIZE, type ArrowEnd, type ArrowHeads, type Position, type Shape, type ShapeKind, type TextSize } from "@open-arch/core";
// The package's own entry, which Node loads as CommonJS and Vite as a module: its bin/ files are modules Node can't load.
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import type { RoughGenerator } from "roughjs/bin/generator";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How big each size of text is, in pixels on the diagram. */
export const TEXT_PX: Record<TextSize, number> = { small: 16, medium: 20, large: 28, huge: 40 };
/** A line of text's height, as a share of its size. */
export const LINE_HEIGHT = 1.25;
/** Room round text inside a shape, and round text on its own. */
export const TEXT_PAD = 8;
/** Room round a pen's line in its box, so its strokes, and the ring round it when it's selected, aren't clipped. */
export const PEN_PAD = 6;
/** How far short of a shape's outline an arrow stops, as a pen lifted before it touches. */
export const ARROW_GAP = 5;

/** A guess at how big text is, before the page has measured it: its longest line, and its lines. */
export function textSize(text: string, size: TextSize): { w: number; h: number } {
  const px = TEXT_PX[size];
  const lines = text.split(/\r?\n/);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { w: Math.ceil(longest * px * 0.52) + 2 * TEXT_PAD, h: Math.ceil(lines.length * px * LINE_HEIGHT) + 2 * TEXT_PAD };
}

/** A pen's points' bounding box, from its corner, with room round it. */
export function penBox(at: Position, points: readonly (readonly [number, number])[]): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: at[0] + left - PEN_PAD, y: at[1] + top - PEN_PAD, w: Math.max(...xs) - left + 2 * PEN_PAD, h: Math.max(...ys) - top + 2 * PEN_PAD };
}

/**
 * Where a shape is drawn on the board. A rectangle, ellipse or diamond without a size is 160 by 80;
 * text without one is as big as the page measured it, or, before then, about as big as its text.
 */
export function shapeBox(shape: Pick<Shape, "kind" | "at" | "points" | "text" | "size">, measured?: { width?: number; height?: number }): Rect {
  if (shape.kind === "pen") return penBox(shape.at, shape.points);
  const [x, y] = shape.at;
  if (shape.at.length === 4) {
    // Text that's longer than its box makes it taller, as it's drawn.
    const h = shape.kind === "text" && measured?.height ? Math.max(shape.at[3], measured.height) : shape.at[3];
    return { x, y, w: shape.at[2], h };
  }
  if (shape.kind !== "text") return { x, y, w: SHAPE_SIZE[0], h: SHAPE_SIZE[1] };
  const guess = textSize(shape.text ?? "", shape.size);
  return { x, y, w: measured?.width ?? guess.w, h: measured?.height ?? guess.h };
}

const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Where a line from the middle of a shape towards `toward` crosses its outline, `gap` beyond it: a
 * rectangle's, an ellipse's or a diamond's. Text and a pen's line end at their box. Towards the
 * middle itself, it's the middle.
 */
export function edgePoint(kind: ShapeKind, box: Rect, toward: Point, gap = ARROW_GAP): Point {
  const c = centre(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return c;
  const [rx, ry] = [Math.max(box.w / 2, 0.5), Math.max(box.h / 2, 0.5)];
  // How far along (dx, dy) the outline is: 1 is at `toward`.
  const t =
    kind === "ellipse"
      ? 1 / Math.hypot(dx / rx, dy / ry)
      : kind === "diamond"
        ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
        : Math.min(dx === 0 ? Infinity : rx / Math.abs(dx), dy === 0 ? Infinity : ry / Math.abs(dy));
  // Not past `toward`, if it's inside the shape.
  const out = Math.min(t + gap / length, 1);
  return { x: c.x + dx * out, y: c.y + dy * out };
}

/** Whether a point is inside a shape: inside its outline, or for text and a pen's line, inside its box. */
export function contains(kind: ShapeKind, box: Rect, p: Point): boolean {
  const c = centre(box);
  const [dx, dy] = [(p.x - c.x) / (box.w / 2), (p.y - c.y) / (box.h / 2)];
  if (kind === "ellipse") return dx * dx + dy * dy <= 1;
  if (kind === "diamond") return Math.abs(dx) + Math.abs(dy) <= 1;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

export interface PlacedShape {
  id: string;
  kind: ShapeKind;
  box: Rect;
}

/** The shape at a point that's in front of the rest there, if any: `shapes` are from the back to the front. */
export function shapeAt(shapes: readonly PlacedShape[], p: Point, except?: string): string | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (s.id !== except && contains(s.kind, s.box, p)) return s.id;
  }
  return undefined;
}

/**
 * Where an arrow's two ends are drawn: a point where it says, or where a line between the two
 * ends leaves the shape there. `moved` puts an end at a point instead, as while it's dragged.
 * Null when an end is a shape that isn't drawn, or both are the same shape.
 */
export function arrowEnds(
  arrow: { from: ArrowEnd; to: ArrowEnd },
  shapes: ReadonlyMap<string, PlacedShape>,
  moved: { from?: Point; to?: Point } = {},
): { from: Point; to: Point } | null {
  const end = (which: "from" | "to") => {
    const at = moved[which];
    if (at) return { point: at };
    const e = arrow[which];
    if (typeof e !== "string") return { point: { x: e[0], y: e[1] } };
    const shape = shapes.get(e);
    return shape && { shape };
  };
  const [from, to] = [end("from"), end("to")];
  if (!from || !to) return null;
  if (from.shape && from.shape === to.shape) return null;
  const aim = (e: NonNullable<typeof from>) => e.point ?? centre(e.shape!.box);
  return {
    from: from.point ?? edgePoint(from.shape!.kind, from.shape!.box, aim(to)),
    to: to.point ?? edgePoint(to.shape!.kind, to.shape!.box, aim(from)),
  };
}

/** A number from an ID, the same each time, so a shape's or arrow's wobble doesn't change as it's drawn again. */
export function seedOf(id: string): number {
  // FNV-1a, kept above 0, as rough.js picks a new seed for 0.
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 1) + 1;
}

const generator = rough.generator();
/** How hand-drawn it looks: about as wobbly as a marker on a whiteboard. */
const SKETCH: Options = { roughness: 1, bowing: 1, strokeWidth: 2, fillStyle: "solid", preserveVertices: true };

/** Paths rough.js sketched, split into what's filled and what's stroked, as SVG path data. */
export interface Sketch {
  fill: string[];
  stroke: string[];
}

function sketchOf(drawn: ReturnType<RoughGenerator["path"]>): Sketch {
  const out: Sketch = { fill: [], stroke: [] };
  for (const set of drawn.sets) {
    const d = generator.opsToPath(set, 2);
    if (set.type === "fillPath") out.fill.push(d);
    else if (set.type === "path") out.stroke.push(d);
  }
  return out;
}

/**
 * A rectangle's, ellipse's or diamond's outline, sketched as by hand, `w` by `h` from its corner,
 * with a fill to colour if it's `filled`. A dashed one is drawn with one stroke, not two, so its
 * dashes don't blur.
 */
export function shapeSketch(kind: ShapeKind, w: number, h: number, seed: number, { filled = false, dashed = false } = {}): Sketch {
  // Inside its box by a stroke's width, so the stroke isn't clipped.
  const [x, y, right, bottom] = [2, 2, Math.max(w - 2, 3), Math.max(h - 2, 3)];
  const options: Options = { ...SKETCH, seed, fill: filled ? "fill" : undefined, disableMultiStroke: dashed };
  if (kind === "ellipse") return sketchOf(generator.ellipse(w / 2, h / 2, right - x, bottom - y, options));
  if (kind === "diamond") {
    return sketchOf(
      generator.polygon(
        [
          [w / 2, y],
          [right, h / 2],
          [w / 2, bottom],
          [x, h / 2],
        ],
        options,
      ),
    );
  }
  // A rectangle has rounded corners, as one drawn with a marker does.
  const r = Math.min(14, (right - x) / 4, (bottom - y) / 4);
  const d = `M ${x + r} ${y} L ${right - r} ${y} Q ${right} ${y} ${right} ${y + r} L ${right} ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom} L ${x + r} ${bottom} Q ${x} ${bottom} ${x} ${bottom - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
  return sketchOf(generator.path(d, options));
}

/** How long an arrow's head is, and how wide it opens: two strokes, each this far from the line. */
const HEAD = { length: 16, angle: 0.45 };

/** An arrow's line, from one end to the other, and its heads, sketched as by hand. A dashed arrow's heads aren't dashed. */
export function arrowSketch(from: Point, to: Point, heads: ArrowHeads, seed: number, dashed = false): { line: string[]; heads: string[] } {
  const options: Options = { ...SKETCH, seed, disableMultiStroke: dashed };
  const line = sketchOf(generator.line(from.x, from.y, to.x, to.y, options)).stroke;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0 || heads === "none") return { line, heads: [] };
  const size = Math.min(HEAD.length, length / 3);
  const head = (tip: Point, tail: Point) => {
    const a = Math.atan2(tip.y - tail.y, tip.x - tail.x);
    const side = (turn: number): [number, number] => [tip.x - size * Math.cos(a + turn), tip.y - size * Math.sin(a + turn)];
    return sketchOf(generator.linearPath([side(-HEAD.angle), [tip.x, tip.y], side(HEAD.angle)], { ...SKETCH, seed: seed + 1 })).stroke;
  };
  return { line, heads: [...head(to, from), ...(heads === "both" ? head(from, to) : [])] };
}

/** The middle of an arrow, where its text goes. */
export const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A smooth path through a pen's points: a curve through the middle of each step, each bent at a point. */
export function penPath(points: readonly (readonly [number, number])[], dx = 0, dy = 0): string {
  const p = points.map(([x, y]) => [x + dx, y + dy] as const);
  if (p.length === 0) return "";
  if (p.length < 3) return `M ${p.map(([x, y]) => `${x} ${y}`).join(" L ")}`;
  const parts = [`M ${p[0]![0]} ${p[0]![1]}`];
  for (let i = 1; i < p.length - 1; i++) {
    const [x, y] = p[i]!;
    const [nx, ny] = p[i + 1]!;
    parts.push(`Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`);
  }
  const last = p[p.length - 1]!;
  parts.push(`L ${last[0]} ${last[1]}`);
  return parts.join(" ");
}

/** How far a point is from the line through two others, or from the first when they're the same point. */
function offLine(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
}

/**
 * The points of a line drawn with the pen, with those that change its shape by less than
 * `tolerance` left out (Ramer–Douglas–Peucker), rounded to whole pixels, from the first point's
 * top-left: the corner of its box, `at`.
 */
export function simplifyLine(points: readonly Point[], tolerance = 1): { at: [number, number]; points: [number, number][] } {
  const keep = new Array<boolean>(points.length).fill(false);
  const walk = (first: number, last: number) => {
    let far = -1;
    let most = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = offLine(points[i]!, points[first]!, points[last]!);
      if (d > most) [far, most] = [i, d];
    }
    if (far < 0) return;
    keep[far] = true;
    walk(first, far);
    walk(far, last);
  };
  if (points.length > 0) {
    keep[0] = keep[points.length - 1] = true;
    walk(0, points.length - 1);
  }
  const kept = points.filter((_, i) => keep[i]).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const left = Math.min(...kept.map((p) => p.x));
  const top = Math.min(...kept.map((p) => p.y));
  // Points the same as the one before, once rounded, add nothing to the line.
  const out: [number, number][] = [];
  for (const p of kept) {
    const before = out[out.length - 1];
    if (!before || before[0] !== p.x - left || before[1] !== p.y - top) out.push([p.x - left, p.y - top]);
  }
  // A dot is a line from a point to itself, so a tap draws something.
  if (out.length === 1) out.push([...out[0]!]);
  return { at: [left, top], points: out };
}
