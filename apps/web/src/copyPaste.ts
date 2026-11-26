/**
 * Copy and paste on a view of boxes. What's copied is boxes, each with everything inside it, the
 * relationships between them, and sticky notes, as text on the clipboard. Pasting adds copies of
 * them to the model, with new IDs, on this view or another, in this workspace or another.
 */
import {
  applyOperations,
  buildWorkspace,
  computeView,
  isInside,
  kindList,
  lineage,
  OpError,
  PARENT_KINDS,
  scopeProblems,
  type ElementKind,
  type ElementShape,
  type Operation,
  type Position,
  type RelationshipKind,
  type StickyColor,
  type StickyTargetData,
  type Tags,
  type ViewDef,
  type Workspace,
} from "@open-arch/core";
import type { Selection } from "./canvas/Canvas.js";
import { uniqueAmong, viewAction } from "./model.js";

/** What the clipboard's text says it is, so text copied from anywhere else isn't pasted as boxes. */
const MARK = "open-arch/copied";

/** An element copied, with its fields as add-element takes them. */
export interface CopiedElement {
  id: string;
  kind: ElementKind;
  name: string;
  /** Its parent's ID, where it was copied from: one of the others copied, or else an element of that workspace. */
  parent?: string;
  description?: string;
  technology?: string;
  external?: boolean;
  shape?: ElementShape;
  stereotype?: string;
  members?: string[];
  libraries?: string[];
  tags?: Tags;
  notes?: string;
  /** Whether it was selected, rather than copied for being inside something selected. Pasting shows these on the view. */
  picked?: boolean;
  /** Where its box was on the view it was copied from. */
  at?: [number, number];
}

/** A relationship between two of the elements copied. */
export interface CopiedRelationship {
  from: string;
  to: string;
  kind?: RelationshipKind;
  bidirectional?: boolean;
  description?: string;
  technology?: string;
  tags?: Tags;
  notes?: string;
}

/** A sticky note copied. `on` is one of the elements copied, or a relationship between two of them. */
export interface CopiedSticky {
  text: string;
  color?: StickyColor;
  notes?: string;
  on?: StickyTargetData;
  at?: [number, number];
}

/** What Copy put on the clipboard: elements, parents first, the relationships between them, and notes. */
export interface Copied {
  copied: typeof MARK;
  /** The view it was copied from. */
  view?: string;
  elements: CopiedElement[];
  relationships: CopiedRelationship[];
  stickies: CopiedSticky[];
}

/** The boxes and notes a selection copies: an element, a note, or several of them. */
export function copySource(selection: Selection): { elements: string[]; stickies: string[] } {
  if (selection?.kind === "element") return { elements: [selection.id], stickies: [] };
  if (selection?.kind === "sticky") return { elements: [], stickies: [selection.id] };
  if (selection?.kind === "several") return { elements: selection.elements, stickies: selection.stickies };
  return { elements: [], stickies: [] };
}

const point = (p: Position | [number, number] | undefined): [number, number] | undefined => p && [p[0], p[1]];

/**
 * What copying these elements and notes of a view puts on the clipboard, or null when there's
 * nothing to copy. Each element is copied with everything inside it, and the relationships
 * between the elements copied go with them. `boxes` and `notes` are where each is on the diagram
 * as shown, to keep them in the same places relative to each other when they're pasted.
 */
