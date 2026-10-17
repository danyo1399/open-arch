/**
 * Single-purpose edits used by the designer: change fields, add and remove
 * relationships, delete elements, save positions, show or hide elements in a
 * view. Like ops.ts, each returns file changes and never touches a disk.
 */
import { isMap, isScalar, isSeq, type Document, type YAMLMap } from "yaml";
import { ELEMENT_KEY_ORDER, orderKeys, parseFrontmatter, RELATIONSHIP_KEY_ORDER, stringifyDoc, VIEW_KEY_ORDER } from "./frontmatter.js";
import { layoutBlockLines, parseLayout, type NodeLayout } from "./layout.js";
import { loadWorkspace, type ParsedFile, type Workspace } from "./load.js";
import { joinFile } from "./markdown.js";
import { isInside, PARENT_KIND } from "./model.js";
import { applyChanges, OpError, withRefreshedViews } from "./ops.js";
import type { ArchElement, FileChange, ViewDef } from "./types.js";
import { computeView, scopeProblems } from "./views.js";

/** Field values to set. `null` or an empty string removes the field. */
export interface ElementFields {
  name?: string;
  parent?: string;
  description?: string | null;
  technology?: string | null;
  external?: boolean;
  tags?: string[];
}

export function updateElement(ws: Workspace, id: string, fields: ElementFields): FileChange[] {
  const element = requireElement(ws, id);
  if (fields.name !== undefined && !fields.name.trim()) throw new OpError("The name can't be empty.");
  if (fields.parent !== undefined && fields.parent !== element.parent) {
    const wanted = PARENT_KIND[element.kind];
    const parent = ws.elements.get(fields.parent);
    if (!wanted) throw new OpError(`A ${element.kind} is top-level, so it can't have a parent.`);
    if (!parent) throw new OpError(`Parent "${fields.parent}" isn't an element.`);
    if (parent.kind !== wanted) throw new OpError(`A ${element.kind}'s parent must be a ${wanted}, but "${parent.id}" is a ${parent.kind}.`);
  }
  if (fields.external && PARENT_KIND[element.kind]) throw new OpError("Only people and systems can be external.");

  const change = editFrontmatter(ws, element.path, (map, doc) => {
    if (fields.name !== undefined) setField(map, doc, "name", fields.name.trim());
    if (fields.parent !== undefined) setField(map, doc, "parent", fields.parent);
    if (fields.description !== undefined) setField(map, doc, "description", fields.description?.trim());
    if (fields.technology !== undefined) setField(map, doc, "technology", fields.technology?.trim());
    if (fields.external !== undefined) setField(map, doc, "external", fields.external || undefined);
    if (fields.tags !== undefined) setField(map, doc, "tags", fields.tags.length ? fields.tags : undefined, true);
  });
  return change ? withRefreshedViews(ws, [change]) : [];
}

export interface RelationshipFields {
  description?: string | null;
  technology?: string | null;
}

/** Add `from uses to`. */
export function addRelationship(ws: Workspace, from: string, to: string, fields: RelationshipFields = {}): FileChange[] {
  const source = requireElement(ws, from);
  const target = requireElement(ws, to);
  if (source.id === target.id) throw new OpError("An element can't use itself.");
  if (isInside(ws, from, to) || isInside(ws, to, from)) {
    throw new OpError(`"${from}" and "${to}" contain one another, so the relationship couldn't be drawn.`);
  }
  const change = editFrontmatter(ws, source.path, (map, doc) => {
    const entry: Record<string, string> = { to };
    if (fields.description?.trim()) entry.description = fields.description.trim();
    if (fields.technology?.trim()) entry.technology = fields.technology.trim();
    const uses = map.get("uses", true);
    if (isSeq(uses)) uses.items.push(doc.createNode(entry));
    else map.set("uses", doc.createNode([entry]));
  });
  return withRefreshedViews(ws, [change!]);
}

/** Change one relationship, given its position in the element's `uses` array. */
export function updateRelationship(ws: Workspace, from: string, position: number, fields: RelationshipFields): FileChange[] {
  const { element, index } = requireRelationship(ws, from, position);
  const change = editFrontmatter(ws, element.path, (map, doc) => {
    const uses = map.get("uses", true);
    if (!isSeq(uses)) return;
    let item = uses.items[index];
    if (isScalar(item)) {
      item = doc.createNode({ to: String(item.value) });
      uses.items[index] = item;
    }
    if (!isMap(item)) return;
    if (fields.description !== undefined) setField(item, doc, "description", fields.description?.trim());
    if (fields.technology !== undefined) setField(item, doc, "technology", fields.technology?.trim());
    orderKeys(item, RELATIONSHIP_KEY_ORDER);
  });
  return change ? withRefreshedViews(ws, [change]) : [];
}

