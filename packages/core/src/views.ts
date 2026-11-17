/**
 * Working out what a view shows: which elements appear as boxes, and which
 * arrows connect them, including relationships implied by nested elements.
 * A sequence view shows the elements in its steps instead, and its steps in order.
 * A deployment view shows its nodes, the containers and systems running in them, and the
 * arrows between those copies.
 * An event view shows its cards in order, each in its lane, and the arrows between them.
 * A wireframe view shows its screens in order, each with its widgets, and arrows from the
 * widgets that lead to other screens.
 * A whiteboard view shows its shapes and arrows, each where it's put.
 * A flowchart view shows its blocks, each where it's put, and the flows between them.
 */
import type { Workspace } from "./workspace.js";
import { builtInto, childrenOf, compareElements, containerOf, inFrame, kindList, libraryOf, lineage, topLevel } from "./model.js";
import { suggest } from "./suggest.js";
import {
  ELEMENT_KINDS,
  RELATIONSHIP_KINDS,
  SHAPE_KIND_LABELS,
  type ArchElement,
  type Arrow,
  type Connection,
  type DeploymentNode,
  type Diagnostic,
  type ElementKind,
  type RelationshipKind,
  type Shape,
  type Step,
  type StickyTarget,
  type StickyTargetData,
  type ViewDef,
  type ViewLevel,
  type Widget,
} from "./types.js";

export interface ViewEdge {
  from: string;
  to: string;
  description?: string;
  technology?: string;
  /**
   * What its relationships mean. On a class view, relationships of different kinds between the
   * same two boxes are different arrows. Elsewhere, every arrow is an association.
   */
  kind: RelationshipKind;
  /** False when a model relationship joins exactly these two boxes. */
  implied: boolean;
  /**
   * True when a relationship it stands for goes both ways. It's drawn with an arrowhead at each
   * end, and stands for every relationship between its two boxes, in either direction.
   */
  bidirectional: boolean;
  /** The model relationships drawn as this edge: source element ID and index in its `uses`. */
  sources: RelationshipSource[];
}

/** A model relationship: the element it's on, and its index in that element's `uses`. */
export interface RelationshipSource {
  element: string;
  index: number;
}

export interface ComputedStep extends Step {
  /** The step's own description, or for a call without one, its relationship's. */
  label?: string;
  /** The step's own technology, or for a call without one, its relationship's. */
  labelTechnology?: string;
  /** The model relationships the step goes along: none when the model has none between its elements. */
  sources: RelationshipSource[];
}

export interface ComputedView {
  view: ViewDef;
  /** The system (container view), container or library (component view), or component or library (class view) drawn as a frame. */
  boundary?: ArchElement;
  /** Boxes, in display order. A sequence view's are its participants, in the order they first appear in its steps. */
  nodes: ArchElement[];
  /** Always empty for a sequence view, which draws its steps instead. */
  edges: ViewEdge[];
  /** A sequence view's steps, in order; empty for other views. */
  steps: ComputedStep[];
  /** A deployment view's nodes, what runs in them and the arrows between them; absent on other views. */
  deployment?: ComputedDeployment;
  /** Problems with the view's include/exclude lists. */
  diagnostics: Diagnostic[];
}

/**
 * What a deployment view draws. Its `nodes` are the elements its nodes run, and its `edges` the
 * arrows between those elements, as another view would draw them. This says where each copy of
 * them runs, and which copies each arrow joins.
 */
export interface ComputedDeployment {
  /**
   * The view's nodes in reading order. A node whose parent is missing, is infrastructure or is in
   * a cycle is drawn at the top, so its `parent` here is left out.
   */
  nodes: DeploymentNode[];
  /** A container or system running in a node, in the order of the nodes and their `runs`. */
  instances: DeploymentInstance[];
  arrows: DeploymentArrow[];
}

export interface DeploymentInstance {
  /** The node's ID and the element's, as `instanceId` makes them. */
  id: string;
  node: string;
  element: ArchElement;
}

/** An arrow on a deployment view: between two boxes, each a node or an instance. */
export interface DeploymentArrow {
  /** Unique within the view. */
  id: string;
  from: string;
  to: string;
  description?: string;
  technology?: string;
  bidirectional: boolean;
  /** For an arrow between two instances: the arrow between their elements, with the relationships it draws. */
  edge?: ViewEdge;
  /** For an arrow to or from a node: the view's connection. */
  connection?: Connection;
}

/** The ID of the box for an element running in a node: no node or element ID has a slash. */
export function instanceId(node: string, element: string): string {
  return `${node}/${element}`;
}

/** The kinds a view's scope can have: none when the level takes no scope. */
export const SCOPE_KINDS: Record<ViewLevel, readonly ElementKind[]> = {
  landscape: [],
  context: ["system"],
  container: ["system"],
  component: ["container", "library"],
  class: ["component", "library"],
  sequence: [],
  // Optional: the element whose states the view shows, of any kind.
  state: ELEMENT_KINDS,
  deployment: [],
  event: [],
  // Optional: the app whose screens the view shows.
  wireframe: ["system", "container"],
  whiteboard: [],
  // Optional: the element whose process the flowchart shows, of any kind.
  flowchart: ELEMENT_KINDS,
};

/** Problems with a view's level and scope. A view with any of these can't be computed. */
export function scopeProblems(ws: Workspace, view: ViewDef): Diagnostic[] {
  const at = { path: `${view.path}.${view.scope === undefined ? "level" : "scope"}` };
  const kinds = SCOPE_KINDS[view.level];
  const wanted = kindList(kinds);
  if (!kinds.length) {
    const message =
      view.level === "sequence"
        ? "Sequence views show the elements in their steps, so they don't take a `scope`."
        : view.level === "deployment"
          ? "Deployment views show their nodes and what runs in them, so they don't take a `scope`."
          : view.level === "event"
            ? "Event views show their lanes and cards, so they don't take a `scope`."
            : view.level === "whiteboard"
              ? "Whiteboard views show their shapes and arrows, not the model, so they don't take a `scope`."
              : "Landscape views show every person and system, so they don't take a `scope`.";
    return view.scope === undefined ? [] : [{ ...at, severity: "error", rule: "view-scope-not-allowed", message, fix: "Remove `scope`." }];
  }
  if (view.scope === undefined) {
    if (view.level === "state" || view.level === "wireframe" || view.level === "flowchart") return [];
    return [{ ...at, severity: "error", rule: "view-scope-required", message: `A ${view.level} view needs \`scope\`: the ID of the ${wanted} it shows.` }];
  }
  const scope = ws.elements.get(view.scope);
  if (!scope) {
    return [{ ...at, severity: "error", rule: "view-scope-unknown", message: `Scope "${view.scope}" isn't an element.`, fix: didYouMean(ws, view.scope) }];
  }
  if (!kinds.includes(scope.kind)) {
    return [{ ...at, severity: "error", rule: "view-scope-kind", message: `A ${view.level} view's scope must be a ${wanted}, but "${scope.id}" is a ${scope.kind}.` }];
  }
  return [];
}

