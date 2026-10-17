/**
 * Working out what a view shows: which elements appear as boxes, and which
 * arrows connect them, including relationships implied by nested elements.
 */
import type { Workspace } from "./load.js";
import { childrenOf, compareElements, lineage, PARENT_KIND, topLevel } from "./model.js";
import { suggest } from "./suggest.js";
import type { ArchElement, Diagnostic, ViewDef, ViewLevel } from "./types.js";

export interface ViewEdge {
  from: string;
  to: string;
  description?: string;
  technology?: string;
  /** False when a model relationship joins exactly these two boxes. */
  implied: boolean;
  /** The model relationships drawn as this edge: source element ID and index in its `uses`. */
  sources: { element: string; index: number }[];
}

export interface ComputedView {
  view: ViewDef;
  /** The system (container view) or container (component view) drawn as a frame. */
  boundary?: ArchElement;
  /** Boxes, in display order. */
  nodes: ArchElement[];
  edges: ViewEdge[];
  /** Problems with the view's include/exclude lists. */
  diagnostics: Diagnostic[];
}

/** The kind a view's scope must have, or undefined when the level takes no scope. */
export const SCOPE_KIND: Record<ViewLevel, "system" | "container" | undefined> = {
  landscape: undefined,
  context: "system",
  container: "system",
  component: "container",
};

/** Problems with a view's level and scope. A view with any of these can't be computed. */
export function scopeProblems(ws: Workspace, view: ViewDef): Diagnostic[] {
  const at = { path: view.path, line: view.lines.scope ?? view.lines.level };
  const wanted = SCOPE_KIND[view.level];
  if (!wanted) {
    return view.scope === undefined
      ? []
      : [{ ...at, severity: "error", rule: "view-scope-not-allowed", message: "Landscape views show every person and system, so they don't take a `scope`.", fix: "Remove `scope`." }];
  }
  if (view.scope === undefined) {
    return [{ ...at, severity: "error", rule: "view-scope-required", message: `A ${view.level} view needs \`scope\`: the ID of the ${wanted} it shows.` }];
  }
  if (ws.brokenIds.has(view.scope)) return [{ ...at, severity: "error", rule: "view-scope-unknown", message: `Scope "${view.scope}" has errors of its own; fix that file first.` }];
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
 * it is the view's boundary and so has no box.
 */
function representative(ws: Workspace, view: ViewDef): (id: string) => string | null {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  const scopeSystem = scope ? topLevel(ws, scope.id) : undefined;
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
    }
  };
}

/** Compute a view. Call `scopeProblems` first: this assumes the scope is valid. */
export function computeView(ws: Workspace, view: ViewDef): ComputedView {
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

  // Every model relationship, lifted to the boxes of this view.
  const lifted: { from: string; to: string; element: string; index: number }[] = [];
  for (const element of ws.elements.values()) {
    element.uses.forEach((rel, index) => {
      if (!ws.elements.has(rel.to)) return;
      const from = rep(element.id);
      const to = rep(rel.to);
      if (from && to && from !== to) lifted.push({ from, to, element: element.id, index });
    });
  }

  const shown = new Set<string>();
  view.include.forEach((entry, i) => {
    const line = view.listLines.include[i] ?? view.lines.include;
    if (entry === "*") {
      innerIds.forEach((id) => shown.add(id));
      for (const l of lifted) {
        if (innerIds.has(l.from)) shown.add(l.to);
        if (innerIds.has(l.to)) shown.add(l.from);
      }
      return;
    }
    if (ws.brokenIds.has(entry)) return;
    if (!ws.elements.has(entry)) {
      diagnostics.push({ severity: "error", rule: "view-include-unknown", message: `"${entry}" in \`include\` isn't an element.`, path: view.path, line, fix: didYouMean(ws, entry) });
      return;
    }
    const r = rep(entry);
    if (r === null) {
      diagnostics.push({ severity: "warning", rule: "view-include-boundary", message: `"${entry}" is this view's scope, so it's drawn as the frame, not a box.`, path: view.path, line, fix: `Remove "${entry}" from \`include\`.` });
      return;
    }
    if (r !== entry) {
      diagnostics.push({ severity: "warning", rule: "view-include-lifted", message: `"${entry}" is too detailed for a ${view.level} view, so it's shown as "${r}".`, path: view.path, line, fix: `Include "${r}" instead.` });
    }
    shown.add(r);
  });

  view.exclude.forEach((entry, i) => {
    const line = view.listLines.exclude[i] ?? view.lines.exclude;
    if (shown.delete(entry)) return;
    const known = ws.elements.has(entry) || ws.brokenIds.has(entry);
    diagnostics.push({
      severity: "warning",
      rule: "view-exclude-unused",
      message: known ? `"${entry}" in \`exclude\` isn't in this view anyway.` : `"${entry}" in \`exclude\` isn't an element.`,
      path: view.path,
      line,
      fix: known ? `Remove "${entry}" from \`exclude\`.` : didYouMean(ws, entry),
    });
  });

  const nodes = [...shown].map((id) => ws.elements.get(id)!).sort(compareElements);

  const groups = new Map<string, typeof lifted>();
  for (const l of lifted) {
    if (!shown.has(l.from) || !shown.has(l.to)) continue;
    const key = `${l.from}\u0000${l.to}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const edges: ViewEdge[] = [...groups.values()].map((group) => {
    const { from, to } = group[0]!;
    const direct = group.filter((g) => g.element === from && ws.elements.get(g.element)!.uses[g.index]!.to === to);
    const labelled = direct.length ? direct : group;
    const rels = labelled.map((g) => ws.elements.get(g.element)!.uses[g.index]!);
    return {
      from,
      to,
      description: joinLabels(rels.map((r) => r.description), "; "),
      technology: joinLabels(rels.map((r) => r.technology), ", "),
      implied: direct.length === 0,
      sources: group.map((g) => ({ element: g.element, index: g.index })),
    };
  });
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

  const boundary = view.level === "container" || view.level === "component" ? scope : undefined;
  return { view, boundary, nodes, edges, diagnostics };
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
