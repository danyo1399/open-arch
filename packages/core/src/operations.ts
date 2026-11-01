/**
 * Every change to a workspace is an operation. Agents send them through the
 * CLI, the designer sends them from the UI, and `applyOperations` checks each
 * one, applies the batch to a copy, and rejects the whole batch if the model
 * would end up with new errors. Nothing edits the document any other way.
 */
import { checkWorkspace } from "./check.js";
import { isInside, PARENT_KIND } from "./model.js";
import { suggest } from "./suggest.js";
import {
  ELEMENT_KINDS,
  ELEMENT_SHAPES,
  ID_PATTERN,
  STICKY_COLORS,
  VIEW_LEVELS,
  type Diagnostic,
  type ElementData,
  type ElementKind,
  type ElementShape,
  type OpenArchDocument,
  type Position,
  type RelationshipData,
  type StickyColor,
  type StickyData,
  type Tags,
  type ViewData,
  type ViewLevel,
} from "./types.js";
import { computeView, scopeProblems } from "./views.js";
import { buildWorkspace } from "./workspace.js";

/** Changes to tags: a value sets a tag (an empty one makes it a plain label) and null removes it. */
export type TagChanges = Record<string, string | null>;

export type Operation =
  | { op: "add-element"; id: string; kind: ElementKind; parent?: string; name?: string; description?: string; technology?: string; external?: boolean; shape?: ElementShape; tags?: Tags; notes?: string }
  | { op: "update-element"; id: string; name?: string; parent?: string; description?: string | null; technology?: string | null; external?: boolean; shape?: ElementShape | null; tags?: TagChanges; notes?: string | null }
  | { op: "remove-element"; id: string }
  | { op: "rename"; id: string; to: string }
  | { op: "add-relationship"; from: string; to: string; description?: string; technology?: string; tags?: Tags; notes?: string }
  | { op: "update-relationship"; from: string; to: string; index?: number; newFrom?: string; newTo?: string; description?: string | null; technology?: string | null; tags?: TagChanges; notes?: string | null }
  | { op: "remove-relationship"; from: string; to: string; index?: number }
  | { op: "add-view"; id: string; level: ViewLevel; scope?: string; title?: string; description?: string; include?: string[]; exclude?: string[]; notes?: string }
  | { op: "update-view"; id: string; title?: string; description?: string | null; include?: string[]; exclude?: string[]; notes?: string | null }
  | { op: "remove-view"; id: string }
  | { op: "show-in-view"; view: string; id: string }
  | { op: "hide-in-view"; view: string; id: string }
  | { op: "set-layout"; view: string; positions: Record<string, Position | null> }
  | { op: "add-sticky"; view: string; id: string; text: string; color?: StickyColor; at?: [number, number] }
  | { op: "update-sticky"; view: string; id: string; text?: string; color?: StickyColor; at?: [number, number] | null }
  | { op: "remove-sticky"; view: string; id: string }
  | { op: "update-workspace"; name?: string; description?: string | null; docs?: string | null };

export type OperationName = Operation["op"];

/** A refused change. `diagnostics` lists the errors it would have caused, when that's why. */
export class OpError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message);
  }
}

// --- Checking the shape of operations sent as JSON ----------------------------------

type FieldType = "string" | "nullable-string" | "boolean" | "strings" | "tags" | "nullable-tags" | "index" | "positions" | "point" | "nullable-point";

