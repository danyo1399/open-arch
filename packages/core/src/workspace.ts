/** The model, indexed for queries, built from a parsed document. */
import { nodeOrder, parseDocument } from "./document.js";
import { ATTRIBUTE_KEYS, DEFAULT_CARDINALITY } from "./types.js";
import type { ArchElement, Diagnostic, OpenArchDocument, Screen, ScreenData, State, StateData, Sticky, StickyTarget, StickyTargetData, TransitionData, ViewDef, Widget, WidgetData } from "./types.js";

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
        .map(([sid, s]) => ({ id: sid, path: `views.${id}.stickies.${sid}`, text: s.text, on: s.on && stickyTarget(s.on), color: s.color ?? "yellow", at: s.at, notes: s.notes || undefined }))
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
      nodes: nodeOrder(v.nodes ?? {}).map((nid) => {
        const n = v.nodes![nid]!;
        return {
          id: nid,
          path: `views.${id}.nodes.${nid}`,
          name: n.name,
          parent: n.parent || undefined,
          description: n.description || undefined,
          technology: n.technology || undefined,
          infrastructure: n.infrastructure ?? false,
          instances: n.instances ?? 1,
          shape: n.shape ?? "box",
          runs: [...new Set(n.runs ?? [])],
        };
      }),
      connections: (v.connections ?? []).map((c, i) => ({
        path: `views.${id}.connections[${i}]`,
        number: i + 1,
        from: c.from,
        to: c.to,
        description: c.description || undefined,
        technology: c.technology || undefined,
      })),
      lanes: (v.lanes ?? []).map((l, i) => ({ id: l.id, path: `views.${id}.lanes[${i}]`, number: i + 1, name: l.name, description: l.description || undefined })),
      cards: (v.cards ?? []).map((c, i) => ({
        id: c.id,
        path: `views.${id}.cards[${i}]`,
        number: i + 1,
        kind: c.kind,
        name: c.name,
        description: c.description || undefined,
        lane: c.lane || undefined,
        from: [...new Set(c.from ?? [])],
      })),
      screens: (v.screens ?? []).map((s, i) => screen(s, `views.${id}.screens[${i}]`, i + 1)),
      shapes: (v.shapes ?? []).map((s, i) => ({
        id: s.id,
        path: `views.${id}.shapes[${i}]`,
        number: i + 1,
        kind: s.kind,
        text: s.text || undefined,
        at: s.at,
        points: s.points ?? [],
        size: s.size ?? "medium",
        color: s.color ?? "black",
        fill: s.fill,
        dashed: s.dashed ?? false,
      })),
      arrows: (v.arrows ?? []).map((a, i) => ({
        id: a.id,
        path: `views.${id}.arrows[${i}]`,
        from: a.from,
        to: a.to,
        text: a.text || undefined,
        heads: a.heads ?? "end",
        color: a.color ?? "black",
        dashed: a.dashed ?? false,
      })),
      blocks: (v.blocks ?? []).map((b, i) => ({
        id: b.id,
        path: `views.${id}.blocks[${i}]`,
        number: i + 1,
        kind: b.kind ?? "process",
        text: b.text,
        description: b.description || undefined,
        lane: b.lane || undefined,
        at: b.at,
      })),
      flows: (v.flows ?? []).map((f, i) => ({ path: `views.${id}.flows[${i}]`, number: i + 1, from: f.from, to: f.to, text: f.text || undefined })),
      entities: (v.entities ?? []).map((e, i) => {
        const path = `views.${id}.entities[${i}]`;
        return {
          id: e.id,
          path,
          number: i + 1,
          name: e.name,
          description: e.description || undefined,
          attributes: (e.attributes ?? []).map((a, k) => ({
            path: `${path}.attributes[${k}]`,
            number: k + 1,
            name: a.name,
            type: a.type || undefined,
            keys: ATTRIBUTE_KEYS.filter((key) => a.keys?.includes(key)),
            description: a.description || undefined,
          })),
          at: e.at,
        };
      }),
      links: (v.links ?? []).map((l, i) => ({
        path: `views.${id}.links[${i}]`,
        number: i + 1,
        from: l.from,
        to: l.to,
        cardinality: l.cardinality ? [l.cardinality[0], l.cardinality[1]] : [DEFAULT_CARDINALITY[0], DEFAULT_CARDINALITY[1]],
        text: l.text || undefined,
      })),
    });
  }
  for (const element of ws.elements.values()) {
    if (!element.parent) continue;
    ws.children.set(element.parent, [...(ws.children.get(element.parent) ?? []), element.id]);
  }
  return ws;
}

function screen(s: ScreenData, path: string, number: number): Screen {
  return { id: s.id, path, number, name: s.name, description: s.description || undefined, device: s.device ?? "desktop", widgets: widgets(s.widgets, path, s.id, undefined) };
}

/** A list of widgets, at `path` and its `widgets`, on a screen, and in a row or a panel, `parent`, or none. */
function widgets(list: WidgetData[] | undefined, path: string, screen: string, parent: string | undefined): Widget[] {
  return (list ?? []).map((w, i) => {
    const at = `${path}.widgets[${i}]`;
    return {
      id: w.id,
      path: at,
      number: i + 1,
      kind: w.kind,
      text: w.text || undefined,
      description: w.description || undefined,
      to: w.to || undefined,
      screen,
      parent,
      widgets: widgets(w.widgets, at, screen, w.id),
    };
  });
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

/** What a sticky note is on, with a relationship's kind always given. */
function stickyTarget(on: StickyTargetData): StickyTarget {
  return "element" in on ? { element: on.element } : { from: on.from, to: on.to, kind: on.kind ?? "association" };
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