export function copyOf(
  ws: Workspace,
  view: ViewDef,
  source: { elements: readonly string[]; stickies: readonly string[] },
  places: { boxes: Record<string, Position>; notes: Record<string, [number, number]> },
): Copied | null {
  const picked = new Set(source.elements.filter((id) => ws.elements.has(id)));
  const all = [...ws.elements.values()].filter((e) => picked.has(e.id) || [...picked].some((p) => isInside(ws, e.id, p)));
  // Parents first, so each is added before what's inside it.
  all.sort((a, b) => lineage(ws, a.id).length - lineage(ws, b.id).length);
  const copied = new Set(all.map((e) => e.id));
  const elements = all.map(
    (e): CopiedElement => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      parent: e.parent,
      description: e.description,
      technology: e.technology,
      external: e.external || undefined,
      shape: e.shape === "box" ? undefined : e.shape,
      stereotype: e.stereotype,
      members: e.members.length ? e.members : undefined,
      libraries: e.libraries.length ? e.libraries : undefined,
      tags: Object.keys(e.tags).length ? e.tags : undefined,
      notes: e.notes,
      picked: picked.has(e.id) || undefined,
      at: point(places.boxes[e.id]),
    }),
  );
  const relationships = all.flatMap((e) =>
    e.uses
      .filter((r) => copied.has(r.to))
      .map(
        (r): CopiedRelationship => ({
          from: e.id,
          to: r.to,
          kind: r.kind === "association" ? undefined : r.kind,
          bidirectional: r.bidirectional || undefined,
          description: r.description,
          technology: r.technology,
          tags: Object.keys(r.tags).length ? r.tags : undefined,
          notes: r.notes,
        }),
      ),
  );
  // A note keeps what it's on only when that's copied too.
  const keeps = (on: StickyTargetData | undefined) => !!on && ("element" in on ? copied.has(on.element) : "from" in on && copied.has(on.from) && copied.has(on.to));
  const stickies = view.stickies
    .filter((s) => source.stickies.includes(s.id))
    .map(
      (s): CopiedSticky => ({
        text: s.text,
        color: s.color === "yellow" ? undefined : s.color,
        notes: s.notes,
        on: keeps(s.on) ? s.on : undefined,
        at: places.notes[s.id] ?? point(s.at),
      }),
    );
  if (elements.length + stickies.length === 0) return null;
  return JSON.parse(JSON.stringify({ copied: MARK, view: view.id, elements, relationships, stickies })) as Copied;
}

/**
 * The middle of what was copied, where it was on the view it was copied from, with each box this
 * big: or null when none of it had a place there.
 */
export function copiedMiddle(copied: Copied, box: { width: number; height: number }): { x: number; y: number } | null {
  const places = [...copied.elements.flatMap((e) => (e.at ? [e.at] : [])), ...copied.stickies.flatMap((s) => (s.at ? [s.at] : []))];
  if (places.length === 0) return null;
  const [minX, minY] = [Math.min(...places.map((p) => p[0])), Math.min(...places.map((p) => p[1]))];
  const [maxX, maxY] = [Math.max(...places.map((p) => p[0] + box.width)), Math.max(...places.map((p) => p[1] + box.height))];
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** The clipboard's text for what's copied. */
export function copiedText(copied: Copied): string {
  return JSON.stringify(copied);
}

/** What the clipboard's text is, when it's what Copy put there, or else null. */
export function readCopied(text: string): Copied | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<Copied>;
  if (c.copied !== MARK || !Array.isArray(c.elements) || !Array.isArray(c.relationships) || !Array.isArray(c.stickies)) return null;
  // The rest is checked as the paste's operations are applied.
  const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
  const isPoint = (p: unknown) => p === undefined || (Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)));
  if (!c.elements.every((e) => isObject(e) && typeof e.id === "string" && typeof e.kind === "string" && typeof e.name === "string" && isPoint(e.at))) return null;
  if (!c.relationships.every((r) => isObject(r) && typeof r.from === "string" && typeof r.to === "string")) return null;
  if (!c.stickies.every((s) => isObject(s) && typeof s.text === "string" && isPoint(s.at))) return null;
  return c as Copied;
}

/**
 * The parent a pasted element goes in, when what it was in wasn't copied with it: what the view
 * is of, such as the system on a container view, when it can be in that, or else the element it
 * was in, if this workspace has it.
 */
function pasteParent(ws: Workspace, view: ViewDef, e: CopiedElement): string | undefined {
  const kinds = PARENT_KINDS[e.kind] ?? [];
  if (!kinds.length) return undefined;
  const fits = (id: string | undefined) => {
    const parent = id === undefined ? undefined : ws.elements.get(id);
    return parent && kinds.includes(parent.kind) ? parent.id : undefined;
  };
  const parent = fits(view.scope) ?? fits(e.parent);
  if (!parent) throw new OpError(`There's no ${kindList(kinds)} here for the ${e.kind} "${e.name}" to go in. Paste it on a view of one.`);
  return parent;
}

/**
 * The edit that pastes what was copied on a view of boxes, as one step for Undo, and the IDs of
 * the boxes and notes it adds, to select. Each element gets a new ID, and the same name. The
 * boxes and notes keep their places relative to each other, centred on `center`, and the boxes
 * already there keep theirs: `layout` is every box's position as shown. Worked out from the
 * workspace as it is when the edit runs.
 */