const SHAPES: Record<OperationName, { required: string[]; fields: Record<string, FieldType> }> = {
  "add-element": {
    required: ["id", "kind"],
    fields: { id: "string", kind: "string", parent: "string", name: "string", description: "string", technology: "string", external: "boolean", shape: "string", tags: "tags", notes: "string" },
  },
  "update-element": {
    required: ["id"],
    fields: { id: "string", name: "string", parent: "string", description: "nullable-string", technology: "nullable-string", external: "boolean", shape: "nullable-string", tags: "nullable-tags", notes: "nullable-string" },
  },
  "remove-element": { required: ["id"], fields: { id: "string" } },
  rename: { required: ["id", "to"], fields: { id: "string", to: "string" } },
  "add-relationship": { required: ["from", "to"], fields: { from: "string", to: "string", description: "string", technology: "string", tags: "tags", notes: "string" } },
  "update-relationship": {
    required: ["from", "to"],
    fields: { from: "string", to: "string", index: "index", newFrom: "string", newTo: "string", description: "nullable-string", technology: "nullable-string", tags: "nullable-tags", notes: "nullable-string" },
  },
  "remove-relationship": { required: ["from", "to"], fields: { from: "string", to: "string", index: "index" } },
  "add-view": {
    required: ["id", "level"],
    fields: { id: "string", level: "string", scope: "string", title: "string", description: "string", include: "strings", exclude: "strings", notes: "string" },
  },
  "update-view": { required: ["id"], fields: { id: "string", title: "string", description: "nullable-string", include: "strings", exclude: "strings", notes: "nullable-string" } },
  "remove-view": { required: ["id"], fields: { id: "string" } },
  "show-in-view": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "hide-in-view": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "set-layout": { required: ["view", "positions"], fields: { view: "string", positions: "positions" } },
  "add-sticky": { required: ["view", "id", "text"], fields: { view: "string", id: "string", text: "string", color: "string", at: "point" } },
  "update-sticky": { required: ["view", "id"], fields: { view: "string", id: "string", text: "string", color: "string", at: "nullable-point" } },
  "remove-sticky": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "update-workspace": { required: [], fields: { name: "string", description: "nullable-string", docs: "nullable-string" } },
};

export const OPERATION_NAMES = Object.keys(SHAPES) as OperationName[];

function fits(type: FieldType, value: unknown): boolean {
  const isPoint = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  switch (type) {
    case "string":
      return typeof value === "string";
    case "nullable-string":
      return typeof value === "string" || value === null;
    case "boolean":
      return typeof value === "boolean";
    case "strings":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "tags":
      return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
    case "nullable-tags":
      return isRecord(value) && Object.values(value).every((v) => typeof v === "string" || v === null);
    case "index":
      return Number.isInteger(value) && (value as number) >= 0;
    case "positions":
      return (
        isRecord(value) &&
        Object.values(value).every((p) => p === null || (Array.isArray(p) && (p.length === 2 || p.length === 4) && p.every((n) => typeof n === "number" && Number.isFinite(n))))
      );
    case "point":
      return isPoint(value);
    case "nullable-point":
      return value === null || isPoint(value);
  }
}

const TYPE_TEXT: Record<FieldType, string> = {
  string: "a string",
  "nullable-string": "a string, or null to remove it",
  boolean: "true or false",
  strings: "a list of strings",
  tags: 'an object of tag names and string values, like { "owner": "payments" }',
  "nullable-tags": 'an object of tag names and string values, like { "owner": "payments" } (null removes a tag)',
  index: "a whole number, 0 or more",
  positions: "an object of [x, y] positions (null removes one)",
  point: "a position, [x, y]",
  "nullable-point": "a position, [x, y], or null to let the designer place it",
};

/** Check operations received as JSON: an operation object or a list of them. */
export function parseOperations(raw: unknown): Operation[] {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length === 0) throw new OpError("There are no operations to apply.");
  return list.map((item, i) => {
    const where = list.length > 1 ? `Operation ${i + 1}: ` : "";
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new OpError(`${where}each operation must be an object like { "op": "add-element", ... }.`);
    const record = item as Record<string, unknown>;
    const name = record.op;
    const shape = typeof name === "string" ? SHAPES[name as OperationName] : undefined;
    if (!shape) {
      const near = typeof name === "string" ? suggest(name, OPERATION_NAMES) : undefined;
      throw new OpError(`${where}unknown "op" ${JSON.stringify(name)}.${near ? ` Did you mean "${near}"?` : ""} Operations: ${OPERATION_NAMES.join(", ")}.`);
    }
    for (const key of Object.keys(record)) {
      if (key === "op") continue;
      const type = shape.fields[key];
      if (!type) {
        const near = suggest(key, Object.keys(shape.fields));
        throw new OpError(`${where}${name} has no field "${key}".${near ? ` Did you mean "${near}"?` : ""} Fields: ${Object.keys(shape.fields).join(", ")}.`);
      }
      if (!fits(type, record[key])) throw new OpError(`${where}${name}: "${key}" must be ${TYPE_TEXT[type]}.`);
    }
    for (const key of shape.required) if (record[key] === undefined) throw new OpError(`${where}${name} needs "${key}".`);
    return record as Operation;
  });
}

