/**
 * What a diagram's right-click menu is for, and how that's found again once edits have landed.
 *
 * A right-click selects at once, but its menu opens once the edits made before it have landed:
 * text typed in the details is saved as the click takes the focus from it, and that can give a
 * block, a state, an entity, a lane or the view itself a new ID. So what was clicked is followed
 * through those edits by what they did, as the designer is told it, never by guessing from what
 * the diagram looks like after: when there's no telling, there's no menu. An open menu is
 * followed the same way, and closes when what it's for is lost.
 *
 * An edit says what it did. Undo, Redo, going back in the History and a file changed outside the
 * designer don't: they write a whole version of the file, where a block with the same ID needn't
 * be the same block. Through one of those, everything but the diagram itself is lost.
 */
import { isInside, OpError, type Operation, type ViewDef, type Workspace } from "@open-arch/core";
import type { Selection } from "./Canvas.js";

/** The things of a view that have an ID of their own, as a selection names their kind, and where the view keeps each. */
const ID_PARTS = {
  block: (view: ViewDef) => view.blocks,
  lane: (view: ViewDef) => view.lanes,
  sticky: (view: ViewDef) => view.stickies,
  state: (view: ViewDef) => view.states,
  entity: (view: ViewDef) => view.entities,
} satisfies Record<string, (view: ViewDef) => readonly { id: string }[]>;
export type IdPart = keyof typeof ID_PARTS;

/**
 * The things of a view that go by their number, their place in a list: 1 is the first. A number
 * says which one only until another is added before it, deleted or moved, so each of those is
 * followed too.
 */
const NUMBERED = {
  flow: (view: ViewDef) => view.flows,
  transition: (view: ViewDef) => view.transitions,
  link: (view: ViewDef) => view.links,
} satisfies Record<string, (view: ViewDef) => readonly unknown[]>;
export type NumberedPart = keyof typeof NUMBERED;

const isIdPart = (kind: string): kind is IdPart => Object.hasOwn(ID_PARTS, kind);
const isNumbered = (kind: string): kind is NumberedPart => Object.hasOwn(NUMBERED, kind);

/**
 * What a right-click menu is for: one thing of a diagram, as a click selects it, or the diagram,
 * after a right-click on the background. The kinds here are the ones followed through edits.
 */
export type MenuFor = Extract<Selection, { kind: IdPart | NumberedPart | "attribute" }> | { kind: "diagram" };

/** What a right-click is for: `on` is what the click selects, or null for the background. Null for a selection no menu is for. */
export function menuOn(on: Selection): MenuFor | null {
  if (!on) return { kind: "diagram" };
  return isIdPart(on.kind) || isNumbered(on.kind) || on.kind === "attribute" ? (on as MenuFor) : null;
}

/** Whether a view has what a menu is for. */
export function menuThere(view: ViewDef, on: MenuFor): boolean {
  if (on.kind === "diagram") return true;
  if (on.kind === "attribute") return !!view.entities.find((e) => e.id === on.entity)?.attributes.some((a) => a.name === on.name);
  if ("number" in on) return Number.isInteger(on.number) && on.number >= 1 && on.number <= NUMBERED[on.kind](view).length;
  return ID_PARTS[on.kind](view).some((x) => x.id === on.id);
}

/** What's selected while a menu for this is open: what the menu is for, or nothing for the diagram's. */
export function selectionFor(on: MenuFor): Selection {
  return on.kind === "diagram" ? null : on;
}

/** Whether a menu's target is what's selected. */
export function isSelected(on: MenuFor, selection: Selection): boolean {
  const a: Record<string, unknown> | null = selectionFor(on);
  const b: Record<string, unknown> | null = selection;
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * Something a change to the workspace did that a menu follows.
 *
 * An edit gave a view a new ID, or deleted it. It gave one of a view's things a new ID (`kind`
 * is which kind of thing), or deleted it (`gone`), after which another can take its ID. It added
 * one to a numbered list at a place that isn't the end, deleted one, or moved one, each of which
 * renumbers the ones after. It gave an attribute a new name, or deleted it. Or it changed a
 * view's numbered lists without saying how: `lists-lost`. Or a whole version of the file was
 * written, which says nothing of what's in the views: `lost`.
 */
