/** Small questions about the model that the designer's UI asks. */
import {
  allWidgets,
  builtInto,
  computeAllViews,
  computeView,
  describeElement,
  isInside,
  kindLabel,
  LEVEL_TITLE,
  nodeKindLabel,
  representative,
  RUNNABLE_KINDS,
  SCOPE_KINDS,
  stickyAnchor,
  STICKY_TARGET_LEVELS,
  VIEW_LEVELS,
  WIDGET_KIND_LABELS,
  type ArchElement,
  type Arrow,
  type ArrowHeads,
  type Attribute,
  type Block,
  type Card,
  type ComputedView,
  type Connection,
  type DeploymentNode,
  type ElementData,
  type ElementKind,
  type ElementDescription,
  type Entity,
  type EntityLink,
  type Flow,
  type Lane,
  type Operation,
  type Screen,
  type Shape,
  type Relationship,
  type RelationshipKind,
  type State,
  type Step,
  type Sticky,
  type StickyTargetData,
  type Transition,
  type ViewData,
  type ViewDef,
  type ViewLevel,
  type Widget,
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

/** `base`, or `base-2`, `base-3`, ... whichever isn't among `ids`, `self` aside: for an ID unique among an event view's lanes, or its cards, a wireframe view's screens, or its widgets, or a whiteboard's shapes and arrows. */
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

/**
 * What has notes: an element, a relationship, a view or a sticky note on a view. A relationship
 * is named as operations name one, by its place among the element's relationships to the same
 * target. An edit elsewhere can put another relationship in that place, so `look` is how those
 * relationships looked once the notes editor knew which one it's on (see notesOwnerAsIs). Once
 * they look different, it's taken as gone, rather than saving over another relationship's
 * notes. `look` is null when the editor lost track of which one it's on before it knew.
 */
export type NotesOwner =
  | { kind: "element"; id: string }
  | { kind: "relationship"; from: string; to: string; index: number; look?: string | null }
  | { kind: "view"; id: string }
  | { kind: "sticky"; view: string; id: string };

/** An element's relationships to a target. */
const relationshipsTo = (ws: Workspace, from: string, to: string) => ws.elements.get(from)?.uses.filter((r) => r.to === to) ?? [];

/**
 * How an element's relationships to a target look, but for their notes. Their places in the
 * element's whole list, and the target's ID, which a rename changes, are left out too.
 */
function relationshipsLook(ws: Workspace, from: string, to: string): string {
  return JSON.stringify(relationshipsTo(ws, from, to).map(({ to: _to, notes: _notes, index: _index, ...rest }) => rest));
}

/**
 * Where an element's relationships to a target are in its whole list. It changes when one of
 * them is added, moved to another target or deleted, when one is moved in, and when one before
 * them in the list is deleted, but not when one is edited, as by its description.
 */
export function relationshipsPlace(ws: Workspace, owner: NotesOwner): string | undefined {
  return owner.kind === "relationship" ? JSON.stringify(relationshipsTo(ws, owner.from, owner.to).map((r) => r.index)) : undefined;
}

/**
 * The owner as it is now: a relationship with how its element's relationships to the same target
 * look. Given where they were (`place`, from relationshipsPlace) when the notes were opened, it
 * loses track of the relationship if they've moved since, as another may be in its place.
 */
export function notesOwnerAsIs(ws: Workspace, owner: NotesOwner, place?: string): NotesOwner {
  if (owner.kind !== "relationship") return owner;
  const moved = place !== undefined && relationshipsPlace(ws, owner) !== place;
  return { ...owner, look: moved ? null : relationshipsLook(ws, owner.from, owner.to) };
}

/** The relationship the owner names, if it's still there and nothing has taken its place. */
function relationshipAt(ws: Workspace, owner: Extract<NotesOwner, { kind: "relationship" }>): Relationship | undefined {
  if (owner.look === null || (owner.look !== undefined && relationshipsLook(ws, owner.from, owner.to) !== owner.look)) return undefined;
  return relationshipsTo(ws, owner.from, owner.to)[owner.index];
}

/**
 * The notes it has now, "" when it has none, or undefined when it's no longer in the model. A
 * relationship whose element's relationships to the same target changed since its `look` counts
 * as no longer there.
 */
export function notesOf(ws: Workspace, owner: NotesOwner): string | undefined {
  const found =
    owner.kind === "view"
      ? ws.views.get(owner.id)
      : owner.kind === "element"
        ? ws.elements.get(owner.id)
        : owner.kind === "sticky"
          ? ws.views.get(owner.view)?.stickies.find((s) => s.id === owner.id)
          : relationshipAt(ws, owner);
  return found && (found.notes ?? "");
}

/** The same owner after renames: `to` gives an element's or view's new ID. A sticky note's ID stays as it is, but its view's follows. */
export function renamedNotesOwner(owner: NotesOwner, to: (id: string) => string): NotesOwner {
  if (owner.kind === "relationship") return { ...owner, from: to(owner.from), to: to(owner.to) };
  if (owner.kind === "sticky") return { ...owner, view: to(owner.view) };
  return { ...owner, id: to(owner.id) };
}

/** The edit that gives it these notes. Empty notes are taken off. */
export function notesOp(owner: NotesOwner, text: string): Operation {
  const notes = text || null;
  if (owner.kind === "view") return { op: "update-view", id: owner.id, notes };
  if (owner.kind === "element") return { op: "update-element", id: owner.id, notes };
  if (owner.kind === "sticky") return { op: "update-sticky", view: owner.view, id: owner.id, notes };
  return { op: "update-relationship", from: owner.from, to: owner.to, index: owner.index, notes };
}

/** A sticky note's text, as the notes editor names it: its first line, in quotes, cut short when it's long. */
export function stickyName(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  return `“${line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line}”`;
}

/** What the notes editor calls it: an element's name, a view's title, a relationship's two ends, or a sticky note's text. */
export function notesName(ws: Workspace, owner: NotesOwner): string {
  if (owner.kind === "view") return ws.views.get(owner.id)?.title ?? owner.id;
  if (owner.kind === "sticky") {
    const sticky = ws.views.get(owner.view)?.stickies.find((s) => s.id === owner.id);
    return sticky ? stickyName(sticky.text) : owner.id;
  }
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  if (owner.kind === "element") return name(owner.id);
  return `${name(owner.from)} ${relationshipAt(ws, owner)?.bidirectional ? "↔" : "→"} ${name(owner.to)}`;
}

/**
 * The edit that builds a container with a library, or takes it out, from the container's libraries
 * as `ws` has them: the workspace when the edit runs, so that a change to them made just before
 * isn't lost. Nothing when the container isn't there, or it's already so.
 */
export function buildOps(ws: Workspace, container: string, library: string, built: boolean): Operation[] {
  const c = ws.elements.get(container);
  if (c?.kind !== "container" || c.libraries.includes(library) === built) return [];
  return [{ op: "update-element", id: c.id, libraries: built ? [...c.libraries, library] : c.libraries.filter((l) => l !== library) }];
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

/** The operation that adds a view, with an ID made from its title that no element or view has yet. */
export function addViewOp(ws: Workspace, level: ViewLevel, scope: string | undefined, title: string): Extract<Operation, { op: "add-view" }> {
  return { op: "add-view", id: uniqueId(ws, idFromName(title) || "view"), level, scope, title };
}

/** The label of the field that picks what a state, wireframe, flowchart or entity view is of, in the New view dialog and the view's details. */
export const SCOPE_LABELS: Partial<Record<ViewLevel, string>> = { state: "The states of", wireframe: "The screens of", flowchart: "The process of", entity: "The data of" };

/** What a view of each level is called in a menu. */
export const LEVEL_NAMES: Record<ViewLevel, string> = {
  landscape: "Landscape view",
  context: "Context view",
  container: "Container view",
  component: "Component view",
  class: "Class view",
  sequence: "Sequence view",
  state: "State view",
  deployment: "Deployment view",
  event: "Event view",
  wireframe: "Wireframe view",
  whiteboard: "Whiteboard view",
  flowchart: "Flowchart view",
  entity: "Entity view",
};

/**
 * The levels of view that can be of this element, in the New view dialog's order: a container
 * view of a system, a component view of a container, a class view of a component, and so on.
 */
export function viewLevelsOf(element: ArchElement): ViewLevel[] {
  return VIEW_LEVELS.filter((level) => SCOPE_KINDS[level].includes(element.kind));
}

/** The operation that adds a view of this level of an element, titled as the New view dialog titles it: "Orders API components". */
export function newViewOf(ws: Workspace, element: ArchElement, level: ViewLevel): Extract<Operation, { op: "add-view" }> {
  return addViewOp(ws, level, element.id, `${element.name} ${LEVEL_TITLE[level]}`);
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
  // A sequence view shows the elements in its steps, a state view its states, a deployment view what its nodes run, an event view its cards, a wireframe view its screens, a whiteboard its shapes, a flowchart its blocks and an entity view its entities, so they have nothing to show or hide.
  if (
    !view ||
    !computed ||
    !element ||
    view.level === "sequence" ||
    view.level === "state" ||
    view.level === "deployment" ||
    view.level === "event" ||
    view.level === "wireframe" ||
    view.level === "whiteboard" ||
    view.level === "flowchart" ||
    view.level === "entity" ||
    computed.boundary?.id === id
  )
    return null;
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

/** The edit that removes the arrow from one card of an event view to another: none when there isn't one. */
export function cardArrowDeleteOps(view: ViewDef, from: string, to: string): Operation[] {
  const card = view.cards.find((c) => c.id === to);
  if (!card?.from.includes(from)) return [];
  return [{ op: "update-card", view: view.id, id: card.id, from: card.from.filter((id) => id !== from) }];
}

/**
 * The edit that deletes what's selected on an event view: a lane, whose cards stay, in no lane; a
 * card, with its arrows; or the arrow from one card to another. None for any other selection.
 */
export function eventDeleteOps(view: ViewDef, selection: Selection): Operation[] {
  if (selection?.kind === "lane") return [{ op: "remove-lane", view: view.id, id: selection.id }];
  if (selection?.kind === "card") return [{ op: "remove-card", view: view.id, id: selection.id }];
  if (selection?.kind === "cardArrow") return cardArrowDeleteOps(view, selection.from, selection.to);
  return [];
}

/** Whether a selected lane, card or arrow between cards is no longer in the view, as after an Undo or a change to the file. */
export function eventSelectionGone(view: ViewDef | undefined, selection: Selection): boolean {
  if (selection?.kind === "lane") return !view?.lanes.some((l) => l.id === selection.id);
  if (selection?.kind === "card") return !view?.cards.some((c) => c.id === selection.id);
  if (selection?.kind === "cardArrow") return !view?.cards.some((c) => c.id === selection.to && c.from.includes(selection.from));
  return false;
}

/** The edit that deletes what's selected on a wireframe view: a screen, with what's on it, or a widget, with what's inside it. None for any other selection. */
export function wireframeDeleteOps(view: ViewDef, selection: Selection): Operation[] {
  if (selection?.kind === "screen") return [{ op: "remove-screen", view: view.id, id: selection.id }];
  if (selection?.kind === "widget") return [{ op: "remove-widget", view: view.id, id: selection.id }];
  return [];
}

/** Whether a selected screen or widget is no longer in the view, as after an Undo or a change to the file. */
export function wireframeSelectionGone(view: ViewDef | undefined, selection: Selection): boolean {
  if (selection?.kind === "screen") return !view?.screens.some((s) => s.id === selection.id);
  if (selection?.kind === "widget") return !view || !allWidgets(view).some((w) => w.id === selection.id);
  return false;
}

/** What's on a whiteboard that's selected together: its shapes, its arrows and its sticky notes. */
export interface BoardItems {
  shapes: string[];
  arrows: string[];
  stickies: string[];
}

/** The selection of these shapes, arrows and notes: one of them on its own, two or more together, or nothing. */
export function selectBoard({ shapes, arrows, stickies }: BoardItems): Selection {
  if (shapes.length + arrows.length + stickies.length > 1) return { kind: "board", shapes, arrows, stickies };
  if (shapes.length === 1) return { kind: "shape", id: shapes[0]! };
  if (arrows.length === 1) return { kind: "boardArrow", id: arrows[0]! };
  if (stickies.length === 1) return { kind: "sticky", id: stickies[0]! };
  return null;
}

/** What's on a whiteboard in a selection: the shape, arrow or note selected, or those selected together. */
export function boardItemsOf(selection: Selection): BoardItems {
  if (selection?.kind === "board") return selection;
  return {
    shapes: selection?.kind === "shape" ? [selection.id] : [],
    arrows: selection?.kind === "boardArrow" ? [selection.id] : [],
    stickies: selection?.kind === "sticky" ? [selection.id] : [],
  };
}

/**
 * The edit that deletes what's selected on a whiteboard view: shapes, with the arrows to and from
 * them, arrows and sticky notes. The arrows go first, as removing a shape takes the arrows to it
 * with it. None for any other selection.
 */
export function whiteboardDeleteOps(view: ViewDef, selection: Selection): Operation[] {
  if (view.level !== "whiteboard" || (selection?.kind !== "shape" && selection?.kind !== "boardArrow" && selection?.kind !== "board")) return [];
  const { shapes, arrows, stickies } = boardItemsOf(selection);
  return [
    ...arrows.filter((id) => view.arrows.some((a) => a.id === id)).map((id): Operation => ({ op: "remove-arrow", view: view.id, id })),
    ...shapes.filter((id) => view.shapes.some((s) => s.id === id)).map((id): Operation => ({ op: "remove-shape", view: view.id, id })),
    ...stickies.filter((id) => view.stickies.some((s) => s.id === id)).map((id): Operation => ({ op: "remove-sticky", view: view.id, id })),
  ];
}

/**
 * A whiteboard selection with what's no longer on the view left out, as after an Undo or a change
 * to the file: the same one when it's all still there.
 */
export function whiteboardSelectionLeft(view: ViewDef | undefined, selection: Selection): Selection {
  if (selection?.kind !== "shape" && selection?.kind !== "boardArrow" && selection?.kind !== "board") return selection;
  const items = boardItemsOf(selection);
  const left = {
    shapes: items.shapes.filter((id) => view?.shapes.some((s) => s.id === id)),
    arrows: items.arrows.filter((id) => view?.arrows.some((a) => a.id === id)),
    stickies: items.stickies.filter((id) => view?.stickies.some((s) => s.id === id)),
  };
  const same = left.shapes.length === items.shapes.length && left.arrows.length === items.arrows.length && left.stickies.length === items.stickies.length;
  return same ? selection : selectBoard(left);
}

/** What + Add calls a flowchart's new lane, until it's named, or picks an element whose name it takes. */
export const NEW_LANE_NAME = "New lane";

/** A flowchart block's text on one line, as lists and menus name it. */
export function blockText(block: Pick<Block, "id" | "text">): string {
  return block.text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? block.id;
}

/** What each choice of heads for a whiteboard's arrow is called, where one is picked. */
export const HEADS_TEXT: Record<ArrowHeads, string> = { end: "Arrow: one way", both: "Arrow: both ways", none: "Line: no heads" };

/** The nodes of a deployment view, and the containers and systems they run, for picking a connection's end. */
export function connectionEnds(ws: Workspace, view: ViewDef): { id: string; label: string }[] {
  const run = [...new Set(view.nodes.flatMap((n) => n.runs))].flatMap((id) => ws.elements.get(id) ?? []).sort(byName);
  return [...view.nodes.map((n) => ({ id: n.id, label: `${n.name} [${nodeKindLabel(n)}]` })), ...run.map((e) => ({ id: e.id, label: `${e.name} [${kindLabel(e)}]` }))];
}

/** The edits a deployment view's menus offer: a node changed, or a connection added or changed. */
export type DeploymentOffer = Extract<Operation, { op: "update-node" | "add-connection" | "update-connection" }>;

/**
 * A deployment view as one of the edits its menus offer would leave it: a node moved inside
 * another or out to the top, told what it runs, or made infrastructure or not, and a connection
 * added at the end, or with an end moved. A node told what it runs takes the connections to
 * what no node runs any more, as update-node does, and the ones after are renumbered. Anything
 * else an operation says is left as it is.
 */
export function deploymentAfter(ws: Workspace, view: ViewDef, op: DeploymentOffer): ViewDef {
  if (op.op === "add-connection") {
    const number = view.connections.length + 1;
    return { ...view, connections: [...view.connections, { path: `${view.path}.connections[${number - 1}]`, number, from: op.from, to: op.to }] };
  }
  if (op.op === "update-connection") {
    return { ...view, connections: view.connections.map((c) => (c.number === op.connection ? { ...c, from: op.from ?? c.from, to: op.to ?? c.to } : c)) };
  }
  const change = (node: DeploymentNode): DeploymentNode => {
    const { parent, ...rest } = node;
    const inside = op.parent === undefined ? parent : (op.parent ?? undefined);
    return { ...rest, ...(inside !== undefined && { parent: inside }), runs: op.runs === undefined ? node.runs : runList(op.runs), infrastructure: op.infrastructure ?? node.infrastructure };
  };
  const nodes = view.nodes.map((n) => (n.id === op.id ? change(n) : n));
  if (op.runs === undefined) return { ...view, nodes };
  const run = new Set(nodes.flatMap((n) => n.runs));
  const loose = (end: string) => !nodes.some((n) => n.id === end) && ws.elements.has(end) && !run.has(end);
  const connections = view.connections.filter((c) => !loose(c.from) && !loose(c.to)).map((c, at) => ({ ...c, number: at + 1, path: `${view.path}.connections[${at}]` }));
  return { ...view, nodes, connections };
}

/**
 * Whether the operation's own rules let an edit a deployment view's menu offers be made, as
 * update-node, add-connection and update-connection check them. They look at what the edit
 * leaves, whatever was wrong before it: every thing a node is told to run, not only what's new,
 * and a node that's infrastructure, whichever of its fields the edit changes.
 */
function deploymentRules(ws: Workspace, view: ViewDef, op: DeploymentOffer): boolean {
  const node = (id: string) => view.nodes.find((n) => n.id === id);
  if (op.op !== "update-node") {
    const was = op.op === "update-connection" ? view.connections[op.connection - 1] : undefined;
    if (op.op === "update-connection" && !was) return false;
    const [from, to] = [op.from ?? was!.from, op.to ?? was!.to];
    // Each end is a node, or something one runs. Not something to itself, and not two elements, whose arrows are the model's.
    const run = new Set(view.nodes.flatMap((n) => n.runs));
    return [from, to].every((end) => node(end) || run.has(end)) && from !== to && !!(node(from) || node(to));
  }
  const changed = node(op.id);
  if (!changed) return false;
  // In update-node's order: where it is, what it runs, then what it is, each as the ones before leave it.
  let parent = changed.parent;
  if (op.parent === null) parent = undefined;
  else if (op.parent !== undefined && op.parent !== changed.parent) {
    // Inside a node that isn't infrastructure, and isn't itself or inside it.
    if (!node(op.parent) || node(op.parent)!.infrastructure) return false;
    for (let at: string | undefined = op.parent, steps = 0; at !== undefined && steps <= view.nodes.length; at = node(at)?.parent, steps++) if (at === op.id) return false;
    parent = op.parent;
  }
  // What it's told to run is all containers and systems of the model.
  const runs = op.runs === undefined ? changed.runs : runList(op.runs);
  if (op.runs !== undefined && !runs.every((id) => RUNNABLE_KINDS.includes(ws.elements.get(id)?.kind as ElementKind))) return false;
  // Infrastructure runs nothing and holds no nodes: not even itself, once it's been moved.
  const holds = view.nodes.some((n) => (n.id === op.id ? parent : n.parent) === op.id);
  return !((op.infrastructure ?? changed.infrastructure) && (runs.length > 0 || holds));
}

/** What a node is told to run, as update-node reads it: each ID trimmed, and once. */
function runList(runs: string[] | null): string[] {
  return [...new Set((runs ?? []).map((id) => id.trim()).filter(Boolean))];
}

/** The errors a view's own checks find in it, each by its rule and what it says, as an edit compares them. */
function viewErrors(ws: Workspace, view: ViewDef): string[] {
  return computeView(ws, view)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => `${d.rule}\u0000${d.message}`);
}

/**
 * The errors each view has as it stands, so a menu drawn again doesn't work them out again. They
 * depend on the model too, so this is right only because a view is made again with each
 * workspace: one view is never the view of two.
 */
const errorsNow = new WeakMap<ViewDef, string[]>();

/**
 * Whether a deployment view's menu can offer an edit: whether core would make it. Core refuses
 * one for the operation's own rules (see deploymentRules), or for leaving the workspace with an
 * error it didn't have. The second can refuse a move or a connection that looks fine, for
 * another connection: none can join a node and something inside it. So the view is checked as
 * the edit would leave it (see deploymentAfter), by the checks an edit runs, and its errors
 * compared as an edit compares them, by rule and message.
 *
 * Only this view is checked. These edits change nothing else, and every rule about a deployment
 * view's nodes and connections is the view's own. Asking core to try the whole edit would check
 * every view of the workspace, twice, for each thing a menu might offer.
 */
export function deploymentOffers(ws: Workspace, view: ViewDef, op: DeploymentOffer): boolean {
  if (!deploymentRules(ws, view, op)) return false;
  let had = errorsNow.get(view);
  if (!had) errorsNow.set(view, (had = viewErrors(ws, view)));
  const left = [...had];
  return viewErrors(ws, deploymentAfter(ws, view, op)).every((error) => {
    const at = left.indexOf(error);
    if (at >= 0) left.splice(at, 1);
    return at >= 0;
  });
}

/** A wireframe's widget as lists and menus name it: its kind, and its text's first line. */
export function widgetName(w: Pick<Widget, "kind" | "text">): string {
  const first = (w.text ?? "").split(/\r?\n/).find((l) => l.trim())?.trim();
  return first ? `${WIDGET_KIND_LABELS[w.kind]}: ${first}` : WIDGET_KIND_LABELS[w.kind];
}

/** "note", or "note-2", "note-3", ... whichever the view doesn't have yet. */
export function newStickyId(view: ViewDef): string {
  const taken = new Set(view.stickies.map((s) => s.id));
  if (!taken.has("note")) return "note";
  for (let i = 2; ; i++) if (!taken.has(`note-${i}`)) return `note-${i}`;
}

/**
 * What a sticky note can be on, from what's selected: the element of a box, or of the frame round
 * the view, or the first relationship an arrow stands for whose note would have its line to that
 * arrow. None on other views than those of boxes, for an element or arrow the view doesn't draw as
 * itself, or for an arrow whose every relationship is drawn first by another, as a library's can be.
 */
export function stickyTargetFor(ws: Workspace, computed: ComputedView | null, selection: Selection): StickyTargetData | undefined {
  if (!computed || !STICKY_TARGET_LEVELS.includes(computed.view.level)) return undefined;
  if (selection?.kind === "element") {
    // Its own box, or the frame: not the box of something it's inside.
    const anchor = stickyAnchor(ws, computed, { element: selection.id });
    return anchor?.kind === "frame" || (anchor?.kind === "box" && anchor.id === selection.id) ? { element: selection.id } : undefined;
  }
  if (selection?.kind !== "arrow") return undefined;
  const edge = findArrow(computed, selection.from, selection.to, selection.relation);
  // A library's relationship is drawn once for each container built with it, and a note on it
  // has its line to the first of those arrows: so the first relationship this one draws first.
  for (const source of edge?.sources ?? []) {
    const rel = ws.elements.get(source.element)?.uses[source.index];
    if (!rel) continue;
    const on: StickyTargetData = { from: source.element, to: rel.to, ...(rel.kind !== "association" && { kind: rel.kind }) };
    const anchor = stickyAnchor(ws, computed, { from: source.element, to: rel.to, kind: rel.kind });
    if (anchor?.kind === "arrow" && anchor.edge === edge) return on;
  }
  return undefined;
}

/** One thing a note can be put on, as the details panel lists it: `key` tells them apart. What it's on, when the view doesn't draw it, is in no group. */
export interface StickyChoice {
  key: string;
  label: string;
  group?: "Boxes" | "Arrows" | "Blocks";
  on: StickyTargetData;
}

/** A key for what a note is on, the same for a relationship's kind given or left out as an association. */
export function stickyKey(on: StickyTargetData): string {
  if ("block" in on) return `block:${on.block}`;
  return "element" in on ? `element:${on.element}` : `relationship:${on.from}\u0000${on.to}\u0000${on.kind ?? "association"}`;
}

/**
 * What a note on this view can be put on: its boxes and its frame, by name, then its arrows, each
 * as the relationship it stands for first, unless the note is on another of them already. On a
 * flowchart: its blocks, in their order. What the note is on is among them even when the view
 * doesn't draw it, so the list can show it.
 */
export function stickyChoices(ws: Workspace, computed: ComputedView, sticky: Sticky): StickyChoice[] {
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  const current = sticky.on && stickyAnchor(ws, computed, sticky.on);
  const choice = (on: StickyTargetData, label: string, group?: StickyChoice["group"]): StickyChoice => ({ key: stickyKey(on), label, group, on });
  /** What a note is on, as the list names it when the view doesn't draw it. */
  const named = (on: StickyTargetData) => ("block" in on ? on.block : "element" in on ? name(on.element) : `${name(on.from)} → ${name(on.to)}`);
  if (computed.view.level === "flowchart") {
    const blocks = computed.view.blocks.map((b) => choice({ block: b.id }, blockText(b), "Blocks"));
    if (sticky.on && !current) blocks.unshift(choice(sticky.on, `${named(sticky.on)} (not in this view)`));
    return blocks;
  }
  const boxes = [...computed.nodes, ...(computed.boundary ? [computed.boundary] : [])]
    .filter((e) => stickyAnchor(ws, computed, { element: e.id }))
    .sort(byName)
    .map((e) => choice({ element: e.id }, e.id === computed.boundary?.id ? `${e.name} (the frame)` : e.name, "Boxes"));
  const arrows = computed.edges.flatMap((edge) => {
    const label = `${name(edge.from)} ${edge.bidirectional ? "↔" : "→"} ${name(edge.to)}${edge.description ? `: ${edge.description}` : ""}`;
    if (current?.kind === "arrow" && current.edge === edge) return [choice(sticky.on!, label, "Arrows")];
    const on = stickyTargetFor(ws, computed, { kind: "arrow", from: edge.from, to: edge.to, ...arrowRelation(edge) });
    return on ? [choice(on, label, "Arrows")] : [];
  });
  const all = [...boxes, ...arrows];
  if (sticky.on && !all.some((c) => c.key === stickyKey(sticky.on!))) {
    const on = sticky.on;
    all.unshift(choice(on, current?.kind === "box" ? `${named(on)} (drawn as ${name(current.id)})` : `${named(on)} (not in this view)`));
  }
  return all;
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
  | { kind: "screen"; view: ViewDef; screen: Screen }
  | { kind: "widget"; view: ViewDef; widget: Widget }
  | { kind: "shape"; view: ViewDef; shape: Shape }
  | { kind: "boardArrow"; view: ViewDef; arrow: Arrow }
  | { kind: "board"; view: ViewDef; shapes: Shape[]; arrows: Arrow[]; stickies: Sticky[] }
  | { kind: "block"; view: ViewDef; block: Block }
  | { kind: "flow"; view: ViewDef; flow: Flow }
  | { kind: "entity"; view: ViewDef; entity: Entity }
  | { kind: "attribute"; view: ViewDef; entity: Entity; attribute: Attribute }
  | { kind: "link"; view: ViewDef; link: EntityLink }
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
  if (selection?.kind === "board" && view) {
    const left = whiteboardSelectionLeft(view, selection);
    if (left?.kind !== "board") return shownInProperties(ws, view, left);
    const shapes = view.shapes.filter((s) => left.shapes.includes(s.id));
    const arrows = view.arrows.filter((a) => left.arrows.includes(a.id));
    const stickies = view.stickies.filter((s) => left.stickies.includes(s.id));
    return { kind: "board", view, shapes, arrows, stickies };
  }
  const shape = selection?.kind === "shape" ? view?.shapes.find((s) => s.id === selection.id) : undefined;
  if (view && shape) return { kind: "shape", view, shape };
  const boardArrow = selection?.kind === "boardArrow" ? view?.arrows.find((a) => a.id === selection.id) : undefined;
  if (view && boardArrow) return { kind: "boardArrow", view, arrow: boardArrow };
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
  const screen = selection?.kind === "screen" ? view?.screens.find((s) => s.id === selection.id) : undefined;
  if (view && screen) return { kind: "screen", view, screen };
  const widget = selection?.kind === "widget" && view ? allWidgets(view).find((w) => w.id === selection.id) : undefined;
  if (view && widget) return { kind: "widget", view, widget };
  const block = selection?.kind === "block" ? view?.blocks.find((b) => b.id === selection.id) : undefined;
  if (view && block) return { kind: "block", view, block };
  const flow = selection?.kind === "flow" ? view?.flows[selection.number - 1] : undefined;
  if (view && flow) return { kind: "flow", view, flow };
  const entity = selection?.kind === "entity" || selection?.kind === "attribute" ? view?.entities.find((e) => e.id === (selection.kind === "entity" ? selection.id : selection.entity)) : undefined;
  if (view && entity && selection?.kind === "entity") return { kind: "entity", view, entity };
  const attribute = selection?.kind === "attribute" ? entity?.attributes.find((a) => a.name === selection.name) : undefined;
  if (view && entity && attribute) return { kind: "attribute", view, entity, attribute };
  const link = selection?.kind === "link" ? view?.links[selection.number - 1] : undefined;
  if (view && link) return { kind: "link", view, link };
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

/** What a note is on, with its IDs passed through `to`. A flowchart's block is its view's own, so it stays as it is. */
function followTarget(on: StickyTargetData, to: (id: string) => string): StickyTargetData {
  if ("block" in on) return on;
  return "element" in on ? { element: to(on.element) } : { ...on, from: to(on.from), to: to(on.to) };
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
      stickies: v.stickies && Object.fromEntries(Object.entries(v.stickies).map(([id, s]) => [id, { ...s, on: s.on && followTarget(s.on, to) }])),
      nodes: v.nodes && Object.fromEntries(Object.entries(v.nodes).map(([id, n]) => [id, { ...n, runs: n.runs?.map(to) }])),
      lanes: v.lanes?.map((l) => ({ ...l, element: l.element && to(l.element) })),
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
      // A note's ID is its view's own; what it's on is in the model.
      case "add-sticky":
      case "update-sticky":
        return { ...op, view: follow(op.view), ...(op.on && { on: followTarget(op.on, follow) }) };
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
      case "remove-lane":
      case "add-card":
      case "update-card":
      case "remove-card":
      // So are a wireframe view's screens and widgets.
      case "add-screen":
      case "update-screen":
      case "remove-screen":
      case "add-widget":
      case "update-widget":
      case "remove-widget":
      // So are a whiteboard's shapes and arrows.
      case "add-shape":
      case "update-shape":
      case "remove-shape":
      case "add-arrow":
      case "update-arrow":
      case "remove-arrow":
      // So are a flowchart's blocks and flows.
      case "add-block":
      case "update-block":
      case "remove-block":
      case "add-flow":
      case "update-flow":
      case "remove-flow":
      // So are an entity view's entities, their attributes and its links.
      case "add-entity":
      case "update-entity":
      case "remove-entity":
      case "add-attribute":
      case "update-attribute":
      case "remove-attribute":
      case "add-link":
      case "update-link":
      case "remove-link":
        return { ...op, view: follow(op.view) };
      case "add-step":
        return { ...op, view: follow(op.view), from: follow(op.from), to: follow(op.to) };
      // A lane's ID is its view's own; the element a flowchart's lane is for is an element.
      case "add-lane":
      case "update-lane":
        return { ...op, view: follow(op.view), ...(op.element && { element: follow(op.element) }) };
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
