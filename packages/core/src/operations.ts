/**
 * Every change to a workspace is an operation. Agents send them through the
 * CLI, the designer sends them from the UI, and `applyOperations` checks each
 * one, applies the batch to a copy, and rejects the whole batch if the model
 * would end up with new errors. Nothing edits the document any other way.
 */
import { checkWorkspace } from "./check.js";
import { isInside, kindList, PARENT_KINDS } from "./model.js";
import { suggest } from "./suggest.js";
import {
  CARD_KINDS,
  ELEMENT_KINDS,
  ELEMENT_SHAPES,
  ID_PATTERN,
  RELATIONSHIP_KINDS,
  STICKY_COLORS,
  VIEW_LEVELS,
  type CardData,
  type CardKind,
  type ConnectionData,
  type DeploymentNodeData,
  type Diagnostic,
  type ElementData,
  type ElementKind,
  type ElementShape,
  type LaneData,
  type OpenArchDocument,
  type Position,
  type RelationshipData,
  type RelationshipKind,
  type StateData,
  type StepData,
  type StickyColor,
  type StickyData,
  type Tags,
  type ViewData,
  type ViewLevel,
} from "./types.js";
import { computeView, RUNNABLE_KINDS, scopeProblems, stepRelationships } from "./views.js";
import { buildWorkspace } from "./workspace.js";

/**
 * Whether a view shows elements added to the model later: "show" keeps `*` in its include list,
 * "hide" lists its boxes one by one.
 */
export type NewElements = "show" | "hide";

/** Changes to tags: a value sets a tag (an empty one makes it a plain label) and null removes it. */
export type TagChanges = Record<string, string | null>;

export type Operation =
  | {
      op: "add-element";
      id: string;
      kind: ElementKind;
      parent?: string;
      name?: string;
      description?: string;
      technology?: string;
      external?: boolean;
      shape?: ElementShape;
      stereotype?: string;
      members?: string[];
      libraries?: string[];
      tags?: Tags;
      notes?: string;
    }
  | {
      op: "update-element";
      id: string;
      name?: string;
      parent?: string;
      description?: string | null;
      technology?: string | null;
      external?: boolean;
      shape?: ElementShape | null;
      stereotype?: string | null;
      members?: string[] | null;
      /** Replaces the container's list of libraries. */
      libraries?: string[] | null;
      tags?: TagChanges;
      notes?: string | null;
    }
  | { op: "remove-element"; id: string }
  | { op: "rename"; id: string; to: string }
  | { op: "add-relationship"; from: string; to: string; kind?: RelationshipKind; bidirectional?: boolean; description?: string; technology?: string; tags?: Tags; notes?: string }
  | {
      op: "update-relationship";
      from: string;
      to: string;
      index?: number;
      newFrom?: string;
      newTo?: string;
      kind?: RelationshipKind | null;
      bidirectional?: boolean;
      description?: string | null;
      technology?: string | null;
      tags?: TagChanges;
      notes?: string | null;
    }
  | { op: "remove-relationship"; from: string; to: string; index?: number }
  | { op: "add-view"; id: string; level: ViewLevel; scope?: string; title?: string; description?: string; include?: string[]; exclude?: string[]; notes?: string }
  | { op: "update-view"; id: string; title?: string; description?: string | null; include?: string[]; exclude?: string[]; newElements?: NewElements; notes?: string | null }
  | { op: "remove-view"; id: string }
  | { op: "show-in-view"; view: string; id: string }
  | { op: "hide-in-view"; view: string; id: string }
  | { op: "set-layout"; view: string; positions: Record<string, Position | null> }
  | { op: "add-sticky"; view: string; id: string; text: string; color?: StickyColor; at?: [number, number] }
  | { op: "update-sticky"; view: string; id: string; text?: string; color?: StickyColor; at?: [number, number] | null }
  | { op: "remove-sticky"; view: string; id: string }
  | { op: "add-step"; view: string; from: string; to: string; description?: string; technology?: string; reply?: boolean; step?: number }
  | { op: "update-step"; view: string; step: number; from?: string; to?: string; description?: string | null; technology?: string | null; reply?: boolean; newStep?: number }
  | { op: "remove-step"; view: string; step: number }
  | { op: "add-state"; view: string; id: string; name?: string; description?: string; initial?: boolean; final?: boolean; at?: [number, number] }
  | { op: "update-state"; view: string; id: string; newId?: string; name?: string; description?: string | null; initial?: boolean; final?: boolean; at?: [number, number] | null }
  | { op: "remove-state"; view: string; id: string }
  | { op: "add-transition"; view: string; from: string; to: string; event?: string; guard?: string; action?: string; transition?: number }
  | { op: "update-transition"; view: string; transition: number; from?: string; to?: string; event?: string | null; guard?: string | null; action?: string | null; newTransition?: number }
  | { op: "remove-transition"; view: string; transition: number }
  | {
      op: "add-node";
      view: string;
      id: string;
      name?: string;
      parent?: string;
      description?: string;
      technology?: string;
      infrastructure?: boolean;
      instances?: number;
      shape?: ElementShape;
      runs?: string[];
    }
  | {
      op: "update-node";
      view: string;
      id: string;
      newId?: string;
      name?: string;
      /** null puts it at the top. */
      parent?: string | null;
      description?: string | null;
      technology?: string | null;
      infrastructure?: boolean;
      instances?: number | null;
      shape?: ElementShape | null;
      /** Replaces what it runs. */
      runs?: string[] | null;
    }
  | { op: "remove-node"; view: string; id: string }
  | { op: "add-connection"; view: string; from: string; to: string; description?: string; technology?: string; connection?: number }
  | { op: "update-connection"; view: string; connection: number; from?: string; to?: string; description?: string | null; technology?: string | null; newConnection?: number }
  | { op: "remove-connection"; view: string; connection: number }
  /** `position` is the lane's place from the top: 1 is the first. */
  | { op: "add-lane"; view: string; id: string; name?: string; description?: string; position?: number }
  | { op: "update-lane"; view: string; id: string; newId?: string; name?: string; description?: string | null; position?: number }
  | { op: "remove-lane"; view: string; id: string }
  /** `position` is the card's place along the timeline: 1 is the first. */
  | { op: "add-card"; view: string; id: string; kind?: CardKind; name?: string; description?: string; lane?: string; from?: string[]; position?: number }
  | {
      op: "update-card";
      view: string;
      id: string;
      newId?: string;
      kind?: CardKind;
      name?: string;
      description?: string | null;
      /** null takes it out of its lane. */
      lane?: string | null;
      /** Replaces the cards it comes from. */
      from?: string[] | null;
      position?: number;
    }
  | { op: "remove-card"; view: string; id: string }
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

type FieldType =
  | "string"
  | "nullable-string"
  | "boolean"
  | "strings"
  | "nullable-strings"
  | "tags"
  | "nullable-tags"
  | "index"
  | "number"
  | "count"
  | "nullable-count"
  | "positions"
  | "point"
  | "nullable-point";

