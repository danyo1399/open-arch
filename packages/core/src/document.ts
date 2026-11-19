/**
 * Reading and writing the .openarch file. Parsing checks the file's shape and
 * reports every problem it finds; writing always produces the same canonical
 * text for the same model, so diffs stay small and merges stay local.
 */
import { aOrAn, KIND_RANK, tagEntries } from "./model.js";
import {
  ARROW_HEADS,
  ARROW_SIDES,
  ATTRIBUTE_KEYS,
  BLOCK_KINDS,
  CARDINALITIES,
  CARD_KINDS,
  DEFAULT_CARDINALITY,
  ELEMENT_KINDS,
  ELEMENT_SHAPES,
  FORMAT_VERSION,
  ID_PATTERN,
  RELATIONSHIP_KINDS,
  SCREEN_DEVICES,
  SHAPE_COLORS,
  SHAPE_FILLS,
  SHAPE_KINDS,
  STICKY_COLORS,
  TEXT_SIZES,
  VIEW_LEVELS,
  WIDGET_HOLDERS,
  WIDGET_KINDS,
  type ArrowData,
  type ArrowEnd,
  type ArrowSide,
  type AttributeData,
  type AttributeKey,
  type BlockData,
  type BlockKind,
  type CardData,
  type CardKind,
  type Cardinality,
  type ConnectionData,
  type DeploymentNodeData,
  type Diagnostic,
  type ElementData,
  type ElementShape,
  type EntityData,
  type EntityLinkData,
  type FlowData,
  type LaneData,
  type OpenArchDocument,
  type Position,
  type RelationshipData,
  type RelationshipKind,
  type ScreenData,
  type ScreenDevice,
  type ShapeData,
  type StateData,
  type StepData,
  type StickyData,
  type StickyTargetData,
  type TransitionData,
  type Tags,
  type ViewData,
  type WidgetData,
  type WidgetKind,
} from "./types.js";

export interface ParseResult {
  /** The document with anything malformed left out. Always present, so a broken file can still be shown. */
  doc: OpenArchDocument;
  /** Problems with the file's shape. */
  diagnostics: Diagnostic[];
  /** False when anything was left out. Writing a document that isn't valid would lose those parts. */
  valid: boolean;
}

/** A workspace name from a file or folder name: "my-repo_name" → "My Repo Name". Empty when it has no words. */
export function nameFromFileName(text: string): string {
  return text
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function emptyDocument(name: string): OpenArchDocument {
  return { openarch: FORMAT_VERSION, name, elements: {}, views: {} };
}

export function parseDocument(text: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    diagnostics.push({ severity: "error", rule: "json-invalid", message: `The file isn't valid JSON: ${(error as Error).message}`, path: "" });
    return { doc: emptyDocument("Untitled"), diagnostics, valid: false };
  }
  const doc = readDocument(raw, (path, rule, message, fix) => diagnostics.push({ severity: "error", rule, message, path, fix }));
  return { doc, diagnostics, valid: diagnostics.length === 0 };
}

type Report = (path: string, rule: string, message: string, fix?: string) => void;

const TOP_KEYS = ["$schema", "openarch", "name", "description", "export", "elements", "views"];
const ELEMENT_KEYS = ["kind", "name", "parent", "description", "technology", "external", "shape", "stereotype", "libraries", "tags", "notes", "members", "uses"];
const RELATIONSHIP_KEYS = ["to", "kind", "bidirectional", "description", "technology", "tags", "notes"];
const VIEW_KEYS = [
  "title",
  "description",
  "level",
  "scope",
  "include",
  "exclude",
  "notes",
  "steps",
  "initial",
  "states",
  "transitions",
  "nodes",
  "connections",
  "lanes",
  "cards",
  "screens",
  "shapes",
  "arrows",
  "blocks",
  "flows",
  "entities",
  "links",
  "stickies",
  "layout",
];
/** Views that draw something other than boxes picked from the model. */
type OwnLevel = "sequence" | "state" | "deployment" | "event" | "wireframe" | "whiteboard" | "flowchart" | "entity";
/** Fields only sequence, state, deployment, event, wireframe, whiteboard, flowchart and entity views take, and those they don't, with why. */
const ONLY_ON: Record<string, OwnLevel | OwnLevel[]> = {
  steps: "sequence",
  initial: "state",
  states: "state",
  transitions: "state",
  nodes: "deployment",
  connections: "deployment",
  lanes: ["event", "flowchart"],
  cards: "event",
  screens: "wireframe",
  shapes: "whiteboard",
  arrows: "whiteboard",
  blocks: "flowchart",
  flows: "flowchart",
  entities: "entity",
  links: "entity",
};
const NOT_ON: Record<OwnLevel, { fields: string[]; why: string }> = {
  sequence: { fields: ["include", "exclude", "layout"], why: "they show the elements in their steps, in the order they first appear" },
  state: { fields: ["include", "exclude", "layout"], why: "they show their states, each placed by its own `at`" },
  deployment: { fields: ["scope", "include", "exclude", "layout"], why: "they show their nodes and what runs in them, laid out automatically" },
  event: { fields: ["scope", "include", "exclude", "layout"], why: "they show their cards in order, each in its lane" },
  wireframe: { fields: ["include", "exclude", "layout"], why: "they show their screens in order, each drawn from its widgets" },
  whiteboard: { fields: ["scope", "include", "exclude", "layout"], why: "they show their shapes and arrows, each where it's put" },
  flowchart: { fields: ["include", "exclude", "layout"], why: "they show their blocks, each where its `at` puts it, or laid out from the first down" },
  entity: { fields: ["include", "exclude", "layout"], why: "they show their entities, each where its `at` puts it, or laid out automatically" },
};
const LEVEL_NAME: Record<OwnLevel, string> = {
  sequence: "Sequence",
  state: "State",
  deployment: "Deployment",
  event: "Event",
  wireframe: "Wireframe",
  whiteboard: "Whiteboard",
  flowchart: "Flowchart",
  entity: "Entity",
};
const STATE_KEYS = ["name", "description", "final", "at"];
const TRANSITION_KEYS = ["from", "to", "event", "guard", "action"];
const NODE_KEYS = ["name", "parent", "description", "technology", "infrastructure", "instances", "shape", "runs"];
const CONNECTION_KEYS = ["from", "to", "description", "technology"];
const LANE_KEYS = ["id", "name", "description"];
const CARD_KEYS = ["id", "kind", "name", "description", "lane", "from"];
const SCREEN_KEYS = ["id", "name", "description", "device", "widgets"];
const WIDGET_KEYS = ["id", "kind", "text", "description", "to", "widgets"];
const SHAPE_KEYS = ["id", "kind", "text", "at", "points", "size", "color", "fill", "dashed"];
const ARROW_KEYS = ["id", "from", "to", "text", "heads", "color", "dashed"];
const ARROW_END_KEYS = ["shape", "side"];
const BLOCK_KEYS = ["id", "kind", "text", "description", "lane", "at"];
const FLOW_KEYS = ["from", "to", "text"];
const ENTITY_KEYS = ["id", "name", "description", "attributes", "at"];
const ATTRIBUTE_FIELDS = ["name", "type", "keys", "description"];
const LINK_KEYS = ["from", "to", "cardinality", "text"];
const STEP_KEYS = ["from", "to", "description", "technology", "reply"];
const STICKY_KEYS = ["text", "on", "color", "at", "notes"];
const STICKY_ON_KEYS = ["element", "from", "to", "kind"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: string[], path: string, report: Report): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) report(`${path}.${key}`.replace(/^\./, ""), "field-unknown", `Unknown field "${key}".`, `Allowed fields: ${allowed.join(", ")}.`);
  }
}

function str(value: unknown, path: string, report: Report): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  report(path, "field-type", "Must be a string.");
  return undefined;
}

function strList(value: unknown, path: string, report: Report): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
  report(path, "field-type", "Must be a list of strings.");
  return undefined;
}

const isFacts = (value: unknown): value is Record<string, string> => isObject(value) && Object.values(value).every((v) => typeof v === "string");

/** `onElement`: an element's tags, where a list of labels most likely meant a shape. */
function tagMap(value: unknown, path: string, report: Report, onElement: boolean): Tags | undefined {
  if (value === undefined) return undefined;
  if (isFacts(value)) return value;
  const fix = Array.isArray(value) ? `Give a tag without a value "" as its value.${onElement ? ' To draw a cylinder, set "shape": "database" instead of a tag.' : ""}` : undefined;
  report(path, "field-type", 'Must be an object of tag names and values, like { "owner": "payments" }.', fix);
  return undefined;
}

