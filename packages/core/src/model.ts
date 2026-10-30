import type { Workspace } from "./workspace.js";
import type { ArchElement, ElementKind, Tags } from "./types.js";

export const KIND_RANK: Record<ElementKind, number> = { person: 0, system: 1, container: 2, component: 3 };

/** The kind a parent must have, or undefined when the kind is top-level. */
export const PARENT_KIND: Record<ElementKind, ElementKind | undefined> = {
  person: undefined,
  system: undefined,
  container: "system",
  component: "container",
};

/** The element followed by its ancestors, nearest first. Stops at unknown parents and cycles. */
export function lineage(ws: Workspace, id: string): ArchElement[] {
  const chain: ArchElement[] = [];
  const visited = new Set<string>();
  let current = ws.elements.get(id);
  while (current && !visited.has(current.id)) {
    chain.push(current);
    visited.add(current.id);
    current = current.parent ? ws.elements.get(current.parent) : undefined;
  }
  return chain;
}

export function topLevel(ws: Workspace, id: string): ArchElement | undefined {
  const chain = lineage(ws, id);
  return chain[chain.length - 1];
}

/** True when `id` is inside `ancestorId` at any depth (not when they're equal). */
export function isInside(ws: Workspace, id: string, ancestorId: string): boolean {
  return lineage(ws, id).slice(1).some((e) => e.id === ancestorId);
}

export function childrenOf(ws: Workspace, id: string): ArchElement[] {
  return (ws.children.get(id) ?? []).map((c) => ws.elements.get(c)!).filter(Boolean);
}

export function compareElements(a: ArchElement, b: ArchElement): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Tags by name, in the order the file keeps them: by UTF-16 code unit, the same on every machine. */
export function tagEntries(tags: Tags): [string, string][] {
  return Object.keys(tags)
    .sort()
    .map((name) => [name, tags[name]!]);
}

/** Tags on one line, like `owner=payments, pii`. */
export function tagText(tags: Tags): string {
  return tagEntries(tags)
    .map(([name, value]) => (value ? `${name}=${value}` : name))
    .join(", ");
}

export function kindLabel(element: ArchElement): string {
  const kind = element.kind[0]!.toUpperCase() + element.kind.slice(1);
  return element.external ? `External ${kind}` : kind;
}
