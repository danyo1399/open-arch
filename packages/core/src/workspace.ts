/** The model, indexed for queries, built from a parsed document. */
import { parseDocument } from "./document.js";
import type { ArchElement, Diagnostic, OpenArchDocument, ViewDef } from "./types.js";

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
      tags: e.tags ?? [],
      properties: e.properties ?? {},
      notes: e.notes || undefined,
      uses: (e.uses ?? []).map((r, index) => ({ to: r.to, description: r.description || undefined, technology: r.technology || undefined, tags: r.tags ?? [], index })),
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
      layout: v.layout ?? {},
    });
  }
  for (const element of ws.elements.values()) {
    if (!element.parent) continue;
    ws.children.set(element.parent, [...(ws.children.get(element.parent) ?? []), element.id]);
  }
  return ws;
}

/** Parse the text of a .openarch file and build its workspace. */
export function loadWorkspace(text: string): Workspace {
  const { doc, diagnostics, valid } = parseDocument(text);
  return buildWorkspace(doc, diagnostics, valid);
}