/**
 * Which container's copy of a library a relationship's end is in: a container's ID, or null when
 * it's in no container's copy, as a relationship from something not built with the library.
 * Left out, it's the copy in the container the view is of, if that's built with the library.
 */
export type LibraryCopy = string | null | undefined;

/**
 * Maps any element to the box that represents it in this view, or null when it is the view's
 * boundary, or holds it, and so has no box. Something in a library is drawn as part of the
 * container whose copy of the library it's in: in a component view of that container, as the
 * library's own box, inside the frame; elsewhere, as that container is. A class is always itself
 * in a class view. A view of a library, or of a component in one, is of no container's copy: see
 * libraryViewRepresentative.
 */
export function representative(ws: Workspace, view: ViewDef): (id: string, copy?: LibraryCopy) => string | null {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  const scopeSystem = scope ? topLevel(ws, scope.id) : undefined;
  const scopeContainer = scope?.kind === "component" && scope.parent ? ws.elements.get(scope.parent) : undefined;
  // The container whose copy of a library is drawn as the library's own box.
  const home = view.level === "component" ? scope : view.level === "class" ? scopeContainer : undefined;
  const plain = plainRepresentative(ws, view, scope, scopeSystem, scopeContainer);
  if (scope && view.level !== "sequence" && view.level !== "state" && view.level !== "flowchart" && libraryOf(ws, scope.id)) return libraryViewRepresentative(ws, view, scope);
  return (id, copy) => {
    const library = libraryOf(ws, id);
    if (!library || view.level === "sequence") return plain(id);
    if (view.level === "class" && ws.elements.get(id)!.kind === "class") return id;
    const at = copy === undefined ? (home?.libraries.includes(library.id) ? home.id : null) : copy;
    if (view.level === "class") return at === null || at === home?.id ? library.id : plain(at);
    if (view.level === "component") return at !== null && at === home?.id ? library.id : at === null ? null : plain(at);
    return at === null ? null : plain(at);
  };
}

/**
 * The box for an element in a view of a library, or of a component in one. What's in the scope is
 * drawn as it is; in a class view of a library's component, so is the rest of the library, as a
 * component view of the library would draw it. Everything else is drawn as itself, a class as
 * its component (or library) except in a class view, where a class is always itself.
 */
function libraryViewRepresentative(ws: Workspace, view: ViewDef, scope: ArchElement): (id: string) => string | null {
  const holder = scope.kind === "library" ? undefined : scope.parent;
  return (id) => {
    const chain = lineage(ws, id);
    if (chain.length === 0) return null;
    const childOf = (parent: string) => chain.find((e) => e.parent === parent)?.id ?? null;
    if (view.level === "class" && chain[0]!.kind === "class") return id;
    if (chain.some((e) => e.id === scope.id)) return childOf(scope.id);
    if (holder && chain.some((e) => e.id === holder)) return childOf(holder);
    return (chain.find((e) => e.kind !== "class") ?? chain[0]!).id;
  };
}

/** The box for an element that isn't in a library (see representative). */
function plainRepresentative(ws: Workspace, view: ViewDef, scope?: ArchElement, scopeSystem?: ArchElement, scopeContainer?: ArchElement): (id: string) => string | null {
  return (id) => {
    const chain = lineage(ws, id);
    const top = chain[chain.length - 1];
    if (!top) return null;
    const childOf = (parent: string) => chain.find((e) => e.parent === parent)?.id ?? null;
    switch (view.level) {
      case "landscape":
      case "context":
        return top.id;
      case "container":
        if (!scope || !chain.some((e) => e.id === scope.id)) return top.id;
        return childOf(scope.id);
      case "component":
        if (!scope || !scopeSystem) return top.id;
        if (chain.some((e) => e.id === scope.id)) return childOf(scope.id);
        if (chain.some((e) => e.id === scopeSystem.id)) return childOf(scopeSystem.id);
        return top.id;
      case "class":
        // A class anywhere is drawn as itself. Anything else is drawn as in a component view of
        // the scope's container.
        if (!scope || !scopeSystem) return top.id;
        if (chain.some((e) => e.id === scope.id)) return childOf(scope.id);
        if (chain[0]!.kind === "class") return chain[0]!.id;
        if (scopeContainer && chain.some((e) => e.id === scopeContainer.id)) return childOf(scopeContainer.id);
        if (chain.some((e) => e.id === scopeSystem.id)) return childOf(scopeSystem.id);
        return top.id;
      case "sequence":
      case "state":
      case "deployment":
      case "event":
      case "wireframe":
      case "whiteboard":
      case "flowchart":
        return id;
    }
  };
}

