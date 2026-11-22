/**
 * What a diagram's right-click menu is for, and how that's found again once edits have landed.
 *
 * A right-click selects at once, but its menu opens once the edits made before it have landed:
 * text typed in the details is saved as the click takes the focus from it, and that can give a
 * block, a state, an entity, a card, a screen, a widget, a node, a lane or the view itself a new
 * ID. So what was clicked is followed through those edits by what they did, as the designer is told it,
 * never by guessing from what the diagram looks like after: when there's no telling, there's no
 * menu. An open menu is followed the same way, and closes when what it's for is lost.
 *
 * An edit says what it did. Undo, Redo, going back in the History and a file changed outside the
 * designer don't: they write a whole version of the file, where a block with the same ID needn't
 * be the same block. Through one of those, everything but the diagram itself is lost.
 */
import { allWidgets, applyOperations, buildWorkspace, cardArrows, endShape, isInside, OpError, type Operation, type ViewDef, type Workspace } from "@open-arch/core";
import type { Selection } from "./Canvas.js";

/** The things of a view that have an ID of their own, as a selection names their kind, and where the view keeps each. */
const ID_PARTS = {
  block: (view: ViewDef) => view.blocks,
  lane: (view: ViewDef) => view.lanes,
  sticky: (view: ViewDef) => view.stickies,
  state: (view: ViewDef) => view.states,
  entity: (view: ViewDef) => view.entities,
  card: (view: ViewDef) => view.cards,
  screen: (view: ViewDef) => view.screens,
  // Wherever it is: on a screen, or inside a row or a panel.
  widget: (view: ViewDef) => allWidgets(view),
  node: (view: ViewDef) => view.nodes,
  shape: (view: ViewDef) => view.shapes,
  boardArrow: (view: ViewDef) => view.arrows,
} satisfies Record<string, (view: ViewDef) => readonly { id: string }[]>;
export type IdPart = keyof typeof ID_PARTS;

/**
 * The things of a view that go by their number, their place in a list: 1 is the first. A number
 * says which one only until another is added before it, deleted or moved, so each of those is
 * followed too. Each is an arrow between two things: a connection's can be nodes of the view or
 * elements of the model, and a step's are elements.
 */
const NUMBERED = {
  flow: (view: ViewDef) => view.flows,
  transition: (view: ViewDef) => view.transitions,
  link: (view: ViewDef) => view.links,
  connection: (view: ViewDef) => view.connections,
  step: (view: ViewDef) => view.steps,
} satisfies Record<string, (view: ViewDef) => readonly { from: string; to: string }[]>;
export type NumberedPart = keyof typeof NUMBERED;

const isIdPart = (kind: string): kind is IdPart => Object.hasOwn(ID_PARTS, kind);
const isNumbered = (kind: string): kind is NumberedPart => Object.hasOwn(NUMBERED, kind);

/**
 * What a right-click menu is for: one thing of a diagram, as a click selects it, or the diagram,
 * after a right-click on the background. The kinds here are the ones followed through edits.
 *
 * An attribute goes by its entity and its name, as selecting one does. A file written by hand
 * can give an entity two attributes with one name, which the problems list says: there, it's
 * the first of them, as it is in the details.
 *
 * An event view's arrow goes by the cards at its ends: there's one at most from a card to another.
 *
 * A container or system running in a deployment view's node goes by the node and by its own ID,
 * an element's of the model.
 *
 * Several of a whiteboard's shapes, arrows and notes selected together are one target: `board`.
 * It's there while every one of them is.
 */
export type MenuFor = Extract<Selection, { kind: IdPart | NumberedPart | "attribute" | "cardArrow" | "instance" | "board" }> | { kind: "diagram" };

/** The kinds that go by more than an ID or a number of their own. */
const isComposite = (kind: string): kind is "attribute" | "cardArrow" | "instance" | "board" => kind === "attribute" || kind === "cardArrow" || kind === "instance" || kind === "board";

/** The kinds of thing several selected together on a whiteboard can be, and the list of the selection each is in. */
const BOARD_LISTS = { shape: "shapes", boardArrow: "arrows", sticky: "stickies" } as const satisfies Partial<Record<IdPart, string>>;
type BoardKind = keyof typeof BOARD_LISTS;
const isBoardKind = (kind: string): kind is BoardKind => Object.hasOwn(BOARD_LISTS, kind);