function readDocument(input: unknown, report: Report): OpenArchDocument {
  if (!isObject(input)) {
    report("", "field-type", "The file must hold a JSON object.");
    return emptyDocument("Untitled");
  }
  unknownKeys(input, TOP_KEYS, "", report);
  const raw = upgrade(input, report);
  if (raw.openarch !== FORMAT_VERSION) {
    report(
      "openarch",
      "version-unsupported",
      raw.openarch === undefined
        ? `Missing "openarch": ${FORMAT_VERSION}.`
        : `Unsupported format version ${JSON.stringify(raw.openarch)}; this tool reads version ${FORMAT_VERSION}, and upgrades versions 1 to ${FORMAT_VERSION - 1}.`,
    );
  }
  const name = str(raw.name, "name", report);
  if (!name?.trim()) report("name", "field-required", "The workspace needs a `name`.");
  const doc: OpenArchDocument = { openarch: FORMAT_VERSION, name: name?.trim() ? name : "Untitled", elements: {}, views: {} };
  if (typeof raw.$schema === "string") doc.$schema = raw.$schema;
  const description = str(raw.description, "description", report);
  if (description) doc.description = description;
  if (raw.export !== undefined) {
    if (!isObject(raw.export)) report("export", "field-type", "Must be an object.");
    else {
      unknownKeys(raw.export, ["docs"], "export", report);
      const docs = str(raw.export.docs, "export.docs", report);
      if (docs !== undefined) doc.export = { docs };
    }
  }

  if (raw.elements !== undefined && !isObject(raw.elements)) report("elements", "field-type", "Must be an object keyed by element ID.");
  else {
    for (const [id, value] of Object.entries(raw.elements ?? {})) {
      const element = readElement(id, value, `elements.${id}`, report);
      if (element) doc.elements[id] = element;
    }
  }
  if (raw.views !== undefined && !isObject(raw.views)) report("views", "field-type", "Must be an object keyed by view ID.");
  else {
    for (const [id, value] of Object.entries(raw.views ?? {})) {
      const view = readView(id, value, `views.${id}`, report);
      if (view) doc.views[id] = view;
    }
  }
  return doc;
}

/** An older file in this version's terms, a version at a time. Newer and unknown versions are left as they are. */
function upgrade(raw: Record<string, unknown>, report: Report): Record<string, unknown> {
  let out = raw;
  if (out.openarch === 1) out = upgradeFromV1(out, report);
  // Version 3 added notes to views and relationships, so a version 2 file means the same in it.
  if (out.openarch === 2) out = { ...out, openarch: 3 };
  // Version 4 added sequence views, so a version 3 file means the same in it.
  if (out.openarch === 3) out = { ...out, openarch: 4 };
  // Version 5 added relationships that go both ways, so a version 4 file means the same in it.
  if (out.openarch === 4) out = { ...out, openarch: 5 };
  // Version 6 added classes, class views and kinds of relationship, so a version 5 file means the same in it.
  if (out.openarch === 5) out = { ...out, openarch: 6 };
  // Version 7 added libraries, so a version 6 file means the same in it.
  if (out.openarch === 6) out = { ...out, openarch: 7 };
  // Version 8 let libraries hold components, so a version 7 file means the same in it.
  if (out.openarch === 7) out = { ...out, openarch: 8 };
  // Version 9 added state views, so a version 8 file means the same in it.
  if (out.openarch === 8) out = { ...out, openarch: 9 };
  // Version 10 added deployment views, so a version 9 file means the same in it.
  if (out.openarch === 9) out = { ...out, openarch: 10 };
  // Version 11 added event views, so a version 10 file means the same in it.
  if (out.openarch === 10) out = { ...out, openarch: 11 };
  // Version 12 let a sticky note be on an element or relationship, so a version 11 file means the same in it.
  if (out.openarch === 11) out = { ...out, openarch: 12 };
  // Version 13 added wireframe views, so a version 12 file means the same in it.
  if (out.openarch === 12) out = { ...out, openarch: 13 };
  // Version 14 added whiteboard views, so a version 13 file means the same in it.
  if (out.openarch === 13) out = { ...out, openarch: 14 };
  // Version 15 let a whiteboard arrow's end stay on a side of its shape, so a version 14 file means the same in it.
  if (out.openarch === 14) out = { ...out, openarch: 15 };
  // Version 16 added flowchart views, so a version 15 file means the same in it.
  if (out.openarch === 15) out = { ...out, openarch: 16 };
  // Version 17 added lanes to flowchart views, so a version 16 file means the same in it.
  if (out.openarch === 16) out = { ...out, openarch: 17 };
  // Version 18 added entity views, so a version 17 file means the same in it.
  if (out.openarch === 17) out = { ...out, openarch: 18 };
  // Version 19 added notes to sticky notes, so a version 18 file means the same in it.
  if (out.openarch === 18) out = { ...out, openarch: 19 };
  return out;
}

/**
 * Version 1 had tags as a list of labels, of which `database` drew a cylinder, and name/value
 * facts in `properties`. Version 2 has a `shape`, and tags with values that hold both.
 */
function upgradeFromV1(raw: Record<string, unknown>, report: Report): Record<string, unknown> {
  if (!isObject(raw.elements)) return { ...raw, openarch: 2 };
  const elements = Object.entries(raw.elements).map(([id, e]) => [id, isObject(e) ? upgradeElementFromV1(e, `elements.${id}`, report) : e]);
  return { ...raw, openarch: 2, elements: Object.fromEntries(elements) };
}

const isLabels = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

/** Version 2 tags from version 1 labels and facts, with names trimmed. A fact wins over a label of the same name. */
function tagsFromV1(labels: string[], facts: Record<string, string>): Tags | undefined {
  const out = new Map<string, string>();
  for (const label of labels) if (label.trim()) out.set(label.trim(), "");
  for (const [name, value] of Object.entries(facts)) if (name.trim()) out.set(name.trim(), value);
  return out.size ? Object.fromEntries(out) : undefined;
}

/** Fields too malformed to upgrade are reported in version 1's terms and left out, never passed on. */
function upgradeElementFromV1(e: Record<string, unknown>, path: string, report: Report): Record<string, unknown> {
  const { tags, properties, uses, ...out } = e;
  const labels = isLabels(tags) ? tags : [];
  if (tags !== undefined && !isLabels(tags)) report(`${path}.tags`, "field-type", "Must be a list of strings.");
  const facts = isFacts(properties) ? properties : {};
  if (properties !== undefined && !isFacts(properties)) report(`${path}.properties`, "field-type", "Must be an object of string values.");
  const cylinder = e.kind !== "person" && labels.includes("database");
  if (cylinder) out.shape = "database";
  const merged = tagsFromV1(cylinder ? labels.filter((t) => t !== "database") : labels, facts);
  if (merged) out.tags = merged;
  if (!Array.isArray(uses)) {
    if (uses !== undefined) out.uses = uses;
    return out;
  }
  out.uses = uses.map((r, i) => {
    if (!isObject(r) || r.tags === undefined) return r;
    const { tags: relTags, ...rel } = r;
    if (!isLabels(relTags)) report(`${path}.uses[${i}].tags`, "field-type", "Must be a list of strings.");
    const upgraded = isLabels(relTags) ? tagsFromV1(relTags, {}) : undefined;
    return upgraded ? { ...rel, tags: upgraded } : rel;
  });
  return out;
}

function readId(id: string, path: string, report: Report): boolean {
  if (ID_PATTERN.test(id)) return true;
  report(path, "id-format", `"${id}" isn't a valid ID. IDs are lowercase kebab-case, like "checkout-api".`);
  return false;
}

function readElement(id: string, value: unknown, path: string, report: Report): ElementData | undefined {
  if (!readId(id, path, report)) return undefined;
  if (!isObject(value)) {
    report(path, "field-type", "An element must be an object.");
    return undefined;
  }
  unknownKeys(value, ELEMENT_KEYS, path, report);
  if (!(ELEMENT_KINDS as readonly unknown[]).includes(value.kind)) {
    report(`${path}.kind`, value.kind === undefined ? "field-required" : "kind-invalid", `\`kind\` must be one of: ${ELEMENT_KINDS.join(", ")}.`);
    return undefined;
  }
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) report(`${path}.name`, "field-required", "`name` is required.");
  const element: ElementData = { kind: value.kind as ElementData["kind"], name: name?.trim() ? name : id };
  const parent = str(value.parent, `${path}.parent`, report);
  if (parent !== undefined) element.parent = parent;
  for (const key of ["description", "technology", "stereotype", "notes"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) element[key] = v;
  }
  const members = strList(value.members, `${path}.members`, report);
  if (members) element.members = members;
  const libraries = strList(value.libraries, `${path}.libraries`, report);
  if (libraries) element.libraries = libraries;
  if (value.external !== undefined) {
    if (typeof value.external === "boolean") element.external = value.external;
    else report(`${path}.external`, "field-type", "Must be true or false.");
  }
  if (value.shape !== undefined) {
    if ((ELEMENT_SHAPES as readonly unknown[]).includes(value.shape)) element.shape = value.shape as ElementShape;
    else report(`${path}.shape`, "shape-invalid", `\`shape\` must be one of: ${ELEMENT_SHAPES.join(", ")}.`);
  }
  const tags = tagMap(value.tags, `${path}.tags`, report, true);
  if (tags) element.tags = tags;
  if (value.uses !== undefined) {
    if (!Array.isArray(value.uses)) report(`${path}.uses`, "field-type", "Must be a list of relationships.");
    else {
      element.uses = [];
      value.uses.forEach((item, i) => {
        const rel = readRelationship(item, `${path}.uses[${i}]`, report);
        if (rel) element.uses!.push(rel);
      });
    }
  }
  return element;
}

