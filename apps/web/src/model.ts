/** Small questions about the model that the designer's UI asks. */
import { isInside, type ArchElement, type ViewDef, type Workspace } from "@open-arch/core";

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