/** Compute a view. Call `scopeProblems` first: this assumes the scope is valid. */
export function computeView(ws: Workspace, view: ViewDef): ComputedView {
  if (view.level === "sequence") return computeSequence(ws, view);
  if (view.level === "state") return computeStates(ws, view);
  if (view.level === "deployment") return computeDeployment(ws, view);
  if (view.level === "event") return computeEvents(ws, view);
  if (view.level === "wireframe") return computeWireframe(ws, view);
  if (view.level === "whiteboard") return computeWhiteboard(view);
  if (view.level === "flowchart") return computeFlowchart(ws, view);
  const diagnostics: Diagnostic[] = [];
  const rep = representative(ws, view);
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;

  const inner: ArchElement[] =
    view.level === "landscape"
      ? [...ws.elements.values()].filter((e) => e.kind === "person" || e.kind === "system")
      : view.level === "context"
        ? scope
          ? [scope]
          : []
        : scope
          ? [...childrenOf(ws, scope.id), ...(view.level === "component" ? scope.libraries.flatMap((id) => (ws.elements.get(id)?.kind === "library" ? [ws.elements.get(id)!] : [])) : [])]
          : [];
  const innerIds = new Set(inner.map((e) => e.id));

  // Every model relationship, lifted to the boxes of this view. A class view tells kinds apart, as
  // does any view that draws a relationship's two classes as themselves, such as a component view
  // of a library that holds classes.
  const classes = view.level === "class";
  const lifted: Lifted[] = [];
  for (const element of ws.elements.values()) {
    element.uses.forEach((rel, index) => {
      if (!ws.elements.has(rel.to)) return;
      // One for each container whose copy of a library it's in, once for each pair of boxes.
      const pairs = new Set<string>();
      for (const [fromCopy, toCopy] of libraryCopies(ws, element.id, rel.to)) {
        const from = rep(element.id, fromCopy);
        const to = rep(rel.to, toCopy);
        if (!from || !to || from === to || pairs.has(`${from}\u0000${to}`)) continue;
        pairs.add(`${from}\u0000${to}`);
        const own = from === element.id && to === rel.to;
        lifted.push({ from, to, element: element.id, index, both: rel.bidirectional, kind: classes || own ? rel.kind : "association" });
      }
    });
  }

  const shown = new Set<string>();
  view.include.forEach((entry, i) => {
    const path = `${view.path}.include[${i}]`;
    if (entry === "*") {
      innerIds.forEach((id) => shown.add(id));
      for (const l of lifted) {
        if (innerIds.has(l.from)) shown.add(l.to);
        if (innerIds.has(l.to)) shown.add(l.from);
      }
      return;
    }
    if (!ws.elements.has(entry)) {
      diagnostics.push({ severity: "error", rule: "view-include-unknown", message: `"${entry}" in \`include\` isn't an element.`, path, fix: didYouMean(ws, entry) });
      return;
    }
    const r = rep(entry);
    const library = libraryOf(ws, entry);
    if (r === null && library && !libraryOf(ws, view.scope ?? "")) {
      diagnostics.push({
        severity: "warning",
        rule: "view-include-library",
        message: `"${entry}" is in the library "${library.id}", which a ${view.level} view draws only as part of the containers built with it.`,
        path,
        fix: `Remove "${entry}" from \`include\`.`,
      });
      return;
    }
    if (r === null) {
      diagnostics.push({ severity: "warning", rule: "view-include-boundary", message: `"${entry}" is this view's scope, so it's drawn as the frame, not a box.`, path, fix: `Remove "${entry}" from \`include\`.` });
      return;
    }
    if (r !== entry) {
      diagnostics.push({ severity: "warning", rule: "view-include-lifted", message: `"${entry}" is too detailed for a ${view.level} view, so it's shown as "${r}".`, path, fix: `Include "${r}" instead.` });
    }
    shown.add(r);
  });

  view.exclude.forEach((entry, i) => {
    const path = `${view.path}.exclude[${i}]`;
    if (shown.delete(entry)) return;
    const known = ws.elements.has(entry);
    diagnostics.push({
      severity: "warning",
      rule: "view-exclude-unused",
      message: known ? `"${entry}" in \`exclude\` isn't in this view anyway.` : `"${entry}" in \`exclude\` isn't an element.`,
      path,
      fix: known ? `Remove "${entry}" from \`exclude\`.` : didYouMean(ws, entry),
    });
  });

  const nodes = [...shown].map((id) => ws.elements.get(id)!).sort(compareElements);
  const edges = groupEdges(ws, lifted, shown);
  const boundary = view.level === "container" || view.level === "component" || view.level === "class" ? scope : undefined;
  return { view, boundary, nodes, edges, steps: [], diagnostics };
}

/** A model relationship lifted to the boxes of a view: the boxes it joins, and the relationship. */
interface Lifted {
  from: string;
  to: string;
  element: string;
  index: number;
  both: boolean;
  kind: RelationshipKind;
}