// --- Applying ---------------------------------------------------------------------

export interface ApplyResult {
  doc: OpenArchDocument;
  /** One line per operation, e.g. "added container cache". */
  summary: string[];
  /** Warnings the changes introduced. They don't stop the changes. */
  warnings: Diagnostic[];
}

export function applyOperations(doc: OpenArchDocument, ops: Operation[]): ApplyResult {
  const before = checkWorkspace(buildWorkspace(doc));
  const draft = JSON.parse(JSON.stringify(doc)) as OpenArchDocument;
  const summary: string[] = [];
  ops.forEach((op, i) => {
    try {
      summary.push(applyOne(draft, op));
    } catch (error) {
      if (error instanceof OpError && ops.length > 1) throw new OpError(`Operation ${i + 1} (${op.op}): ${error.message}`, error.diagnostics);
      throw error;
    }
  });
  pruneLayouts(draft);

  // Compare by rule and message, not location: positions in lists shift as things are removed.
  const counts = new Map<string, number>();
  const key = (d: Diagnostic) => `${d.rule}\u0000${d.message}`;
  for (const d of before) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1);
  const added: Diagnostic[] = [];
  for (const d of checkWorkspace(buildWorkspace(draft))) {
    const left = counts.get(key(d)) ?? 0;
    if (left > 0) counts.set(key(d), left - 1);
    else added.push(d);
  }
  const errors = added.filter((d) => d.severity === "error");
  if (errors.length) {
    throw new OpError(
      `Nothing was changed: the changes would leave the model with ${errors.length === 1 ? "an error" : `${errors.length} errors`}:\n${errors.map((d) => `  ${d.path}: ${d.message}${d.fix ? ` ${d.fix}` : ""}`).join("\n")}`,
      errors,
    );
  }
  return { doc: draft, summary, warnings: added.filter((d) => d.severity === "warning") };
}

function applyOne(doc: OpenArchDocument, op: Operation): string {
  switch (op.op) {
    case "add-element":
      return addElement(doc, op);
    case "update-element":
      return updateElement(doc, op);
    case "remove-element":
      return removeElement(doc, op.id);
    case "rename":
      return rename(doc, op.id, op.to);
    case "add-relationship":
      return addRelationship(doc, op);
    case "update-relationship":
      return updateRelationship(doc, op);
    case "remove-relationship": {
      const { element, position } = findRelationship(doc, op.from, op.to, op.index);
      element.uses!.splice(position, 1);
      if (element.uses!.length === 0) delete element.uses;
      return `removed relationship ${op.from} -> ${op.to}`;
    }
    case "add-view":
      return addView(doc, op);
    case "update-view":
      return updateView(doc, op);
    case "remove-view":
      requireView(doc, op.id);
      delete doc.views[op.id];
      return `removed view ${op.id}`;
    case "show-in-view":
      return showInView(doc, op.view, op.id);
    case "hide-in-view":
      return hideInView(doc, op.view, op.id);
    case "set-layout":
      return setLayout(doc, op.view, op.positions);
    case "add-sticky":
      return addSticky(doc, op);
    case "update-sticky":
      return updateSticky(doc, op);
    case "remove-sticky": {
      const view = requireView(doc, op.view);
      requireSticky(view, op.view, op.id);
      delete view.stickies![op.id];
      if (Object.keys(view.stickies!).length === 0) delete view.stickies;
      return `removed sticky note ${op.id} from view ${op.view}`;
    }
    case "update-workspace":
      return updateWorkspace(doc, op);
  }
}