export function pasteOps(ws: Workspace, viewId: string, copied: Copied, layout: Record<string, Position>, center: { x: number; y: number }, box: { width: number; height: number }): { ops: Operation[]; elements: string[]; stickies: string[] } {
  const view = ws.views.get(viewId);
  if (!view) throw new OpError("The view is gone, so nothing was pasted.");
  const taken = [...ws.elements.keys(), ...ws.views.keys()];
  const ids = new Map<string, string>();
  for (const e of copied.elements) {
    // The same ID where it's free, as in another workspace; or else the next of its kind, so a copy of "api-2" is "api-3", not "api-2-2".
    const id = taken.includes(e.id) ? uniqueAmong(taken, e.id.replace(/-\d+$/, "")) : e.id;
    ids.set(e.id, id);
    taken.push(id);
  }
  const to = (id: string) => ids.get(id) ?? id;
  const library = (id: string) => (ids.has(id) ? ids.get(id) : ws.elements.get(id)?.kind === "library" ? id : undefined);
  const added: Operation[] = [
    ...copied.elements.map(
      (e): Operation => ({
        op: "add-element",
        id: to(e.id),
        kind: e.kind,
        parent: e.parent !== undefined && ids.has(e.parent) ? to(e.parent) : pasteParent(ws, view, e),
        name: e.name,
        description: e.description,
        technology: e.technology,
        external: e.external,
        shape: e.shape,
        stereotype: e.stereotype,
        members: e.members,
        libraries: e.libraries?.flatMap((l) => library(l) ?? []),
        tags: e.tags,
        notes: e.notes,
      }),
    ),
    ...copied.relationships
      .filter((r) => ids.has(r.from) && ids.has(r.to))
      .map((r): Operation => ({ op: "add-relationship", ...r, from: to(r.from), to: to(r.to) })),
  ];

  // The elements that were selected show on this view, where it can draw them.
  const after = buildWorkspace(applyOperations(ws.doc, added).doc);
  const viewAfter = after.views.get(viewId)!;
  const computed = scopeProblems(after, viewAfter).length ? null : computeView(after, viewAfter);
  const picked = copied.elements.filter((e) => e.picked).map((e) => to(e.id));
  const shown = picked.filter((id) => viewAction(after, viewAfter, computed, id) === "show").map((id): Operation => ({ op: "show-in-view", view: viewId, id }));

  // Centred on `center`, as they were relative to each other. A box's place is its top left corner.
  const middle = copiedMiddle(copied, box) ?? center;
  const shift = (at: [number, number]): [number, number] => [Math.round(at[0] + center.x - middle.x), Math.round(at[1] + center.y - middle.y)];
  const positions: Record<string, Position> = { ...layout };
  for (const e of copied.elements) if (e.at) positions[to(e.id)] = shift(e.at);
  // A position for a box the view doesn't draw is dropped as the edit is applied.
  const placed: Operation[] = Object.keys(positions).length ? [{ op: "set-layout", view: viewId, positions }] : [];

  const stickyIds = view.stickies.map((s) => s.id);
  const stickies = copied.stickies.map((s) => {
    const id = uniqueAmong(stickyIds, "note");
    stickyIds.push(id);
    const on = s.on && ("element" in s.on ? { element: to(s.on.element) } : "from" in s.on ? { ...s.on, from: to(s.on.from), to: to(s.on.to) } : undefined);
    return { op: "add-sticky" as const, view: viewId, id, text: s.text, color: s.color, notes: s.notes, on, at: s.at && shift(s.at) };
  });

  return { ops: [...added, ...shown, ...placed, ...stickies], elements: picked, stickies: stickies.map((s) => s.id) };
}

/**
 * The edit that deletes these elements from the model, with everything inside each, and these
 * sticky notes from the view, as one step for Undo. One inside another is deleted with it.
 */
export function deleteOps(ws: Workspace, viewId: string | null, elements: readonly string[], stickies: readonly string[]): Operation[] {
  const present = elements.filter((id) => ws.elements.has(id));
  const outer = present.filter((id) => !present.some((other) => other !== id && isInside(ws, id, other)));
  const view = viewId ? ws.views.get(viewId) : undefined;
  return [
    ...(view ? stickies.filter((id) => view.stickies.some((s) => s.id === id)).map((id): Operation => ({ op: "remove-sticky", view: view.id, id })) : []),
    ...outer.map((id): Operation => ({ op: "remove-element", id })),
  ];
}