/** The arrows between the boxes `shown`, from the relationships lifted to them. */
function groupEdges(ws: Workspace, lifted: Lifted[], shown: Set<string>): ViewEdge[] {
  // Two boxes joined by a relationship that goes both ways get one arrow, with a head at each end,
  // for every relationship of its kind between them: a second arrow would only say part of it again.
  // Only associations go both ways.
  const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const bothWays = new Set(lifted.filter((l) => l.both).map((l) => pair(l.from, l.to)));
  const groups = new Map<string, typeof lifted>();
  for (const l of lifted) {
    if (!shown.has(l.from) || !shown.has(l.to)) continue;
    const both = l.kind === "association" && bothWays.has(pair(l.from, l.to));
    const key = `${l.kind}\u0000${both ? `both\u0000${pair(l.from, l.to)}` : `${l.from}\u0000${l.to}`}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const edges: ViewEdge[] = [...groups.values()].map((group) => {
    // It points the way its first relationship that goes both ways does.
    const { from, to } = group.find((g) => g.both) ?? group[0]!;
    const joins = (g: (typeof group)[number], a: string, b: string) => g.element === a && ws.elements.get(g.element)!.uses[g.index]!.to === b;
    const direct = group.filter((g) => joins(g, from, to) || joins(g, to, from));
    const labelled = direct.length ? direct : group;
    const rels = labelled.map((g) => ws.elements.get(g.element)!.uses[g.index]!);
    return {
      from,
      to,
      description: joinLabels(rels.map((r) => r.description), "; "),
      technology: joinLabels(rels.map((r) => r.technology), ", "),
      kind: group[0]!.kind,
      implied: direct.length === 0,
      bidirectional: group.some((g) => g.both),
      sources: group.map((g) => ({ element: g.element, index: g.index })),
    };
  });
  const kindRank = (e: ViewEdge) => RELATIONSHIP_KINDS.indexOf(e.kind);
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : kindRank(a) - kindRank(b)));
  return edges;
}

/**
 * The copies of libraries a relationship from `from` to `to` joins, as pairs of the container
 * each end's copy is in (see LibraryCopy), with undefined for an end in no library. Something in
 * a library uses what it uses from inside each container built with it; something outside uses
 * the copy in its own container, and none when its container isn't built with the library.
 */
export function libraryCopies(ws: Workspace, from: string, to: string): [LibraryCopy, LibraryCopy][] {
  const fromLibrary = libraryOf(ws, from);
  const toLibrary = libraryOf(ws, to);
  if (!fromLibrary && !toLibrary) return [[undefined, undefined]];
  if (!fromLibrary) {
    const container = containerOf(ws, from);
    return [[undefined, container?.libraries.includes(toLibrary!.id) ? container.id : null]];
  }
  const containers = builtInto(ws, fromLibrary.id).filter((c) => !toLibrary || c.libraries.includes(toLibrary.id));
  if (containers.length === 0) return [[null, toLibrary ? null : undefined]];
  return containers.map((c) => [c.id, toLibrary ? c.id : undefined]);
}

/** `id` itself or anything inside it. */
function within(ws: Workspace, id: string, ancestor: string): boolean {
  return lineage(ws, id).some((e) => e.id === ancestor);
}

/**
 * The model relationships a step from `from` to `to` goes along: for a call, those from `from`
 * or something inside it to `to` or something inside it; for a reply, those the other way.
 * A relationship that goes both ways counts in either direction. Relationships between exactly
 * these two elements come first. None join an element and something it's inside.
 */
export function stepRelationships(ws: Workspace, from: string, to: string, reply = false): RelationshipSource[] {
  const [caller, callee] = reply ? [to, from] : [from, to];
  if (caller === callee || !ws.elements.has(caller) || !ws.elements.has(callee)) return [];
  // No relationship can join an element and what it's inside, so no step can either.
  if (within(ws, caller, callee) || within(ws, callee, caller)) return [];
  const direct: RelationshipSource[] = [];
  const nested: RelationshipSource[] = [];
  for (const element of ws.elements.values()) {
    element.uses.forEach((rel, index) => {
      if (!ws.elements.has(rel.to)) return;
      const forward = within(ws, element.id, caller) && within(ws, rel.to, callee);
      const back = rel.bidirectional && within(ws, element.id, callee) && within(ws, rel.to, caller);
      if (!forward && !back) return;
      const exact = forward ? element.id === caller && rel.to === callee : element.id === callee && rel.to === caller;
      (exact ? direct : nested).push({ element: element.id, index });
    });
  }
  return [...direct, ...nested];
}

function computeSequence(ws: Workspace, view: ViewDef): ComputedView {
  const diagnostics: Diagnostic[] = [];
  const participants: ArchElement[] = [];
  const steps: ComputedStep[] = [];
  for (const step of view.steps) {
    let known = true;
    for (const end of ["from", "to"] as const) {
      const id = step[end];
      const element = ws.elements.get(id);
      if (!element) {
        known = false;
        diagnostics.push({ severity: "error", rule: "step-unknown-element", message: `Step ${step.number}: "${id}" isn't an element.`, path: `${step.path}.${end}`, fix: didYouMean(ws, id) });
      } else if (!participants.includes(element)) participants.push(element);
    }
    if (known && step.from === step.to) {
      diagnostics.push({ severity: "error", rule: "step-self", message: `Step ${step.number} goes from "${step.from}" to itself.`, path: step.path, fix: "Point it at another element." });
    }
    const sources = known ? stepRelationships(ws, step.from, step.to, step.reply) : [];
    if (known && step.from !== step.to && sources.length === 0) {
      const [caller, callee] = step.reply ? [step.to, step.from] : [step.from, step.to];
      diagnostics.push({
        severity: "warning",
        rule: "step-relationship-missing",
        message: `Step ${step.number}: the model has no relationship from "${caller}" to "${callee}"${step.reply ? ", for this reply to go back along" : ""}.`,
        path: step.path,
        fix: `Add one with \`open-arch add-relationship ${caller} ${callee}\`, or change the step.`,
      });
    }
    // A call is labelled with what its relationships say, when it says nothing itself; a reply isn't.
    const exactly = (s: RelationshipSource) => {
      const to = ws.elements.get(s.element)!.uses[s.index]!.to;
      return (s.element === step.from && to === step.to) || (s.element === step.to && to === step.from);
    };
    const rels = step.reply ? [] : sources.filter(exactly);
    const labelled = (rels.length ? rels : step.reply ? [] : sources).map((s) => ws.elements.get(s.element)!.uses[s.index]!);
    steps.push({
      ...step,
      label: step.description ?? joinLabels(labelled.map((r) => r.description), "; "),
      labelTechnology: step.technology ?? joinLabels(labelled.map((r) => r.technology), ", "),
      sources,
    });
  }
  return { view, nodes: participants, edges: [], steps, diagnostics };
}

/**
 * A state view: it draws its states, not boxes, so it has none, and the element whose states they
 * are, if it says, as its frame. Its problems are transitions and an initial state that name no
 * state, and states with no initial one.
 */
function computeStates(ws: Workspace, view: ViewDef): ComputedView {
  const diagnostics: Diagnostic[] = [];
  const ids = view.states.map((s) => s.id);
  const near = (id: string) => {
    const match = suggest(id, ids);
    return match ? `Did you mean "${match}"?` : undefined;
  };
  if (view.initial !== undefined && !ids.includes(view.initial)) {
    diagnostics.push({ severity: "error", rule: "state-initial-unknown", message: `The initial state "${view.initial}" isn't a state of this view.`, path: `${view.path}.initial`, fix: near(view.initial) });
  } else if (view.initial === undefined && ids.length) {
    diagnostics.push({
      severity: "warning",
      rule: "state-initial-missing",
      message: "This state view has no initial state, so it doesn't say where it starts.",
      path: `${view.path}.initial`,
      fix: `Mark one with \`open-arch update-state ${view.id} <state> --initial\`.`,
    });
  }
  for (const t of view.transitions) {
    for (const end of ["from", "to"] as const) {
      if (ids.includes(t[end])) continue;
      diagnostics.push({ severity: "error", rule: "transition-unknown-state", message: `Transition ${t.number}: "${t[end]}" isn't a state of this view.`, path: `${t.path}.${end}`, fix: near(t[end]) });
    }
  }
  const boundary = view.scope ? ws.elements.get(view.scope) : undefined;
  return { view, boundary, nodes: [], edges: [], steps: [], diagnostics };
}

