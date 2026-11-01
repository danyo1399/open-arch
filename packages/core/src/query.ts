/** Read-only questions about the model, used by `show` and later by the designer. */
import type { Workspace } from "./workspace.js";
import { childrenOf, compareElements, isInside } from "./model.js";
import type { ArchElement, Relationship, ViewDef } from "./types.js";
import { computeView, scopeProblems, type ComputedView } from "./views.js";

export interface ElementDescription {
  element: ArchElement;
  parent?: ArchElement;
  children: ArchElement[];
  uses: { rel: Relationship; target?: ArchElement }[];
  usedBy: { from: ArchElement; rel: Relationship }[];
  /** Relationships of elements inside this one, to or from elements outside it. */
  contentsUse: { from: ArchElement; rel: Relationship }[];
  contentsUsedBy: { from: ArchElement; rel: Relationship }[];
  /** Views that draw this element, as a box or as the frame around the view. */
  views: { view: ViewDef; as: "box" | "frame" }[];
}

export function describeElement(ws: Workspace, id: string): ElementDescription | undefined {
  const element = ws.elements.get(id);
  if (!element) return undefined;
  const usedBy: ElementDescription["usedBy"] = [];
  const contentsUse: ElementDescription["contentsUse"] = [];
  const contentsUsedBy: ElementDescription["contentsUsedBy"] = [];
  const within = (other: string) => other === id || isInside(ws, other, id);
  for (const other of [...ws.elements.values()].sort(compareElements)) {
    for (const rel of other.uses) {
      if (rel.to === id && other.id !== id) usedBy.push({ from: other, rel });
      const fromInside = other.id !== id && isInside(ws, other.id, id);
      if (fromInside && !within(rel.to)) contentsUse.push({ from: other, rel });
      if (!within(other.id) && rel.to !== id && isInside(ws, rel.to, id)) contentsUsedBy.push({ from: other, rel });
    }
  }
  const views: ElementDescription["views"] = [];
  for (const cv of computeAllViews(ws)) {
    if (cv.boundary?.id === id) views.push({ view: cv.view, as: "frame" });
    else if (cv.nodes.some((n) => n.id === id)) views.push({ view: cv.view, as: "box" });
  }
  return {
    element,
    parent: element.parent ? ws.elements.get(element.parent) : undefined,
    children: childrenOf(ws, id).sort(compareElements),
    uses: element.uses.map((rel) => ({ rel, target: ws.elements.get(rel.to) })),
    usedBy,
    contentsUse,
    contentsUsedBy,
    views,
  };
}

/** Every view whose scope is valid, computed, in ID order. */
export function computeAllViews(ws: Workspace): ComputedView[] {
  return [...ws.views.values()]
    .filter((v) => scopeProblems(ws, v).length === 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((v) => computeView(ws, v));
}

export interface TreeNode {
  element: ArchElement;
  children: TreeNode[];
}

/**
 * The model as a tree: people and systems at the top, their contents below.
 * Each level is in `compare`'s order: by kind and then ID, unless another is given.
 */
export function modelTree(ws: Workspace, compare: (a: ArchElement, b: ArchElement) => number = compareElements): TreeNode[] {
  const build = (e: ArchElement): TreeNode => ({ element: e, children: childrenOf(ws, e.id).sort(compare).map(build) });
  // Elements whose parent is missing still appear, at the top, so nothing is hidden.
  const roots = [...ws.elements.values()].filter((e) => !e.parent || !ws.elements.has(e.parent)).sort(compare);
  return roots.map(build);
}