function readRelationship(value: unknown, path: string, report: Report): RelationshipData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A relationship must be an object like { "to": "orders-db" }.');
    return undefined;
  }
  unknownKeys(value, RELATIONSHIP_KEYS, path, report);
  const to = str(value.to, `${path}.to`, report);
  if (!to) {
    report(`${path}.to`, "field-required", "`to` is required: the ID of the element used.");
    return undefined;
  }
  const rel: RelationshipData = { to };
  if (value.kind !== undefined) {
    if ((RELATIONSHIP_KINDS as readonly unknown[]).includes(value.kind)) {
      if (value.kind !== "association") rel.kind = value.kind as RelationshipKind;
    } else report(`${path}.kind`, "relationship-kind-invalid", `\`kind\` must be one of: ${RELATIONSHIP_KINDS.join(", ")}.`);
  }
  if (value.bidirectional !== undefined) {
    if (typeof value.bidirectional !== "boolean") report(`${path}.bidirectional`, "field-type", "Must be true or false.");
    else if (value.bidirectional) rel.bidirectional = true;
  }
  for (const key of ["description", "technology", "notes"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) rel[key] = v;
  }
  const tags = tagMap(value.tags, `${path}.tags`, report, false);
  if (tags) rel.tags = tags;
  return rel;
}

function readView(id: string, value: unknown, path: string, report: Report): ViewData | undefined {
  if (!readId(id, path, report)) return undefined;
  if (!isObject(value)) {
    report(path, "field-type", "A view must be an object.");
    return undefined;
  }
  unknownKeys(value, VIEW_KEYS, path, report);
  if (!(VIEW_LEVELS as readonly unknown[]).includes(value.level)) {
    report(`${path}.level`, value.level === undefined ? "field-required" : "level-invalid", `\`level\` must be one of: ${VIEW_LEVELS.join(", ")}.`);
    return undefined;
  }
  const title = str(value.title, `${path}.title`, report);
  if (!title?.trim()) report(`${path}.title`, "field-required", "`title` is required.");
  const view: ViewData = { title: title?.trim() ? title : id, level: value.level as ViewData["level"] };
  const sequence = view.level === "sequence";
  const statesView = view.level === "state";
  const deployment = view.level === "deployment";
  const events = view.level === "event";
  const wireframe = view.level === "wireframe";
  const whiteboard = view.level === "whiteboard";
  const flowchart = view.level === "flowchart";
  const entities = view.level === "entity";
  // Boxes come from include and exclude, and are placed by layout, only on the other views.
  const boxes = !sequence && !statesView && !deployment && !events && !wireframe && !whiteboard && !flowchart && !entities;
  const own = boxes ? undefined : (view.level as OwnLevel);
  for (const key of Object.keys(value)) {
    const only = ONLY_ON[key];
    const levels = only === undefined ? undefined : Array.isArray(only) ? only : [only];
    if (levels && !levels.includes(view.level as OwnLevel)) {
      report(`${path}.${key}`, "field-not-allowed", `Only ${levels.join(" and ")} views have \`${key}\`.`, `Remove \`${key}\`.`);
    } else if (own && NOT_ON[own].fields.includes(key)) {
      report(`${path}.${key}`, "field-not-allowed", `${LEVEL_NAME[own]} views don't take \`${key}\`: ${NOT_ON[own].why}.`, `Remove \`${key}\`.`);
    }
  }
  const description = str(value.description, `${path}.description`, report);
  if (description !== undefined) view.description = description;
  const scope = deployment || events || whiteboard ? undefined : str(value.scope, `${path}.scope`, report);
  if (scope !== undefined) view.scope = scope;
  const include = boxes ? strList(value.include, `${path}.include`, report) : undefined;
  if (include) view.include = include;
  const exclude = boxes ? strList(value.exclude, `${path}.exclude`, report) : undefined;
  if (exclude) view.exclude = exclude;
  const notes = str(value.notes, `${path}.notes`, report);
  if (notes !== undefined) view.notes = notes;
  if (sequence && value.steps !== undefined) {
    if (!Array.isArray(value.steps)) report(`${path}.steps`, "field-type", "Must be a list of steps.");
    else {
      view.steps = [];
      value.steps.forEach((item, i) => {
        const step = readStep(item, `${path}.steps[${i}]`, report);
        if (step) view.steps!.push(step);
      });
    }
  }
  if (statesView) {
    if (value.states !== undefined) {
      if (!isObject(value.states)) report(`${path}.states`, "field-type", "Must be an object keyed by state ID.");
      else {
        view.states = {};
        for (const [stateId, state] of Object.entries(value.states)) {
          const s = readState(stateId, state, `${path}.states.${stateId}`, report);
          if (s) view.states[stateId] = s;
        }
      }
    }
    const initial = str(value.initial, `${path}.initial`, report);
    if (initial !== undefined) view.initial = initial;
    if (value.transitions !== undefined) {
      if (!Array.isArray(value.transitions)) report(`${path}.transitions`, "field-type", "Must be a list of transitions.");
      else {
        view.transitions = [];
        value.transitions.forEach((item, i) => {
          const t = readTransition(item, `${path}.transitions[${i}]`, report);
          if (t) view.transitions!.push(t);
        });
      }
    }
  }
  if (deployment) {
    if (value.nodes !== undefined) {
      if (!isObject(value.nodes)) report(`${path}.nodes`, "field-type", "Must be an object keyed by node ID.");
      else {
        view.nodes = {};
        for (const [nodeId, node] of Object.entries(value.nodes)) {
          const n = readNode(nodeId, node, `${path}.nodes.${nodeId}`, report);
          if (n) view.nodes[nodeId] = n;
        }
      }
    }
    if (value.connections !== undefined) {
      if (!Array.isArray(value.connections)) report(`${path}.connections`, "field-type", "Must be a list of connections.");
      else {
        view.connections = [];
        value.connections.forEach((item, i) => {
          const c = readConnection(item, `${path}.connections[${i}]`, report);
          if (c) view.connections!.push(c);
        });
      }
    }
  }
  // A lane, card or block with the ID of one before it is left out: every reference to it would mean the first.
  if ((events || flowchart) && value.lanes !== undefined) {
    if (!Array.isArray(value.lanes)) report(`${path}.lanes`, "field-type", "Must be a list of lanes.");
    else {
      view.lanes = [];
      value.lanes.forEach((item, i) => {
        const lane = readLane(item, `${path}.lanes[${i}]`, report);
        if (!lane) return;
        if (view.lanes!.some((l) => l.id === lane.id)) report(`${path}.lanes[${i}].id`, "id-duplicate", `"${lane.id}" is the ID of two lanes of this view.`, "Give one of them another ID.");
        else view.lanes!.push(lane);
      });
    }
  }
  if (events) {
    if (value.cards !== undefined) {
      if (!Array.isArray(value.cards)) report(`${path}.cards`, "field-type", "Must be a list of cards.");
      else {
        view.cards = [];
        value.cards.forEach((item, i) => {
          const card = readCard(item, `${path}.cards[${i}]`, report);
          if (!card) return;
          if (view.cards!.some((c) => c.id === card.id)) report(`${path}.cards[${i}].id`, "id-duplicate", `"${card.id}" is the ID of two cards of this view.`, "Give one of them another ID.");
          else view.cards!.push(card);
        });
      }
    }
  }
  if (wireframe && value.screens !== undefined) {
    if (!Array.isArray(value.screens)) report(`${path}.screens`, "field-type", "Must be a list of screens.");
    else {
      view.screens = [];
      // Widget IDs are unique across the view's screens, so a widget can move to another screen and keep its ID.
      const screenIds = new Set<string>();
      const widgetIds = new Set<string>();
      value.screens.forEach((item, i) => {
        const screen = readScreen(item, `${path}.screens[${i}]`, report, screenIds, widgetIds);
        if (screen) view.screens!.push(screen);
      });
    }
  }
  if (whiteboard) {
    // A shape or arrow with the ID of one before it is left out: every reference to it would mean the first.
    if (value.shapes !== undefined) {
      if (!Array.isArray(value.shapes)) report(`${path}.shapes`, "field-type", "Must be a list of shapes.");
      else {
        view.shapes = [];
        value.shapes.forEach((item, i) => {
          const shape = readShape(item, `${path}.shapes[${i}]`, report);
          if (!shape) return;
          if (view.shapes!.some((s) => s.id === shape.id)) report(`${path}.shapes[${i}].id`, "id-duplicate", `"${shape.id}" is the ID of two shapes of this view.`, "Give one of them another ID.");
          else view.shapes!.push(shape);
        });
      }
    }
    if (value.arrows !== undefined) {
      if (!Array.isArray(value.arrows)) report(`${path}.arrows`, "field-type", "Must be a list of arrows.");
      else {
        view.arrows = [];
        value.arrows.forEach((item, i) => {
          const arrow = readArrow(item, `${path}.arrows[${i}]`, report);
          if (!arrow) return;
          if (view.arrows!.some((a) => a.id === arrow.id)) report(`${path}.arrows[${i}].id`, "id-duplicate", `"${arrow.id}" is the ID of two arrows of this view.`, "Give one of them another ID.");
          else view.arrows!.push(arrow);
        });
      }
    }
  }
  if (flowchart) {
    // A block with the ID of one before it is left out: every flow to it would mean the first.
    if (value.blocks !== undefined) {
      if (!Array.isArray(value.blocks)) report(`${path}.blocks`, "field-type", "Must be a list of blocks.");
      else {
        view.blocks = [];
        value.blocks.forEach((item, i) => {
          const b = readBlock(item, `${path}.blocks[${i}]`, report);
          if (!b) return;
          if (view.blocks!.some((other) => other.id === b.id)) report(`${path}.blocks[${i}].id`, "id-duplicate", `"${b.id}" is the ID of two blocks of this view.`, "Give one of them another ID.");
          else view.blocks!.push(b);
        });
      }
    }
    if (value.flows !== undefined) {
      if (!Array.isArray(value.flows)) report(`${path}.flows`, "field-type", "Must be a list of flows.");
      else {
        view.flows = [];
        value.flows.forEach((item, i) => {
          const flow = readFlow(item, `${path}.flows[${i}]`, report);
          if (flow) view.flows!.push(flow);
        });
      }
    }
  }
  if (entities) {
    // An entity with the ID of one before it is left out: every link to it would mean the first.
    if (value.entities !== undefined) {
      if (!Array.isArray(value.entities)) report(`${path}.entities`, "field-type", "Must be a list of entities.");
      else {
        view.entities = [];
        value.entities.forEach((item, i) => {
          const e = readEntity(item, `${path}.entities[${i}]`, report);
          if (!e) return;
          if (view.entities!.some((other) => other.id === e.id)) report(`${path}.entities[${i}].id`, "id-duplicate", `"${e.id}" is the ID of two entities of this view.`, "Give one of them another ID.");
          else view.entities!.push(e);
        });
      }
    }
    if (value.links !== undefined) {
      if (!Array.isArray(value.links)) report(`${path}.links`, "field-type", "Must be a list of links.");
      else {
        view.links = [];
        value.links.forEach((item, i) => {
          const link = readLink(item, `${path}.links[${i}]`, report);
          if (link) view.links!.push(link);
        });
      }
    }
  }
  if (value.stickies !== undefined) {
    if (!isObject(value.stickies)) report(`${path}.stickies`, "field-type", "Must be an object keyed by sticky note ID.");
    else {
      view.stickies = {};
      for (const [stickyId, sticky] of Object.entries(value.stickies)) {
        const s = readSticky(stickyId, sticky, `${path}.stickies.${stickyId}`, report, own);
        if (s) view.stickies[stickyId] = s;
      }
    }
  }
  if (boxes && value.layout !== undefined) {
    if (!isObject(value.layout)) report(`${path}.layout`, "field-type", "Must be an object keyed by element ID.");
    else {
      view.layout = {};
      for (const [elementId, pos] of Object.entries(value.layout)) {
        if (Array.isArray(pos) && (pos.length === 2 || pos.length === 4) && pos.every((n) => typeof n === "number" && Number.isFinite(n))) {
          view.layout[elementId] = pos as Position;
        } else {
          report(`${path}.layout.${elementId}`, "field-type", "A position must be [x, y] or [x, y, width, height].");
        }
      }
    }
  }
  return view;
}

