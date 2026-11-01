/**
 * Where a sequence view's parts go: a lifeline for each element, left to right in the order
 * they first appear, and a row for each step, top to bottom. Nothing is saved: the steps decide.
 */
import { stepRelationships, type ArchElement, type ComputedView, type Workspace } from "@open-arch/core";
import { byName } from "../model.js";

/** The width of a lifeline's column, its heading box's size, and the height of a step's row. */
export const SEQ = { column: 220, headWidth: 188, headHeight: 64, row: 52, pad: 24 } as const;

export interface SequenceLayout {
  /** The middle of each lifeline, by element ID. */
  x: Map<string, number>;
  /** Where each step's arrow is, by step number. */
  y: Map<number, number>;
  /** Where the lifelines end. */
  bottom: number;
  width: number;
  height: number;
}

/** Room under the headings before the first step, and after the last. */
const FIRST_ROW = SEQ.pad + SEQ.headHeight + 40;

export function sequenceLayout(cv: ComputedView): SequenceLayout {
  const x = new Map(cv.nodes.map((n, i) => [n.id, SEQ.pad + i * SEQ.column + SEQ.column / 2]));
  const y = new Map(cv.steps.map((s, i) => [s.number, FIRST_ROW + i * SEQ.row]));
  // An empty view keeps a row's room, where a step dragged onto it goes.
  const bottom = FIRST_ROW + Math.max(cv.steps.length, 1) * SEQ.row - SEQ.row / 2;
  return { x, y, bottom, width: SEQ.pad * 2 + Math.max(cv.nodes.length, 1) * SEQ.column, height: bottom + SEQ.pad };
}

/** The lifeline nearest a point across the diagram, if it's within its column. */
export function lifelineAt(layout: SequenceLayout, x: number): string | undefined {
  let best: { id: string; d: number } | undefined;
  for (const [id, mid] of layout.x) {
    const d = Math.abs(mid - x);
    if (d <= SEQ.column / 2 && (!best || d < best.d)) best = { id, d };
  }
  return best?.id;
}

/** The number a step dropped at this height gets: that of the first step whose arrow is below it, or one after the last. */
export function dropNumber(layout: SequenceLayout, y: number): number {
  const rows = [...layout.y.entries()].sort((a, b) => a[0] - b[0]);
  for (const [number, at] of rows) if (y < at) return number;
  return rows.length + 1;
}

/**
 * The elements a step from `from` can go to: those the model has a relationship to, from it or
 * from something inside it, or for a reply, back from. In alphabetical order.
 */
export function stepTargets(ws: Workspace, from: string, reply: boolean): ArchElement[] {
  return [...ws.elements.values()].filter((e) => stepRelationships(ws, from, e.id, reply).length > 0).sort(byName);
}

/**
 * A step drawn from one lifeline to another: a call when the model has a relationship that way,
 * else a reply when it has one back, else nothing.
 */
export function drawnStep(ws: Workspace, from: string, to: string): { reply: boolean } | undefined {
  if (from === to) return undefined;
  if (stepRelationships(ws, from, to).length) return { reply: false };
  if (stepRelationships(ws, from, to, true).length) return { reply: true };
  return undefined;
}