/** What a right-click is for: `on` is what the click selects, or null for the background. Null for a selection no menu is for. */
export function menuOn(on: Selection): MenuFor | null {
  if (!on) return { kind: "diagram" };
  return isIdPart(on.kind) || isNumbered(on.kind) || isComposite(on.kind) ? (on as MenuFor) : null;
}

/** Whether a view has what a menu is for. */
export function menuThere(view: ViewDef, on: MenuFor): boolean {
  if (on.kind === "diagram") return true;
  if (on.kind === "attribute") return !!view.entities.find((e) => e.id === on.entity)?.attributes.some((a) => a.name === on.name);
  if (on.kind === "cardArrow") return cardArrows(view).some((a) => a.from === on.from && a.to === on.to);
  if (on.kind === "instance") return !!view.nodes.find((n) => n.id === on.node)?.runs.includes(on.element);
  if (on.kind === "board") return (Object.keys(BOARD_LISTS) as BoardKind[]).every((kind) => on[BOARD_LISTS[kind]].every((id) => ID_PARTS[kind](view).some((x) => x.id === id)));
  if ("number" in on) return Number.isInteger(on.number) && on.number >= 1 && on.number <= NUMBERED[on.kind](view).length;
  return ID_PARTS[on.kind](view).some((x) => x.id === on.id);
}

/** What's selected while a menu for this is open: what the menu is for, or nothing for the diagram's. */
export function selectionFor(on: MenuFor): Selection {
  return on.kind === "diagram" ? null : on;
}

/** Whether a menu's target is what's selected. Several selected together are the same several in any order. */
export function isSelected(on: MenuFor, selection: Selection): boolean {
  const a: Record<string, unknown> | null = selectionFor(on);
  const b: Record<string, unknown> | null = selection;
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const same = (x: unknown, y: unknown) => (Array.isArray(x) && Array.isArray(y) ? x.length === y.length && x.every((item) => y.includes(item)) : x === y);
  return [...keys].every((key) => same(a[key], b[key]));
}

/**
 * Something a change to the workspace did that a menu follows.
 *
 * An edit gave a view a new ID, or deleted it. It gave one of a view's things a new ID (`kind`
 * is which kind of thing), or deleted it (`gone`), after which another can take its ID. It added
 * one to a numbered list at a place that isn't the end, deleted one, or moved one, each of which
 * renumbers the ones after. It gave an attribute a new name, or deleted it. It said which cards a
 * card comes from, so the arrows to it from any other card are gone: `comes-from`. It said what
 * a node runs, so anything else stopped running there: `runs`. It deleted an element of the
 * model, which no node runs after: `element-gone`. Or it deleted some of a view's things of these
 * kinds, and which ones couldn't be worked out: `kinds-lost`. Or a whole version of the file was
 * written, which says nothing of what's in the views: `lost`.
 *
 * `view` is said for an element's new ID too, as `rename` gives both: no view has an element's
 * ID, so it's no view's, and what runs in a node goes by it.
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
  | { kind: "comes-from"; view: string; card: string; from: string[] }
  | { kind: "runs"; view: string; node: string; runs: string[] }
  | { kind: "element-gone"; id: string }
  | { kind: "kinds-lost"; kinds: (IdPart | NumberedPart)[]; view: string }
  | { kind: "lost" };

/** The operation that gives each kind of thing a new ID. A sticky note's ID is never changed. */
const RENAMES: Partial<Record<Operation["op"], IdPart>> = {
  "update-block": "block",
  "update-lane": "lane",
  "update-state": "state",
  "update-entity": "entity",
  "update-card": "card",
  "update-screen": "screen",
  "update-widget": "widget",
  "update-node": "node",
  "update-shape": "shape",
  "update-arrow": "boardArrow",
};