/** The kinds of element a deployment view's nodes can run. */
export const RUNNABLE_KINDS: readonly ElementKind[] = ["container", "system"];

/**
 * A deployment view: its nodes, nested, with the containers and systems each runs, and arrows.
 * An arrow between two elements comes from the model's relationships, lifted to the nearest
 * element the view runs, as other views lift them to their boxes. Each copy of the element at
 * its start joins the copies at its end that run nearest to it: those in the deepest node they
 * share. So with a copy of a web app and of its database in each of two regions, each web app
 * uses the database in its own region. Connections join nodes the same way.
 */
function computeDeployment(ws: Workspace, view: ViewDef): ComputedView {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const near = (id: string) => {
    const match = suggest(id, [...byId.keys()]);
    return match ? `Did you mean "${match}"?` : undefined;
  };

  // Each node's parent as drawn: one that's missing, infrastructure or in a cycle is left out.
  const drawnParent = new Map<string, string | undefined>();
  for (const node of view.nodes) {
    let parent = node.parent;
    if (parent !== undefined) {
      const holder = byId.get(parent);
      if (!holder) {
        diagnostics.push({ severity: "error", rule: "node-parent-unknown", message: `Node "${node.id}": its parent "${parent}" isn't a node of this view.`, path: `${node.path}.parent`, fix: near(parent) });
        parent = undefined;
      } else if (holder.infrastructure) {
        diagnostics.push({
          severity: "error",
          rule: "node-parent-infrastructure",
          message: `Node "${node.id}" is inside "${parent}", which is infrastructure, and infrastructure holds no nodes.`,
          path: `${node.path}.parent`,
          fix: `Put it in another node, or make "${parent}" a deployment node.`,
        });
        parent = undefined;
      }
    }
    drawnParent.set(node.id, parent);
  }
  const cycled = view.nodes.filter((node) => {
    const seen = new Set<string>();
    for (let at = drawnParent.get(node.id); at !== undefined && !seen.has(at); at = drawnParent.get(at)) {
      if (at === node.id) return true;
      seen.add(at);
    }
    return false;
  });
  // A node in a cycle is drawn at the top, which breaks it.
  for (const node of cycled) {
    diagnostics.push({ severity: "error", rule: "node-parent-cycle", message: `Node "${node.id}" is inside itself, through its parents.`, path: `${node.path}.parent`, fix: "Change one of the parents." });
    drawnParent.set(node.id, undefined);
  }
  /** A node and the nodes it's inside, the top one first. */
  const chain = (id: string): string[] => {
    const out: string[] = [];
    for (let at: string | undefined = id; at !== undefined && !out.includes(at); at = drawnParent.get(at)) out.unshift(at);
    return out;
  };

  const instances: DeploymentInstance[] = [];
  for (const node of view.nodes) {
    if (node.infrastructure && node.runs.length) {
      diagnostics.push({
        severity: "error",
        rule: "node-infrastructure-runs",
        message: `Node "${node.id}" is infrastructure, so it runs no containers or systems.`,
        path: `${node.path}.runs`,
        fix: "Remove runs, or make it a deployment node.",
      });
      continue;
    }
    node.runs.forEach((id, i) => {
      const path = `${node.path}.runs[${i}]`;
      const element = ws.elements.get(id);
      if (!element) {
        diagnostics.push({ severity: "error", rule: "node-runs-unknown", message: `Node "${node.id}" runs "${id}", which isn't an element.`, path, fix: didYouMean(ws, id) });
      } else if (!RUNNABLE_KINDS.includes(element.kind)) {
        diagnostics.push({
          severity: "error",
          rule: "node-runs-kind",
          message: `Node "${node.id}" runs "${id}", a ${element.kind}. Nodes run containers and systems.`,
          path,
          fix: element.kind === "component" || element.kind === "class" ? `Run the container it's in instead.` : `Remove "${id}" from runs.`,
        });
      } else instances.push({ id: instanceId(node.id, id), node: node.id, element });
    });
  }
  const runs = new Map<string, DeploymentInstance[]>();
  for (const instance of instances) runs.set(instance.element.id, [...(runs.get(instance.element.id) ?? []), instance]);
  for (const node of view.nodes) {
    if (!runs.has(node.id)) continue;
    diagnostics.push({
      severity: "error",
      rule: "node-id-taken",
      message: `Node "${node.id}" has the ID of an element this view runs, so a connection to "${node.id}" could mean either.`,
      path: node.path,
      fix: `Give the node another ID with \`open-arch update-node ${view.id} ${node.id} --new-id <id>\`.`,
    });
  }

  // The model's relationships, lifted to the elements the view runs.
  const deployed = (id: string) => lineage(ws, id).find((e) => runs.has(e.id))?.id;
  const lifted: Lifted[] = [];
  for (const element of ws.elements.values()) {
    element.uses.forEach((rel, index) => {
      if (!ws.elements.has(rel.to)) return;
      const pairs = new Set<string>();
      for (const [fromCopy, toCopy] of libraryCopies(ws, element.id, rel.to)) {
        if (fromCopy === null || toCopy === null) continue;
        const from = deployed(fromCopy ?? element.id);
        const to = deployed(toCopy ?? rel.to);
        if (!from || !to || from === to || pairs.has(`${from}\u0000${to}`)) continue;
        pairs.add(`${from}\u0000${to}`);
        lifted.push({ from, to, element: element.id, index, both: rel.bidirectional, kind: "association" });
      }
    });
  }
  const edges = groupEdges(ws, lifted, new Set(runs.keys()));

  /** The nodes a box is in, top first: a node's own chain, or the chain of the node an instance runs in. */
  const where = (box: string) => chain(box.includes("/") ? box.slice(0, box.indexOf("/")) : box);
  /** The pairs of boxes from `from` to `to` that are nearest each other: for each start, the ends in the deepest node they share. */
  const nearest = (from: string[], to: string[]): [string, string][] =>
    from.flatMap((a) => {
      const shared = (b: string) => {
        const [x, y] = [where(a), where(b)];
        let k = 0;
        while (k < x.length && k < y.length && x[k] === y[k]) k++;
        return k;
      };
      const ends = to.filter((b) => b !== a);
      const best = Math.max(0, ...ends.map(shared));
      return ends.filter((b) => shared(b) === best).map((b): [string, string] => [a, b]);
    });

  const arrows: DeploymentArrow[] = [];
  for (const edge of edges) {
    const ends = (id: string) => runs.get(id)!.map((i) => i.id);
    for (const [from, to] of nearest(ends(edge.from), ends(edge.to))) {
      arrows.push({ id: `${from}->${to}`, from, to, description: edge.description, technology: edge.technology, bidirectional: edge.bidirectional, edge });
    }
  }

  for (const c of view.connections) {
    const boxes = { from: [] as string[], to: [] as string[] };
    for (const end of ["from", "to"] as const) {
      const id = c[end];
      if (byId.has(id)) boxes[end] = [id];
      else if (runs.has(id)) boxes[end] = runs.get(id)!.map((i) => i.id);
      else {
        const known = ws.elements.has(id);
        diagnostics.push({
          severity: "error",
          rule: "connection-unknown-end",
          message: known
            ? `Connection ${c.number}: "${id}" isn't run by any node of this view.`
            : `Connection ${c.number}: "${id}" isn't a node of this view, or a container or system one runs.`,
          path: `${c.path}.${end}`,
          fix: known ? `Run it in a node: list it in the node's runs, with \`open-arch update-node ${view.id} <node> --run ${id}\` and a --run for each of the others it runs.` : (near(id) ?? didYouMean(ws, id)),
        });
      }
    }
    if (!boxes.from.length || !boxes.to.length) continue;
    if (c.from === c.to) {
      diagnostics.push({ severity: "error", rule: "connection-self", message: `Connection ${c.number} goes from "${c.from}" to itself.`, path: c.path, fix: "Point it at something else." });
      continue;
    }
    if (!byId.has(c.from) && !byId.has(c.to)) {
      diagnostics.push({
        severity: "error",
        rule: "connection-between-elements",
        message: `Connection ${c.number} joins "${c.from}" and "${c.to}", two elements. Arrows between them come from the model's relationships.`,
        path: c.path,
        fix: `Add a relationship with \`open-arch add-relationship ${c.from} ${c.to}\`, and remove the connection.`,
      });
      continue;
    }
    // A node can't connect to what's inside it, as a relationship can't join an element and its parent.
    const inside = (box: string, node: string) => byId.has(node) && box !== node && where(box).includes(node);
    const from = boxes.from.filter((box) => !inside(box, c.to));
    const to = boxes.to.filter((box) => !inside(box, c.from));
    if (!from.length || !to.length) {
      diagnostics.push({
        severity: "error",
        rule: "connection-parent-child",
        message: `Connection ${c.number} joins "${c.from}" and "${c.to}", and one is inside the other.`,
        path: c.path,
        fix: "Point it at something outside instead.",
      });
      continue;
    }
    nearest(from, to).forEach(([from, to], k) =>
      arrows.push({ id: `connection:${c.number}${k ? `:${k}` : ""}`, from, to, description: c.description, technology: c.technology, bidirectional: false, connection: c }),
    );
  }

  const nodes = view.nodes.map((n) => (drawnParent.get(n.id) === n.parent ? n : { ...n, parent: drawnParent.get(n.id) }));
  const elements = [...runs.keys()].map((id) => ws.elements.get(id)!).sort(compareElements);
  return { view, nodes: elements, edges, steps: [], deployment: { nodes, instances, arrows }, diagnostics };
}