const SHAPES: Record<OperationName, { required: string[]; fields: Record<string, FieldType> }> = {
  "add-element": {
    required: ["id", "kind"],
    fields: {
      id: "string",
      kind: "string",
      parent: "string",
      name: "string",
      description: "string",
      technology: "string",
      external: "boolean",
      shape: "string",
      stereotype: "string",
      members: "strings",
      libraries: "strings",
      tags: "tags",
      notes: "string",
    },
  },
  "update-element": {
    required: ["id"],
    fields: {
      id: "string",
      name: "string",
      parent: "string",
      description: "nullable-string",
      technology: "nullable-string",
      external: "boolean",
      shape: "nullable-string",
      stereotype: "nullable-string",
      members: "nullable-strings",
      libraries: "nullable-strings",
      tags: "nullable-tags",
      notes: "nullable-string",
    },
  },
  "remove-element": { required: ["id"], fields: { id: "string" } },
  rename: { required: ["id", "to"], fields: { id: "string", to: "string" } },
  "add-relationship": { required: ["from", "to"], fields: { from: "string", to: "string", kind: "string", bidirectional: "boolean", description: "string", technology: "string", tags: "tags", notes: "string" } },
  "update-relationship": {
    required: ["from", "to"],
    fields: { from: "string", to: "string", index: "index", newFrom: "string", newTo: "string", kind: "nullable-string", bidirectional: "boolean", description: "nullable-string", technology: "nullable-string", tags: "nullable-tags", notes: "nullable-string" },
  },
  "remove-relationship": { required: ["from", "to"], fields: { from: "string", to: "string", index: "index" } },
  "add-view": {
    required: ["id", "level"],
    fields: { id: "string", level: "string", scope: "string", title: "string", description: "string", include: "strings", exclude: "strings", notes: "string" },
  },
  "update-view": {
    required: ["id"],
    fields: { id: "string", title: "string", description: "nullable-string", include: "strings", exclude: "strings", newElements: "string", notes: "nullable-string" },
  },
  "remove-view": { required: ["id"], fields: { id: "string" } },
  "show-in-view": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "hide-in-view": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "set-layout": { required: ["view", "positions"], fields: { view: "string", positions: "positions" } },
  "add-sticky": { required: ["view", "id", "text"], fields: { view: "string", id: "string", text: "string", color: "string", at: "point" } },
  "update-sticky": { required: ["view", "id"], fields: { view: "string", id: "string", text: "string", color: "string", at: "nullable-point" } },
  "remove-sticky": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "add-step": {
    required: ["view", "from", "to"],
    fields: { view: "string", from: "string", to: "string", description: "string", technology: "string", reply: "boolean", step: "number" },
  },
  "update-step": {
    required: ["view", "step"],
    fields: { view: "string", step: "number", from: "string", to: "string", description: "nullable-string", technology: "nullable-string", reply: "boolean", newStep: "number" },
  },
  "remove-step": { required: ["view", "step"], fields: { view: "string", step: "number" } },
  "add-state": {
    required: ["view", "id"],
    fields: { view: "string", id: "string", name: "string", description: "string", initial: "boolean", final: "boolean", at: "point" },
  },
  "update-state": {
    required: ["view", "id"],
    fields: { view: "string", id: "string", newId: "string", name: "string", description: "nullable-string", initial: "boolean", final: "boolean", at: "nullable-point" },
  },
  "remove-state": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "add-transition": {
    required: ["view", "from", "to"],
    fields: { view: "string", from: "string", to: "string", event: "string", guard: "string", action: "string", transition: "number" },
  },
  "update-transition": {
    required: ["view", "transition"],
    fields: { view: "string", transition: "number", from: "string", to: "string", event: "nullable-string", guard: "nullable-string", action: "nullable-string", newTransition: "number" },
  },
  "remove-transition": { required: ["view", "transition"], fields: { view: "string", transition: "number" } },
  "add-node": {
    required: ["view", "id"],
    fields: {
      view: "string",
      id: "string",
      name: "string",
      parent: "string",
      description: "string",
      technology: "string",
      infrastructure: "boolean",
      instances: "count",
      shape: "string",
      runs: "strings",
    },
  },
  "update-node": {
    required: ["view", "id"],
    fields: {
      view: "string",
      id: "string",
      newId: "string",
      name: "string",
      parent: "nullable-string",
      description: "nullable-string",
      technology: "nullable-string",
      infrastructure: "boolean",
      instances: "nullable-count",
      shape: "nullable-string",
      runs: "nullable-strings",
    },
  },
  "remove-node": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "add-connection": {
    required: ["view", "from", "to"],
    fields: { view: "string", from: "string", to: "string", description: "string", technology: "string", connection: "number" },
  },
  "update-connection": {
    required: ["view", "connection"],
    fields: { view: "string", connection: "number", from: "string", to: "string", description: "nullable-string", technology: "nullable-string", newConnection: "number" },
  },
  "remove-connection": { required: ["view", "connection"], fields: { view: "string", connection: "number" } },
  "add-lane": { required: ["view", "id"], fields: { view: "string", id: "string", name: "string", description: "string", position: "number" } },
  "update-lane": { required: ["view", "id"], fields: { view: "string", id: "string", newId: "string", name: "string", description: "nullable-string", position: "number" } },
  "remove-lane": { required: ["view", "id"], fields: { view: "string", id: "string" } },
  "add-card": {
    required: ["view", "id"],
    fields: { view: "string", id: "string", kind: "string", name: "string", description: "string", lane: "string", from: "strings", position: "number" },
  },
  "update-card": {
    required: ["view", "id"],
    fields: { view: "string", id: "string", newId: "string", kind: "string", name: "string", description: "nullable-string", lane: "nullable-string", from: "nullable-strings", position: "number" },
  },
  "remove-card": { required: ["view", "id"], fields: { view: "string", id: "string" } },
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
    case "nullable-strings":
      return value === null || (Array.isArray(value) && value.every((v) => typeof v === "string"));
    case "tags":
      return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
    case "nullable-tags":
      return isRecord(value) && Object.values(value).every((v) => typeof v === "string" || v === null);
    case "index":
      return Number.isInteger(value) && (value as number) >= 0;
    case "number":
      return Number.isInteger(value) && (value as number) >= 1;
    case "count":
      return Number.isInteger(value) && (value as number) >= 1;
    case "nullable-count":
      return value === null || (Number.isInteger(value) && (value as number) >= 1);
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
  "nullable-strings": "a list of strings, or null to remove it",
  tags: 'an object of tag names and string values, like { "owner": "payments" }',
  "nullable-tags": 'an object of tag names and string values, like { "owner": "payments" } (null removes a tag)',
  index: "a whole number, 0 or more",
  number: "a number, 1 or more: 1 is the first",
  count: "a whole number, 1 or more",
  "nullable-count": "a whole number, 1 or more, or null for 1",
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
    case "add-step":
      return addStep(doc, op);
    case "update-step":
      return updateStep(doc, op);
    case "remove-step": {
      const view = requireSequence(doc, op.view);
      requireStep(view, op.view, op.step);
      view.steps!.splice(op.step - 1, 1);
      return `removed step ${op.step} from view ${op.view}`;
    }
    case "add-state":
      return addState(doc, op);
    case "update-state":
      return updateState(doc, op);
    case "remove-state": {
      const view = requireStates(doc, op.view);
      requireState(view, op.view, op.id);
      delete view.states![op.id];
      const before = view.transitions?.length ?? 0;
      view.transitions = (view.transitions ?? []).filter((t) => t.from !== op.id && t.to !== op.id);
      if (view.initial === op.id) delete view.initial;
      const gone = before - view.transitions.length;
      return `removed state ${op.id} from view ${op.view}${gone ? ` and ${count(gone, "transition")} to or from it` : ""}`;
    }
    case "add-transition":
      return addTransition(doc, op);
    case "update-transition":
      return updateTransition(doc, op);
    case "remove-transition": {
      const view = requireStates(doc, op.view);
      requireTransition(view, op.view, op.transition);
      view.transitions!.splice(op.transition - 1, 1);
      return `removed transition ${op.transition} from view ${op.view}`;
    }
    case "add-node":
      return addNode(doc, op);
    case "update-node":
      return updateNode(doc, op);
    case "remove-node":
      return removeNode(doc, op.view, op.id);
    case "add-connection":
      return addConnection(doc, op);
    case "update-connection":
      return updateConnection(doc, op);
    case "remove-connection": {
      const view = requireDeployment(doc, op.view);
      requireConnection(view, op.view, op.connection);
      view.connections!.splice(op.connection - 1, 1);
      return `removed connection ${op.connection} from view ${op.view}`;
    }
    case "add-lane":
      return addLane(doc, op);
    case "update-lane":
      return updateLane(doc, op);
    case "remove-lane":
      return removeLane(doc, op.view, op.id);
    case "add-card":
      return addCard(doc, op);
    case "update-card":
      return updateCard(doc, op);
    case "remove-card":
      return removeCard(doc, op.view, op.id);
    case "update-workspace":
      return updateWorkspace(doc, op);
  }
}

