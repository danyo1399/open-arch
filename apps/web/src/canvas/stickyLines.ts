/**
 * The lines from sticky notes to what they're on: a box, the frame round the view, or an arrow,
 * or on a flowchart, a block. A line runs from the edge of the note to the edge of the box, the
 * arrow's label, or the frame's outline, or to the middle of an arrow with no label. One to a
 * block runs to the block's outline (see outlineToward in flowchartLayout.ts).
 */
import { NODE_H, NODE_W, type Point } from "./autoLayout.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a note's line goes to: a box or label, all round; the frame's outline, from inside or out; or a point on an arrow. */
export type LineEnd = { rect: Rect } | { outline: Rect } | { point: Point };

const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where the line from a rect's centre towards `to` crosses its edge, or `to` itself when that's inside it. */
export function edgePoint(r: Rect, to: Point): Point {
  const c = centre(r);
  const [dx, dy] = [to.x - c.x, to.y - c.y];
  const scale = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity, 1);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** The point on a rect's outline nearest `p`, from inside it or outside. */
export function nearestOnOutline(r: Rect, p: Point): Point {
  if (!inside(r, p)) return { x: Math.min(Math.max(p.x, r.x), r.x + r.w), y: Math.min(Math.max(p.y, r.y), r.y + r.h) };
  // Inside: out to the nearest side.
  const sides = [
    { d: p.x - r.x, at: { x: r.x, y: p.y } },
    { d: r.x + r.w - p.x, at: { x: r.x + r.w, y: p.y } },
    { d: p.y - r.y, at: { x: p.x, y: r.y } },
    { d: r.y + r.h - p.y, at: { x: p.x, y: r.y + r.h } },
  ];
  return sides.reduce((a, b) => (b.d < a.d ? b : a)).at;
}

/** The point halfway along a route, by its length; undefined for one with no points. */
export function midpoint(points: readonly Point[]): Point | undefined {
  if (points.length < 2) return points[0];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let left = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const [a, b, length] = [points[i]!, points[i + 1]!, lengths[i]!];
    if (left <= length) return length ? { x: a.x + ((b.x - a.x) * left) / length, y: a.y + ((b.y - a.y) * left) / length } : a;
    left -= length;
  }
  return points[points.length - 1];
}

/** How far a point is from the nearest point along a route; Infinity for one with no points. */
export function distanceToRoute(points: readonly Point[], p: Point): number {
  if (points.length === 1) return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
  let nearest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const length = dx * dx + dy * dy;
    // How far along the segment the nearest point is, from 0 at a to 1 at b.
    const t = length ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return nearest;
}

/** The line from a note to what it's on, or null when they touch, and no line would show. */
export function stickyLine(note: Rect, end: LineEnd): { from: Point; to: Point } | null {
  if ("rect" in end) {
    if (overlap(note, end.rect)) return null;
    return { from: edgePoint(note, centre(end.rect)), to: edgePoint(end.rect, centre(note)) };
  }
  const to = "point" in end ? end.point : nearestOnOutline(end.outline, centre(note));
  return inside(note, to) ? null : { from: edgePoint(note, to), to };
}

/** Where to put a note on a box, before it's moved: to the right of the box, level with its top. */
export function besideBox(box: Point): Point {
  return { x: box.x + NODE_W + 60, y: box.y };
}

/** Where to put a note on the frame, before it's moved: off its top right corner. */
export function besideFrame(frame: Rect): Point {
  return { x: frame.x + frame.w + 60, y: frame.y };
}

/** Where to put a note on an arrow, before it's moved: just below and right of halfway between its two boxes. */
export function besideArrow(from: Point, to: Point): Point {
  return { x: (from.x + to.x) / 2 + NODE_W / 2 + 30, y: (from.y + to.y) / 2 + NODE_H / 2 + 30 };
}
