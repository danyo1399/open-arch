/** Small questions about the model that the designer's UI asks. */
import { computeAllViews, describeElement, isInside, type ArchElement, type ComputedView, type Relationship, type ViewDef, type Workspace } from "@open-arch/core";

/** IDs the designer gives new elements before they have a name. */
export const PLACEHOLDER_ID = /^new-(person|system|container|component)(-\d+)?$/;

/** `base`, or `base-2`, `base-3`, ... whichever isn't taken by an element or view other than `self`. */
export function uniqueId(ws: Workspace, base: string, self?: string): string {
  const taken = (id: string) => id !== self && (ws.elements.has(id) || ws.views.has(id));
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

/**
 * Operations name a relationship by its target and which one it is among the
 * element's relationships to that target. This turns a position in `uses` into that.
 */
export function relationshipRef(element: ArchElement, position: number): { from: string; to: string; index: number } {
  const to = element.uses[position]!.to;
  return { from: element.id, to, index: element.uses.slice(0, position).filter((r) => r.to === to).length };
}

/** What deleting an element would remove, for the confirmation dialog. */
export function deletePlan(ws: Workspace, id: string): { inside: ArchElement[]; views: ViewDef[]; affected: ArchElement[] } {
  const gone = new Set([id, ...[...ws.elements.keys()].filter((e) => isInside(ws, e, id))]);
  return {
    inside: [...gone].filter((e) => e !== id).map((e) => ws.elements.get(e)!),
    views: [...ws.views.values()].filter((v) => v.scope !== undefined && gone.has(v.scope)),
    affected: [...ws.elements.values()].filter((e) => !gone.has(e.id) && e.uses.some((r) => gone.has(r.to))),
  };
}

/** Whether a view can draw this element as its own box (rather than as the system or container around it). */
export function canShowAsBox(ws: Workspace, view: ViewDef, element: ArchElement): boolean {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  if (element.kind === "person" || element.kind === "system") {
    // The frame's own system has no box of its own.
    const frameSystem = view.level === "container" ? scope?.id : view.level === "component" ? scope?.parent : undefined;
    return element.id !== frameSystem;
  }
  if (view.level === "container") return element.parent === scope?.id;
  if (view.level === "component") return element.parent === scope?.id || (element.kind === "container" && element.parent === scope?.parent && element.id !== scope?.id);
  return false;
}

/**
 * What the open view can do with an element: hide its box, show it as a box, or neither,
 * as for the frame around the view or an element the view can't draw. `computed` is the
 * view as drawn, or null when it can't be drawn, which leaves nothing to hide.
 */
export function viewAction(ws: Workspace, view: ViewDef | null, computed: ComputedView | null, id: string): "show" | "hide" | null {
  const element = ws.elements.get(id);
  if (!view || !element || computed?.boundary?.id === id) return null;
  if (computed?.nodes.some((n) => n.id === id)) return "hide";
  return canShowAsBox(ws, view, element) ? "show" : null;
}

export interface Usages {
  /** Relationships to the element or to something inside it, each with an arrow that draws it, if any view does. */
  relationships: { from: ArchElement; rel: Relationship; arrow?: { view: string; from: string; to: string } }[];
  /** Views that draw the element, as a box or as the frame around the view, by title. */
  views: { view: ViewDef; as: "box" | "frame" }[];
}

/** What refers to an element, for "Find usages". Arrows are looked for in `preferView` first. */
export function findUsages(ws: Workspace, id: string, preferView?: string): Usages | undefined {
  const d = describeElement(ws, id);
  if (!d) return undefined;
  const computed = computeAllViews(ws).sort((a, b) => Number(b.view.id === preferView) - Number(a.view.id === preferView));
  const arrowFor = (from: string, index: number) => {
    for (const cv of computed) {
      const edge = cv.edges.find((e) => e.sources.some((s) => s.element === from && s.index === index));
      if (edge) return { view: cv.view.id, from: edge.from, to: edge.to };
    }
    return undefined;
  };
  return {
    relationships: [...d.usedBy, ...d.contentsUsedBy].map(({ from, rel }) => ({ from, rel, arrow: arrowFor(from.id, rel.index) })),
    views: d.views.sort((a, b) => a.view.title.localeCompare(b.view.title)),
  };
}