function readStep(value: unknown, path: string, report: Report): StepData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A step must be an object like { "from": "customer", "to": "web-app" }.');
    return undefined;
  }
  unknownKeys(value, STEP_KEYS, path, report);
  const from = str(value.from, `${path}.from`, report);
  const to = str(value.to, `${path}.to`, report);
  if (!from) report(`${path}.from`, "field-required", "`from` is required: the ID of the element that acts.");
  if (!to) report(`${path}.to`, "field-required", "`to` is required: the ID of the element it calls or answers.");
  if (!from || !to) return undefined;
  const step: StepData = { from, to };
  for (const key of ["description", "technology"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) step[key] = v;
  }
  if (value.reply !== undefined) {
    if (typeof value.reply === "boolean") {
      if (value.reply) step.reply = true;
    } else report(`${path}.reply`, "field-type", "Must be true or false.");
  }
  return step;
}

function readState(id: string, value: unknown, path: string, report: Report): StateData | undefined {
  if (!readId(id, path, report)) return undefined;
  if (!isObject(value)) {
    report(path, "field-type", 'A state must be an object like { "name": "Paid" }.');
    return undefined;
  }
  unknownKeys(value, STATE_KEYS, path, report);
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) report(`${path}.name`, "field-required", "`name` is required.");
  const state: StateData = { name: name?.trim() ? name : id };
  const description = str(value.description, `${path}.description`, report);
  if (description !== undefined) state.description = description;
  if (value.final !== undefined) {
    if (typeof value.final !== "boolean") report(`${path}.final`, "field-type", "Must be true or false.");
    else if (value.final) state.final = true;
  }
  if (value.at !== undefined) {
    if (Array.isArray(value.at) && value.at.length === 2 && value.at.every((n) => typeof n === "number" && Number.isFinite(n))) state.at = value.at as [number, number];
    else report(`${path}.at`, "field-type", "Must be a position, [x, y].");
  }
  return state;
}

function readTransition(value: unknown, path: string, report: Report): TransitionData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A transition must be an object like { "from": "placed", "to": "paid" }.');
    return undefined;
  }
  unknownKeys(value, TRANSITION_KEYS, path, report);
  const from = str(value.from, `${path}.from`, report);
  const to = str(value.to, `${path}.to`, report);
  if (!from) report(`${path}.from`, "field-required", "`from` is required: the ID of the state it leaves.");
  if (!to) report(`${path}.to`, "field-required", "`to` is required: the ID of the state it goes to.");
  if (!from || !to) return undefined;
  const transition: TransitionData = { from, to };
  for (const key of ["event", "guard", "action"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) transition[key] = v;
  }
  return transition;
}

function readNode(id: string, value: unknown, path: string, report: Report): DeploymentNodeData | undefined {
  if (!readId(id, path, report)) return undefined;
  if (!isObject(value)) {
    report(path, "field-type", 'A node must be an object like { "name": "Web server" }.');
    return undefined;
  }
  unknownKeys(value, NODE_KEYS, path, report);
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) report(`${path}.name`, "field-required", "`name` is required.");
  const node: DeploymentNodeData = { name: name?.trim() ? name : id };
  for (const key of ["parent", "description", "technology"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) node[key] = v;
  }
  if (value.infrastructure !== undefined) {
    if (typeof value.infrastructure !== "boolean") report(`${path}.infrastructure`, "field-type", "Must be true or false.");
    else if (value.infrastructure) node.infrastructure = true;
  }
  if (value.instances !== undefined) {
    if (Number.isInteger(value.instances) && (value.instances as number) >= 1) {
      if (value.instances !== 1) node.instances = value.instances as number;
    } else report(`${path}.instances`, "field-type", "Must be a whole number, 1 or more: how many copies of the node run.");
  }
  if (value.shape !== undefined) {
    if ((ELEMENT_SHAPES as readonly unknown[]).includes(value.shape)) node.shape = value.shape as ElementShape;
    else report(`${path}.shape`, "shape-invalid", `\`shape\` must be one of: ${ELEMENT_SHAPES.join(", ")}.`);
  }
  const runs = strList(value.runs, `${path}.runs`, report);
  if (runs) node.runs = runs;
  return node;
}

function readConnection(value: unknown, path: string, report: Report): ConnectionData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A connection must be an object like { "from": "load-balancer", "to": "web-app" }.');
    return undefined;
  }
  unknownKeys(value, CONNECTION_KEYS, path, report);
  const from = str(value.from, `${path}.from`, report);
  const to = str(value.to, `${path}.to`, report);
  if (!from) report(`${path}.from`, "field-required", "`from` is required: the ID of a node, or of a container or system a node runs.");
  if (!to) report(`${path}.to`, "field-required", "`to` is required: the ID of a node, or of a container or system a node runs.");
  if (!from || !to) return undefined;
  const connection: ConnectionData = { from, to };
  for (const key of ["description", "technology"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) connection[key] = v;
  }
  return connection;
}