export function removeRelationship(ws: Workspace, from: string, position: number): FileChange[] {
  const { element, index } = requireRelationship(ws, from, position);
  const change = editFrontmatter(ws, element.path, (map) => {
    const uses = map.get("uses", true);
    if (!isSeq(uses)) return;
    uses.items.splice(index, 1);
    if (uses.items.length === 0) map.delete("uses");
  });
  return change ? withRefreshedViews(ws, [change]) : [];
}

export interface DeletePlan {
  /** The element and everything inside it. */
  elements: ArchElement[];
  /** Views scoped to one of those elements; they're deleted too. */
  views: ViewDef[];
  /** Elements that keep existing but lose relationships to the deleted ones. */
  affected: ArchElement[];
}

/** What deleting an element would remove, for a confirmation message. */
export function planDeleteElement(ws: Workspace, id: string): DeletePlan {
  requireElement(ws, id);
  const elements = [...ws.elements.values()].filter((e) => e.id === id || isInside(ws, e.id, id));
  const gone = new Set(elements.map((e) => e.id));
  return {
    elements,
    views: [...ws.views.values()].filter((v) => v.scope !== undefined && gone.has(v.scope)),
    affected: [...ws.elements.values()].filter((e) => !gone.has(e.id) && e.uses.some((r) => gone.has(r.to))),
  };
}

/** Delete an element, everything inside it, views scoped to them, and every reference to them. */
export function deleteElement(ws: Workspace, id: string): FileChange[] {
  const plan = planDeleteElement(ws, id);
  const gone = new Set(plan.elements.map((e) => e.id));
  const changes: FileChange[] = [
    ...plan.elements.map((e) => ({ path: e.path, content: null })),
    ...plan.views.map((v) => ({ path: v.path, content: null })),
  ];
  for (const element of plan.affected) {
    const change = editFrontmatter(ws, element.path, (map) => {
      const uses = map.get("uses", true);
      if (!isSeq(uses)) return;
      uses.items = uses.items.filter((item) => {
        const to = isMap(item) ? item.get("to") : isScalar(item) ? item.value : undefined;
        return !(typeof to === "string" && gone.has(to));
      });
      if (uses.items.length === 0) map.delete("uses");
    });
    if (change) changes.push(change);
  }
  const deletedViews = new Set(plan.views.map((v) => v.id));
  for (const view of ws.views.values()) {
    if (deletedViews.has(view.id)) continue;
    if (![...view.include, ...view.exclude].some((x) => gone.has(x))) continue;
    const change = editFrontmatter(ws, view.path, (map) => {
      for (const key of ["include", "exclude"]) {
        const list = map.get(key, true);
        if (isSeq(list)) list.items = list.items.filter((item) => !(isScalar(item) && gone.has(String(item.value))));
      }
    });
    if (change) changes.push(change);
  }
  return withRefreshedViews(ws, changes);
}

export function deleteView(ws: Workspace, id: string): FileChange[] {
  const view = requireView(ws, id);
  return [{ path: view.path, content: null }];
}

export function updateView(ws: Workspace, id: string, fields: { title?: string; description?: string | null }): FileChange[] {
  const view = requireView(ws, id);
  if (fields.title !== undefined && !fields.title.trim()) throw new OpError("The title can't be empty.");
  const change = editFrontmatter(ws, view.path, (map, doc) => {
    if (fields.title !== undefined) setField(map, doc, "title", fields.title.trim());
    if (fields.description !== undefined) setField(map, doc, "description", fields.description?.trim());
  });
  return change ? [change] : [];
}

/** Replace the saved positions of a view. Other keys in the layout comment are kept. */
export function setLayout(ws: Workspace, viewId: string, nodes: Record<string, NodeLayout>): FileChange[] {
  const view = requireView(ws, viewId);
  const file = ws.files.get(view.path)!;
  const block = file.blocks.layout;
  const previous = block ? parseLayout(block.json) : undefined;
  const extras = previous?.ok ? previous.layout : {};
  const rounded = Object.fromEntries(
    Object.entries(nodes).map(([id, n]) => [id, Object.fromEntries(Object.entries(n).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v])) as NodeLayout]),
  );
  const lines = layoutBlockLines({ ...extras, nodes: rounded });
  let body = file.blocks.lines;
  if (block) {
    body = [...body.slice(0, block.start), ...lines, ...body.slice(block.end + 1)];
  } else {
    body = [...body];
    while (body.length && body[body.length - 1]!.trim() === "") body.pop();
    body.push("", ...lines);
  }
  const text = joinFile(file.split.frontmatter || "\n", body.join("\n"), file.split.eol);
  return text === originalText(ws, view.path) ? [] : [{ path: view.path, content: text }];
}