export type MenuRename =
  | { kind: "view"; id: string; to: string }
  | { kind: "view-gone"; id: string }
  | { kind: IdPart; view: string; id: string; to: string }
  | { kind: "gone"; what: IdPart; view: string; id: string }
  | { kind: "added" | "removed"; list: NumberedPart; view: string; number: number }
  | { kind: "moved"; list: NumberedPart; view: string; from: number; to: number }
  | { kind: "attribute"; view: string; entity: string; name: string; to: string }
  | { kind: "attribute-gone"; view: string; entity: string; name: string }
  | { kind: "lists-lost"; lists: NumberedPart[]; view: string }
  | { kind: "lost" };

/** The operation that gives each kind of thing a new ID. A sticky note's ID is never changed. */
const RENAMES: Partial<Record<Operation["op"], IdPart>> = { "update-block": "block", "update-lane": "lane", "update-state": "state", "update-entity": "entity" };

/**
 * The operation that deletes each kind of thing, and the numbered lists of its view that it
 * deletes from too: a block's flows go with it, a state's transitions and an entity's links.
 * Which ones isn't said, so those lists can't be followed through it.
 */
const REMOVES: Partial<Record<Operation["op"], { what: IdPart; loses: NumberedPart[] }>> = {
  "remove-block": { what: "block", loses: ["flow"] },
  "remove-lane": { what: "lane", loses: [] },
  "remove-sticky": { what: "sticky", loses: [] },
  "remove-state": { what: "state", loses: ["transition"] },
  "remove-entity": { what: "entity", loses: ["link"] },
};

/** The operations that add to, change and delete from each numbered list. Each names its number in a field called as the list is, and the number it moves to in `new` and that, as in `newFlow`. */
const LISTED: Partial<Record<Operation["op"], { list: NumberedPart; does: "add" | "update" | "remove" }>> = Object.fromEntries(
  (Object.keys(NUMBERED) as NumberedPart[]).flatMap((list) => (["add", "update", "remove"] as const).map((does) => [`${does}-${list}`, { list, does }])),
);

/**
 * What a change to the workspace did that a diagram's menu follows, in order. `ops` are an
 * edit's operations. Every way an edit gives something a new ID, deletes it or renumbers it is
 * here: nothing can be added or renamed under an ID that's taken, so what has an ID after an edit
 * is what had it before, unless the edit says otherwise.
 *
 * `before` is the workspace the operations were applied to. It says which views go with an
 * element that's deleted. That's only so for an edit's first operation, so an element deleted by
 * an edit that does more loses everything: no such edit in the designer does anything else.
 *
 * Without `before`, the change is a whole version of the file, written by Undo, Redo, the
 * History or a change made outside the designer, and `ops` only the renames it made. Everything
 * in the views is lost, and the views are followed to their new IDs.
 */
export function menuRenamesIn(ops: Operation[], before?: Workspace): MenuRename[] {
  const first = ops.length === 1 ? before : undefined;
  const followed = ops.flatMap((op): MenuRename[] => {
    // An element's new ID is here too. No view has an element's ID, so it changes nothing.
    if (op.op === "rename") return [{ kind: "view", id: op.id, to: op.to }];
    if (op.op === "remove-view") return [{ kind: "view-gone", id: op.id }];
    if (op.op === "remove-element") {
      // The views of an element, and of what's inside it, are deleted with it.
      if (!first) return [{ kind: "lost" }];
      return [...first.views.values()].filter((v) => v.scope !== undefined && (v.scope === op.id || isInside(first, v.scope, op.id))).map((v) => ({ kind: "view-gone", id: v.id }));
    }
    const renamed = RENAMES[op.op];
    if (renamed) {
      const { view, id, newId } = op as { view: string; id: string; newId?: string };
      return newId !== undefined && newId !== id ? [{ kind: renamed, view, id, to: newId }] : [];
    }
    const removed = REMOVES[op.op];
    if (removed) {
      const { view, id } = op as { view: string; id: string };
      return [{ kind: "gone", what: removed.what, view, id }, ...(removed.loses.length ? [{ kind: "lists-lost" as const, lists: removed.loses, view }] : [])];
    }
    const listed = LISTED[op.op];
    if (listed) {
      const { list, does } = listed;
      const fields = op as unknown as Record<string, number | undefined> & { view: string };
      const [number, to] = [fields[list], fields[`new${list[0]!.toUpperCase()}${list.slice(1)}`]];
      // One added without a place goes at the end, after every other. One changed where it is keeps its number.
      if (number === undefined) return [];
      if (does === "add") return [{ kind: "added", list, view: fields.view, number }];
      if (does === "remove") return [{ kind: "removed", list, view: fields.view, number }];
      return to !== undefined && to !== number ? [{ kind: "moved", list, view: fields.view, from: number, to }] : [];
    }
    if (op.op === "update-attribute") {
      // As update-attribute makes its name: trimmed.
      const to = op.newName?.trim();
      return to !== undefined && to !== op.name ? [{ kind: "attribute", view: op.view, entity: op.entity, name: op.name, to }] : [];
    }
    if (op.op === "remove-attribute") return [{ kind: "attribute-gone", view: op.view, entity: op.entity, name: op.name }];
    return [];
  });
  return before ? followed : [{ kind: "lost" }, ...followed];
}