function readLane(value: unknown, path: string, report: Report): LaneData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A lane must be an object like { "id": "customer", "name": "Customer" }.');
    return undefined;
  }
  unknownKeys(value, LANE_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's lanes.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) report(`${path}.name`, "field-required", "`name` is required.");
  const lane: LaneData = { id, name: name?.trim() ? name : id };
  const description = str(value.description, `${path}.description`, report);
  if (description !== undefined) lane.description = description;
  return lane;
}

function readCard(value: unknown, path: string, report: Report): CardData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A card must be an object like { "id": "order-placed", "kind": "event", "name": "Order placed" }.');
    return undefined;
  }
  unknownKeys(value, CARD_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's cards.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  if (!(CARD_KINDS as readonly unknown[]).includes(value.kind)) {
    report(`${path}.kind`, value.kind === undefined ? "field-required" : "card-kind-invalid", `\`kind\` must be one of: ${CARD_KINDS.join(", ")}.`);
    return undefined;
  }
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) report(`${path}.name`, "field-required", "`name` is required.");
  const card: CardData = { id, kind: value.kind as CardKind, name: name?.trim() ? name : id };
  for (const key of ["description", "lane"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) card[key] = v;
  }
  const from = strList(value.from, `${path}.from`, report);
  if (from) card.from = from;
  return card;
}

/**
 * A screen, with an ID none of the screens before it has. One with a taken ID is left out before
 * its widgets are read, so their IDs stay free for the widgets after it.
 */
function readScreen(value: unknown, path: string, report: Report, screenIds: Set<string>, widgetIds: Set<string>): ScreenData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A screen must be an object like { "id": "cart", "name": "Cart" }.');
    return undefined;
  }
  unknownKeys(value, SCREEN_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's screens.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  if (screenIds.has(id)) {
    report(`${path}.id`, "id-duplicate", `"${id}" is the ID of two screens of this view.`, "Give one of them another ID.");
    return undefined;
  }
  screenIds.add(id);
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) report(`${path}.name`, "field-required", "`name` is required.");
  const screen: ScreenData = { id, name: name?.trim() ? name : id };
  const description = str(value.description, `${path}.description`, report);
  if (description !== undefined) screen.description = description;
  if (value.device !== undefined) {
    if ((SCREEN_DEVICES as readonly unknown[]).includes(value.device)) {
      if (value.device !== "desktop") screen.device = value.device as ScreenDevice;
    } else report(`${path}.device`, "device-invalid", `\`device\` must be one of: ${SCREEN_DEVICES.join(", ")}.`);
  }
  const widgets = readWidgets(value.widgets, `${path}.widgets`, report, widgetIds);
  if (widgets) screen.widgets = widgets;
  return screen;
}

/** A list of widgets, each with an ID none of the view's widgets before it has. One with a taken ID is left out, with what's inside it. */
function readWidgets(value: unknown, path: string, report: Report, widgetIds: Set<string>): WidgetData[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    report(path, "field-type", "Must be a list of widgets.");
    return undefined;
  }
  const widgets: WidgetData[] = [];
  value.forEach((item, i) => {
    const widget = readWidget(item, `${path}[${i}]`, report, widgetIds);
    if (widget) widgets.push(widget);
  });
  return widgets;
}

function readWidget(value: unknown, path: string, report: Report, widgetIds: Set<string>): WidgetData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A widget must be an object like { "id": "check-out", "kind": "button", "text": "Check out" }.');
    return undefined;
  }
  unknownKeys(value, WIDGET_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's widgets.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  if (widgetIds.has(id)) {
    report(`${path}.id`, "id-duplicate", `"${id}" is the ID of two widgets of this view.`, "Give one of them another ID.");
    return undefined;
  }
  if (!(WIDGET_KINDS as readonly unknown[]).includes(value.kind)) {
    report(`${path}.kind`, value.kind === undefined ? "field-required" : "widget-kind-invalid", `\`kind\` must be one of: ${WIDGET_KINDS.join(", ")}.`);
    return undefined;
  }
  widgetIds.add(id);
  const kind = value.kind as WidgetKind;
  const widget: WidgetData = { id, kind };
  for (const key of ["text", "description", "to"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) widget[key] = v;
  }
  if (value.widgets !== undefined && !WIDGET_HOLDERS.includes(kind)) {
    report(`${path}.widgets`, "field-not-allowed", `Only rows and panels hold widgets, and this is a ${kind}.`, "Make it a row or a panel, or move its widgets out.");
  } else {
    const widgets = readWidgets(value.widgets, `${path}.widgets`, report, widgetIds);
    if (widgets) widget.widgets = widgets;
  }
  return widget;
}

const isPoint = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));

/** A shape's `at`: [x, y], or [x, y, width, height] with a width and height above 0. A pen's is only [x, y]. */
function readShapeAt(value: unknown, path: string, report: Report, pen: boolean): ShapeData["at"] | undefined {
  if (isPoint(value)) return value;
  const numbers = Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n));
  if (numbers && value.length === 4 && !pen) {
    if (value[2] > 0 && value[3] > 0) return value as [number, number, number, number];
    report(path, "field-type", "Its width and height must be more than 0.");
    return undefined;
  }
  report(path, "field-type", pen ? "Must be a position, [x, y]: how big a pen's line is comes from its points." : "Must be a position, [x, y], or a position and a size, [x, y, width, height].");
  return undefined;
}

function readShape(value: unknown, path: string, report: Report): ShapeData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A shape must be an object like { "id": "idea", "kind": "rectangle", "text": "An idea", "at": [0, 0] }.');
    return undefined;
  }
  unknownKeys(value, SHAPE_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's shapes.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  if (!(SHAPE_KINDS as readonly unknown[]).includes(value.kind)) {
    report(`${path}.kind`, value.kind === undefined ? "field-required" : "shape-kind-invalid", `\`kind\` must be one of: ${SHAPE_KINDS.join(", ")}.`);
    return undefined;
  }
  const kind = value.kind as ShapeData["kind"];
  const pen = kind === "pen";
  if (value.at === undefined) {
    report(`${path}.at`, "field-required", "`at` is required: where the shape is, [x, y], or [x, y, width, height].");
    return undefined;
  }
  const at = readShapeAt(value.at, `${path}.at`, report, pen);
  if (!at) return undefined;
  const shape: ShapeData = { id, kind, at };
  // A pen draws only a line, and text has no outline to dash.
  for (const key of pen ? ["text", "size", "fill"] : kind === "text" ? ["dashed"] : []) {
    if (value[key] !== undefined) report(`${path}.${key}`, "field-not-allowed", pen ? `A pen draws only a line, so it takes no \`${key}\`.` : "Text has no outline, so it can't be dashed.", `Remove \`${key}\`.`);
  }
  if (pen) {
    if (value.points === undefined) report(`${path}.points`, "field-required", "A pen needs `points`: the points its line goes through, [[x, y], ...].");
    else if (!Array.isArray(value.points) || value.points.length < 2 || !value.points.every(isPoint)) report(`${path}.points`, "field-type", "Must be a list of two or more points, [[x, y], ...].");
    else shape.points = value.points as [number, number][];
    if (!shape.points) return undefined;
  } else {
    if (value.points !== undefined) report(`${path}.points`, "field-not-allowed", "Only pens have points.", "Remove `points`.");
    const text = str(value.text, `${path}.text`, report);
    if (text !== undefined) shape.text = text;
    if (value.size !== undefined) {
      if ((TEXT_SIZES as readonly unknown[]).includes(value.size)) {
        if (value.size !== "medium") shape.size = value.size as ShapeData["size"];
      } else report(`${path}.size`, "size-invalid", `\`size\` must be one of: ${TEXT_SIZES.join(", ")}.`);
    }
    if (value.fill !== undefined) {
      if ((SHAPE_FILLS as readonly unknown[]).includes(value.fill)) shape.fill = value.fill as ShapeData["fill"];
      else report(`${path}.fill`, "fill-invalid", `\`fill\` must be one of: ${SHAPE_FILLS.join(", ")}.`);
    }
  }
  readLook(value, shape, path, report, kind !== "text");
  return shape;
}

/** A shape's or arrow's colour, and whether it's dashed, when it can be. */
function readLook(value: Record<string, unknown>, into: { color?: ShapeData["color"]; dashed?: boolean }, path: string, report: Report, dashes: boolean): void {
  if (value.color !== undefined) {
    if ((SHAPE_COLORS as readonly unknown[]).includes(value.color)) {
      if (value.color !== "black") into.color = value.color as ShapeData["color"];
    } else report(`${path}.color`, "color-invalid", `\`color\` must be one of: ${SHAPE_COLORS.join(", ")}.`);
  }
  if (dashes && value.dashed !== undefined) {
    if (typeof value.dashed !== "boolean") report(`${path}.dashed`, "field-type", "Must be true or false.");
    else if (value.dashed) into.dashed = true;
  }
}