/** Hide an element from a view: drop it from `include`, and add it to `exclude` if `*` still shows it. */
export function hideInView(ws: Workspace, viewId: string, elementId: string): FileChange[] {
  const edit = new ListEditor(ws, viewId);
  edit.step("include", (items) => items.filter((x) => x !== elementId));
  if (edit.shows(elementId)) edit.step("exclude", (items) => [...items, elementId]);
  return edit.result();
}

/** Show an element in a view: drop it from `exclude`, and add it to `include` if it still isn't shown. */
export function showInView(ws: Workspace, viewId: string, elementId: string): FileChange[] {
  requireElement(ws, elementId);
  const edit = new ListEditor(ws, viewId);
  edit.step("exclude", (items) => items.filter((x) => x !== elementId));
  if (!edit.shows(elementId)) edit.step("include", (items) => [...items, elementId]);
  return edit.result();
}

/** Successive edits to one view's include/exclude lists; the last change holds them all. */
class ListEditor {
  private current: Workspace;
  private change: FileChange | null = null;

  constructor(
    private readonly ws: Workspace,
    private readonly viewId: string,
  ) {
    requireView(ws, viewId);
    this.current = ws;
  }

  step(key: "include" | "exclude", fn: (items: string[]) => string[]): void {
    const change = editList(this.current, this.current.views.get(this.viewId)!, key, fn);
    if (!change) return;
    this.change = change;
    this.current = loadWorkspace(applyChanges(this.ws.inputs, [change]), this.ws.config);
  }

  shows(elementId: string): boolean {
    const view = this.current.views.get(this.viewId)!;
    return scopeProblems(this.current, view).length === 0 && computeView(this.current, view).nodes.some((n) => n.id === elementId);
  }

  result(): FileChange[] {
    return this.change ? withRefreshedViews(this.ws, [this.change]) : [];
  }
}

// --- helpers -------------------------------------------------------------

function originalText(ws: Workspace, path: string): string | undefined {
  return ws.inputs.find((f) => f.path === path)?.text;
}

function requireElement(ws: Workspace, id: string): ArchElement {
  const element = ws.elements.get(id);
  if (!element) throw new OpError(`No element has the ID "${id}".`);
  return element;
}

function requireView(ws: Workspace, id: string): ViewDef {
  const view = ws.views.get(id);
  if (!view) throw new OpError(`No view has the ID "${id}".`);
  return view;
}

function requireRelationship(ws: Workspace, from: string, position: number) {
  const element = requireElement(ws, from);
  const rel = element.uses[position];
  if (!rel) throw new OpError(`"${from}" has no relationship number ${position + 1}.`);
  return { element, index: rel.index };
}

/** Edit one list field of a view (include/exclude), keeping its style. Returns null when nothing changed. */
function editList(ws: Workspace, view: ViewDef, key: "include" | "exclude", fn: (items: string[]) => string[]): FileChange | null {
  const current = view[key];
  const next = fn(current);
  if (next.length === current.length && next.every((x, i) => x === current[i])) return null;
  return editFrontmatter(ws, view.path, (map, doc) => {
    const existing = map.get(key, true);
    const flow = isSeq(existing) ? existing.flow ?? false : true;
    // An empty exclude list is the default, so drop it. An empty include list stays: it means "show nothing".
    if (key === "exclude" && next.length === 0) map.delete(key);
    else setField(map, doc, key, next, flow);
  });
}

/**
 * Parse a file's frontmatter, let `fn` change it, and return the new file
 * text, or null when nothing changed.
 */
function editFrontmatter(ws: Workspace, path: string, fn: (map: YAMLMap, doc: Document) => void): FileChange | null {
  const file: ParsedFile | undefined = ws.files.get(path);
  if (!file?.fm) throw new OpError(`${path} has frontmatter errors; fix them first.`);
  const fm = parseFrontmatter(file.split.frontmatter, file.split.frontmatterLine);
  const doc = fm.doc as Document;
  const map = doc.contents as YAMLMap;
  const before = stringifyDoc(doc);
  fn(map, doc);
  orderKeys(map, file.role === "element" ? ELEMENT_KEY_ORDER : VIEW_KEY_ORDER);
  const after = stringifyDoc(doc);
  if (after === before) return null;
  return { path, content: joinFile(after, file.split.body, file.split.eol) };
}

/** Set or remove a field, keeping the existing scalar's quoting where possible. */
function setField(map: YAMLMap, doc: Document, key: string, value: unknown, flow = false): void {
  if (value === undefined || value === null || value === "") {
    map.delete(key);
    return;
  }
  const existing = map.get(key, true);
  if (isScalar(existing) && typeof value !== "object") {
    existing.value = value;
    return;
  }
  const node = doc.createNode(value);
  if (flow && isSeq(node)) node.flow = true;
  map.set(key, node);
}

