/**
 * Where a sequence view's parts go: a lifeline for each element, left to right in the order
 * they first appear, and a row for each step, top to bottom. Nothing is saved: the steps decide.
 */
import { isInside, stepRelationships, type ArchElement, type ComputedView, type Operation, type Workspace } from "@open-arch/core";
import { byName, relationshipRef } from "../model.js";

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

/** A way to add a step from one element to another: a label for a menu, and its edit. */
export interface StepChoice {
  label: string;
  ops: Operation[];
  /** It adds a relationship, or changes one, as well as the step. */
  changesModel: boolean;
}

/**
 * The ways to add a step from `from` to `to`, numbered `step`, or at the end: a call when the model
 * has a relationship that way. Otherwise a reply, when it has one back, and a call after adding a
 * relationship, or making the one back go both ways. None when they contain one another, which no
 * relationship can join.
 */
export function stepChoices(ws: Workspace, view: string, from: string, to: string, step?: number): StepChoice[] {
  const source = ws.elements.get(from);
  const target = ws.elements.get(to);
  if (!source || !target || from === to || isInside(ws, from, to) || isInside(ws, to, from)) return [];
  const add = (reply: boolean): Operation => ({ op: "add-step", view, from, to, reply: reply || undefined, step });
  if (stepRelationships(ws, from, to).length) return [{ label: `Call ${target.name}`, ops: [add(false)], changesModel: false }];
  const choices: StepChoice[] = [];
  if (stepRelationships(ws, from, to, true).length) choices.push({ label: `Reply to ${target.name}`, ops: [add(true)], changesModel: false });
  const back = target.uses.findIndex((r) => r.to === from);
  if (back >= 0) {
    choices.push({
      label: `Call ${target.name}, making ${target.name} → ${source.name} go both ways`,
      ops: [{ op: "update-relationship", ...relationshipRef(target, back), bidirectional: true }, add(false)],
      changesModel: true,
    });
  }
  choices.push({ label: `Call ${target.name}, adding a relationship from ${source.name} to ${target.name}`, ops: [{ op: "add-relationship", from, to }, add(false)], changesModel: true });
  if (back < 0) {
    choices.push({ label: `Call ${target.name}, adding a relationship both ways`, ops: [{ op: "add-relationship", from, to, bidirectional: true }, add(false)], changesModel: true });
  }
  return choices;
}
