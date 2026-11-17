/**
 * Sizes and shapes for a flowchart view's diagram: how big each kind of block is drawn before
 * it's been measured, and where an arrow meets a block's outline, which isn't always the box
 * round it: a decision is a diamond, a start or end a pill, and an input or output slanted.
 */
import type { Block, BlockKind } from "@open-arch/core";
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