function addElement(doc: OpenArchDocument, op: Extract<Operation, { op: "add-element" }>): string {
  assertNewId(doc, op.id);
  if (!(ELEMENT_KINDS as readonly string[]).includes(op.kind)) throw new OpError(`Unknown kind "${op.kind}". Use one of: ${ELEMENT_KINDS.join(", ")}.`);
  checkParent(doc, op.kind, op.parent);
  if (op.external && PARENT_KIND[op.kind]) throw new OpError("Only people and systems can be external.");
  checkShape(op.kind, op.shape);
  doc.elements[op.id] = clean<ElementData>({
    kind: op.kind,
    name: op.name?.trim() || titleFromId(op.id),
    parent: op.parent,
    description: op.description?.trim(),
    technology: op.technology?.trim(),
    external: op.external || undefined,
    shape: op.shape === "box" ? undefined : op.shape,
    tags: changeTags(undefined, op.tags ?? {}),
    notes: op.notes?.trim(),
  });
  return `added ${op.kind} ${op.id}`;
}

function updateElement(doc: OpenArchDocument, op: Extract<Operation, { op: "update-element" }>): string {
  const e = requireElement(doc, op.id);
  const fields = ["name", "parent", "description", "technology", "external", "shape", "tags", "notes"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on "${op.id}": ${fields.join(", ")}.`);
  if (op.name !== undefined) {
    if (!op.name.trim()) throw new OpError("The name can't be empty.");
    e.name = op.name.trim();
  }
  if (op.parent !== undefined && op.parent !== e.parent) {
    checkParent(doc, e.kind, op.parent);
    e.parent = op.parent;
  }
  for (const key of ["description", "technology", "notes"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete e[key];
    else e[key] = value.trim();
  }
  if (op.external !== undefined) {
    if (op.external && PARENT_KIND[e.kind]) throw new OpError("Only people and systems can be external.");
    if (op.external) e.external = true;
    else delete e.external;
  }
  if (op.shape !== undefined) {
    checkShape(e.kind, op.shape);
    if (op.shape === null || op.shape === "box") delete e.shape;
    else e.shape = op.shape;
  }
  if (op.tags !== undefined) {
    const tags = changeTags(e.tags, op.tags);
    if (tags) e.tags = tags;
    else delete e.tags;
  }
  return `updated ${op.id}`;
}

function removeElement(doc: OpenArchDocument, id: string): string {
  requireElement(doc, id);
  const ws = buildWorkspace(doc);
  const gone = new Set([id, ...[...ws.elements.keys()].filter((other) => isInside(ws, other, id))]);
  for (const g of gone) delete doc.elements[g];
  for (const e of Object.values(doc.elements)) {
    if (!e.uses) continue;
    e.uses = e.uses.filter((r) => !gone.has(r.to));
    if (e.uses.length === 0) delete e.uses;
  }
  const removedViews: string[] = [];
  for (const [viewId, v] of Object.entries(doc.views)) {
    if (v.scope && gone.has(v.scope)) {
      delete doc.views[viewId];
      removedViews.push(viewId);
      continue;
    }
    if (v.include) v.include = v.include.filter((x) => !gone.has(x));
    if (v.exclude) v.exclude = v.exclude.filter((x) => !gone.has(x));
    if (v.exclude?.length === 0) delete v.exclude;
  }
  const extra = [gone.size > 1 ? `${gone.size - 1} element${gone.size === 2 ? "" : "s"} inside it` : "", removedViews.length ? `view${removedViews.length === 1 ? "" : "s"} ${removedViews.join(", ")}` : ""].filter(Boolean);
  return `removed ${id}${extra.length ? ` and ${extra.join(" and ")}` : ""}`;
}

function rename(doc: OpenArchDocument, from: string, to: string): string {
  if (from === to) throw new OpError("The new ID is the same as the old one.");
  if (doc.views[from] && !doc.elements[from]) {
    assertNewId(doc, to);
    doc.views = renameKey(doc.views, from, to);
    return `renamed view ${from} to ${to}`;
  }
  requireElement(doc, from);
  assertNewId(doc, to);
  doc.elements = renameKey(doc.elements, from, to);
  for (const e of Object.values(doc.elements)) {
    if (e.parent === from) e.parent = to;
    for (const r of e.uses ?? []) if (r.to === from) r.to = to;
  }
  for (const v of Object.values(doc.views)) {
    if (v.scope === from) v.scope = to;
    if (v.include) v.include = v.include.map((x) => (x === from ? to : x));
    if (v.exclude) v.exclude = v.exclude.map((x) => (x === from ? to : x));
    if (v.layout?.[from]) v.layout = renameKey(v.layout, from, to);
  }
  return `renamed ${from} to ${to}`;
}

function addRelationship(doc: OpenArchDocument, op: Extract<Operation, { op: "add-relationship" }>): string {
  const from = requireElement(doc, op.from);
  requireElement(doc, op.to);
  checkEnds(doc, op.from, op.to);
  const description = op.description?.trim() || undefined;
  if (from.uses?.some((r) => r.to === op.to && (r.description || undefined) === description)) {
    throw new OpError(`"${op.from}" already has this relationship to "${op.to}". Use update-relationship to change it.`);
  }
  from.uses = [
    ...(from.uses ?? []),
    clean<RelationshipData>({ to: op.to, description, technology: op.technology?.trim(), tags: changeTags(undefined, op.tags ?? {}), notes: op.notes?.trim() }),
  ];
  return `added relationship ${op.from} -> ${op.to}`;
}

/**
 * Changes a relationship's fields, and its ends: `newFrom` moves it to another element's `uses`,
 * at the end, and `newTo` points it at another element. It keeps its description, technology, tags and notes.
 */
function updateRelationship(doc: OpenArchDocument, op: Extract<Operation, { op: "update-relationship" }>): string {
  if (op.newFrom === undefined && op.newTo === undefined && op.description === undefined && op.technology === undefined && op.tags === undefined && op.notes === undefined) {
    throw new OpError("Say what to change: newFrom, newTo, description, technology, tags or notes.");
  }
  const { element, position } = findRelationship(doc, op.from, op.to, op.index);
  const rel = element.uses![position]!;
  for (const key of ["description", "technology", "notes"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete rel[key];
    else rel[key] = value.trim();
  }
  if (op.tags !== undefined) {
    const tags = changeTags(rel.tags, op.tags);
    if (tags) rel.tags = tags;
    else delete rel.tags;
  }
  const [from, to] = [op.newFrom ?? op.from, op.newTo ?? op.to];
  if (from === op.from && to === op.to) return `updated relationship ${op.from} -> ${op.to}`;
  const source = requireElement(doc, from);
  requireElement(doc, to);
  checkEnds(doc, from, to);
  if (source.uses?.some((r) => r !== rel && r.to === to && (r.description || undefined) === (rel.description || undefined))) {
    throw new OpError(`"${from}" already has this relationship to "${to}".`);
  }
  rel.to = to;
  if (from !== op.from) {
    element.uses!.splice(position, 1);
    if (element.uses!.length === 0) delete element.uses;
    source.uses = [...(source.uses ?? []), rel];
  }
  return `moved relationship ${op.from} -> ${op.to} to ${from} -> ${to}`;
}

function addView(doc: OpenArchDocument, op: Extract<Operation, { op: "add-view" }>): string {
  assertNewId(doc, op.id);
  if (!(VIEW_LEVELS as readonly string[]).includes(op.level)) throw new OpError(`Unknown level "${op.level}". Use one of: ${VIEW_LEVELS.join(", ")}.`);
  const ws = buildWorkspace(doc);
  const draft = { id: op.id, path: `views.${op.id}`, title: "", level: op.level, scope: op.scope, include: ["*"], exclude: [], stickies: [], layout: {} };
  const problems = scopeProblems(ws, draft);
  if (problems.length) throw new OpError(`${problems[0]!.message}${problems[0]!.fix ? ` ${problems[0]!.fix}` : ""}`);
  checkIds(doc, op.include, "include");
  checkIds(doc, op.exclude, "exclude");
  const scope = op.scope ? doc.elements[op.scope] : undefined;
  const title =
    op.title?.trim() || (scope ? `${scope.name} ${op.level === "context" ? "context" : op.level === "container" ? "containers" : "components"}` : "System landscape");
  doc.views[op.id] = clean<ViewData>({
    title,
    description: op.description?.trim(),
    level: op.level,
    scope: op.scope,
    include: op.include ? [...op.include] : ["*"],
    exclude: op.exclude?.length ? [...op.exclude] : undefined,
    notes: op.notes?.trim(),
  });
  return `added view ${op.id}`;
}

function updateView(doc: OpenArchDocument, op: Extract<Operation, { op: "update-view" }>): string {
  const view = requireView(doc, op.id);
  if (op.title === undefined && op.description === undefined && op.include === undefined && op.exclude === undefined && op.notes === undefined) {
    throw new OpError("Say what to change: title, description, include, exclude or notes.");
  }
  if (op.title !== undefined) {
    if (!op.title.trim()) throw new OpError("The title can't be empty.");
    view.title = op.title.trim();
  }
  for (const key of ["description", "notes"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete view[key];
    else view[key] = value.trim();
  }
  if (op.include !== undefined) {
    checkIds(doc, op.include, "include");
    view.include = [...op.include];
  }
  if (op.exclude !== undefined) {
    checkIds(doc, op.exclude, "exclude");
    if (op.exclude.length) view.exclude = [...op.exclude];
    else delete view.exclude;
  }
  return `updated view ${op.id}`;
}

function shows(doc: OpenArchDocument, viewId: string, id: string): boolean {
  const ws = buildWorkspace(doc);
  const view = ws.views.get(viewId)!;
  return scopeProblems(ws, view).length === 0 && computeView(ws, view).nodes.some((n) => n.id === id);
}

function showInView(doc: OpenArchDocument, viewId: string, id: string): string {
  const view = requireView(doc, viewId);
  requireElement(doc, id);
  if (shows(doc, viewId, id)) return `${id} is already in view ${viewId}`;
  if (view.exclude?.includes(id)) {
    view.exclude = view.exclude.filter((x) => x !== id);
    if (view.exclude.length === 0) delete view.exclude;
  }
  if (!shows(doc, viewId, id)) view.include = [...(view.include ?? ["*"]), id];
  if (!shows(doc, viewId, id)) {
    throw new OpError(`A ${view.level} view can't draw "${id}" as its own box: it's too detailed for this view, or it's the view's frame.`);
  }
  return `showed ${id} in view ${viewId}`;
}

function hideInView(doc: OpenArchDocument, viewId: string, id: string): string {
  const view = requireView(doc, viewId);
  requireElement(doc, id);
  if (!shows(doc, viewId, id)) throw new OpError(`"${id}" isn't a box in view "${viewId}".`);
  if (view.include?.includes(id)) view.include = view.include.filter((x) => x !== id);
  if (shows(doc, viewId, id)) view.exclude = [...(view.exclude ?? []), id];
  return `hid ${id} in view ${viewId}`;
}

function setLayout(doc: OpenArchDocument, viewId: string, positions: Record<string, Position | null>): string {
  const view = requireView(doc, viewId);
  const layout: Record<string, Position> = { ...view.layout };
  for (const [id, pos] of Object.entries(positions)) {
    if (pos === null) {
      delete layout[id];
      continue;
    }
    requireElement(doc, id);
    layout[id] = pos.map((n) => Math.round(n)) as Position;
  }
  if (Object.keys(layout).length) view.layout = layout;
  else delete view.layout;
  return `saved positions in view ${viewId}`;
}

function addSticky(doc: OpenArchDocument, op: Extract<Operation, { op: "add-sticky" }>): string {
  const view = requireView(doc, op.view);
  if (!ID_PATTERN.test(op.id)) throw new OpError(`"${op.id}" isn't a valid ID. IDs are lowercase kebab-case, like "start-here".`);
  if (view.stickies?.[op.id]) throw new OpError(`View "${op.view}" already has a sticky note "${op.id}".`);
  if (!op.text.trim()) throw new OpError("A sticky note needs some text.");
  checkColor(op.color);
  view.stickies = {
    ...view.stickies,
    [op.id]: clean<StickyData>({ text: op.text.trim(), color: op.color === "yellow" ? undefined : op.color, at: op.at && [Math.round(op.at[0]), Math.round(op.at[1])] }),
  };
  return `added sticky note ${op.id} to view ${op.view}`;
}

function updateSticky(doc: OpenArchDocument, op: Extract<Operation, { op: "update-sticky" }>): string {
  const view = requireView(doc, op.view);
  const sticky = requireSticky(view, op.view, op.id);
  if (op.text === undefined && op.color === undefined && op.at === undefined) throw new OpError("Say what to change: text, color or at.");
  if (op.text !== undefined) {
    if (!op.text.trim()) throw new OpError("A sticky note needs some text. Remove it with remove-sticky instead.");
    sticky.text = op.text.trim();
  }
  if (op.color !== undefined) {
    checkColor(op.color);
    if (op.color === "yellow") delete sticky.color;
    else sticky.color = op.color;
  }
  if (op.at === null) delete sticky.at;
  else if (op.at !== undefined) sticky.at = [Math.round(op.at[0]), Math.round(op.at[1])];
  return `updated sticky note ${op.id} in view ${op.view}`;
}

function updateWorkspace(doc: OpenArchDocument, op: Extract<Operation, { op: "update-workspace" }>): string {
  if (op.name === undefined && op.description === undefined && op.docs === undefined) throw new OpError("Say what to change: name, description or docs.");
  if (op.name !== undefined) {
    if (!op.name.trim()) throw new OpError("The workspace name can't be empty.");
    doc.name = op.name.trim();
  }
  if (op.description !== undefined) {
    if (op.description === null || !op.description.trim()) delete doc.description;
    else doc.description = op.description.trim();
  }
  if (op.docs !== undefined) {
    if (op.docs === null || !op.docs.trim()) delete doc.export;
    else doc.export = { docs: op.docs.trim().replace(/\\/g, "/") };
  }
  return "updated workspace";
}

/** Drop saved positions of elements a view no longer shows. */
export function pruneLayouts(doc: OpenArchDocument): void {
  const ws = buildWorkspace(doc);
  for (const [viewId, v] of Object.entries(doc.views)) {
    if (!v.layout) continue;
    const view = ws.views.get(viewId)!;
    if (scopeProblems(ws, view).length) continue;
    const shown = new Set(computeView(ws, view).nodes.map((n) => n.id));
    for (const id of Object.keys(v.layout)) if (!shown.has(id)) delete v.layout[id];
    if (Object.keys(v.layout).length === 0) delete v.layout;
  }
}

// --- Helpers ------------------------------------------------------------------------

function requireElement(doc: OpenArchDocument, id: string): ElementData {
  const e = doc.elements[id];
  if (!e) {
    const near = suggest(id, Object.keys(doc.elements));
    throw new OpError(`No element has the ID "${id}".${near ? ` Did you mean "${near}"?` : ""}`);
  }
  return e;
}

function requireView(doc: OpenArchDocument, id: string): ViewData {
  const v = doc.views[id];
  if (!v) {
    const near = suggest(id, Object.keys(doc.views));
    throw new OpError(`No view has the ID "${id}".${near ? ` Did you mean "${near}"?` : ""}`);
  }
  return v;
}

function requireSticky(view: ViewData, viewId: string, id: string): StickyData {
  const sticky = view.stickies?.[id];
  if (!sticky) {
    const ids = Object.keys(view.stickies ?? {});
    const near = suggest(id, ids);
    throw new OpError(`View "${viewId}" has no sticky note "${id}".${near ? ` Did you mean "${near}"?` : ids.length ? ` Its notes: ${ids.join(", ")}.` : ""}`);
  }
  return sticky;
}

function checkShape(kind: ElementKind, shape: string | null | undefined): void {
  if (shape === undefined || shape === null) return;
  if (!(ELEMENT_SHAPES as readonly string[]).includes(shape)) {
    const near = suggest(shape, ELEMENT_SHAPES);
    throw new OpError(`Unknown shape "${shape}".${near ? ` Did you mean "${near}"?` : ""} Use one of: ${ELEMENT_SHAPES.join(", ")}.`);
  }
  if (kind === "person" && shape !== "box") throw new OpError("People are always drawn as a person, so they don't take a shape.");
}

/**
 * The tags with the changes made, or undefined when none are left. New names are trimmed;
 * a removal names the tag exactly, so one written by hand with stray spaces can still go.
 * A Map, so a tag called "__proto__" is a tag like any other.
 */
function changeTags(tags: Tags | undefined, changes: TagChanges): Tags | undefined {
  const out = new Map(Object.entries(tags ?? {}));
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) {
      out.delete(name);
      continue;
    }
    if (!name.trim()) throw new OpError("A tag needs a name.");
    out.set(name.trim(), value.trim());
  }
  return out.size ? Object.fromEntries(out) : undefined;
}