/**
 * The operation that deletes each kind of thing, and what of its view goes with it. `loses` are
 * the numbered lists it deletes from too: a block's flows go with it, a state's transitions and
 * an entity's links, the ones with it at either end. `holds` are the things with an ID of their
 * own that go with it, as the view had them before: the widgets on a screen, the ones inside a
 * row or a panel, the nodes inside a node, and the arrows with an end on a whiteboard's shape.
 *
 * An entity's attributes go with it too, a card's arrows, and what runs in a node. Those go by
 * the entity's ID, the cards' and the node's, so they're followed by that (see `followed`), and
 * aren't here. Nor are a node's connections: see SWEEPS.
 */
const REMOVES: Partial<Record<Operation["op"], { what: IdPart; loses?: NumberedPart[]; holds?: { what: IdPart; of(was: ViewDef, id: string): readonly { id: string }[] } }>> = {
  "remove-block": { what: "block", loses: ["flow"] },
  "remove-lane": { what: "lane" },
  "remove-sticky": { what: "sticky" },
  "remove-state": { what: "state", loses: ["transition"] },
  "remove-entity": { what: "entity", loses: ["link"] },
  "remove-card": { what: "card" },
  "remove-screen": { what: "screen", holds: { what: "widget", of: (was, id) => allWidgets(was).filter((w) => w.screen === id) } },
  "remove-widget": { what: "widget", holds: { what: "widget", of: (was, id) => allWidgets(was).filter((w) => w.id === id).flatMap((w) => allWidgets(w)) } },
  "remove-node": { what: "node", holds: { what: "node", of: (was, id) => was.nodes.filter((n) => isInsideNode(was, n.id, id)) } },
  "remove-shape": { what: "shape", holds: { what: "boardArrow", of: (was, id) => was.arrows.filter((a) => endShape(a.from) === id || endShape(a.to) === id) } },
  "remove-arrow": { what: "boardArrow" },
};

/** Whether a deployment view's node is inside another, however deep. */
function isInsideNode(view: ViewDef, id: string, holder: string): boolean {
  const seen = new Set<string>();
  for (let at = view.nodes.find((n) => n.id === id)?.parent; at !== undefined && !seen.has(at); at = view.nodes.find((n) => n.id === at)?.parent) {
    if (at === holder) return true;
    seen.add(at);
  }
  return false;
}

/**
 * The operations that delete from a numbered list that isn't theirs, by rules only applying them
 * says: a node that's deleted, or told what it runs, takes the connections left with nothing at an
 * end, and an element deleted from the model takes those and the steps it's in, in every view.
 * What each did is read off a copy of the workspace: see `swept`.
 */
const SWEEPS: Partial<Record<Operation["op"], NumberedPart[]>> = {
  "remove-node": ["connection"],
  "update-node": ["connection"],
  "remove-element": ["connection", "step"],
};

/**
 * What an operation of SWEEPS deleted from the numbered lists of these kinds, in the views of the
 * workspace it was applied to, `was`. It's applied to a copy in which each connection and each
 * step is described by its number, so the ones still there after say which they were: none of
 * these operations reads or writes a connection's description, or a step's. An operation on one
 * view changes no other, so only that view is looked at. Where the copy can't say, as when the
 * operation is refused on its own, the lists are lost.
 */