type InView = Exclude<MenuRename, { kind: "view" | "view-gone" | "lost" }>;

/** One thing of a view after something an edit did to the view, or null once it's deleted or lost. */
function followed(on: Exclude<MenuFor, { kind: "diagram" }>, r: InView): MenuFor | null {
  if (r.kind === "gone") {
    // An entity's attributes go with it.
    if (on.kind === "attribute") return r.what === "entity" && on.entity === r.id ? null : on;
    return on.kind === r.what && on.id === r.id ? null : on;
  }
  if (r.kind === "lists-lost") return (r.lists as string[]).includes(on.kind) ? null : on;
  if (r.kind === "added" || r.kind === "removed" || r.kind === "moved") {
    if (on.kind !== r.list) return on;
    // One added at a number takes it, and the ones from there on go up by one.
    if (r.kind === "added") return r.number <= on.number ? { ...on, number: on.number + 1 } : on;
    if (r.kind === "removed") return on.number === r.number ? null : { ...on, number: on.number - (r.number < on.number ? 1 : 0) };
    if (r.kind !== "moved") return on;
    if (on.number === r.from) return { ...on, number: r.to };
    // One moved is taken out, which closes the gap it leaves, then put in at its new number.
    const left = on.number - (r.from < on.number ? 1 : 0);
    return { ...on, number: left + (r.to <= left ? 1 : 0) };
  }
  if (r.kind === "attribute" || r.kind === "attribute-gone") {
    if (on.kind !== "attribute" || on.entity !== r.entity || on.name !== r.name) return on;
    return r.kind === "attribute" ? { ...on, name: r.to } : null;
  }
  // A new ID. An attribute goes by its entity's.
  if (on.kind === "attribute") return r.kind === "entity" && on.entity === r.id ? { ...on, entity: r.to } : on;
  return on.kind === r.kind && on.id === r.id ? { ...on, id: r.to } : on;
}

/**
 * What a menu is for, and the ID of its view, after these, applied in order. What it's for is
 * null once it's deleted, or lost: there's no telling what it is now, if it's there at all.
 * Nothing after brings it back, as what then has its ID is something else.
 */
export function followMenu(on: MenuFor | null, view: string, renames: MenuRename[]): { on: MenuFor | null; view: string } {
  for (const r of renames) {
    if (r.kind === "view") {
      if (r.id === view) view = r.to;
    } else if (r.kind === "view-gone") {
      if (r.id === view) on = null;
    } else if (!on || on.kind === "diagram") {
      continue;
    } else if (r.kind === "lost") {
      on = null;
    } else if (r.view === view) {
      on = followed(on, r);
    }
  }
  return { on, view };
}

/**
 * Operations that put a sticky note on a flowchart's block, made with the IDs a render showed,
 * moved to the ID the block has after `renames`, what the changes applied since that render did.
 * A new block's ID follows its text, so text typed just before a note is put on the block gives
 * it a new ID ahead of the note's edit. The block is followed as a menu's is (see followMenu): by
 * what the edits did, never by what's in its place after. One that was deleted, or lost through
 * an Undo or a file changed elsewhere, is refused, with why. The other operations are as they were.
 */
export function followBlocks(ops: Operation[], renames: MenuRename[]): Operation[] {
  if (renames.length === 0) return ops;
  return ops.map((op): Operation => {
    if ((op.op !== "add-sticky" && op.op !== "update-sticky") || !op.on || !("block" in op.on)) return op;
    const { on } = followMenu({ kind: "block", id: op.on.block }, op.view, renames);
    if (on?.kind !== "block") throw new OpError("The flowchart changed just before, so no note was put on the block. Try again.");
    return on.id === op.on.block ? op : { ...op, on: { block: on.id } };
  });
}