/** An arrow on an event view, from one card to a card it leads to. */
export interface CardArrow {
  from: string;
  to: string;
}

/**
 * The arrows an event view draws: one to each card from each card its `from` names, in the order
 * of the cards. A `from` that names no card of the view, or the card itself, draws nothing.
 */
export function cardArrows(view: ViewDef): CardArrow[] {
  const ids = new Set(view.cards.map((c) => c.id));
  return view.cards.flatMap((card) => card.from.filter((from) => from !== card.id && ids.has(from)).map((from) => ({ from, to: card.id })));
}

/**
 * An event view: it draws its cards, not boxes, so it has none. Its problems are cards in a lane
 * the view doesn't have, and cards that come from a card it doesn't have, or from themselves.
 */
function computeEvents(ws: Workspace, view: ViewDef): ComputedView {
  const diagnostics: Diagnostic[] = [];
  const lanes = view.lanes.map((l) => l.id);
  const cards = view.cards.map((c) => c.id);
  const near = (id: string, among: string[]) => {
    const match = suggest(id, among);
    return match ? `Did you mean "${match}"?` : undefined;
  };
  for (const card of view.cards) {
    if (card.lane !== undefined && !lanes.includes(card.lane)) {
      diagnostics.push({ severity: "error", rule: "card-lane-unknown", message: `Card "${card.id}" is in the lane "${card.lane}", which isn't a lane of this view.`, path: `${card.path}.lane`, fix: near(card.lane, lanes) });
    }
    // The workspace lists each card it comes from once, so look at the file for where it is.
    const listed = ws.doc.views[view.id]?.cards?.[card.number - 1]?.from ?? card.from;
    card.from.forEach((from) => {
      const path = `${card.path}.from[${listed.indexOf(from)}]`;
      if (from === card.id) {
        diagnostics.push({ severity: "error", rule: "card-from-self", message: `Card "${card.id}" comes from itself.`, path, fix: `Remove "${from}" from \`from\`.` });
      } else if (!cards.includes(from)) {
        diagnostics.push({ severity: "error", rule: "card-from-unknown", message: `Card "${card.id}" comes from "${from}", which isn't a card of this view.`, path, fix: near(from, cards) });
      }
    });
  }
  return { view, nodes: [], edges: [], steps: [], diagnostics };
}

