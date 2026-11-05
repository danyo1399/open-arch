/** The model, indexed for queries, built from a parsed document. */
import { parseDocument } from "./document.js";
import type { ArchElement, Diagnostic, OpenArchDocument, State, StateData, Sticky, TransitionData, ViewDef } from "./types.js";

export interface Workspace {
  doc: OpenArchDocument;
  elements: Map<string, ArchElement>;
  views: Map<string, ViewDef>;
  /** Element ID → IDs of its direct children. */
  children: Map<string, string[]>;
  /** Problems with the file's shape, from parsing. `checkWorkspace` adds the rest. */
  diagnostics: Diagnostic[];
  /** False when parsing had to leave parts of the file out; such a workspace mustn't be written back. */
  valid: boolean;
}

export function buildWorkspace(doc: OpenArchDocument, diagnostics: Diagnostic[] = [], valid = true): Workspace {
  const ws: Workspace = { doc, elements: new Map(), views: new Map(), children: new Map(), diagnostics, valid };
  for (const [id, e] of Object.entries(doc.elements)) {
    ws.elements.set(id, {
      id,
      path: `elements.${id}`,
      kind: e.kind,
      name: e.name,
      parent: e.parent,
      description: e.description || undefined,
      technology: e.technology || undefined,
      external: e.external ?? false,
      shape: e.kind === "person" || e.kind === "class" ? "box" : (e.shape ?? "box"),
      stereotype: e.stereotype || undefined,
      libraries: e.kind === "container" ? [...new Set(e.libraries ?? [])] : [],
      tags: e.tags ?? {},
      notes: e.notes || undefined,
      members: e.members ?? [],
      uses: (e.uses ?? []).map((r, index) => ({
        to: r.to,
        kind: r.kind ?? "association",
        bidirectional: r.bidirectional ?? false,
        description: r.description || undefined,
        technology: r.technology || undefined,
        tags: r.tags ?? {},
        notes: r.notes || undefined,
        index,
      })),
    });
  }
  for (const [id, v] of Object.entries(doc.views)) {
    ws.views.set(id, {
      id,
      path: `views.${id}`,
      title: v.title,
      description: v.description || undefined,
      level: v.level,
      scope: v.scope,
      include: v.include ?? ["*"],
      exclude: v.exclude ?? [],
      notes: v.notes || undefined,
      stickies: Object.entries(v.stickies ?? {})
        .map(([sid, s]) => ({ id: sid, path: `views.${id}.stickies.${sid}`, text: s.text, color: s.color ?? "yellow", at: s.at }))
        .sort(readingOrder),
      layout: v.layout ?? {},
      steps: (v.steps ?? []).map((step, i) => ({
        path: `views.${id}.steps[${i}]`,
        number: i + 1,
        from: step.from,
        to: step.to,
        description: step.description || undefined,
        technology: step.technology || undefined,
        reply: step.reply ?? false,
      })),
      states: statesInOrder(v.states ?? {}, v.initial, v.transitions ?? []).map(([sid, s]) => ({
        id: sid,
        path: `views.${id}.states.${sid}`,
        name: s.name,
        description: s.description || undefined,
        final: s.final ?? false,
        at: s.at,
      })),
      initial: v.initial || undefined,
      transitions: (v.transitions ?? []).map((t, i) => ({
        path: `views.${id}.transitions[${i}]`,
        number: i + 1,
        from: t.from,
        to: t.to,
        event: t.event || undefined,
        guard: t.guard || undefined,
        action: t.action || undefined,
      })),
    });
  }
  for (const element of ws.elements.values()) {
    if (!element.parent) continue;
    ws.children.set(element.parent, [...(ws.children.get(element.parent) ?? []), element.id]);
  }
  return ws;
}

/**
 * States in reading order: the initial state, then the states transitions lead to from it, in the
 * order of the transitions, then those leading on from them, and so on; then the rest, by ID.
 */
function statesInOrder(states: Record<string, StateData>, initial: string | undefined, transitions: TransitionData[]): [string, StateData][] {
  const order: string[] = [];
  const visit = (id: string) => {
    if (Object.hasOwn(states, id) && !order.includes(id)) order.push(id);
  };
  if (initial) visit(initial);
  for (let i = 0; i < order.length; i++) for (const t of transitions) if (t.from === order[i]) visit(t.to);
  for (const id of Object.keys(states).sort()) visit(id);
  return order.map((id) => [id, states[id]!]);
}

/** Placed notes top to bottom, then left to right; unplaced ones after them, by ID. */
function readingOrder(a: Sticky, b: Sticky): number {
  if (a.at && b.at) return a.at[1] - b.at[1] || a.at[0] - b.at[0] || (a.id < b.id ? -1 : 1);
  if (a.at || b.at) return a.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Parse the text of a .openarch file and build its workspace. */
export function loadWorkspace(text: string): Workspace {
  const { doc, diagnostics, valid } = parseDocument(text);
  return buildWorkspace(doc, diagnostics, valid);
}
