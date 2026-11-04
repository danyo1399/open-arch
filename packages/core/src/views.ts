/**
 * Working out what a view shows: which elements appear as boxes, and which
 * arrows connect them, including relationships implied by nested elements.
 * A sequence view shows the elements in its steps instead, and its steps in order.
 */
import type { Workspace } from "./workspace.js";
import { childrenOf, compareElements, lineage, PARENT_KIND, topLevel } from "./model.js";
import { suggest } from "./suggest.js";
import { RELATIONSHIP_KINDS, type ArchElement, type Diagnostic, type RelationshipKind, type Step, type ViewDef, type ViewLevel } from "./types.js";

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
  /** The system (container view), container (component view) or component (class view) drawn as a frame. */
  boundary?: ArchElement;
  /** Boxes, in display order. A sequence view's are its participants, in the order they first appear in its steps. */
  nodes: ArchElement[];
  /** Always empty for a sequence view, which draws its steps instead. */
  edges: ViewEdge[];
  /** A sequence view's steps, in order; empty for other views. */
  steps: ComputedStep[];
  /** Problems with the view's include/exclude lists. */
  diagnostics: Diagnostic[];
}

/** The kind a view's scope must have, or undefined when the level takes no scope. */
export const SCOPE_KIND: Record<ViewLevel, "system" | "container" | "component" | undefined> = {
  landscape: undefined,
  context: "system",
  container: "system",
  component: "container",
  class: "component",
  sequence: undefined,
};

/** Problems with a view's level and scope. A view with any of these can't be computed. */
export function scopeProblems(ws: Workspace, view: ViewDef): Diagnostic[] {
  const at = { path: `${view.path}.${view.scope === undefined ? "level" : "scope"}` };
  const wanted = SCOPE_KIND[view.level];
  if (!wanted) {
    const message =
      view.level === "sequence" ? "Sequence views show the elements in their steps, so they don't take a `scope`." : "Landscape views show every person and system, so they don't take a `scope`.";
    return view.scope === undefined ? [] : [{ ...at, severity: "error", rule: "view-scope-not-allowed", message, fix: "Remove `scope`." }];
  }
  if (view.scope === undefined) {
    return [{ ...at, severity: "error", rule: "view-scope-required", message: `A ${view.level} view needs \`scope\`: the ID of the ${wanted} it shows.` }];
  }
  const scope = ws.elements.get(view.scope);
  if (!scope) {
    return [{ ...at, severity: "error", rule: "view-scope-unknown", message: `Scope "${view.scope}" isn't an element.`, fix: didYouMean(ws, view.scope) }];
  }
  if (scope.kind !== wanted) {
    return [{ ...at, severity: "error", rule: "view-scope-kind", message: `A ${view.level} view's scope must be a ${wanted}, but "${scope.id}" is a ${scope.kind}.` }];
  }
  return [];
}

/**
 * Maps any element to the box that represents it in this view, or null when
 * it is the view's boundary, or holds it, and so has no box.
 */
function representative(ws: Workspace, view: ViewDef): (id: string) => string | null {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  const scopeSystem = scope ? topLevel(ws, scope.id) : undefined;
  const scopeContainer = scope?.kind === "component" && scope.parent ? ws.elements.get(scope.parent) : undefined;
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
        return id;
    }
  };
}

/** Compute a view. Call `scopeProblems` first: this assumes the scope is valid. */
export function computeView(ws: Workspace, view: ViewDef): ComputedView {
  if (view.level === "sequence") return computeSequence(ws, view);
  const diagnostics: Diagnostic[] = [];
  const rep = representative(ws, view);
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;

  const inner: ArchElement[] =
    view.level === "landscape"
      ? [...ws.elements.values()].filter((e) => PARENT_KIND[e.kind] === undefined)
      : view.level === "context"
        ? scope
          ? [scope]
          : []
        : scope
          ? childrenOf(ws, scope.id)
          : [];
  const innerIds = new Set(inner.map((e) => e.id));

  // Every model relationship, lifted to the boxes of this view. Only a class view tells kinds apart.
  const classes = view.level === "class";
  const lifted: { from: string; to: string; element: string; index: number; both: boolean; kind: RelationshipKind }[] = [];
  for (const element of ws.elements.values()) {
    element.uses.forEach((rel, index) => {
      if (!ws.elements.has(rel.to)) return;
      const from = rep(element.id);
      const to = rep(rel.to);
      if (from && to && from !== to) lifted.push({ from, to, element: element.id, index, both: rel.bidirectional, kind: classes ? rel.kind : "association" });
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

  const boundary = view.level === "container" || view.level === "component" || view.level === "class" ? scope : undefined;
  return { view, boundary, nodes, edges, steps: [], diagnostics };
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