function checkColor(color: string | undefined): void {
  if (color !== undefined && !(STICKY_COLORS as readonly string[]).includes(color)) throw new OpError(`Unknown color "${color}". Use one of: ${STICKY_COLORS.join(", ")}.`);
}

function assertNewId(doc: OpenArchDocument, id: string): void {
  if (!ID_PATTERN.test(id)) throw new OpError(`"${id}" isn't a valid ID. IDs are lowercase kebab-case, like "checkout-api".`);
  if (doc.elements[id]) throw new OpError(`The ID "${id}" is already used by an element.`);
  if (doc.views[id]) throw new OpError(`The ID "${id}" is already used by a view.`);
}

function checkParent(doc: OpenArchDocument, kind: ElementKind, parentId: string | undefined): void {
  const wanted = PARENT_KIND[kind];
  if (!wanted && parentId !== undefined) throw new OpError(`A ${kind} is top-level, so it can't have a parent.`);
  if (wanted && parentId === undefined) throw new OpError(`A ${kind} needs a parent ${wanted}: set "parent".`);
  if (parentId === undefined) return;
  const parent = requireElement(doc, parentId);
  if (parent.kind !== wanted) throw new OpError(`A ${kind}'s parent must be a ${wanted}, but "${parentId}" is a ${parent.kind}.`);
}

