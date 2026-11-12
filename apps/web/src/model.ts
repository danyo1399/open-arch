/** Small questions about the model that the designer's UI asks. */
import {
  builtInto,
  computeAllViews,
  describeElement,
  isInside,
  representative,
  VIEW_LEVELS,
  type ArchElement,
  type Card,
  type ComputedView,
  type Connection,
  type DeploymentNode,
  type ElementData,
  type ElementDescription,
  type Lane,
  type Operation,
  type Relationship,
  type RelationshipKind,
  type State,
  type Step,
  type Sticky,
  type Transition,
  type ViewData,
  type ViewDef,
  type Workspace,
} from "@open-arch/core";
import type { Selection } from "./canvas/Canvas.js";

/** IDs the designer gives new elements before they have a name. */
export const PLACEHOLDER_ID = /^new-(person|system|container|component|library|class)(-\d+)?$/;

/** `base`, or `base-2`, `base-3`, ... whichever isn't taken by an element or view other than `self`. */
export function uniqueId(ws: Workspace, base: string, self?: string): string {
  const taken = (id: string) => id !== self && (ws.elements.has(id) || ws.views.has(id));
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/** `base`, or `base-2`, `base-3`, ... whichever isn't the ID of another of the view's states than `self`. */
export function uniqueStateId(view: ViewDef, base: string, self?: string): string {
  const taken = (id: string) => id !== self && view.states.some((s) => s.id === id);
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * `base`, or `base-2`, `base-3`, ... whichever isn't the ID of another of the view's nodes than
 * `self`, or of an element. A node can't have the ID of an element its view runs, as a
 * connection to it could mean either, so a node named after what it runs, like "Orders DB", gets
 * "orders-db-2"; and no element can be run in the view later and clash with it.
 */
export function uniqueNodeId(ws: Workspace, view: ViewDef, base: string, self?: string): string {
  const taken = (id: string) => id !== self && (view.nodes.some((n) => n.id === id) || ws.elements.has(id));
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/** `base`, or `base-2`, `base-3`, ... whichever isn't among `ids`, `self` aside: for an ID unique among an event view's lanes, or its cards. */
export function uniqueAmong(ids: readonly string[], base: string, self?: string): string {
  const taken = (id: string) => id !== self && ids.includes(id);
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/** "Checkout API" → "checkout-api", or "" when the name has no letters or digits. */
export function idFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Whether `id` is the one the designer would make from `name` ("checkout-api",
 * or "checkout-api-2" when that was taken), or a placeholder. Such an ID keeps
 * following the name; one that differs was chosen on purpose and stays put.
 */
export function followsName(id: string, name: string): boolean {
  if (PLACEHOLDER_ID.test(id)) return true;
  const base = idFromName(name);
  return base !== "" && (id === base || (id.startsWith(`${base}-`) && /^\d+$/.test(id.slice(base.length + 1))));
}

/** Elements in alphabetical order of name, as the model tree lists them. Elements with the same name go by ID. */
export function byName(a: ArchElement, b: ArchElement): number {
  return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** How the Views list is sorted: by title, or by level, from landscape down to class, and then by title. */
export type ViewOrder = "name" | "level";

/** The Views list: the pinned views, then the rest, each in `order`. Views with the same title go by ID. */
export function viewList(views: Iterable<ViewDef>, order: ViewOrder, pins: readonly string[]): { pinned: ViewDef[]; others: ViewDef[] } {
  const byTitle = (a: ViewDef, b: ViewDef) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byLevel = (a: ViewDef, b: ViewDef) => VIEW_LEVELS.indexOf(a.level) - VIEW_LEVELS.indexOf(b.level) || byTitle(a, b);
  const sorted = [...views].sort(order === "level" ? byLevel : byTitle);
  const pinned = new Set(pins);
  return { pinned: sorted.filter((v) => pinned.has(v.id)), others: sorted.filter((v) => !pinned.has(v.id)) };
}

/**
 * Operations name a relationship by its target and which one it is among the
 * element's relationships to that target. This turns a position in `uses` into that.
 */
export function relationshipRef(element: ArchElement, position: number): { from: string; to: string; index: number } {
  const to = element.uses[position]!.to;
  return { from: element.id, to, index: element.uses.slice(0, position).filter((r) => r.to === to).length };
}

/** What deleting an element would remove, for the confirmation dialog: `builtWith` are the containers built with a library being deleted. */
export function deletePlan(ws: Workspace, id: string): { inside: ArchElement[]; views: ViewDef[]; affected: ArchElement[]; builtWith: ArchElement[] } {
  const gone = new Set([id, ...[...ws.elements.keys()].filter((e) => isInside(ws, e, id))]);
  return {
    inside: [...gone].filter((e) => e !== id).map((e) => ws.elements.get(e)!),
    views: [...ws.views.values()].filter((v) => v.scope !== undefined && gone.has(v.scope)),
    affected: [...ws.elements.values()].filter((e) => !gone.has(e.id) && e.uses.some((r) => gone.has(r.to))),
    builtWith: ws.elements.get(id)?.kind === "library" ? builtInto(ws, id).filter((c) => !gone.has(c.id)) : [],
  };
}

/** Whether a view can draw this element as its own box: it does when the view would draw it as itself, as show-in-view checks. */
function canShowAsBox(ws: Workspace, view: ViewDef, element: ArchElement): boolean {
  return representative(ws, view)(element.id) === element.id;
}

/**
 * What the open view can do with an element: hide its box, show it as a box, or neither,
 * as for the frame around the view or an element the view can't draw. `computed` is the
 * view as drawn, or null when it can't be drawn, which can't show or hide anything.
 */
export function viewAction(ws: Workspace, view: ViewDef | null, computed: ComputedView | null, id: string): "show" | "hide" | null {
  const element = ws.elements.get(id);
  // A sequence view shows the elements in its steps, a state view its states, a deployment view what its nodes run, and an event view its cards, so they have nothing to show or hide.
  if (!view || !computed || !element || view.level === "sequence" || view.level === "state" || view.level === "deployment" || view.level === "event" || computed.boundary?.id === id) return null;
  if (computed.nodes.some((n) => n.id === id)) return "hide";
  return canShowAsBox(ws, view, element) ? "show" : null;
}

/**
 * Whether an arrow is the one between these boxes, of this kind: one that goes both ways is, from
 * either end. Only a class view has arrows of kinds other than association, the default, and draws
 * one for each kind of relationship between two boxes.
 */
export function isArrow(edge: { from: string; to: string; bidirectional: boolean; kind: RelationshipKind }, from: string, to: string, relation: RelationshipKind = "association"): boolean {
  if (edge.kind !== relation) return false;
  return (edge.from === from && edge.to === to) || (edge.bidirectional && edge.from === to && edge.to === from);
}

/** The arrow between these boxes, of this kind, if the view draws one. */
export function findArrow(computed: ComputedView | null, from: string, to: string, relation?: RelationshipKind) {
  return computed?.edges.find((e) => isArrow(e, from, to, relation));
}

/** What an arrow's selection says about its kind: nothing for an association, which most are, so their selections stay as they were. */
export function arrowRelation(edge: { kind: RelationshipKind }): { relation?: RelationshipKind } {
  return edge.kind === "association" ? {} : { relation: edge.kind };
}

/**
 * The relationships an arrow draws, in the order its details list them, each with the element it's
 * on and how operations name it: none when the view doesn't draw the arrow.
 */
export function arrowRelationships(
  ws: Workspace,
  computed: ComputedView | null,
  from: string,
  to: string,
  relation?: RelationshipKind,
): { element: ArchElement; rel: Relationship; ref: ReturnType<typeof relationshipRef> }[] {
  const edge = findArrow(computed, from, to, relation);
  return (edge?.sources ?? []).flatMap(({ element, index }) => {
    const source = ws.elements.get(element);
    const rel = source?.uses[index];
    return source && rel ? [{ element: source, rel, ref: relationshipRef(source, index) }] : [];
  });
}

/** A relationship drawn by an arrow, as its right-click menu names it, and the edit that removes it. */
export interface ArrowRemoval {
  /** "From → To", or "From ↔ To" when it goes both ways. */
  ends: string;
  /** `ends`, then its description and technology, numbered when that alone would read the same as another. */
  label: string;
  ops: Operation[];
}

/**
 * What an arrow's right-click menu can remove: each relationship it draws, in the order its
 * details list them. Each label says which relationship it removes: its technology tells apart
 * ones with the same description, or none, and a number those that would still read the same.
 */
export function arrowRemovals(ws: Workspace, computed: ComputedView | null, from: string, to: string, relation?: RelationshipKind): ArrowRemoval[] {
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  const items = arrowRelationships(ws, computed, from, to, relation).map(({ element, rel, ref }) => {
    const ends = `${element.name} ${rel.bidirectional ? "↔" : "→"} ${name(rel.to)}`;
    const detail = rel.description && rel.technology ? `${rel.description} [${rel.technology}]` : (rel.description ?? rel.technology);
    return { ends, label: detail ? `${ends}: ${detail}` : ends, ops: [{ op: "remove-relationship", ...ref } as Operation] };
  });
  const count = new Map<string, number>();
  for (const item of items) count.set(item.label, (count.get(item.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return items.map((item) => {
    if (count.get(item.label)! < 2) return item;
    const n = (seen.get(item.label) ?? 0) + 1;
    seen.set(item.label, n);
    return { ...item, label: `${item.label} (${n})` };
  });
}

/**
 * What deleting a selected arrow removes: the relationships that join exactly its two boxes, in
 * either direction when it goes both ways. None for an implied arrow, whose relationships are on
 * what's inside the boxes, or one the view doesn't draw. The last go first, so earlier ones keep
 * their place.
 */
export function arrowDeleteOps(ws: Workspace, computed: ComputedView | null, from: string, to: string, relation?: RelationshipKind): Operation[] {
  const edge = findArrow(computed, from, to, relation);
  if (!edge || edge.implied) return [];
  const joins = (s: { element: string; index: number }, a: string, b: string) => s.element === a && ws.elements.get(s.element)?.uses[s.index]?.to === b;
  return edge.sources
    .filter((s) => joins(s, edge.from, edge.to) || (edge.bidirectional && joins(s, edge.to, edge.from)))
    .sort((a, b) => b.index - a.index)
    .map((s) => ({ op: "remove-relationship", ...relationshipRef(ws.elements.get(s.element)!, s.index) }));
}

export interface Usages {
  /** Relationships to the element or to something inside it, each with an arrow that draws it, if any view does. */
  relationships: { from: ArchElement; rel: Relationship; arrow?: { view: string; from: string; to: string; relation?: RelationshipKind } }[];
  /** Views that draw the element, as a box, as the frame around the view, or running in a deployment view's nodes, by title. */
  views: ElementDescription["views"];
}

/** What refers to an element, for "Find usages". Arrows are looked for in `preferView` first. */
export function findUsages(ws: Workspace, id: string, preferView?: string): Usages | undefined {
  const d = describeElement(ws, id);
  if (!d) return undefined;
  const computed = computeAllViews(ws).sort((a, b) => Number(b.view.id === preferView) - Number(a.view.id === preferView));
  const arrowFor = (from: string, index: number) => {
    for (const cv of computed) {
      const edge = cv.edges.find((e) => e.sources.some((s) => s.element === from && s.index === index));
      if (edge) return { view: cv.view.id, from: edge.from, to: edge.to, ...arrowRelation(edge) };
    }
    return undefined;
  };
  return {
    relationships: [...d.usedBy, ...d.contentsUsedBy].map(({ from, rel }) => ({ from, rel, arrow: arrowFor(from.id, rel.index) })),
    views: d.views.sort((a, b) => a.view.title.localeCompare(b.view.title)),
  };
}

/** Boxes and sticky notes on a view's diagram: the IDs of the elements the boxes are for, and of the notes. */
export interface Shapes {
  elements: string[];
  stickies: string[];
}

/** The boxes and notes a selection picks, of the diagram's `boxes`: the frame round a view isn't one of them. */
export function selectedShapes(selection: Selection, boxes: ReadonlySet<string>): Shapes {
  if (selection?.kind === "several") return { elements: selection.elements.filter((id) => boxes.has(id)), stickies: selection.stickies };
  if (selection?.kind === "element" && boxes.has(selection.id)) return { elements: [selection.id], stickies: [] };
  if (selection?.kind === "sticky") return { elements: [], stickies: [selection.id] };
  return { elements: [], stickies: [] };
}

/** Selecting these boxes and notes: one on its own is selected as it would be by a click, and none is nothing. */
export function selectShapes({ elements, stickies }: Shapes): Selection {
  if (elements.length + stickies.length > 1) return { kind: "several", elements, stickies };
  if (elements.length === 1) return { kind: "element", id: elements[0]! };
  if (stickies.length === 1) return { kind: "sticky", id: stickies[0]! };
  return null;
}

/** Whether two lists of shapes have the same boxes and notes, in any order. */
export function sameShapes(a: Shapes, b: Shapes): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((id) => y.includes(id));
  return same(a.elements, b.elements) && same(a.stickies, b.stickies);
}

/** The selection with a box or note added, or taken out when it's in already, as a Ctrl-click does. */
export function toggleShape(selection: Selection, boxes: ReadonlySet<string>, shape: { kind: "element" | "sticky"; id: string }): Selection {
  const { elements, stickies } = selectedShapes(selection, boxes);
  const toggle = (ids: string[]) => (ids.includes(shape.id) ? ids.filter((id) => id !== shape.id) : [...ids, shape.id]);
  return selectShapes(shape.kind === "element" ? { elements: toggle(elements), stickies } : { elements, stickies: toggle(stickies) });
}

/** What the details panel shows. */
export type Shown =
  | { kind: "element"; element: ArchElement }
  | { kind: "arrow"; from: string; to: string; relation?: RelationshipKind }
  | { kind: "sticky"; view: ViewDef; sticky: Sticky }
  | { kind: "step"; view: ViewDef; step: Step }
  | { kind: "state"; view: ViewDef; state: State }
  | { kind: "transition"; view: ViewDef; transition: Transition }
  | { kind: "node"; view: ViewDef; node: DeploymentNode }
  | { kind: "connection"; view: ViewDef; connection: Connection }
  | { kind: "instance"; view: ViewDef; node: DeploymentNode; element: ArchElement }
  | { kind: "lane"; view: ViewDef; lane: Lane }
  | { kind: "card"; view: ViewDef; card: Card }
  | { kind: "cardArrow"; view: ViewDef; from: Card; to: Card }
  | { kind: "several"; view: ViewDef; elements: ArchElement[]; stickies: Sticky[] }
  | { kind: "view"; view: ViewDef }
  | { kind: "workspace" };

/** What the panel shows: the selection while it's still there, else the open view, or the workspace when none is open. */
export function shownInProperties(ws: Workspace, view: ViewDef | null, selection: Selection): Shown {
  if (selection?.kind === "several") {
    const elements = selection.elements.flatMap((id) => ws.elements.get(id) ?? []);
    const stickies = selection.stickies.flatMap((id) => view?.stickies.find((s) => s.id === id) ?? []);
    if (view && elements.length + stickies.length > 1) return { kind: "several", view, elements, stickies };
    // What's left of it, if only one is.
    return shownInProperties(ws, view, selectShapes({ elements: elements.map((e) => e.id), stickies: stickies.map((s) => s.id) }));
  }
  const element = selection?.kind === "element" ? ws.elements.get(selection.id) : undefined;
  if (element) return { kind: "element", element };
  if (selection?.kind === "arrow") return selection;
  const sticky = selection?.kind === "sticky" ? view?.stickies.find((s) => s.id === selection.id) : undefined;
  if (view && sticky) return { kind: "sticky", view, sticky };
  const step = selection?.kind === "step" ? view?.steps[selection.number - 1] : undefined;
  if (view && step) return { kind: "step", view, step };
  const state = selection?.kind === "state" ? view?.states.find((s) => s.id === selection.id) : undefined;
  if (view && state) return { kind: "state", view, state };
  const transition = selection?.kind === "transition" ? view?.transitions[selection.number - 1] : undefined;
  if (view && transition) return { kind: "transition", view, transition };
  const node = selection?.kind === "node" || selection?.kind === "instance" ? view?.nodes.find((n) => n.id === (selection.kind === "node" ? selection.id : selection.node)) : undefined;
  if (view && node && selection?.kind === "node") return { kind: "node", view, node };
  const runs = selection?.kind === "instance" && node?.runs.includes(selection.element) ? ws.elements.get(selection.element) : undefined;
  if (view && node && runs) return { kind: "instance", view, node, element: runs };
  const connection = selection?.kind === "connection" ? view?.connections[selection.number - 1] : undefined;
  if (view && connection) return { kind: "connection", view, connection };
  const lane = selection?.kind === "lane" ? view?.lanes.find((l) => l.id === selection.id) : undefined;
  if (view && lane) return { kind: "lane", view, lane };
  const card = selection?.kind === "card" ? view?.cards.find((c) => c.id === selection.id) : undefined;
  if (view && card) return { kind: "card", view, card };
  if (view && selection?.kind === "cardArrow") {
    const [from, to] = [view.cards.find((c) => c.id === selection.from), view.cards.find((c) => c.id === selection.to)];
    if (from && to?.from.includes(from.id)) return { kind: "cardArrow", view, from, to };
  }
  return selection?.kind === "workspace" || !view ? { kind: "workspace" } : { kind: "view", view };
}

export type Rename = Extract<Operation, { op: "rename" }>;

/** The renames in a batch of operations, in order. */
export function renamesIn(ops: Operation[]): Rename[] {
  return ops.flatMap((op) => (op.op === "rename" ? [op] : []));
}

/** An ID after these renames, applied in order. */
export function renamedId(renames: Rename[], id: string): string {
  return renames.reduce((current, r) => (current === r.id ? r.to : current), id);
}

/** A selection with the element IDs in it renamed by `to`, or the same one when they don't change. Sticky notes' IDs are left as they are. */
export function renamedSelection<S extends Selection>(selection: S, to: (id: string) => string): S {
  if (selection?.kind === "element" && to(selection.id) !== selection.id) return { ...selection, id: to(selection.id) };
  if (selection?.kind === "arrow" && (to(selection.from) !== selection.from || to(selection.to) !== selection.to)) return { ...selection, from: to(selection.from), to: to(selection.to) };
  if (selection?.kind === "several" && selection.elements.some((id) => to(id) !== id)) return { ...selection, elements: selection.elements.map(to) };
  if (selection?.kind === "instance" && to(selection.element) !== selection.element) return { ...selection, element: to(selection.element) };
  return selection;
}

/** The renames that take these back, last first: what undoing an edit that made them does. */
export function undoRenames(renames: Rename[]): Rename[] {
  return [...renames].reverse().map((r) => ({ op: "rename", id: r.to, to: r.id }));
}

/** Data as text with its keys in order, so two copies compare equal whatever order they were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The renames that took `before` to `after`, worked out from the two, for a change that didn't
 * say: a file reloaded after an agent or the CLI changed it, or an earlier version restored. An
 * ID that went is renamed to one that came when they're the same kind of thing and match in
 * everything but their name or title, with the IDs they refer to followed, and where the boxes
 * stood in each view. When an ID could have gone to more than one, it's left out, as if deleted.
 */
export function renamesBetween(before: Workspace, after: Workspace): Rename[] {
  const renames: Rename[] = [];
  const follow = (id: string) => renamedId(renames, id);
  const { elements: was, views: wasViews } = before.doc;
  const { elements: is, views: isViews } = after.doc;
  const placed = (views: Record<string, ViewData>, id: string) => Object.values(views).flatMap((v) => (v.layout && Object.hasOwn(v.layout, id) ? [canonical(v.layout[id])] : [])).sort();
  /** The keys of `a` that `b` doesn't have. */
  const only = (a: object, b: object) => Object.keys(a).filter((id) => !Object.hasOwn(b, id));

  /** What an element is, apart from its ID and name, in the IDs of `after`. */
  const element = ({ name: _, ...e }: ElementData, at: string[], to: (id: string) => string) =>
    canonical({ ...e, parent: e.parent && to(e.parent), libraries: e.libraries?.map(to).sort(), uses: e.uses?.map((r) => ({ ...r, to: to(r.to) })), at });
  /** What a view is, apart from its ID and title, in the IDs of `after`. */
  const view = ({ title: _, ...v }: ViewData, to: (id: string) => string) =>
    canonical({
      ...v,
      scope: v.scope && to(v.scope),
      include: v.include?.map(to),
      exclude: v.exclude?.map(to),
      layout: v.layout && Object.fromEntries(Object.entries(v.layout).map(([id, at]) => [to(id), at])),
      steps: v.steps?.map((step) => ({ ...step, from: to(step.from), to: to(step.to) })),
      nodes: v.nodes && Object.fromEntries(Object.entries(v.nodes).map(([id, n]) => [id, { ...n, runs: n.runs?.map(to) }])),
      connections: v.connections?.map((c) => ({ ...c, from: Object.hasOwn(v.nodes ?? {}, c.from) ? c.from : to(c.from), to: Object.hasOwn(v.nodes ?? {}, c.to) ? c.to : to(c.to) })),
    });

  /**
   * Pairs IDs that went with ones that came, a round at a time: a container matches once its
   * system's rename is known. `same(gone, came)` says whether they match, with `gone` renamed.
   */
  const pair = (gone: string[], came: string[], same: (gone: string, came: string) => boolean) => {
    for (let found = true; found; ) {
      found = false;
      const paired = new Set(renames.flatMap((r) => [r.id, r.to]));
      const left = came.filter((id) => !paired.has(id));
      const matches = new Map(gone.filter((id) => !paired.has(id)).map((id) => [id, left.filter((to) => same(id, to))]));
      for (const [id, [to, ...others]] of matches) {
        if (!to || others.length > 0) continue;
        // Two that went could each be the one that came.
        if ([...matches.values()].filter((m) => m.includes(to)).length > 1) continue;
        renames.push({ op: "rename", id, to });
        found = true;
      }
    }
  };

  pair(only(was, is), only(is, was), (id, to) => element(was[id]!, placed(wasViews, id), (x) => (x === id ? to : follow(x))) === element(is[to]!, placed(isViews, to), (x) => x));
  pair(only(wasViews, isViews), only(isViews, wasViews), (id, to) => view(wasViews[id]!, follow) === view(isViews[to]!, (x) => x));
  return renames;
}

/**
 * Operations made with the IDs as they were, moved to the IDs these later renames gave them.
 * New IDs (an element or view being added, a rename's target) and sticky note IDs, which are
 * their own, stay as they are. A rename that they have already made is dropped.
 */
export function followRenames(ops: Operation[], renames: Rename[]): Operation[] {
  if (renames.length === 0) return ops;
  const follow = (id: string) => renamedId(renames, id);
  const lists = (op: { include?: string[]; exclude?: string[] }) => ({
    ...(op.include && { include: op.include.map(follow) }),
    ...(op.exclude && { exclude: op.exclude.map(follow) }),
  });
  const followed = ops.map((op): Operation => {
    switch (op.op) {
      case "add-element":
        return { ...op, ...(op.parent && { parent: follow(op.parent) }), ...(op.libraries && { libraries: op.libraries.map(follow) }) };
      case "update-element":
        return { ...op, id: follow(op.id), ...(op.parent && { parent: follow(op.parent) }), ...(op.libraries && { libraries: op.libraries.map(follow) }) };
      case "remove-element":
      case "remove-view":
      case "rename":
        return { ...op, id: follow(op.id) };
      case "add-relationship":
      case "remove-relationship":
        return { ...op, from: follow(op.from), to: follow(op.to) };
      case "update-relationship":
        return { ...op, from: follow(op.from), to: follow(op.to), ...(op.newFrom && { newFrom: follow(op.newFrom) }), ...(op.newTo && { newTo: follow(op.newTo) }) };
      case "add-view":
        return { ...op, ...(op.scope && { scope: follow(op.scope) }), ...lists(op) };
      case "update-view":
        return { ...op, id: follow(op.id), ...lists(op) };
      case "show-in-view":
      case "hide-in-view":
        return { ...op, view: follow(op.view), id: follow(op.id) };
      case "set-layout":
        return { ...op, view: follow(op.view), positions: Object.fromEntries(Object.entries(op.positions).map(([id, at]) => [follow(id), at])) };
      case "add-sticky":
      case "update-sticky":
      case "remove-sticky":
      case "remove-step":
      // A state's ID, and the ends of its transitions, are its view's own.
      case "add-state":
      case "update-state":
      case "remove-state":
      case "add-transition":
      case "update-transition":
      case "remove-transition":
      // So are an event view's lanes and cards.
      case "add-lane":
      case "update-lane":
      case "remove-lane":
      case "add-card":
      case "update-card":
      case "remove-card":
        return { ...op, view: follow(op.view) };
      case "add-step":
        return { ...op, view: follow(op.view), from: follow(op.from), to: follow(op.to) };
      // A node's ID is its view's own; what it runs, and a connection's ends when they aren't nodes, are elements.
      case "add-node":
      case "update-node":
        return { ...op, view: follow(op.view), ...(op.runs && { runs: op.runs.map(follow) }) };
      case "remove-node":
      case "remove-connection":
        return { ...op, view: follow(op.view) };
      case "add-connection":
        return { ...op, view: follow(op.view), from: follow(op.from), to: follow(op.to) };
      case "update-connection":
        return { ...op, view: follow(op.view), ...(op.from && { from: follow(op.from) }), ...(op.to && { to: follow(op.to) }) };
      case "update-step":
        return { ...op, view: follow(op.view), ...(op.from && { from: follow(op.from) }), ...(op.to && { to: follow(op.to) }) };
      case "update-workspace":
        return op;
    }
  });
  // A name saved twice before the first save landed asks for the same rename twice.
  return followed.filter((op) => op.op !== "rename" || op.id !== op.to);
}