/** An arrow's end: a shape's ID, a shape and the side of it the end stays on, or a point. */
function readArrowEnd(value: unknown, path: string, report: Report, which: "from" | "to"): ArrowEnd | undefined {
  if (value === undefined || value === "") {
    report(path, "field-required", `\`${which}\` is required: the ID of the shape it ${which === "from" ? "starts at" : "points to"}, or a point, [x, y].`);
    return undefined;
  }
  if (typeof value === "string") return value;
  if (isPoint(value)) return value;
  if (!isObject(value)) {
    report(path, "field-type", 'Must be the ID of a shape, a shape and a side of it, like { "shape": "decision", "side": "right" }, or a point, [x, y].');
    return undefined;
  }
  unknownKeys(value, ARROW_END_KEYS, path, report);
  const shape = str(value.shape, `${path}.shape`, report);
  if (!shape) {
    if (value.shape === undefined || shape === "") report(`${path}.shape`, "field-required", "`shape` is required: the ID of the shape the end is on.");
    return undefined;
  }
  if (!(ARROW_SIDES as readonly unknown[]).includes(value.side)) {
    report(`${path}.side`, value.side === undefined ? "field-required" : "side-invalid", `\`side\` must be one of: ${ARROW_SIDES.join(", ")}.`);
    return undefined;
  }
  return { shape, side: value.side as ArrowSide };
}

function readArrow(value: unknown, path: string, report: Report): ArrowData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'An arrow must be an object like { "id": "idea-to-plan", "from": "idea", "to": "plan" }.');
    return undefined;
  }
  unknownKeys(value, ARROW_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's arrows.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  const from = readArrowEnd(value.from, `${path}.from`, report, "from");
  const to = readArrowEnd(value.to, `${path}.to`, report, "to");
  if (from === undefined || to === undefined) return undefined;
  const arrow: ArrowData = { id, from, to };
  const text = str(value.text, `${path}.text`, report);
  if (text !== undefined) arrow.text = text;
  if (value.heads !== undefined) {
    if ((ARROW_HEADS as readonly unknown[]).includes(value.heads)) {
      if (value.heads !== "end") arrow.heads = value.heads as ArrowData["heads"];
    } else report(`${path}.heads`, "heads-invalid", `\`heads\` must be one of: ${ARROW_HEADS.join(", ")}.`);
  }
  readLook(value, arrow, path, report, true);
  return arrow;
}

function readBlock(value: unknown, path: string, report: Report): BlockData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A block must be an object like { "id": "pack", "text": "Pack the order" }.');
    return undefined;
  }
  unknownKeys(value, BLOCK_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's blocks.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  const b: BlockData = { id, text: id };
  if (value.kind !== undefined) {
    if ((BLOCK_KINDS as readonly unknown[]).includes(value.kind)) {
      if (value.kind !== "process") b.kind = value.kind as BlockKind;
    } else report(`${path}.kind`, "block-kind-invalid", `\`kind\` must be one of: ${BLOCK_KINDS.join(", ")}.`);
  }
  const text = str(value.text, `${path}.text`, report);
  if (!text?.trim()) report(`${path}.text`, "field-required", "`text` is required: what the block says.");
  else b.text = text;
  for (const key of ["description", "lane"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) b[key] = v;
  }
  if (value.at !== undefined) {
    if (isPoint(value.at)) b.at = value.at;
    else report(`${path}.at`, "field-type", "Must be a position, [x, y].");
  }
  return b;
}

function readFlow(value: unknown, path: string, report: Report): FlowData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A flow must be an object like { "from": "in-stock", "to": "pack", "text": "Yes" }.');
    return undefined;
  }
  unknownKeys(value, FLOW_KEYS, path, report);
  const from = str(value.from, `${path}.from`, report);
  const to = str(value.to, `${path}.to`, report);
  if (!from) report(`${path}.from`, "field-required", "`from` is required: the ID of the block it leaves.");
  if (!to) report(`${path}.to`, "field-required", "`to` is required: the ID of the block it goes to.");
  if (!from || !to) return undefined;
  const flow: FlowData = { from, to };
  const text = str(value.text, `${path}.text`, report);
  if (text !== undefined) flow.text = text;
  return flow;
}

function readEntity(value: unknown, path: string, report: Report): EntityData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'An entity must be an object like { "id": "order", "name": "Order" }.');
    return undefined;
  }
  unknownKeys(value, ENTITY_KEYS, path, report);
  const id = str(value.id, `${path}.id`, report);
  if (!id) {
    report(`${path}.id`, "field-required", "`id` is required: an ID unique among the view's entities.");
    return undefined;
  }
  if (!readId(id, `${path}.id`, report)) return undefined;
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) report(`${path}.name`, "field-required", "`name` is required.");
  const entity: EntityData = { id, name: name?.trim() ? name : id };
  const description = str(value.description, `${path}.description`, report);
  if (description !== undefined) entity.description = description;
  if (value.attributes !== undefined) {
    if (!Array.isArray(value.attributes)) report(`${path}.attributes`, "field-type", "Must be a list of attributes.");
    else {
      // An attribute with the name of one before it is left out: it would say something else about the same thing.
      entity.attributes = [];
      value.attributes.forEach((item, i) => {
        const a = readAttribute(item, `${path}.attributes[${i}]`, report);
        if (!a) return;
        if (entity.attributes!.some((other) => other.name === a.name)) {
          report(`${path}.attributes[${i}].name`, "attribute-duplicate", `"${a.name}" is the name of two attributes of the entity "${id}".`, "Give one of them another name, or remove it.");
        } else entity.attributes!.push(a);
      });
    }
  }
  if (value.at !== undefined) {
    if (isPoint(value.at)) entity.at = value.at;
    else report(`${path}.at`, "field-type", "Must be a position, [x, y].");
  }
  return entity;
}

function readAttribute(value: unknown, path: string, report: Report): AttributeData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'An attribute must be an object like { "name": "id", "type": "uuid", "keys": ["pk"] }.');
    return undefined;
  }
  unknownKeys(value, ATTRIBUTE_FIELDS, path, report);
  const name = str(value.name, `${path}.name`, report);
  if (!name?.trim()) {
    report(`${path}.name`, "field-required", '`name` is required: what\'s kept, like "email".');
    return undefined;
  }
  const attribute: AttributeData = { name };
  for (const key of ["type", "description"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) attribute[key] = v;
  }
  const keys = strList(value.keys, `${path}.keys`, report);
  if (keys) {
    const known = keys.filter((k): k is AttributeKey => (ATTRIBUTE_KEYS as readonly string[]).includes(k));
    if (known.length < keys.length) report(`${path}.keys`, "attribute-key-invalid", `Each of \`keys\` must be one of: ${ATTRIBUTE_KEYS.join(", ")}.`);
    attribute.keys = known;
  }
  return attribute;
}

function readLink(value: unknown, path: string, report: Report): EntityLinkData | undefined {
  if (!isObject(value)) {
    report(path, "field-type", 'A link must be an object like { "from": "customer", "to": "order", "text": "places" }.');
    return undefined;
  }
  unknownKeys(value, LINK_KEYS, path, report);
  const from = str(value.from, `${path}.from`, report);
  const to = str(value.to, `${path}.to`, report);
  if (!from) report(`${path}.from`, "field-required", "`from` is required: the ID of the entity at one end.");
  if (!to) report(`${path}.to`, "field-required", "`to` is required: the ID of the entity at the other end.");
  if (!from || !to) return undefined;
  const link: EntityLinkData = { from, to };
  if (value.cardinality !== undefined) {
    const c = value.cardinality;
    if (!Array.isArray(c) || c.length !== 2 || !c.every((v) => typeof v === "string")) {
      report(`${path}.cardinality`, "field-type", 'Must say how many of each end there can be, `from`\'s then `to`\'s, like ["one", "zero-or-more"].');
    } else if (!c.every((v) => (CARDINALITIES as readonly string[]).includes(v))) {
      report(`${path}.cardinality`, "cardinality-invalid", `Each end's cardinality must be one of: ${CARDINALITIES.join(", ")}.`);
    } else link.cardinality = c as [Cardinality, Cardinality];
  }
  const text = str(value.text, `${path}.text`, report);
  if (text !== undefined) link.text = text;
  return link;
}

