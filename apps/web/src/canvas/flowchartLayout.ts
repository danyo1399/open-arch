/**
 * Sizes and shapes for a flowchart view's diagram: how big each kind of block is drawn before
 * it's been measured, where an arrow meets a block's outline, which isn't always the box round
 * it (a decision is a diamond, a start or end a pill, and an input or output slanted), and where
 * its lanes go, as columns.
 */
import type { Block, BlockKind, Lane, ViewDef } from "@open-arch/core";
import type { Point } from "./autoLayout.js";
import type { Box } from "./routing.js";

/** Each kind's width, as .flow-block in styles.css draws it. A decision is wider, as its text sits in the middle of a diamond. */
export function blockWidth(kind: BlockKind): number {
  return kind === "decision" ? 220 : kind === "start" || kind === "end" ? 160 : 180;
}

/** How far an input or output's sides slant, from top to bottom, as .flow-shape draws it. */
export const SLANT = 18;

/** About how tall a block is drawn: its text and description wrapped to its width, inside its kind's padding. */
export function blockHeight(block: Pick<Block, "kind" | "text" | "description">): number {
  const decision = block.kind === "decision";
  // A diamond's text sits in the middle half of it.
  const perLine = decision ? 14 : block.kind === "start" || block.kind === "end" ? 18 : 21;
  const lines = (text: string) => text.split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
  const content = lines(block.text) * 18 + (block.description ? 4 + lines(block.description) * 16 : 0);
  if (decision) return Math.max(100, Math.round(content * 2 + 24));
  return Math.max(block.kind === "start" || block.kind === "end" ? 44 : 52, content + (block.kind === "database" || block.kind === "document" ? 34 : 22));
}

/**
 * Where an arrow that meets a block's box at `p`, going along `inward` into it, meets its
 * outline: further in, for the corners a diamond, a pill or a slanted side leave empty. The
 * point itself for the other kinds, whose outline is their box, or near enough.
 */
export function onOutline(kind: BlockKind, box: Box, p: Readonly<Point>, inward: Readonly<Point>): Point {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const vertical = inward.x === 0;
  if (kind === "decision") {
    // |x - cx| / (w / 2) + |y - cy| / (h / 2) = 1 along the diamond's edges.
    if (vertical) {
      const off = Math.abs(p.x - cx) / (box.w / 2);
      return off >= 1 ? { ...p } : { x: p.x, y: cy - Math.sign(inward.y) * (box.h / 2) * (1 - off) };
    }
    const off = Math.abs(p.y - cy) / (box.h / 2);
    return off >= 1 ? { ...p } : { x: cx - Math.sign(inward.x) * (box.w / 2) * (1 - off), y: p.y };
  }
  if (kind === "start" || kind === "end") {
    // Round ends, each half a circle as tall as the block.
    const r = Math.min(box.h, box.w) / 2;
    const centre = p.x < box.x + r ? box.x + r : p.x > box.x + box.w - r ? box.x + box.w - r : undefined;
    if (vertical) {
      if (centre === undefined) return { ...p };
      const dy = Math.sqrt(Math.max(0, r * r - (p.x - centre) ** 2));
      return { x: p.x, y: cy - Math.sign(inward.y) * dy };
    }
    const dx = Math.sqrt(Math.max(0, r * r - (p.y - cy) ** 2));
    return { x: inward.x > 0 ? box.x + r - dx : box.x + box.w - r + dx, y: p.y };
  }
  if (kind === "input-output" && !vertical) {
    // The left side slants in from the bottom to the top, and the right side from the top to the bottom.
    const down = (p.y - box.y) / box.h;
    return { x: inward.x > 0 ? box.x + SLANT * (1 - down) : box.x + box.w - SLANT * down, y: p.y };
  }
  return { ...p };
}

/** A route with its ends moved onto the outlines of the blocks it leaves and enters. */
export function routeToOutlines(points: readonly Readonly<Point>[], from: { kind: BlockKind; box: Box }, to: { kind: BlockKind; box: Box }): Point[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out = points.map((p) => ({ ...p }));
  const along = (a: Readonly<Point>, b: Readonly<Point>): Point => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
  // Out of the source is into it the other way.
  const leaving = along(out[1]!, out[0]!);
  out[0] = onOutline(from.kind, from.box, out[0]!, leaving);
  const last = out.length - 1;
  out[last] = onOutline(to.kind, to.box, out[last]!, along(out[last - 1]!, out[last]!));
  return out;
}

/**
 * How a flowchart's lanes are drawn: the height of a lane's name at its top, when every name fits
 * on one line (see laneHead in FlowchartDiagram), the room inside a lane round its blocks, the
 * narrowest a lane is, and how far apart blocks placed side by side in one are. Blocks placed in a
 * lane go down its middle, at `centre` from the inside of its left.
 */
export const LANE = { head: 40, pad: 30, minWidth: 260, centre: 110, beside: 260 } as const;

