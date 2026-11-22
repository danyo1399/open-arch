/**
 * What a flowchart's right-click menu is for, and how that's found again once edits have landed.
 *
 * A right-click selects at once, but its menu opens once the edits made before it have landed:
 * text typed in the details is saved as the click takes the focus from it, and that can give a
 * block, a lane or the view itself a new ID, or a flow new text. So what was clicked is followed
 * through those edits by what they did, as the designer is told it, never by guessing from what
 * the flowchart looks like after: when there's no telling, there's no menu. An open menu is
 * followed the same way, and closes when what it's for is lost.
 *
 * An edit says what it did. Undo, Redo, going back in the History and a file changed outside the
 * designer don't: they write a whole version of the file, where a block with the same ID needn't
 * be the same block. Through one of those, everything but the diagram itself is lost.
 */
import { isInside, OpError, type Flow, type Operation, type ViewDef, type Workspace } from "@open-arch/core";
import type { Selection } from "./Canvas.js";

/**
 * A flow's ends and text, which tell it from the other flows: add-flow and update-flow refuse a
 * second one with the same. Its number is only its place in the list, which other flows coming
 * and going change. A file written by hand can have two flows with the same ends and text, and
 * nothing tells those apart once anything moves, so they have no menu: see flowOf.
 */
export interface FlowEnds {
  from: string;
  to: string;
  text?: string;
}

/** Whether two flows have the same ends and text. */
export const sameFlow = (a: FlowEnds, b: FlowEnds) => a.from === b.from && a.to === b.to && (a.text ?? "") === (b.text ?? "");

/** What a right-click menu is for: a block, a lane or a sticky note, by its ID; a flow, by its ends and text; or the diagram, after a right-click on the background. */
export type MenuFor = { kind: "block" | "lane" | "sticky"; id: string } | ({ kind: "flow" } & FlowEnds) | { kind: "diagram" };

/**
 * What a right-click is for, in the flowchart as it's drawn: `on` is what the click selects, or
 * null for the background. Null when the flowchart has no such thing.
 */
export function menuOn(view: ViewDef, on: Selection): MenuFor | null {
  if (!on) return { kind: "diagram" };
  if (on.kind === "block") return view.blocks.some((b) => b.id === on.id) ? { kind: "block", id: on.id } : null;
  if (on.kind === "lane") return view.lanes.some((l) => l.id === on.id) ? { kind: "lane", id: on.id } : null;
  if (on.kind === "sticky") return view.stickies.some((s) => s.id === on.id) ? { kind: "sticky", id: on.id } : null;
  const flow = on.kind === "flow" ? view.flows[on.number - 1] : undefined;
  return flow && flowOf(view, flow) ? { kind: "flow", from: flow.from, to: flow.to, text: flow.text } : null;
}

/**
 * The flow a menu is for, in the flowchart as it is now, at whatever number it has: the one with
 * these ends and text. None when there isn't one, or when there's more than one.
 */
export function flowOf(view: ViewDef, on: FlowEnds): Flow | undefined {
  const found = view.flows.filter((f) => sameFlow(f, on));
  return found.length === 1 ? found[0] : undefined;
}

/** Whether the flow with this number shares its ends and text with another, so it has no menu. */
export function sharesEnds(view: ViewDef, number: number): boolean {
  const flow = view.flows[number - 1];
  return !!flow && view.flows.some((f) => f !== flow && sameFlow(f, flow));
}

/**
 * What's selected while a menu for this is open, in the flowchart as it is now: what the menu is
 * for, or nothing for the diagram's. Undefined when the flowchart no longer has it.
 */
export function selectionOf(view: ViewDef, on: MenuFor): Selection | undefined {
  if (on.kind === "diagram") return null;
  if (on.kind === "flow") {
    const flow = flowOf(view, on);
    return flow && { kind: "flow", number: flow.number };
  }
  const there = on.kind === "block" ? view.blocks : on.kind === "lane" ? view.lanes : view.stickies;
  return there.some((x) => x.id === on.id) ? { kind: on.kind, id: on.id } : undefined;
}