/** `own`: the view's level, when it draws something other than boxes picked from the model, whose notes can't be on anything. */
function readSticky(id: string, value: unknown, path: string, report: Report, own: OwnLevel | undefined): StickyData | undefined {
  if (!readId(id, path, report)) return undefined;
  if (!isObject(value)) {
    report(path, "field-type", 'A sticky note must be an object like { "text": "..." }.');
    return undefined;
  }
  unknownKeys(value, STICKY_KEYS, path, report);
  const text = str(value.text, `${path}.text`, report);
  if (!text?.trim()) {
    report(`${path}.text`, "field-required", "`text` is required.");
    return undefined;
  }
  const sticky: StickyData = { text };
  if (value.on !== undefined) {
    if (own) {
      report(`${path}.on`, "field-not-allowed", `Only sticky notes on landscape, context, container, component and class views can be on an element or relationship, and this is ${aOrAn(own)} ${own} view.`, "Remove `on`.");
    } else {
      const on = readStickyTarget(value.on, `${path}.on`, report);
      if (on) sticky.on = on;
    }
  }
  if (value.color !== undefined) {
    if ((STICKY_COLORS as readonly unknown[]).includes(value.color)) sticky.color = value.color as StickyData["color"];
    else report(`${path}.color`, "color-invalid", `\`color\` must be one of: ${STICKY_COLORS.join(", ")}.`);
  }
  if (value.at !== undefined) {
    if (Array.isArray(value.at) && value.at.length === 2 && value.at.every((n) => typeof n === "number" && Number.isFinite(n))) sticky.at = value.at as [number, number];
    else report(`${path}.at`, "field-type", "Must be a position, [x, y].");
  }
  const notes = str(value.notes, `${path}.notes`, report);
  if (notes !== undefined) sticky.notes = notes;
  return sticky;
}

/** What a sticky note is on: `{ "element": "<id>" }`, or `{ "from": "<id>", "to": "<id>" }` with the relationship's `kind` when it isn't an association. */
function readStickyTarget(value: unknown, path: string, report: Report): StickyTargetData | undefined {
  const shape = 'Must be an element, like { "element": "cache" }, or a relationship, like { "from": "web-app", "to": "orders-db" }.';
  if (!isObject(value)) {
    report(path, "field-type", shape);
    return undefined;
  }
  unknownKeys(value, STICKY_ON_KEYS, path, report);
  const element = str(value.element, `${path}.element`, report);
  const from = str(value.from, `${path}.from`, report);
  const to = str(value.to, `${path}.to`, report);
  if (value.element !== undefined) {
    if (value.from !== undefined || value.to !== undefined || value.kind !== undefined) {
      report(path, "field-not-allowed", "A sticky note is on an element or on a relationship, not both.", "Keep `element`, or `from` and `to`.");
      return undefined;
    }
    // A value that isn't a string was reported by str.
    if (element === "") report(`${path}.element`, "field-required", "`element` is required: the ID of the element the note is on.");
    return element ? { element } : undefined;
  }
  if (value.from === undefined && value.to === undefined) {
    report(path, "field-required", shape);
    return undefined;
  }
  if (value.from === undefined || from === "") report(`${path}.from`, "field-required", "`from` is required: the ID of the element the relationship is on.");
  if (value.to === undefined || to === "") report(`${path}.to`, "field-required", "`to` is required: the ID of the element it uses.");
  if (!from || !to) return undefined;
  const on: StickyTargetData = { from, to };
  if (value.kind !== undefined) {
    if ((RELATIONSHIP_KINDS as readonly unknown[]).includes(value.kind)) {
      if (value.kind !== "association") on.kind = value.kind as RelationshipKind;
    } else report(`${path}.kind`, "relationship-kind-invalid", `\`kind\` must be one of: ${RELATIONSHIP_KINDS.join(", ")}.`);
  }
  return on;
}

// --- Writing ----------------------------------------------------------------------

/** Elements in reading order: each top-level element, then everything inside it. */
export function elementOrder(elements: Record<string, ElementData>): string[] {
  const byRank = (a: string, b: string) => KIND_RANK[elements[a]!.kind] - KIND_RANK[elements[b]!.kind] || (a < b ? -1 : a > b ? 1 : 0);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const [id, e] of Object.entries(elements)) {
    if (e.parent && elements[e.parent] && e.parent !== id) children.set(e.parent, [...(children.get(e.parent) ?? []), id]);
    else roots.push(id);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    (children.get(id) ?? []).sort(byRank).forEach(visit);
  };
  roots.sort(byRank).forEach(visit);
  // Anything left is in a parent cycle; keep it rather than drop it.
  Object.keys(elements).sort().forEach(visit);
  return out;
}

/** A deployment view's nodes in reading order: each top-level node, then the nodes inside it, by ID at each level. */
export function nodeOrder(nodes: Record<string, { parent?: string }>): string[] {
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const [id, n] of Object.entries(nodes)) {
    if (n.parent && Object.hasOwn(nodes, n.parent) && n.parent !== id) children.set(n.parent, [...(children.get(n.parent) ?? []), id]);
    else roots.push(id);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    (children.get(id) ?? []).sort().forEach(visit);
  };
  roots.sort().forEach(visit);
  // Anything left is in a parent cycle; keep it rather than drop it.
  Object.keys(nodes).sort().forEach(visit);
  return out;
}

/** Inline JSON with a space after colons and commas: `{ "to": "db", "technology": "SQL" }`. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}

function block(entries: [string, string][], indent: string): string {
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${v}`).join(",\n")}\n${indent}}`;
}

function present<T>(value: T | undefined | null, keep: (v: T) => boolean = () => true): value is T {
  return value !== undefined && value !== null && keep(value);
}

function elementText(e: ElementData, indent: string): string {
  const entries: [string, string][] = [
    ["kind", JSON.stringify(e.kind)],
    ["name", JSON.stringify(e.name)],
  ];
  if (present(e.parent)) entries.push(["parent", JSON.stringify(e.parent)]);
  if (present(e.description, (v) => v !== "")) entries.push(["description", JSON.stringify(e.description)]);
  if (present(e.technology, (v) => v !== "")) entries.push(["technology", JSON.stringify(e.technology)]);
  if (e.external) entries.push(["external", "true"]);
  if (present(e.shape, (v) => v !== "box")) entries.push(["shape", JSON.stringify(e.shape)]);
  if (present(e.stereotype, (v) => v !== "")) entries.push(["stereotype", JSON.stringify(e.stereotype)]);
  if (present(e.libraries, (v) => v.length > 0)) entries.push(["libraries", inline([...e.libraries].sort())]);
  if (present(e.tags, (v) => Object.keys(v).length > 0)) {
    entries.push(["tags", block(tagEntries(e.tags).map(([k, v]) => [k, JSON.stringify(v)]), `${indent}  `)]);
  }
  if (present(e.notes, (v) => v !== "")) entries.push(["notes", JSON.stringify(e.notes)]);
  if (present(e.members, (v) => v.length > 0)) entries.push(["members", `[\n${e.members.map((m) => `${indent}    ${JSON.stringify(m)}`).join(",\n")}\n${indent}  ]`]);
  if (present(e.uses, (v) => v.length > 0)) {
    const rels = e.uses.map((r) =>
      inline({
        to: r.to,
        kind: r.kind && r.kind !== "association" ? r.kind : undefined,
        bidirectional: r.bidirectional || undefined,
        description: r.description || undefined,
        technology: r.technology || undefined,
        tags: r.tags && Object.keys(r.tags).length ? Object.fromEntries(tagEntries(r.tags)) : undefined,
        notes: r.notes || undefined,
      }),
    );
    entries.push(["uses", `[\n${rels.map((r) => `${indent}    ${r}`).join(",\n")}\n${indent}  ]`]);
  }
  return block(entries, indent);
}

/** A list that's the value of an entry of a block at `indent`, with an item to a line: `[]` when it's empty. */
function listText(items: string[], indent: string): string {
  return items.length ? `[\n${items.map((item) => `${indent}    ${item}`).join(",\n")}\n${indent}  ]` : "[]";
}

/** A screen as a block, its widgets a list in it. */
function screenText(s: ScreenData, indent: string): string {
  const entries: [string, string][] = [
    ["id", JSON.stringify(s.id)],
    ["name", JSON.stringify(s.name)],
  ];
  if (present(s.description, (d) => d !== "")) entries.push(["description", JSON.stringify(s.description)]);
  if (present(s.device, (d) => d !== "desktop")) entries.push(["device", JSON.stringify(s.device)]);
  entries.push(["widgets", listText((s.widgets ?? []).map((w) => widgetText(w, `${indent}    `)), indent)]);
  return block(entries, indent);
}

/** A widget on one line, or, for a row or panel with widgets in it, as a block with them a list in it. */
function widgetText(w: WidgetData, indent: string): string {
  const fields = { id: w.id, kind: w.kind, text: w.text || undefined, description: w.description || undefined, to: w.to || undefined };
  if (!w.widgets?.length) return inline(fields);
  const entries = Object.entries(fields).flatMap(([k, value]): [string, string][] => (value === undefined ? [] : [[k, JSON.stringify(value)]]));
  entries.push(["widgets", listText(w.widgets.map((c) => widgetText(c, `${indent}    `)), indent)]);
  return block(entries, indent);
}