function swept(was: Workspace, op: Operation, lists: NumberedPart[]): MenuRename[] {
  const only = "view" in op ? op.view : undefined;
  const marked = structuredClone(was.doc);
  const had: { view: string; list: NumberedPart; count: number }[] = [];
  for (const view of was.views.values()) {
    if (only !== undefined && view.id !== only) continue;
    for (const list of lists) {
      // The file keeps each list under its kind's name and an s.
      const items = (marked.views[view.id] as Record<string, { description?: string }[] | undefined> | undefined)?.[`${list}s`];
      if (!items?.length) continue;
      items.forEach((item, at) => (item.description = String(at + 1)));
      had.push({ view: view.id, list, count: items.length });
    }
  }
  if (had.length === 0) return [];
  let after: Workspace["doc"] | undefined;
  try {
    after = applyOperations(marked, [op]).doc;
  } catch {
    after = undefined;
  }
  return had.flatMap(({ view, list, count }): MenuRename[] => {
    // A view deleted with the element is followed as that.
    if (after && !after.views[view]) return [];
    const left = ((after?.views[view] as Record<string, { description?: string }[] | undefined> | undefined)?.[`${list}s`] ?? []).map((item) => Number(item.description));
    // The ones left are in the order they were in, each one of those there before.
    const kept = !!after && left.every((number, at) => Number.isInteger(number) && number >= 1 && number <= count && (at === 0 || number > left[at - 1]!));
    if (!kept) return [{ kind: "kinds-lost", kinds: [list], view }];
    const still = new Set(left);
    const out: MenuRename[] = [];
    // From the last, so each one's number is still its number as the ones after it go.
    for (let number = count; number >= 1; number--) if (!still.has(number)) out.push({ kind: "removed", list, view, number });
    return out;
  });
}

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
 * element that's deleted, which arrows go with a block, a state or an entity, by their numbers,
 * and which widgets go with a screen, a row or a panel. An edit can do more first, as one of Ask
 * AI's can, so the workspace an operation was applied to is `before` with the ones ahead of it
 * applied. Where that can't be worked out, an element that's deleted loses everything, a block, a
 * state or an entity its view's arrows, and a screen, a row or a panel its view's widgets.
 *
 * Without `before`, the change is a whole version of the file, written by Undo, Redo, the
 * History or a change made outside the designer, and `ops` only the renames it made. Everything
 * in the views is lost, and the views are followed to their new IDs.
 */