function addElement(doc: OpenArchDocument, op: Extract<Operation, { op: "add-element" }>): string {
  assertNewId(doc, op.id);
  if (!(ELEMENT_KINDS as readonly string[]).includes(op.kind)) throw new OpError(`Unknown kind "${op.kind}". Use one of: ${ELEMENT_KINDS.join(", ")}.`);
  checkParent(doc, op.kind, op.parent);
  if (op.external && !canBeExternal(op.kind)) throw new OpError("Only people and systems can be external.");
  checkShape(op.kind, op.shape);
  checkClassFields(op.kind, op);
  const libraries = libraryList(doc, op.kind, op.libraries);
  doc.elements[op.id] = clean<ElementData>({
    kind: op.kind,
    name: op.name?.trim() || titleFromId(op.id),
    parent: op.parent,
    description: op.description?.trim(),
    technology: op.technology?.trim(),
    external: op.external || undefined,
    shape: op.shape === "box" ? undefined : op.shape,
    stereotype: op.stereotype?.trim(),
    libraries,
    tags: changeTags(undefined, op.tags ?? {}),
    notes: op.notes?.trim(),
    members: memberLines(op.members),
  });
  return `added ${op.kind} ${op.id}`;
}

function updateElement(doc: OpenArchDocument, op: Extract<Operation, { op: "update-element" }>): string {
  const e = requireElement(doc, op.id);
  const fields = ["name", "parent", "description", "technology", "external", "shape", "stereotype", "members", "libraries", "tags", "notes"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on "${op.id}": ${fields.join(", ")}.`);
  if (op.name !== undefined) {
    if (!op.name.trim()) throw new OpError("The name can't be empty.");
    e.name = op.name.trim();
  }
  if (op.parent !== undefined && op.parent !== e.parent) {
    checkParent(doc, e.kind, op.parent);
    e.parent = op.parent;
  }
  checkClassFields(e.kind, { stereotype: op.stereotype || undefined, members: op.members ?? undefined });
  for (const key of ["description", "technology", "stereotype", "notes"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete e[key];
    else e[key] = value.trim();
  }
  if (op.members !== undefined) {
    const members = memberLines(op.members ?? undefined);
    if (members) e.members = members;
    else delete e.members;
  }
  if (op.libraries !== undefined) {
    const libraries = libraryList(doc, e.kind, op.libraries ?? undefined);
    if (libraries) e.libraries = libraries;
    else delete e.libraries;
  }
  if (op.external !== undefined) {
    if (op.external && !canBeExternal(e.kind)) throw new OpError("Only people and systems can be external.");
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
    if (e.libraries) {
      e.libraries = e.libraries.filter((l) => !gone.has(l));
      if (e.libraries.length === 0) delete e.libraries;
    }
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
    // A step needs both its ends.
    if (v.steps) v.steps = v.steps.filter((step) => !gone.has(step.from) && !gone.has(step.to));
    // A node no longer runs it, and a connection to it goes, unless the end is a node of that name.
    for (const node of Object.values(v.nodes ?? {})) {
      if (!node.runs) continue;
      node.runs = node.runs.filter((id) => !gone.has(id));
      if (node.runs.length === 0) delete node.runs;
    }
    if (v.connections) v.connections = v.connections.filter((c) => ![c.from, c.to].some((end) => gone.has(end) && !Object.hasOwn(v.nodes ?? {}, end)));
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
    if (e.libraries) e.libraries = e.libraries.map((l) => (l === from ? to : l));
    for (const r of e.uses ?? []) if (r.to === from) r.to = to;
  }
  for (const v of Object.values(doc.views)) {
    if (v.scope === from) v.scope = to;
    if (v.include) v.include = v.include.map((x) => (x === from ? to : x));
    if (v.exclude) v.exclude = v.exclude.map((x) => (x === from ? to : x));
    if (v.layout?.[from]) v.layout = renameKey(v.layout, from, to);
    for (const step of v.steps ?? []) {
      if (step.from === from) step.from = to;
      if (step.to === from) step.to = to;
    }
    for (const node of Object.values(v.nodes ?? {})) if (node.runs) node.runs = node.runs.map((id) => (id === from ? to : id));
    // A connection's end is a node when the view has one of that name.
    if (!Object.hasOwn(v.nodes ?? {}, from)) {
      for (const c of v.connections ?? []) {
        if (c.from === from) c.from = to;
        if (c.to === from) c.to = to;
      }
    }
  }
  return `renamed ${from} to ${to}`;
}

function addRelationship(doc: OpenArchDocument, op: Extract<Operation, { op: "add-relationship" }>): string {
  const from = requireElement(doc, op.from);
  requireElement(doc, op.to);
  checkEnds(doc, op.from, op.to);
  checkKind(op.kind);
  const kind = op.kind === "association" ? undefined : op.kind;
  const description = op.description?.trim() || undefined;
  if (from.uses?.some((r) => r.to === op.to && r.kind === kind && (r.description || undefined) === description)) {
    throw new OpError(`"${op.from}" already has this relationship to "${op.to}". Use update-relationship to change it.`);
  }
  from.uses = [
    ...(from.uses ?? []),
    clean<RelationshipData>({ to: op.to, kind, bidirectional: op.bidirectional || undefined, description, technology: op.technology?.trim(), tags: changeTags(undefined, op.tags ?? {}), notes: op.notes?.trim() }),
  ];
  return `added relationship ${op.from} -> ${op.to}`;
}

/**
 * Changes a relationship's fields, and its ends: `newFrom` moves it to another element's `uses`,
 * at the end, and `newTo` points it at another element. It keeps its description, technology, tags and notes.
 */
function updateRelationship(doc: OpenArchDocument, op: Extract<Operation, { op: "update-relationship" }>): string {
  if (
    op.newFrom === undefined &&
    op.newTo === undefined &&
    op.kind === undefined &&
    op.bidirectional === undefined &&
    op.description === undefined &&
    op.technology === undefined &&
    op.tags === undefined &&
    op.notes === undefined
  ) {
    throw new OpError("Say what to change: newFrom, newTo, kind, bidirectional, description, technology, tags or notes.");
  }
  const { element, position } = findRelationship(doc, op.from, op.to, op.index);
  const rel = element.uses![position]!;
  if (op.kind !== undefined) {
    checkKind(op.kind ?? undefined);
    if (op.kind === null || op.kind === "association") delete rel.kind;
    else rel.kind = op.kind;
  }
  if (op.bidirectional === true) rel.bidirectional = true;
  else if (op.bidirectional === false) delete rel.bidirectional;
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
  if (source.uses?.some((r) => r !== rel && r.to === to && r.kind === rel.kind && (r.description || undefined) === (rel.description || undefined))) {
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
  const draft = {
    id: op.id,
    path: `views.${op.id}`,
    title: "",
    level: op.level,
    scope: op.scope,
    include: ["*"],
    exclude: [],
    stickies: [],
    layout: {},
    steps: [],
    states: [],
    transitions: [],
    nodes: [],
    connections: [],
    lanes: [],
    cards: [],
  };
  const problems = scopeProblems(ws, draft);
  if (problems.length) throw new OpError(`${problems[0]!.message}${problems[0]!.fix ? ` ${problems[0]!.fix}` : ""}`);
  const sequence = op.level === "sequence";
  const statesView = op.level === "state";
  const deployment = op.level === "deployment";
  if (sequence && (op.include || op.exclude)) throw new OpError(SEQUENCE_PARTICIPANTS);
  if (statesView && (op.include || op.exclude)) throw new OpError(STATE_BOXES);
  const events = op.level === "event";
  if (deployment && (op.include || op.exclude)) throw new OpError(DEPLOYMENT_BOXES);
  if (events && (op.include || op.exclude)) throw new OpError(EVENT_CARDS);
  checkIds(doc, op.include, "include");
  checkIds(doc, op.exclude, "exclude");
  const scope = op.scope ? doc.elements[op.scope] : undefined;
  const title =
    op.title?.trim() ||
    (sequence || deployment || events ? titleFromId(op.id) : scope ? `${scope.name} ${LEVEL_TITLE[op.level]}` : statesView ? titleFromId(op.id) : "System landscape");
  doc.views[op.id] = clean<ViewData>({
    title,
    description: op.description?.trim(),
    level: op.level,
    scope: op.scope,
    include: sequence || statesView || deployment || events ? undefined : op.include ? [...op.include] : ["*"],
    exclude: op.exclude?.length ? [...op.exclude] : undefined,
    notes: op.notes?.trim(),
    steps: sequence ? [] : undefined,
    states: statesView ? {} : undefined,
    transitions: statesView ? [] : undefined,
    nodes: deployment ? {} : undefined,
    connections: deployment ? [] : undefined,
    lanes: events ? [] : undefined,
    cards: events ? [] : undefined,
  });
  return `added view ${op.id}`;
}

/** What a view of a scope is called, after the scope's name, when it isn't given a title. */
export const LEVEL_TITLE: Record<ViewLevel, string> = {
  landscape: "landscape",
  context: "context",
  container: "containers",
  component: "components",
  class: "classes",
  sequence: "sequence",
  state: "states",
  deployment: "deployment",
  event: "events",
};

function updateView(doc: OpenArchDocument, op: Extract<Operation, { op: "update-view" }>): string {
  const view = requireView(doc, op.id);
  if (op.title === undefined && op.description === undefined && op.include === undefined && op.exclude === undefined && op.newElements === undefined && op.notes === undefined) {
    throw new OpError("Say what to change: title, description, include, exclude, new elements or notes.");
  }
  if (op.newElements !== undefined) {
    if (op.newElements !== "show" && op.newElements !== "hide") throw new OpError(`Unknown new-elements setting "${op.newElements}". Use show or hide.`);
    if (op.include !== undefined || op.exclude !== undefined) {
      throw new OpError("Change new elements, or include and exclude, but not both at once: new elements works out the lists from what the view shows now.");
    }
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
  if (view.level === "sequence" && (op.include !== undefined || op.exclude !== undefined || op.newElements !== undefined)) throw new OpError(SEQUENCE_PARTICIPANTS);
  if (view.level === "state" && (op.include !== undefined || op.exclude !== undefined || op.newElements !== undefined)) throw new OpError(STATE_BOXES);
  if (view.level === "deployment" && (op.include !== undefined || op.exclude !== undefined || op.newElements !== undefined)) throw new OpError(DEPLOYMENT_BOXES);
  if (view.level === "event" && (op.include !== undefined || op.exclude !== undefined || op.newElements !== undefined)) throw new OpError(EVENT_CARDS);
  if (op.include !== undefined) {
    checkIds(doc, op.include, "include");
    view.include = [...op.include];
  }
  if (op.exclude !== undefined) {
    checkIds(doc, op.exclude, "exclude");
    if (op.exclude.length) view.exclude = [...op.exclude];
    else delete view.exclude;
  }
  if (op.newElements !== undefined) setNewElements(doc, op.id, op.newElements);
  return `updated view ${op.id}`;
}

/**
 * Switches whether a view shows elements added later, keeping the boxes it shows now. With
 * "hide", its include list becomes those boxes. With "show", it gets `*` back, an exclude list
 * of what `*` would add, and include entries for boxes `*` doesn't cover.
 */
function setNewElements(doc: OpenArchDocument, viewId: string, mode: NewElements) {
  const ws = buildWorkspace(doc);
  const def = ws.views.get(viewId)!;
  if (def.include.includes("*") === (mode === "show")) return;
  const problems = scopeProblems(ws, def);
  if (problems.length) throw new OpError(`${problems[0]!.message} Fix the view's scope first.`);
  const boxes = computeView(ws, def).nodes.map((n) => n.id);
  const view = doc.views[viewId]!;
  if (mode === "hide") {
    view.include = boxes;
    delete view.exclude;
    return;
  }
  const everything = computeView(ws, { ...def, include: ["*"], exclude: [] }).nodes.map((n) => n.id);
  view.include = ["*", ...boxes.filter((id) => !everything.includes(id))];
  const exclude = everything.filter((id) => !boxes.includes(id));
  if (exclude.length) view.exclude = exclude;
  else delete view.exclude;
}

function shows(doc: OpenArchDocument, viewId: string, id: string): boolean {
  const ws = buildWorkspace(doc);
  const view = ws.views.get(viewId)!;
  return scopeProblems(ws, view).length === 0 && computeView(ws, view).nodes.some((n) => n.id === id);
}

function showInView(doc: OpenArchDocument, viewId: string, id: string): string {
  const view = requireView(doc, viewId);
  if (view.level === "sequence") throw new OpError(SEQUENCE_PARTICIPANTS);
  if (view.level === "state") throw new OpError(STATE_BOXES);
  if (view.level === "deployment") throw new OpError(DEPLOYMENT_BOXES);
  if (view.level === "event") throw new OpError(EVENT_CARDS);
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
  if (view.level === "sequence") throw new OpError(SEQUENCE_PARTICIPANTS);
  if (view.level === "state") throw new OpError(STATE_BOXES);
  if (view.level === "deployment") throw new OpError(DEPLOYMENT_BOXES);
  if (view.level === "event") throw new OpError(EVENT_CARDS);
  requireElement(doc, id);
  if (!shows(doc, viewId, id)) throw new OpError(`"${id}" isn't a box in view "${viewId}".`);
  if (view.include?.includes(id)) view.include = view.include.filter((x) => x !== id);
  if (shows(doc, viewId, id)) view.exclude = [...(view.exclude ?? []), id];
  return `hid ${id} in view ${viewId}`;
}

function setLayout(doc: OpenArchDocument, viewId: string, positions: Record<string, Position | null>): string {
  const view = requireView(doc, viewId);
  if (view.level === "sequence") throw new OpError("A sequence view is laid out from its steps, so it has no box positions.");
  if (view.level === "state") throw new OpError("A state view has no boxes. Move a state with update-state --at.");
  if (view.level === "deployment") throw new OpError("A deployment view is laid out from its nodes, so it has no box positions.");
  if (view.level === "event") throw new OpError("An event view is laid out from its lanes and the order of its cards, so it has no box positions. Move a card with update-card.");
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

/** Why a sequence view can't be given elements to show or hide. */
const SEQUENCE_PARTICIPANTS =
  "A sequence view shows the elements in its steps, in the order they first appear, so it takes no include or exclude list. Add a step with add-step, or remove one with remove-step.";

function addStep(doc: OpenArchDocument, op: Extract<Operation, { op: "add-step" }>): string {
  const view = requireSequence(doc, op.view);
  const steps = view.steps ?? [];
  const step = clean<StepData>({ from: op.from, to: op.to, description: op.description?.trim(), technology: op.technology?.trim(), reply: op.reply || undefined });
  checkStep(doc, step);
  const at = op.step ?? steps.length + 1;
  if (at > steps.length + 1) throw new OpError(`View "${op.view}" has ${countSteps(steps.length)}, so a new one can be step 1 to ${steps.length + 1}.`);
  view.steps = [...steps.slice(0, at - 1), step, ...steps.slice(at - 1)];
  return `added step ${at} to view ${op.view}: ${op.from} ${op.reply ? "replies to" : "->"} ${op.to}`;
}

function updateStep(doc: OpenArchDocument, op: Extract<Operation, { op: "update-step" }>): string {
  const view = requireSequence(doc, op.view);
  const step = requireStep(view, op.view, op.step);
  const fields = ["from", "to", "description", "technology", "reply", "newStep"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on step ${op.step}: ${fields.join(", ")}.`);
  const ends = op.from !== undefined || op.to !== undefined || op.reply !== undefined;
  if (op.from !== undefined) step.from = op.from;
  if (op.to !== undefined) step.to = op.to;
  if (op.reply !== undefined) {
    if (op.reply) step.reply = true;
    else delete step.reply;
  }
  for (const key of ["description", "technology"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete step[key];
    else step[key] = value.trim();
  }
  if (ends) checkStep(doc, step);
  const steps = view.steps!;
  if (op.newStep !== undefined && op.newStep !== op.step) {
    if (op.newStep > steps.length) throw new OpError(`View "${op.view}" has ${countSteps(steps.length)}, so "newStep" must be 1 to ${steps.length}.`);
    steps.splice(op.step - 1, 1);
    steps.splice(op.newStep - 1, 0, step);
    return `moved step ${op.step} to ${op.newStep} in view ${op.view}`;
  }
  return `updated step ${op.step} in view ${op.view}`;
}

/** Refuses a step that the model has no relationship for, or that joins an unknown element or one to itself. */
function checkStep(doc: OpenArchDocument, step: StepData): void {
  requireElement(doc, step.from);
  requireElement(doc, step.to);
  if (step.from === step.to) throw new OpError("A step can't go from an element to itself.");
  const ws = buildWorkspace(doc);
  if (isInside(ws, step.from, step.to) || isInside(ws, step.to, step.from)) {
    throw new OpError(`"${step.from}" and "${step.to}" contain one another, so no relationship can join them, and no step either.`);
  }
  if (stepRelationships(ws, step.from, step.to, step.reply).length) return;
  const [caller, callee] = step.reply ? [step.to, step.from] : [step.from, step.to];
  // A relationship the other way can be made to go both ways instead.
  const back = doc.elements[callee]!.uses?.some((r) => r.to === caller);
  throw new OpError(
    `The model has no relationship from "${caller}" to "${callee}"${step.reply ? " for this reply to go back along" : ""}. Add one first with add-relationship ${caller} ${callee}${back ? `, or make the one from "${callee}" to "${caller}" go both ways` : ", or with one between elements inside them"}.`,
  );
}

const countSteps = (n: number) => `${n} step${n === 1 ? "" : "s"}`;
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Why a state view can't be given elements to show or hide. */
const STATE_BOXES = "A state view draws its states, not elements, so it takes no include or exclude list. Add a state with add-state, or remove one with remove-state.";

function addState(doc: OpenArchDocument, op: Extract<Operation, { op: "add-state" }>): string {
  const view = requireStates(doc, op.view);
  if (!ID_PATTERN.test(op.id)) throw new OpError(`"${op.id}" isn't a valid ID. IDs are lowercase kebab-case, like "awaiting-payment".`);
  if (view.states?.[op.id]) throw new OpError(`View "${op.view}" already has a state "${op.id}".`);
  view.states = {
    ...view.states,
    [op.id]: clean<StateData>({ name: op.name?.trim() || titleFromId(op.id), description: op.description?.trim(), final: op.final || undefined, at: op.at && [Math.round(op.at[0]), Math.round(op.at[1])] }),
  };
  if (op.initial) view.initial = op.id;
  return `added state ${op.id} to view ${op.view}${op.initial ? ", where it starts" : ""}`;
}

function updateState(doc: OpenArchDocument, op: Extract<Operation, { op: "update-state" }>): string {
  const view = requireStates(doc, op.view);
  const state = requireState(view, op.view, op.id);
  const fields = ["newId", "name", "description", "initial", "final", "at"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on state "${op.id}": ${fields.join(", ")}.`);
  if (op.name !== undefined) {
    if (!op.name.trim()) throw new OpError("A state's name can't be empty.");
    state.name = op.name.trim();
  }
  if (op.description !== undefined) {
    if (op.description === null || !op.description.trim()) delete state.description;
    else state.description = op.description.trim();
  }
  if (op.final !== undefined) {
    if (op.final) state.final = true;
    else delete state.final;
  }
  if (op.at === null) delete state.at;
  else if (op.at !== undefined) state.at = [Math.round(op.at[0]), Math.round(op.at[1])];
  if (op.initial === true) view.initial = op.id;
  else if (op.initial === false && view.initial === op.id) delete view.initial;
  if (op.newId === undefined || op.newId === op.id) return `updated state ${op.id} in view ${op.view}`;
  // A new ID keeps the state where it is in the file, and its transitions follow it.
  if (!ID_PATTERN.test(op.newId)) throw new OpError(`"${op.newId}" isn't a valid ID. IDs are lowercase kebab-case, like "awaiting-payment".`);
  if (view.states![op.newId]) throw new OpError(`View "${op.view}" already has a state "${op.newId}".`);
  view.states = renameKey(view.states!, op.id, op.newId);
  for (const t of view.transitions ?? []) {
    if (t.from === op.id) t.from = op.newId;
    if (t.to === op.id) t.to = op.newId;
  }
  if (view.initial === op.id) view.initial = op.newId;
  return `renamed state ${op.id} to ${op.newId} in view ${op.view}`;
}

function addTransition(doc: OpenArchDocument, op: Extract<Operation, { op: "add-transition" }>): string {
  const view = requireStates(doc, op.view);
  requireState(view, op.view, op.from);
  requireState(view, op.view, op.to);
  const transitions = view.transitions ?? [];
  const at = op.transition ?? transitions.length + 1;
  if (at > transitions.length + 1) throw new OpError(`View "${op.view}" has ${count(transitions.length, "transition")}, so a new one can be transition 1 to ${transitions.length + 1}.`);
  const transition = clean({ from: op.from, to: op.to, event: op.event?.trim(), guard: op.guard?.trim(), action: op.action?.trim() });
  view.transitions = [...transitions.slice(0, at - 1), transition, ...transitions.slice(at - 1)];
  return `added transition ${at} to view ${op.view}: ${op.from} -> ${op.to}`;
}

function updateTransition(doc: OpenArchDocument, op: Extract<Operation, { op: "update-transition" }>): string {
  const view = requireStates(doc, op.view);
  const transition = requireTransition(view, op.view, op.transition);
  const fields = ["from", "to", "event", "guard", "action", "newTransition"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on transition ${op.transition}: ${fields.join(", ")}.`);
  for (const end of ["from", "to"] as const) {
    const id = op[end];
    if (id === undefined) continue;
    requireState(view, op.view, id);
    transition[end] = id;
  }
  for (const key of ["event", "guard", "action"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete transition[key];
    else transition[key] = value.trim();
  }
  const transitions = view.transitions!;
  if (op.newTransition !== undefined && op.newTransition !== op.transition) {
    if (op.newTransition > transitions.length) throw new OpError(`View "${op.view}" has ${count(transitions.length, "transition")}, so "newTransition" must be 1 to ${transitions.length}.`);
    transitions.splice(op.transition - 1, 1);
    transitions.splice(op.newTransition - 1, 0, transition);
    return `moved transition ${op.transition} to ${op.newTransition} in view ${op.view}`;
  }
  return `updated transition ${op.transition} in view ${op.view}`;
}

function requireStates(doc: OpenArchDocument, id: string): ViewData {
  const view = requireView(doc, id);
  if (view.level !== "state") throw new OpError(`View "${id}" is a ${view.level} view. Only state views have states and transitions.`);
  return view;
}

function requireState(view: ViewData, viewId: string, id: string): StateData {
  const state = view.states?.[id];
  if (!state) {
    const ids = Object.keys(view.states ?? {});
    const near = suggest(id, ids);
    throw new OpError(`View "${viewId}" has no state "${id}".${near ? ` Did you mean "${near}"?` : ids.length ? ` Its states: ${ids.join(", ")}.` : " Add one with add-state."}`);
  }
  return state;
}

function requireTransition(view: ViewData, viewId: string, number: number) {
  const transitions = view.transitions ?? [];
  const transition = transitions[number - 1];
  if (!transition) throw new OpError(transitions.length ? `View "${viewId}" has ${count(transitions.length, "transition")}: "transition" must be 1 to ${transitions.length}.` : `View "${viewId}" has no transitions yet.`);
  return transition;
}

/** Why a deployment view can't be given elements to show or hide. */
const DEPLOYMENT_BOXES =
  "A deployment view shows its nodes and the containers and systems they run, so it takes no include or exclude list. Add a node with add-node, and list what it runs in its runs.";

const NODE_ID_EXAMPLE = 'IDs are lowercase kebab-case, like "web-server".';

function addNode(doc: OpenArchDocument, op: Extract<Operation, { op: "add-node" }>): string {
  const view = requireDeployment(doc, op.view);
  if (!ID_PATTERN.test(op.id)) throw new OpError(`"${op.id}" isn't a valid ID. ${NODE_ID_EXAMPLE}`);
  if (view.nodes?.[op.id]) throw new OpError(`View "${op.view}" already has a node "${op.id}".`);
  if (op.parent !== undefined) checkNodeParent(view, op.view, op.id, op.parent);
  // A node can be drawn as any shape, as a container can.
  checkShape("container", op.shape);
  const runs = runList(doc, op.runs);
  if (op.infrastructure && runs) throw new OpError("Infrastructure runs no containers or systems. Make it a deployment node to run them in it.");
  view.nodes = {
    ...view.nodes,
    [op.id]: clean<DeploymentNodeData>({
      name: op.name?.trim() || titleFromId(op.id),
      parent: op.parent,
      description: op.description?.trim(),
      technology: op.technology?.trim(),
      infrastructure: op.infrastructure || undefined,
      instances: op.instances && op.instances > 1 ? op.instances : undefined,
      shape: op.shape === "box" ? undefined : op.shape,
      runs,
    }),
  };
  return `added ${op.infrastructure ? "infrastructure node" : "node"} ${op.id} to view ${op.view}`;
}

function updateNode(doc: OpenArchDocument, op: Extract<Operation, { op: "update-node" }>): string {
  const view = requireDeployment(doc, op.view);
  const node = requireNode(view, op.view, op.id);
  const fields = ["newId", "name", "parent", "description", "technology", "infrastructure", "instances", "shape", "runs"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on node "${op.id}": ${fields.join(", ")}.`);
  if (op.name !== undefined) {
    if (!op.name.trim()) throw new OpError("A node's name can't be empty.");
    node.name = op.name.trim();
  }
  if (op.parent === null) delete node.parent;
  else if (op.parent !== undefined && op.parent !== node.parent) {
    checkNodeParent(view, op.view, op.id, op.parent);
    node.parent = op.parent;
  }
  for (const key of ["description", "technology"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete node[key];
    else node[key] = value.trim();
  }
  if (op.instances !== undefined) {
    if (op.instances === null || op.instances === 1) delete node.instances;
    else node.instances = op.instances;
  }
  if (op.shape !== undefined) {
    checkShape("container", op.shape);
    if (op.shape === null || op.shape === "box") delete node.shape;
    else node.shape = op.shape;
  }
  let lost = 0;
  if (op.runs !== undefined) {
    const runs = runList(doc, op.runs ?? undefined);
    if (runs) node.runs = runs;
    else delete node.runs;
    lost = dropLooseConnections(doc, view, new Set());
  }
  if (op.infrastructure === true) node.infrastructure = true;
  else if (op.infrastructure === false) delete node.infrastructure;
  if (node.infrastructure && node.runs?.length) throw new OpError("Infrastructure runs no containers or systems. Take them out of it first, or keep it a deployment node.");
  if (node.infrastructure && Object.values(view.nodes!).some((n) => n.parent === op.id)) {
    throw new OpError(`Node "${op.id}" holds other nodes, and infrastructure holds none. Move them out of it first.`);
  }
  const dropped = lost ? ` and removed ${count(lost, "connection")} to what it no longer runs` : "";
  if (op.newId === undefined || op.newId === op.id) return `updated node ${op.id} in view ${op.view}${dropped}`;
  // A new ID keeps the node where it is, and the nodes inside it and its connections follow it.
  if (!ID_PATTERN.test(op.newId)) throw new OpError(`"${op.newId}" isn't a valid ID. ${NODE_ID_EXAMPLE}`);
  if (view.nodes![op.newId]) throw new OpError(`View "${op.view}" already has a node "${op.newId}".`);
  view.nodes = renameKey(view.nodes!, op.id, op.newId);
  for (const n of Object.values(view.nodes)) if (n.parent === op.id) n.parent = op.newId;
  for (const c of view.connections ?? []) {
    if (c.from === op.id) c.from = op.newId;
    if (c.to === op.id) c.to = op.newId;
  }
  return `renamed node ${op.id} to ${op.newId} in view ${op.view}${dropped}`;
}

/** Removes a node, the nodes inside it, and connections to them and to what only they ran. */
function removeNode(doc: OpenArchDocument, viewId: string, id: string): string {
  const view = requireDeployment(doc, viewId);
  requireNode(view, viewId, id);
  const nodes = view.nodes!;
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [nid, n] of Object.entries(nodes)) {
      if (n.parent && gone.has(n.parent) && !gone.has(nid)) {
        gone.add(nid);
        grew = true;
      }
    }
  }
  for (const g of gone) delete nodes[g];
  const lost = dropLooseConnections(doc, view, gone);
  const extra = [gone.size > 1 ? count(gone.size - 1, "node") + " inside it" : "", lost ? count(lost, "connection") : ""].filter(Boolean);
  return `removed node ${id} from view ${viewId}${extra.length ? ` and ${extra.join(" and ")}` : ""}`;
}

function addConnection(doc: OpenArchDocument, op: Extract<Operation, { op: "add-connection" }>): string {
  const view = requireDeployment(doc, op.view);
  checkConnectionEnds(doc, view, op.view, op.from, op.to);
  const connections = view.connections ?? [];
  const at = op.connection ?? connections.length + 1;
  if (at > connections.length + 1) throw new OpError(`View "${op.view}" has ${count(connections.length, "connection")}, so a new one can be connection 1 to ${connections.length + 1}.`);
  const connection = clean<ConnectionData>({ from: op.from, to: op.to, description: op.description?.trim(), technology: op.technology?.trim() });
  view.connections = [...connections.slice(0, at - 1), connection, ...connections.slice(at - 1)];
  return `added connection ${at} to view ${op.view}: ${op.from} -> ${op.to}`;
}

function updateConnection(doc: OpenArchDocument, op: Extract<Operation, { op: "update-connection" }>): string {
  const view = requireDeployment(doc, op.view);
  const connection = requireConnection(view, op.view, op.connection);
  const fields = ["from", "to", "description", "technology", "newConnection"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on connection ${op.connection}: ${fields.join(", ")}.`);
  if (op.from !== undefined || op.to !== undefined) {
    checkConnectionEnds(doc, view, op.view, op.from ?? connection.from, op.to ?? connection.to);
    connection.from = op.from ?? connection.from;
    connection.to = op.to ?? connection.to;
  }
  for (const key of ["description", "technology"] as const) {
    const value = op[key];
    if (value === undefined) continue;
    if (value === null || !value.trim()) delete connection[key];
    else connection[key] = value.trim();
  }
  const connections = view.connections!;
  if (op.newConnection !== undefined && op.newConnection !== op.connection) {
    if (op.newConnection > connections.length) throw new OpError(`View "${op.view}" has ${count(connections.length, "connection")}, so "newConnection" must be 1 to ${connections.length}.`);
    connections.splice(op.connection - 1, 1);
    connections.splice(op.newConnection - 1, 0, connection);
    return `moved connection ${op.connection} to ${op.newConnection} in view ${op.view}`;
  }
  return `updated connection ${op.connection} in view ${op.view}`;
}

/**
 * Removes the connections to or from a node that's gone, or an element no node of the view runs
 * any more, and says how many. An end that was never either is left for the checks to report.
 */
function dropLooseConnections(doc: OpenArchDocument, view: ViewData, goneNodes: Set<string>): number {
  const nodes = view.nodes ?? {};
  const run = new Set(Object.values(nodes).flatMap((n) => n.runs ?? []));
  const before = view.connections?.length ?? 0;
  if (!before) return 0;
  const loose = (end: string) => !Object.hasOwn(nodes, end) && (goneNodes.has(end) || (!!doc.elements[end] && !run.has(end)));
  view.connections = view.connections!.filter((c) => !loose(c.from) && !loose(c.to));
  return before - view.connections.length;
}

/** Refuses a connection whose ends aren't a node of the view, or something a node runs; or that joins two elements, or something to itself. */
function checkConnectionEnds(doc: OpenArchDocument, view: ViewData, viewId: string, from: string, to: string): void {
  const nodes = view.nodes ?? {};
  const run = new Set(Object.values(nodes).flatMap((n) => n.runs ?? []));
  for (const end of [from, to]) {
    if (Object.hasOwn(nodes, end) || run.has(end)) continue;
    if (doc.elements[end]) throw new OpError(`No node of view "${viewId}" runs "${end}". Run it in one first: list it in the node's runs with update-node.`);
    const near = suggest(end, [...Object.keys(nodes), ...run]);
    throw new OpError(`"${end}" isn't a node of view "${viewId}", or a container or system one runs.${near ? ` Did you mean "${near}"?` : ""}`);
  }
  if (from === to) throw new OpError("A connection can't go from something to itself.");
  if (!Object.hasOwn(nodes, from) && !Object.hasOwn(nodes, to)) {
    throw new OpError(`"${from}" and "${to}" are both elements. Arrows between them come from the model's relationships: add one with add-relationship ${from} ${to}.`);
  }
}

/** Refuses a parent that isn't a node of the view, is infrastructure, or is the node itself or inside it. */
function checkNodeParent(view: ViewData, viewId: string, id: string, parent: string): void {
  const nodes = view.nodes ?? {};
  const holder = requireNode(view, viewId, parent);
  if (holder.infrastructure) throw new OpError(`"${parent}" is infrastructure, which holds no nodes.`);
  for (let at: string | undefined = parent, steps = 0; at !== undefined && steps <= Object.keys(nodes).length; at = nodes[at]?.parent, steps++) {
    if (at === id) throw new OpError(parent === id ? "A node can't be inside itself." : `"${parent}" is inside "${id}", so "${id}" can't be inside it.`);
  }
}

/** What a node runs, each once and in order, or undefined when nothing. Refuses anything but containers and systems. */
function runList(doc: OpenArchDocument, runs: string[] | undefined): string[] | undefined {
  const ids = [...new Set((runs ?? []).map((r) => r.trim()).filter(Boolean))];
  if (ids.length === 0) return undefined;
  for (const id of ids) {
    const element = requireElement(doc, id);
    if (!RUNNABLE_KINDS.includes(element.kind)) {
      throw new OpError(`"${id}" is a ${element.kind}. Nodes run containers and systems${element.kind === "component" || element.kind === "class" ? ": run the container it's in instead" : ""}.`);
    }
  }
  return ids;
}

function requireDeployment(doc: OpenArchDocument, id: string): ViewData {
  const view = requireView(doc, id);
  if (view.level !== "deployment") throw new OpError(`View "${id}" is a ${view.level} view. Only deployment views have nodes and connections.`);
  return view;
}

function requireNode(view: ViewData, viewId: string, id: string): DeploymentNodeData {
  const node = view.nodes?.[id];
  if (!node) {
    const ids = Object.keys(view.nodes ?? {});
    const near = suggest(id, ids);
    throw new OpError(`View "${viewId}" has no node "${id}".${near ? ` Did you mean "${near}"?` : ids.length ? ` Its nodes: ${ids.join(", ")}.` : " Add one with add-node."}`);
  }
  return node;
}

function requireConnection(view: ViewData, viewId: string, number: number): ConnectionData {
  const connections = view.connections ?? [];
  const connection = connections[number - 1];
  if (!connection) throw new OpError(connections.length ? `View "${viewId}" has ${count(connections.length, "connection")}: "connection" must be 1 to ${connections.length}.` : `View "${viewId}" has no connections yet.`);
  return connection;
}

/** Why an event view can't be given elements to show or hide. */
const EVENT_CARDS = "An event view draws its cards, not elements, so it takes no include or exclude list. Add a card with add-card, or remove one with remove-card.";

/** Puts `item` at `position` in a list, 1 being the first, or at the end, and says where it went. `what` is what the list holds. */
function insertAt<T>(items: T[], item: T, position: number | undefined, viewId: string, what: string): number {
  const at = position ?? items.length + 1;
  if (at > items.length + 1) throw new OpError(`View "${viewId}" has ${count(items.length, what)}, so a new one's position can be 1 to ${items.length + 1}.`);
  items.splice(at - 1, 0, item);
  return at;
}

/** Moves the item at `index` of a list to `position`, 1 being the first, and says whether it moved. */
function moveTo<T>(items: T[], index: number, position: number | undefined, viewId: string, what: string): boolean {
  if (position === undefined || position === index + 1) return false;
  if (position > items.length) throw new OpError(`View "${viewId}" has ${count(items.length, what)}, so "position" must be 1 to ${items.length}.`);
  const [item] = items.splice(index, 1);
  items.splice(position - 1, 0, item!);
  return true;
}

function addLane(doc: OpenArchDocument, op: Extract<Operation, { op: "add-lane" }>): string {
  const view = requireEvents(doc, op.view);
  if (!ID_PATTERN.test(op.id)) throw new OpError(`"${op.id}" isn't a valid ID. IDs are lowercase kebab-case, like "customer".`);
  const lanes = (view.lanes ??= []);
  if (lanes.some((l) => l.id === op.id)) throw new OpError(`View "${op.view}" already has a lane "${op.id}".`);
  const lane = clean<LaneData>({ id: op.id, name: op.name?.trim() || titleFromId(op.id), description: op.description?.trim() });
  const at = insertAt(lanes, lane, op.position, op.view, "lane");
  return `added lane ${op.id} to view ${op.view}${at < lanes.length ? `, as lane ${at}` : ""}`;
}

function updateLane(doc: OpenArchDocument, op: Extract<Operation, { op: "update-lane" }>): string {
  const view = requireEvents(doc, op.view);
  const lane = requireLane(view, op.view, op.id);
  const fields = ["newId", "name", "description", "position"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on lane "${op.id}": ${fields.join(", ")}.`);
  if (op.name !== undefined) {
    if (!op.name.trim()) throw new OpError("A lane's name can't be empty.");
    lane.name = op.name.trim();
  }
  if (op.description !== undefined) {
    if (op.description === null || !op.description.trim()) delete lane.description;
    else lane.description = op.description.trim();
  }
  const lanes = view.lanes!;
  const moved = moveTo(lanes, lanes.indexOf(lane), op.position, op.view, "lane");
  const where = moved ? `, and moved it to lane ${op.position}` : "";
  if (op.newId === undefined || op.newId === op.id) {
    // Asked only for the place, or the ID, it has already: say so, as nothing changed.
    if (fields.every((f) => f === "position" || f === "newId" || op[f] === undefined)) {
      return moved ? `moved lane ${op.id} to lane ${op.position} in view ${op.view}` : `lane ${op.id} is already ${op.position === undefined ? `"${op.id}"` : `lane ${op.position}`} in view ${op.view}`;
    }
    return `updated lane ${op.id} in view ${op.view}${where}`;
  }
  // A new ID keeps the lane where it is, and its cards follow it.
  if (!ID_PATTERN.test(op.newId)) throw new OpError(`"${op.newId}" isn't a valid ID. IDs are lowercase kebab-case, like "customer".`);
  if (lanes.some((l) => l.id === op.newId)) throw new OpError(`View "${op.view}" already has a lane "${op.newId}".`);
  lane.id = op.newId;
  for (const card of view.cards ?? []) if (card.lane === op.id) card.lane = op.newId;
  return `renamed lane ${op.id} to ${op.newId} in view ${op.view}${where}`;
}

/** Removes a lane. Its cards stay, in no lane. */
function removeLane(doc: OpenArchDocument, viewId: string, id: string): string {
  const view = requireEvents(doc, viewId);
  const lane = requireLane(view, viewId, id);
  view.lanes!.splice(view.lanes!.indexOf(lane), 1);
  let left = 0;
  for (const card of view.cards ?? []) {
    if (card.lane !== id) continue;
    delete card.lane;
    left++;
  }
  return `removed lane ${id} from view ${viewId}${left ? `, leaving ${count(left, "card")} in no lane` : ""}`;
}

function addCard(doc: OpenArchDocument, op: Extract<Operation, { op: "add-card" }>): string {
  const view = requireEvents(doc, op.view);
  if (!ID_PATTERN.test(op.id)) throw new OpError(`"${op.id}" isn't a valid ID. IDs are lowercase kebab-case, like "order-placed".`);
  const cards = (view.cards ??= []);
  if (cards.some((c) => c.id === op.id)) throw new OpError(`View "${op.view}" already has a card "${op.id}".`);
  const kind = op.kind ?? "event";
  checkCardKind(kind);
  if (op.lane) requireLane(view, op.view, op.lane);
  const card = clean<CardData>({
    id: op.id,
    kind,
    name: op.name?.trim() || titleFromId(op.id),
    description: op.description?.trim(),
    lane: op.lane,
    from: fromList(view, op.view, op.id, op.from),
  });
  const at = insertAt(cards, card, op.position, op.view, "card");
  return `added ${kind} ${op.id} to view ${op.view}${at < cards.length ? `, as card ${at}` : ""}`;
}

function updateCard(doc: OpenArchDocument, op: Extract<Operation, { op: "update-card" }>): string {
  const view = requireEvents(doc, op.view);
  const card = requireCard(view, op.view, op.id);
  const fields = ["newId", "kind", "name", "description", "lane", "from", "position"] as const;
  if (!fields.some((f) => op[f] !== undefined)) throw new OpError(`Say what to change on card "${op.id}": ${fields.join(", ")}.`);
  if (op.kind !== undefined) {
    checkCardKind(op.kind);
    card.kind = op.kind;
  }
  if (op.name !== undefined) {
    if (!op.name.trim()) throw new OpError("A card's name can't be empty.");
    card.name = op.name.trim();
  }
  if (op.description !== undefined) {
    if (op.description === null || !op.description.trim()) delete card.description;
    else card.description = op.description.trim();
  }
  if (op.lane === null || op.lane === "") delete card.lane;
  else if (op.lane !== undefined) {
    requireLane(view, op.view, op.lane);
    card.lane = op.lane;
  }
  if (op.from !== undefined) {
    const from = fromList(view, op.view, op.id, op.from ?? undefined);
    if (from) card.from = from;
    else delete card.from;
  }
  const cards = view.cards!;
  const moved = moveTo(cards, cards.indexOf(card), op.position, op.view, "card");
  const where = moved ? `, and moved it to card ${op.position}` : "";
  if (op.newId === undefined || op.newId === op.id) {
    // Asked only for the place, or the ID, it has already: say so, as nothing changed.
    if (fields.every((f) => f === "position" || f === "newId" || op[f] === undefined)) {
      return moved ? `moved card ${op.id} to card ${op.position} in view ${op.view}` : `card ${op.id} is already ${op.position === undefined ? `"${op.id}"` : `card ${op.position}`} in view ${op.view}`;
    }
    return `updated card ${op.id} in view ${op.view}${where}`;
  }
  // A new ID keeps the card where it is, and the cards that come from it follow it.
  if (!ID_PATTERN.test(op.newId)) throw new OpError(`"${op.newId}" isn't a valid ID. IDs are lowercase kebab-case, like "order-placed".`);
  if (cards.some((c) => c.id === op.newId)) throw new OpError(`View "${op.view}" already has a card "${op.newId}".`);
  card.id = op.newId;
  for (const other of cards) if (other.from) other.from = other.from.map((id) => (id === op.id ? op.newId! : id));
  return `renamed card ${op.id} to ${op.newId} in view ${op.view}${where}`;
}

/** Removes a card, and the arrows from it to the cards it led to. */
function removeCard(doc: OpenArchDocument, viewId: string, id: string): string {
  const view = requireEvents(doc, viewId);
  const card = requireCard(view, viewId, id);
  const cards = view.cards!;
  cards.splice(cards.indexOf(card), 1);
  // Each card it comes from is one arrow, however often a file written by hand names it.
  let lost = new Set(card.from).size;
  for (const other of cards) {
    if (!other.from?.includes(id)) continue;
    other.from = other.from.filter((from) => from !== id);
    if (other.from.length === 0) delete other.from;
    lost++;
  }
  return `removed card ${id} from view ${viewId}${lost ? ` and ${count(lost, "arrow")} to or from it` : ""}`;
}

/** The cards a card comes from, each once and in order, or undefined when none. Refuses one that isn't a card of the view, and the card itself. */
function fromList(view: ViewData, viewId: string, id: string, from: string[] | undefined): string[] | undefined {
  const ids = [...new Set((from ?? []).map((f) => f.trim()).filter(Boolean))];
  if (ids.length === 0) return undefined;
  for (const other of ids) {
    if (other === id) throw new OpError("A card can't come from itself.");
    requireCard(view, viewId, other);
  }
  return ids;
}

function checkCardKind(kind: string): void {
  if ((CARD_KINDS as readonly string[]).includes(kind)) return;
  const near = suggest(kind, CARD_KINDS);
  throw new OpError(`Unknown kind of card "${kind}".${near ? ` Did you mean "${near}"?` : ""} Use one of: ${CARD_KINDS.join(", ")}.`);
}

function requireEvents(doc: OpenArchDocument, id: string): ViewData {
  const view = requireView(doc, id);
  if (view.level !== "event") throw new OpError(`View "${id}" is a ${view.level} view. Only event views have lanes and cards.`);
  return view;
}

function requireLane(view: ViewData, viewId: string, id: string): LaneData {
  const lane = view.lanes?.find((l) => l.id === id);
  if (!lane) {
    const ids = (view.lanes ?? []).map((l) => l.id);
    const near = suggest(id, ids);
    throw new OpError(`View "${viewId}" has no lane "${id}".${near ? ` Did you mean "${near}"?` : ids.length ? ` Its lanes: ${ids.join(", ")}.` : " Add one with add-lane."}`);
  }
  return lane;
}

function requireCard(view: ViewData, viewId: string, id: string): CardData {
  const card = view.cards?.find((c) => c.id === id);
  if (!card) {
    const ids = (view.cards ?? []).map((c) => c.id);
    const near = suggest(id, ids);
    throw new OpError(`View "${viewId}" has no card "${id}".${near ? ` Did you mean "${near}"?` : ids.length ? ` Its cards: ${ids.join(", ")}.` : " Add one with add-card."}`);
  }
  return card;
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

function requireSequence(doc: OpenArchDocument, id: string): ViewData {
  const view = requireView(doc, id);
  if (view.level !== "sequence") throw new OpError(`View "${id}" is a ${view.level} view. Only sequence views have steps.`);
  return view;
}

function requireStep(view: ViewData, viewId: string, number: number): StepData {
  const steps = view.steps ?? [];
  const step = steps[number - 1];
  if (!step) throw new OpError(steps.length ? `View "${viewId}" has ${countSteps(steps.length)}: "step" must be 1 to ${steps.length}.` : `View "${viewId}" has no steps yet.`);
  return step;
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
  if (kind === "class" && shape !== "box") throw new OpError("Classes are always drawn as a class, so they don't take a shape.");
}

/** Refuses a stereotype or members on anything but a class. */
function checkClassFields(kind: ElementKind, fields: { stereotype?: string; members?: string[] }): void {
  if (kind === "class") return;
  if (fields.stereotype?.trim()) throw new OpError(`Only classes have a stereotype, and this is a ${kind}.`);
  if (memberLines(fields.members)) throw new OpError(`Only classes have members, and this is a ${kind}.`);
}

/** A class's members, trimmed, without empty lines, or undefined when none are left. */
function memberLines(members: string[] | undefined): string[] | undefined {
  const lines = (members ?? []).map((m) => m.trim()).filter(Boolean);
  return lines.length ? lines : undefined;
}

function checkKind(kind: string | undefined): void {
  if (kind === undefined || (RELATIONSHIP_KINDS as readonly string[]).includes(kind)) return;
  const near = suggest(kind, RELATIONSHIP_KINDS);
  throw new OpError(`Unknown kind of relationship "${kind}".${near ? ` Did you mean "${near}"?` : ""} Use one of: ${RELATIONSHIP_KINDS.join(", ")}.`);
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
  const kinds = PARENT_KINDS[kind];
  const wanted = kindList(kinds);
  if (!kinds.length && parentId !== undefined) {
    throw new OpError(kind === "library" ? "A library belongs to no one container, so it can't have a parent. List it in the libraries of each container built with it." : `A ${kind} is top-level, so it can't have a parent.`);
  }
  if (kinds.length && parentId === undefined) throw new OpError(`A ${kind} needs a parent ${wanted}: set "parent".`);
  if (parentId === undefined) return;
  const parent = requireElement(doc, parentId);
  if (!kinds.includes(parent.kind)) throw new OpError(`A ${kind}'s parent must be a ${wanted}, but "${parentId}" is a ${parent.kind}.`);
}

const canBeExternal = (kind: ElementKind) => kind === "person" || kind === "system";

/** A container's libraries, each once and in order, or undefined when there are none. Refuses them on anything else, and anything that isn't a library. */
function libraryList(doc: OpenArchDocument, kind: ElementKind, libraries: string[] | undefined): string[] | undefined {
  const ids = [...new Set((libraries ?? []).map((l) => l.trim()).filter(Boolean))].sort();
  if (ids.length === 0) return undefined;
  if (kind !== "container") throw new OpError(`Only containers are built with libraries, and this is a ${kind}.`);
  for (const id of ids) {
    const library = requireElement(doc, id);
    if (library.kind !== "library") throw new OpError(`"${id}" is a ${library.kind}, not a library. Add a library with add-element ${id} --kind library.`);
  }
  return ids;
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