/** An entity as a block, its attributes a list in it, an attribute to a line. An attribute's keys are each written once, in the order of ATTRIBUTE_KEYS. */
function entityText(e: EntityData, indent: string): string {
  const entries: [string, string][] = [
    ["id", JSON.stringify(e.id)],
    ["name", JSON.stringify(e.name)],
  ];
  if (present(e.description, (d) => d !== "")) entries.push(["description", JSON.stringify(e.description)]);
  const keys = (a: AttributeData) => {
    const list = ATTRIBUTE_KEYS.filter((k) => a.keys?.includes(k));
    return list.length ? list : undefined;
  };
  const attribute = (a: AttributeData) => inline({ name: a.name, type: a.type || undefined, keys: keys(a), description: a.description || undefined });
  entries.push(["attributes", listText((e.attributes ?? []).map(attribute), indent)]);
  if (e.at) entries.push(["at", inline(e.at.map((n) => Math.round(n)))]);
  return block(entries, indent);
}

function viewText(v: ViewData, indent: string): string {
  const entries: [string, string][] = [["title", JSON.stringify(v.title)]];
  if (present(v.description, (d) => d !== "")) entries.push(["description", JSON.stringify(v.description)]);
  entries.push(["level", JSON.stringify(v.level)]);
  const sequence = v.level === "sequence";
  const statesView = v.level === "state";
  const deployment = v.level === "deployment";
  const events = v.level === "event";
  const wireframe = v.level === "wireframe";
  const whiteboard = v.level === "whiteboard";
  const flowchart = v.level === "flowchart";
  const entities = v.level === "entity";
  const boxes = !sequence && !statesView && !deployment && !events && !wireframe && !whiteboard && !flowchart && !entities;
  if (present(v.scope)) entries.push(["scope", JSON.stringify(v.scope)]);
  if (boxes) entries.push(["include", inline(v.include ?? ["*"])]);
  if (boxes && present(v.exclude, (x) => x.length > 0)) entries.push(["exclude", inline(v.exclude)]);
  if (present(v.notes, (n) => n !== "")) entries.push(["notes", JSON.stringify(v.notes)]);
  if (sequence) {
    const steps = (v.steps ?? []).map((s) =>
      inline({ from: s.from, to: s.to, description: s.description || undefined, technology: s.technology || undefined, reply: s.reply || undefined }),
    );
    entries.push(["steps", steps.length ? `[\n${steps.map((s) => `${indent}    ${s}`).join(",\n")}\n${indent}  ]` : "[]"]);
  }
  if (statesView) {
    if (present(v.initial, (i) => i !== "")) entries.push(["initial", JSON.stringify(v.initial)]);
    const state = (s: StateData) => inline({ name: s.name, description: s.description || undefined, final: s.final || undefined, at: s.at?.map((n) => Math.round(n)) });
    const ids = Object.keys(v.states ?? {}).sort();
    entries.push(["states", block(ids.map((id) => [id, state(v.states![id]!)]), `${indent}  `)]);
    const transitions = (v.transitions ?? []).map((t) =>
      inline({ from: t.from, to: t.to, event: t.event || undefined, guard: t.guard || undefined, action: t.action || undefined }),
    );
    entries.push(["transitions", transitions.length ? `[\n${transitions.map((t) => `${indent}    ${t}`).join(",\n")}\n${indent}  ]` : "[]"]);
  }
  if (deployment) {
    const node = (n: DeploymentNodeData) =>
      inline({
        name: n.name,
        parent: n.parent || undefined,
        description: n.description || undefined,
        technology: n.technology || undefined,
        infrastructure: n.infrastructure || undefined,
        instances: n.instances && n.instances !== 1 ? n.instances : undefined,
        shape: n.shape && n.shape !== "box" ? n.shape : undefined,
        runs: n.runs?.length ? n.runs : undefined,
      });
    entries.push(["nodes", block(nodeOrder(v.nodes ?? {}).map((id) => [id, node(v.nodes![id]!)]), `${indent}  `)]);
    const connections = (v.connections ?? []).map((c) => inline({ from: c.from, to: c.to, description: c.description || undefined, technology: c.technology || undefined }));
    entries.push(["connections", connections.length ? `[\n${connections.map((c) => `${indent}    ${c}`).join(",\n")}\n${indent}  ]` : "[]"]);
  }
  if (events) {
    const list = (items: string[]) => (items.length ? `[\n${items.map((item) => `${indent}    ${item}`).join(",\n")}\n${indent}  ]` : "[]");
    entries.push(["lanes", list((v.lanes ?? []).map((l) => inline({ id: l.id, name: l.name, description: l.description || undefined })))]);
    // A card comes from each card once, however often the file names it.
    const card = (c: CardData) => inline({ id: c.id, kind: c.kind, name: c.name, description: c.description || undefined, lane: c.lane || undefined, from: c.from?.length ? [...new Set(c.from)] : undefined });
    entries.push(["cards", list((v.cards ?? []).map(card))]);
  }
  if (wireframe) entries.push(["screens", listText((v.screens ?? []).map((s) => screenText(s, `${indent}    `)), indent)]);
  if (whiteboard) {
    const round = (point: number[]) => point.map((n) => Math.round(n));
    const look = (x: { color?: string; dashed?: boolean }) => ({ color: x.color && x.color !== "black" ? x.color : undefined, dashed: x.dashed || undefined });
    const shape = (s: ShapeData) =>
      inline({
        id: s.id,
        kind: s.kind,
        text: s.text || undefined,
        at: round(s.at),
        points: s.points?.map(round),
        size: s.size && s.size !== "medium" ? s.size : undefined,
        color: look(s).color,
        fill: s.fill,
        dashed: look(s).dashed,
      });
    const end = (e: ArrowEnd) => (typeof e === "string" ? e : Array.isArray(e) ? round(e) : { shape: e.shape, side: e.side });
    const arrow = (a: ArrowData) => inline({ id: a.id, from: end(a.from), to: end(a.to), text: a.text || undefined, heads: a.heads && a.heads !== "end" ? a.heads : undefined, ...look(a) });
    entries.push(["shapes", listText((v.shapes ?? []).map(shape), indent)]);
    entries.push(["arrows", listText((v.arrows ?? []).map(arrow), indent)]);
  }
  if (flowchart) {
    // Lanes only when it has some: most flowcharts have none.
    if (v.lanes?.length) entries.push(["lanes", listText(v.lanes.map((l) => inline({ id: l.id, name: l.name, description: l.description || undefined })), indent)]);
    const blockLine = (b: BlockData) =>
      inline({ id: b.id, kind: b.kind && b.kind !== "process" ? b.kind : undefined, text: b.text, description: b.description || undefined, lane: b.lane || undefined, at: b.at?.map((n) => Math.round(n)) });
    entries.push(["blocks", listText((v.blocks ?? []).map(blockLine), indent)]);
    entries.push(["flows", listText((v.flows ?? []).map((f) => inline({ from: f.from, to: f.to, text: f.text || undefined })), indent)]);
  }
  if (entities) {
    entries.push(["entities", listText((v.entities ?? []).map((e) => entityText(e, `${indent}    `)), indent)]);
    const cardinality = (c: EntityLinkData["cardinality"]) => (c && (c[0] !== DEFAULT_CARDINALITY[0] || c[1] !== DEFAULT_CARDINALITY[1]) ? c : undefined);
    entries.push(["links", listText((v.links ?? []).map((l) => inline({ from: l.from, to: l.to, cardinality: cardinality(l.cardinality), text: l.text || undefined })), indent)]);
  }
  if (present(v.stickies, (s) => Object.keys(s).length > 0)) {
    const keys = Object.keys(v.stickies).sort();
    const on = (t: StickyTargetData) => ("element" in t ? { element: t.element } : { from: t.from, to: t.to, kind: t.kind && t.kind !== "association" ? t.kind : undefined });
    const sticky = (s: StickyData) => inline({ text: s.text, on: s.on && on(s.on), color: s.color && s.color !== "yellow" ? s.color : undefined, at: s.at?.map((n) => Math.round(n)), notes: s.notes || undefined });
    entries.push(["stickies", block(keys.map((k) => [k, sticky(v.stickies![k]!)]), `${indent}  `)]);
  }
  if (boxes && present(v.layout, (l) => Object.keys(l).length > 0)) {
    const keys = Object.keys(v.layout).sort();
    entries.push(["layout", block(keys.map((k) => [k, inline(v.layout![k]!.map((n) => Math.round(n)))]), `${indent}  `)]);
  }
  return block(entries, indent);
}

/** The canonical text of a document. */
export function serializeDocument(doc: OpenArchDocument): string {
  const top: [string, string][] = [];
  if (doc.$schema) top.push(["$schema", JSON.stringify(doc.$schema)]);
  top.push(["openarch", String(FORMAT_VERSION)], ["name", JSON.stringify(doc.name)]);
  if (doc.description) top.push(["description", JSON.stringify(doc.description)]);
  if (doc.export?.docs) top.push(["export", inline({ docs: doc.export.docs })]);
  top.push(["elements", block(elementOrder(doc.elements).map((id) => [id, elementText(doc.elements[id]!, "    ")]), "  ")]);
  const viewIds = Object.keys(doc.views).sort();
  top.push(["views", block(viewIds.map((id) => [id, viewText(doc.views[id]!, "    ")]), "  ")]);
  return `${block(top, "")}\n`;
}
