/**
 * What a flowchart's right-click menu is for, and how that's found again once edits have landed.
 *
 * A right-click selects at once, but its menu opens once the edits made before it have landed:
 * text typed in the details is saved as the click takes the focus from it, and that can give a
 * block, a lane or the view itself a new ID, or a flow new text. So what was clicked is followed
 * through those edits by what they did, as the designer is told it, never by guessing from what
 * the flowchart looks like after: when there's no telling, there's no menu.
 */
import type { Flow, Operation, ViewDef, Workspace } from "@open-arch/core";
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
 * Something an edit did that changes how a menu's flowchart, or what the menu is for, is found: a
 * view given a new ID, a block or a lane of a view given one, or a flow of a view given other
 * ends or text.
 */
export type MenuRename =
  | { kind: "view"; id: string; to: string }
  | { kind: "block" | "lane"; view: string; id: string; to: string }
  | { kind: "flow"; view: string; was: FlowEnds; now: FlowEnds };

/**
 * What an edit's operations did that a flowchart's menu follows, in order. `before` is the
 * workspace they were applied to, which says which flow an update-flow changed: its number is a
 * place in the list as it was just then. So a flow is only followed through an edit that does
 * nothing else, as every edit of a flow in the designer is; through any other, it's lost.
 * Undo, Redo and a file changed outside the designer tell only of the views they rename.
 */
export function menuRenamesIn(ops: Operation[], before?: Workspace): MenuRename[] {
  return ops.flatMap((op): MenuRename[] => {
    // An element's new ID is here too. No view has an element's ID, so it changes nothing.
    if (op.op === "rename") return [{ kind: "view", id: op.id, to: op.to }];
    if ((op.op === "update-block" || op.op === "update-lane") && op.newId !== undefined && op.newId !== op.id) {
      return [{ kind: op.op === "update-block" ? "block" : "lane", view: op.view, id: op.id, to: op.newId }];
    }
    if (op.op === "update-flow" && ops.length === 1) {
      const was = before?.views.get(op.view)?.flows[op.flow - 1];
      if (!was) return [];
      // As update-flow makes it: text that's empty is none.
      const now: FlowEnds = { from: op.from ?? was.from, to: op.to ?? was.to, text: op.text === undefined ? was.text : op.text?.trim() || undefined };
      return sameFlow(was, now) ? [] : [{ kind: "flow", view: op.view, was: { from: was.from, to: was.to, text: was.text }, now }];
    }
    return [];
  });
}

/** What a menu is for, and the ID of its flowchart, after these, applied in order. */
export function followMenu(on: MenuFor, view: string, renames: MenuRename[]): { on: MenuFor; view: string } {
  for (const r of renames) {
    if (r.kind === "view") {
      if (r.id === view) view = r.to;
    } else if (r.view !== view) {
      continue;
    } else if (r.kind === "flow") {
      if (on.kind === "flow" && sameFlow(on, r.was)) on = { kind: "flow", ...r.now };
    } else if (on.kind === r.kind && on.id === r.id) {
      on = { ...on, id: r.to };
    } else if (r.kind === "block" && on.kind === "flow") {
      // A flow's ends follow a block given a new ID.
      on = { ...on, from: on.from === r.id ? r.to : on.from, to: on.to === r.id ? r.to : on.to };
    }
  }
  return { on, view };
}