/** One column of a flowchart with lanes: a lane, or the column for the blocks in no lane. */
export interface LaneColumn {
  /** Left out for the column of blocks in no lane. */
  lane?: Lane;
  /** Its left edge, and its width. */
  x: number;
  w: number;
}

/** The lane a block is drawn in: its own, if the view has it. */
export function laneOf(view: Pick<ViewDef, "lanes">, block: Pick<Block, "lane">): string | undefined {
  return block.lane !== undefined && view.lanes.some((l) => l.id === block.lane) ? block.lane : undefined;
}

/**
 * A flowchart's lanes as columns, left to right: first one for the blocks in no lane, when there
 * are some, then each lane, each as wide as its blocks need and no narrower than LANE.minWidth.
 * `at` holds each block's position, with x from the inside of its column's left, and the result
 * where each is drawn. An x less than 0, which only a file edited by hand has (see add-lane), is
 * drawn at 0.
 */
export function laneColumns(view: Pick<ViewDef, "lanes" | "blocks">, at: Record<string, Point>): { columns: LaneColumn[]; positions: Record<string, Point> } {
  const placed = view.blocks.filter((b) => at[b.id]);
  const loose = placed.some((b) => laneOf(view, b) === undefined);
  const columns: LaneColumn[] = [];
  let x = 0;
  for (const lane of [...(loose ? [undefined] : []), ...view.lanes]) {
    const inside = placed.filter((b) => laneOf(view, b) === lane?.id);
    const w = Math.max(LANE.minWidth, ...inside.map((b) => Math.max(0, at[b.id]!.x) + blockWidth(b.kind) + 2 * LANE.pad));
    columns.push({ lane, x, w });
    x += w;
  }
  const positions: Record<string, Point> = {};
  for (const b of placed) {
    const column = columns.find((c) => c.lane?.id === laneOf(view, b))!;
    positions[b.id] = { x: column.x + LANE.pad + Math.max(0, at[b.id]!.x), y: at[b.id]!.y };
  }
  return { columns, positions };
}

/** The column under `x`, or the nearest one, at either end. */
function columnAt(columns: LaneColumn[], x: number): LaneColumn {
  return columns.find((c) => x >= c.x && x < c.x + c.w) ?? (x < (columns[0]?.x ?? 0) ? columns[0]! : columns[columns.length - 1]!);
}

/**
 * Where a block drawn at `position` in `column` is kept: its `at`, with x from the inside of the
 * column's left. One let go of further left stays at its inside.
 */
export function savedAt(column: LaneColumn, position: Point): [number, number] {
  return [Math.max(0, Math.round(position.x - column.x - LANE.pad)), Math.round(position.y)];
}

/** The lane a block let go of at `position`, `w` wide, goes in, by the column under its middle, and its `at` there. */
export function dropInLane(columns: LaneColumn[], position: Point, w: number): { lane: string | undefined; at: [number, number] } {
  const column = columnAt(columns, position.x + w / 2);
  return { lane: column.lane?.id, at: savedAt(column, position) };
}

/**
 * Positions, as laneColumns takes them, for every block of a flowchart with lanes: saved ones as
 * they are; the rest at the height ELK puts them, `auto`, moved to line up with the saved ones,
 * down the middle of their lane, or beside the blocks already there at that height.
 */
export function placeInLanes(view: Pick<ViewDef, "lanes" | "blocks">, saved: Record<string, Point>, auto: Record<string, Point>): Record<string, Point> {
  const out: Record<string, Point> = { ...saved };
  const known = view.blocks.filter((b) => saved[b.id] && auto[b.id]);
  const dy = known.length ? known.reduce((sum, b) => sum + saved[b.id]!.y - auto[b.id]!.y, 0) / known.length : 0;
  const size = (b: Block) => ({ w: blockWidth(b.kind), h: blockHeight(b) });
  const missing = view.blocks.filter((b) => !saved[b.id]).sort((a, b) => (auto[a.id]?.y ?? 0) - (auto[b.id]?.y ?? 0) || (auto[a.id]?.x ?? 0) - (auto[b.id]?.x ?? 0));
  for (const b of missing) {
    const { w, h } = size(b);
    const y = Math.round((auto[b.id]?.y ?? 0) + dy);
    const lane = laneOf(view, b);
    const others = view.blocks.filter((o) => o !== b && out[o.id] && laneOf(view, o) === lane);
    const overlaps = (x: number) => others.some((o) => {
      const p = out[o.id]!;
      const s = size(o);
      return x < p.x + s.w + 20 && x + w + 20 > p.x && y < p.y + s.h + 20 && y + h + 20 > p.y;
    });
    let k = 0;
    while (overlaps(Math.max(0, LANE.centre - w / 2) + k * LANE.beside)) k++;
    out[b.id] = { x: Math.round(Math.max(0, LANE.centre - w / 2) + k * LANE.beside), y };
  }
  return out;
}