export function menuRenamesIn(ops: Operation[], before?: Workspace): MenuRename[] {
  // The workspace so many of the operations have been applied to, taken forward only as far as it's asked for.
  let seen = before;
  let applied = 0;
  /** The workspace the operation at this place was applied to. */
  const appliedTo = (place: number): Workspace | undefined => {
    if (seen && applied < place) {
      try {
        seen = buildWorkspace(applyOperations(seen.doc, ops.slice(applied, place)).doc);
        applied = place;
      } catch {
        // Applied on their own, the operations ahead can be refused where the whole edit isn't: one that leaves something for a later one to put right.
        seen = undefined;
      }
    }
    return seen;
  };
  /** What the operation at this place did, but for what it swept from lists that aren't its own. */
  const did = (op: Operation, place: number): MenuRename[] => {
    // An element's new ID is here too. No view has an element's ID, so it's no view's.
    if (op.op === "rename") return [{ kind: "view", id: op.id, to: op.to }];
    if (op.op === "remove-view") return [{ kind: "view-gone", id: op.id }];
    if (op.op === "remove-element") {
      // What's inside an element is deleted with it, and so are the views of each.
      const was = appliedTo(place);
      if (!was) return [{ kind: "lost" }];
      const gone = (id: string) => id === op.id || isInside(was, id, op.id);
      return [
        ...[...was.views.values()].filter((v) => v.scope !== undefined && gone(v.scope)).map((v): MenuRename => ({ kind: "view-gone", id: v.id })),
        ...[...was.elements.keys()].filter(gone).map((id): MenuRename => ({ kind: "element-gone", id })),
      ];
    }
    const renamed = RENAMES[op.op];
    if (renamed) {
      const { view, id, newId } = op as { view: string; id: string; newId?: string };
      const out: MenuRename[] = [];
      // The cards a card comes from are said under the ID it had, as update-card reads them: each trimmed, and none for null.
      if (op.op === "update-card" && op.from !== undefined) out.push({ kind: "comes-from", view, card: id, from: (op.from ?? []).map((from) => from.trim()) });
      // And what a node runs, as update-node reads it.
      if (op.op === "update-node" && op.runs !== undefined) out.push({ kind: "runs", view, node: id, runs: (op.runs ?? []).map((run) => run.trim()) });
      if (newId !== undefined && newId !== id) out.push({ kind: renamed, view, id, to: newId });
      return out;
    }
    const removed = REMOVES[op.op];
    if (removed) {
      const { view, id } = op as { view: string; id: string };
      const { loses = [], holds } = removed;
      const out: MenuRename[] = [{ kind: "gone", what: removed.what, view, id }];
      if (loses.length === 0 && !holds) return out;
      const was = appliedTo(place)?.views.get(view);
      if (!was) return [...out, { kind: "kinds-lost", kinds: [...loses, ...(holds ? [holds.what] : [])], view }];
      for (const held of holds?.of(was, id) ?? []) out.push({ kind: "gone", what: holds!.what, view, id: held.id });
      for (const list of loses) {
        // Its arrows go with it. From the last, so each one's number is still its number as the ones after it go.
        const arrows = NUMBERED[list](was);
        for (let number = arrows.length; number >= 1; number--) {
          const arrow = arrows[number - 1]!;
          if (arrow.from === id || arrow.to === id) out.push({ kind: "removed", list, view, number });
        }
      }
      return out;
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
  };
  const followed = ops.flatMap((op, place): MenuRename[] => {
    const out = did(op, place);
    const lists = SWEEPS[op.op];
    // A node told anything but what it runs keeps its view's connections.
    if (!lists || (op.op === "update-node" && op.runs === undefined)) return out;
    const was = appliedTo(place);
    if (was) return [...out, ...swept(was, op, lists)];
    // An element deleted from a workspace there's no telling of has lost everything already.
    return "view" in op ? [...out, { kind: "kinds-lost", kinds: lists, view: op.view }] : out;
  });
  return before ? followed : [{ kind: "lost" }, ...followed];
}

type InView = Exclude<MenuRename, { kind: "view" | "view-gone" | "element-gone" | "lost" }>;

/** One thing of a view after something an edit did to the view, or null once it's deleted or lost. */
function followed(on: Exclude<MenuFor, { kind: "diagram" }>, r: InView): MenuFor | null {
  if (on.kind === "board") {
    // Several selected together: lost with any one of them, and followed to each one's new ID.
    if (r.kind === "gone") return isBoardKind(r.what) && on[BOARD_LISTS[r.what]].includes(r.id) ? null : on;
    if (r.kind === "kinds-lost") return r.kinds.some((kind) => isBoardKind(kind) && on[BOARD_LISTS[kind]].length > 0) ? null : on;
    if (!isBoardKind(r.kind)) return on;
    const { id, to } = r as { id: string; to: string };
    return { ...on, [BOARD_LISTS[r.kind]]: on[BOARD_LISTS[r.kind]].map((had) => (had === id ? to : had)) };
  }
  if (r.kind === "gone") {
    // An entity's attributes go with it, a card's arrows, and what runs in a node.
    if (on.kind === "attribute") return r.what === "entity" && on.entity === r.id ? null : on;
    if (on.kind === "cardArrow") return r.what === "card" && (on.from === r.id || on.to === r.id) ? null : on;
    if (on.kind === "instance") return r.what === "node" && on.node === r.id ? null : on;
    return on.kind === r.what && on.id === r.id ? null : on;
  }
  // Where there's no telling which nodes went, there's none which of what ran in them did.
  if (r.kind === "kinds-lost") return (r.kinds as string[]).includes(on.kind === "instance" ? "node" : on.kind) ? null : on;
  // An arrow to the card from one it no longer comes from is gone.
  if (r.kind === "comes-from") return on.kind === "cardArrow" && on.to === r.card && !r.from.includes(on.from) ? null : on;
  // And so is what the node no longer runs.
  if (r.kind === "runs") return on.kind === "instance" && on.node === r.node && !r.runs.includes(on.element) ? null : on;
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
  // A new ID. An attribute goes by its entity's, an arrow by the cards' at its ends, and what runs in a node by the node's.
  if (on.kind === "attribute") return r.kind === "entity" && on.entity === r.id ? { ...on, entity: r.to } : on;
  if (on.kind === "cardArrow") return r.kind === "card" ? { ...on, from: on.from === r.id ? r.to : on.from, to: on.to === r.id ? r.to : on.to } : on;
  if (on.kind === "instance") return r.kind === "node" && on.node === r.id ? { ...on, node: r.to } : on;
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
      // An element's new ID: what runs in a node goes by it too.
      if (on?.kind === "instance" && on.element === r.id) on = { ...on, element: r.to };
    } else if (r.kind === "view-gone") {
      if (r.id === view) on = null;
    } else if (r.kind === "element-gone") {
      // Deleted from the model, it runs nowhere.
      if (on?.kind === "instance" && on.element === r.id) on = null;
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