/** The views whose sticky notes can be on an element or a relationship: those that draw the model as boxes and arrows. */
export const STICKY_TARGET_LEVELS: readonly ViewLevel[] = ["landscape", "context", "container", "component", "class"];

/** Where a view draws what a sticky note is on: a box, the frame round the view, or an arrow. */
export type StickyAnchor = { kind: "box"; id: string } | { kind: "frame"; id: string } | { kind: "arrow"; edge: ViewEdge };

/**
 * Where a view draws what a sticky note is on, or undefined when it doesn't. An element is drawn
 * as the box that shows it, as a relationship's end is: its own, or the one it's inside, as a
 * component is on a container view. The view's scope is the frame, while it's drawn round
 * anything. A relationship is drawn as the arrow that stands for it: the first, when it's in a
 * library built into several containers.
 */
export function stickyAnchor(ws: Workspace, cv: ComputedView, on: StickyTarget): StickyAnchor | undefined {
  if (!STICKY_TARGET_LEVELS.includes(cv.view.level)) return undefined;
  if ("element" in on) {
    if (!ws.elements.has(on.element)) return undefined;
    if (cv.boundary?.id === on.element) return cv.nodes.some((n) => inFrame(cv.boundary, n)) ? { kind: "frame", id: on.element } : undefined;
    const box = representative(ws, cv.view)(on.element);
    return box && cv.nodes.some((n) => n.id === box) ? { kind: "box", id: box } : undefined;
  }
  const edge = cv.edges.find((e) =>
    e.sources.some((s) => {
      const rel = ws.elements.get(s.element)?.uses[s.index];
      return s.element === on.from && rel?.to === on.to && rel.kind === on.kind;
    }),
  );
  return edge && { kind: "arrow", edge };
}

/** What a sticky note is on, as the CLI writes it: "cache", or "web-app -> orders-db", with the relationship's kind when it isn't an association. */
export function stickyTargetText(on: StickyTargetData): string {
  if ("element" in on) return on.element;
  return `${on.from} -> ${on.to}${on.kind && on.kind !== "association" ? ` (${on.kind})` : ""}`;
}

/** Every widget on a screen, or on all of a view's screens, in reading order: each widget, then what's inside it. */
export function allWidgets(of: { widgets: Widget[] } | ViewDef): Widget[] {
  const out: Widget[] = [];
  const walk = (list: Widget[]) => {
    for (const w of list) {
      out.push(w);
      walk(w.widgets);
    }
  };
  if ("screens" in of) for (const s of of.screens) walk(s.widgets);
  else walk(of.widgets);
  return out;
}

/** An arrow on a wireframe view, from a widget to the screen it leads to. */
export interface ScreenArrow {
  /** The widget's ID. */
  from: string;
  /** The ID of the screen the widget is on. */
  screen: string;
  /** The ID of the screen it leads to. */
  to: string;
}

/**
 * The arrows a wireframe view draws: one from each widget whose `to` is another of its screens,
 * in reading order. One to a screen the view doesn't have, or to the widget's own, draws nothing.
 */
export function screenArrows(view: ViewDef): ScreenArrow[] {
  const ids = new Set(view.screens.map((s) => s.id));
  return allWidgets(view).flatMap((w) => (w.to !== undefined && w.to !== w.screen && ids.has(w.to) ? [{ from: w.id, screen: w.screen, to: w.to }] : []));
}

/**
 * A wireframe view: it draws its screens, not boxes, so it has none. Its scope, if it has one, is
 * the app whose screens they are. Its problems are widgets that lead to a screen it doesn't have,
 * or to their own.
 */
function computeWireframe(ws: Workspace, view: ViewDef): ComputedView {
  const diagnostics: Diagnostic[] = [];
  const screens = view.screens.map((s) => s.id);
  for (const w of allWidgets(view)) {
    if (w.to === undefined) continue;
    if (!screens.includes(w.to)) {
      const match = suggest(w.to, screens);
      diagnostics.push({
        severity: "error",
        rule: "widget-to-unknown",
        message: `Widget "${w.id}" leads to "${w.to}", which isn't a screen of this view.`,
        path: `${w.path}.to`,
        fix: match ? `Did you mean "${match}"?` : undefined,
      });
    } else if (w.to === w.screen) {
      diagnostics.push({
        severity: "warning",
        rule: "widget-to-own-screen",
        message: `Widget "${w.id}" leads to the screen it's on, so no arrow is drawn.`,
        path: `${w.path}.to`,
        fix: "Point `to` at another screen, or remove it.",
      });
    }
  }
  const boundary = view.scope ? ws.elements.get(view.scope) : undefined;
  return { view, boundary, nodes: [], edges: [], steps: [], diagnostics };
}

/**
 * What lists call something on a whiteboard without text: its kind, then its ID, unless all the
 * ID says is its kind: "Ellipse", "Ellipse 2", "Pen scribble".
 */
function unnamed(kind: string, id: string): string {
  const base = kind.toLowerCase();
  if (id === base) return kind;
  const numbered = new RegExp(`^${base}-(\\d+)$`).exec(id);
  return numbered ? `${kind} ${numbered[1]}` : `${kind} ${id}`;
}

/** A whiteboard shape as lists name it: the first line of its text, or else its kind and ID. */
export function shapeName(shape: Pick<Shape, "id" | "kind" | "text">): string {
  return shape.text?.split(/\r?\n/).find((l) => l.trim())?.trim() ?? unnamed(SHAPE_KIND_LABELS[shape.kind], shape.id);
}

/** A whiteboard arrow as lists name it: the first line of its text, or else "Arrow" or "Line", and its ID. */
export function arrowName(arrow: Pick<Arrow, "id" | "heads" | "text">): string {
  return arrow.text?.split(/\r?\n/).find((l) => l.trim())?.trim() ?? unnamed(arrow.heads === "none" ? "Line" : "Arrow", arrow.id);
}