function checkIds(doc: OpenArchDocument, ids: string[] | undefined, field: string): void {
  for (const id of ids ?? []) {
    if (id === "*" && field === "include") continue;
    if (!doc.elements[id]) {
      const near = suggest(id, Object.keys(doc.elements));
      throw new OpError(`"${id}" in ${field} isn't an element.${near ? ` Did you mean "${near}"?` : ""}`);
    }
  }
}

/** Refuses a relationship no view could draw: from an element to itself, or between an element and something inside it. */
function checkEnds(doc: OpenArchDocument, from: string, to: string): void {
  if (from === to) throw new OpError("An element can't use itself.");
  const ws = buildWorkspace(doc);
  if (isInside(ws, from, to) || isInside(ws, to, from)) {
    throw new OpError(`"${from}" and "${to}" contain one another, so no view could draw the relationship. Point it at a sibling or at something outside instead.`);
  }
}

function findRelationship(doc: OpenArchDocument, from: string, to: string, index: number | undefined) {
  const element = requireElement(doc, from);
  const matches = (element.uses ?? []).flatMap((r, position) => (r.to === to ? [{ r, position }] : []));
  if (matches.length === 0) throw new OpError(`"${from}" has no relationship to "${to}".`);
  if (index === undefined && matches.length > 1) {
    const list = matches.map((m, i) => `${i}: ${m.r.description ?? "(no description)"}`).join("; ");
    throw new OpError(`"${from}" has ${matches.length} relationships to "${to}" (${list}). Say which with "index".`);
  }
  const match = matches[index ?? 0];
  if (!match) throw new OpError(`"${from}" has ${matches.length} relationship${matches.length === 1 ? "" : "s"} to "${to}"; "index" must be 0 to ${matches.length - 1}.`);
  return { element, position: match.position };
}

/** Rebuild an object with one key renamed, keeping its place. */
function renameKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k === from ? to : k, v]));
}

function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== "")) as T;
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