/** Whether these select the same block, flow, lane or sticky note of a flowchart, or both nothing. */
export function sameSelection(a: Selection, b: Selection): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "flow") return b.kind === "flow" && a.number === b.number;
  return (a.kind === "block" || a.kind === "lane" || a.kind === "sticky") && b.kind === a.kind && a.id === b.id;
}

/**
 * Something a change to the workspace did that a menu follows. An edit gave a view a new ID, or
 * a block or a lane of a view, or gave a flow of a view other ends or text. Or it deleted one of
 * them, or a view, after which another can take its ID. Or it changed the flows of a view without
 * saying which is which: `flows-lost`. Or a whole version of the file was written, which says
 * nothing of what's in the views: `lost`.
 */
export type MenuRename =
  | { kind: "view"; id: string; to: string }
  | { kind: "view-gone"; id: string }
  | { kind: "block" | "lane"; view: string; id: string; to: string }
  | { kind: "gone"; what: "block" | "lane" | "sticky"; view: string; id: string }
  | { kind: "flow"; view: string; was: FlowEnds; now: FlowEnds }
  | { kind: "flow-gone"; view: string; was: FlowEnds }
  | { kind: "flows-lost"; view: string }
  | { kind: "lost" };

const GONE = { "remove-block": "block", "remove-lane": "lane", "remove-sticky": "sticky" } as const;

/**
 * What a change to the workspace did that a flowchart's menu follows, in order. `ops` are an
 * edit's operations. Every way an edit gives something a new ID, or deletes it, is here: nothing
 * can be added or renamed under an ID that's taken, so what has an ID after an edit is what had
 * it before, unless the edit says otherwise.
 *
 * `before` is the workspace the operations were applied to. It says which flow an update-flow or
 * remove-flow means, as a flow's number is its place in the list just then, and which views go
 * with an element that's deleted. That's only so for an edit's first operation, so a flow or an
 * element changed by an edit that does more loses the view's flows, or everything: every such
 * edit in the designer does nothing else.
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
    if ((op.op === "update-block" || op.op === "update-lane") && op.newId !== undefined && op.newId !== op.id) {
      return [{ kind: op.op === "update-block" ? "block" : "lane", view: op.view, id: op.id, to: op.newId }];
    }
    if (op.op === "remove-block" || op.op === "remove-lane" || op.op === "remove-sticky") return [{ kind: "gone", what: GONE[op.op], view: op.view, id: op.id }];
    if (op.op === "update-flow" || op.op === "remove-flow") {
      const flow = first?.views.get(op.view)?.flows[op.flow - 1];
      if (!flow) return [{ kind: "flows-lost", view: op.view }];
      const was: FlowEnds = { from: flow.from, to: flow.to, text: flow.text };
      if (op.op === "remove-flow") return [{ kind: "flow-gone", view: op.view, was }];
      // As update-flow makes it: text that's empty is none.
      const now: FlowEnds = { from: op.from ?? was.from, to: op.to ?? was.to, text: op.text === undefined ? was.text : op.text?.trim() || undefined };
      return sameFlow(was, now) ? [] : [{ kind: "flow", view: op.view, was, now }];
    }
    return [];
  });
  return before ? followed : [{ kind: "lost" }, ...followed];
}

/**
 * What a menu is for, and the ID of its flowchart, after these, applied in order. What it's for
 * is null once it's deleted, or lost: there's no telling what it is now, if it's there at all.
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
    } else if (r.view !== view) {
      continue;
    } else if (on.kind === "flow") {
      // A flow goes with either of its blocks, and its ends follow a block given a new ID.
      if (r.kind === "flows-lost" || ((r.kind === "flow-gone" || r.kind === "flow") && sameFlow(on, r.was))) on = r.kind === "flow" ? { kind: "flow", ...r.now } : null;
      else if (r.kind === "gone" && r.what === "block" && (on.from === r.id || on.to === r.id)) on = null;
      else if (r.kind === "block") on = { ...on, from: on.from === r.id ? r.to : on.from, to: on.to === r.id ? r.to : on.to };
    } else if (r.kind === "gone") {
      if (on.kind === r.what && on.id === r.id) on = null;
    } else if (r.kind === on.kind && r.id === on.id) {
      on = { ...on, id: r.to };
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