/**
 * A whiteboard view: it draws its shapes and arrows, not the model, so it has no boxes. Its
 * problems are text with nothing to say, which draws nothing, and arrows to a shape it doesn't
 * have, or from a shape to itself.
 */
function computeWhiteboard(view: ViewDef): ComputedView {
  const diagnostics: Diagnostic[] = [];
  const shapes = view.shapes.map((s) => s.id);
  for (const shape of view.shapes) {
    if (shape.kind !== "text" || shape.text?.trim()) continue;
    diagnostics.push({
      severity: "warning",
      rule: "shape-text-empty",
      message: `Text "${shape.id}" has nothing to say, so it draws nothing on the board.`,
      path: `${shape.path}.text`,
      fix: "Give it text, or remove it.",
    });
  }
  for (const arrow of view.arrows) {
    for (const end of ["from", "to"] as const) {
      const id = arrow[end];
      if (typeof id !== "string" || shapes.includes(id)) continue;
      const match = suggest(id, shapes);
      diagnostics.push({
        severity: "error",
        rule: "arrow-end-unknown",
        message: `Arrow "${arrow.id}" ${end === "from" ? "starts at" : "points to"} "${id}", which isn't a shape of this view.`,
        path: `${arrow.path}.${end}`,
        fix: match ? `Did you mean "${match}"?` : "Name one of its shapes, or give a point, [x, y].",
      });
    }
    if (typeof arrow.from === "string" && arrow.from === arrow.to && shapes.includes(arrow.from)) {
      diagnostics.push({
        severity: "warning",
        rule: "arrow-to-itself",
        message: `Arrow "${arrow.id}" goes from shape "${arrow.from}" to itself, so it isn't drawn.`,
        path: `${arrow.path}.to`,
        fix: "Point `to` at another shape, or at a point.",
      });
    }
  }
  return { view, nodes: [], edges: [], steps: [], diagnostics };
}

/**
 * A flowchart view: it draws its blocks, not boxes, so it has none, and the element whose process
 * it is, if it says, as its frame. Its problems are flows to or from a block it doesn't have; and
 * flows that aren't drawn or say nothing they should: one from a block to itself, out of an end
 * or into a start, a decision without two ways out, and a way out of a decision that doesn't say
 * which answer it's for. And a flowchart with blocks but no start.
 */
function computeFlowchart(ws: Workspace, view: ViewDef): ComputedView {
  const diagnostics: Diagnostic[] = [];
  const blocks = new Map(view.blocks.map((b) => [b.id, b]));
  const ids = [...blocks.keys()];
  if (view.blocks.length && !view.blocks.some((b) => b.kind === "start")) {
    diagnostics.push({
      severity: "warning",
      rule: "flowchart-start-missing",
      message: "This flowchart has no start, so it doesn't say where the process begins.",
      path: `${view.path}.blocks`,
      fix: `Add one with \`open-arch add-block ${view.id} start --kind start\`, and a flow from it.`,
    });
  }
  /** The flows each block has out of it that are drawn: to another block of the view. */
  const out = new Map<string, number>();
  for (const f of view.flows) {
    let known = true;
    for (const end of ["from", "to"] as const) {
      if (blocks.has(f[end])) continue;
      known = false;
      const match = suggest(f[end], ids);
      diagnostics.push({
        severity: "error",
        rule: "flow-unknown-block",
        message: `Flow ${f.number}: "${f[end]}" isn't a block of this view.`,
        path: `${f.path}.${end}`,
        fix: match ? `Did you mean "${match}"?` : undefined,
      });
    }
    if (!known) continue;
    const from = blocks.get(f.from)!;
    const to = blocks.get(f.to)!;
    if (f.from === f.to) {
      diagnostics.push({
        severity: "warning",
        rule: "flow-to-itself",
        message: `Flow ${f.number} goes from block "${f.from}" to itself, so it isn't drawn.`,
        path: `${f.path}.to`,
        fix: "Point `to` at another block, or remove the flow.",
      });
      continue;
    }
    out.set(f.from, (out.get(f.from) ?? 0) + 1);
    if (from.kind === "end") {
      diagnostics.push({
        severity: "warning",
        rule: "flow-from-end",
        message: `Flow ${f.number} leaves "${f.from}", an end, but the process ends there.`,
        path: `${f.path}.from`,
        fix: "Make the block another kind, or remove the flow.",
      });
    }
    if (to.kind === "start") {
      diagnostics.push({
        severity: "warning",
        rule: "flow-to-start",
        message: `Flow ${f.number} goes into "${f.to}", a start, but nothing comes before the start.`,
        path: `${f.path}.to`,
        fix: "Point it at the step after the start instead, or make the block another kind.",
      });
    }
    if (from.kind === "decision" && !f.text?.trim()) {
      diagnostics.push({
        severity: "warning",
        rule: "decision-flow-text",
        message: `Flow ${f.number}, out of the decision "${f.from}", doesn't say which answer it's for.`,
        path: `${f.path}.text`,
        fix: 'Give it text, like "Yes" or "No".',
      });
    }
  }
  for (const b of view.blocks) {
    const ways = out.get(b.id) ?? 0;
    if (b.kind !== "decision" || ways >= 2) continue;
    diagnostics.push({
      severity: "warning",
      rule: "decision-ways",
      message: `The decision "${b.id}" has ${ways === 0 ? "no way" : "one way"} out, so it decides nothing.`,
      path: `${b.path}.kind`,
      fix: 'Add a flow out of it for each answer, with text like "Yes" and "No", or make it a process.',
    });
  }
  const boundary = view.scope ? ws.elements.get(view.scope) : undefined;
  return { view, boundary, nodes: [], edges: [], steps: [], diagnostics };
}

function joinLabels(values: (string | undefined)[], separator: string): string | undefined {
  const unique = [...new Set(values.filter((v): v is string => !!v))];
  if (unique.length === 0) return undefined;
  if (unique.length <= 2) return unique.join(separator);
  return `${unique.slice(0, 2).join(separator)} (+${unique.length - 2} more)`;
}

export function didYouMean(ws: Workspace, id: string): string | undefined {
  const match = suggest(id, [...ws.elements.keys()]);
  return match ? `Did you mean "${match}"?` : undefined;
}
