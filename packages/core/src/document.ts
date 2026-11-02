/**
 * Reading and writing the .openarch file. Parsing checks the file's shape and
 * reports every problem it finds; writing always produces the same canonical
 * text for the same model, so diffs stay small and merges stay local.
 */
import { KIND_RANK, tagEntries } from "./model.js";
import {
  ELEMENT_KINDS,
  ELEMENT_SHAPES,
  FORMAT_VERSION,
  ID_PATTERN,
  STICKY_COLORS,
  VIEW_LEVELS,
  type Diagnostic,
  type ElementData,
  type ElementShape,
  type OpenArchDocument,
  type Position,
  type RelationshipData,
  type StepData,
  type StickyData,
  type Tags,
  type ViewData,
} from "./types.js";

export interface ParseResult {
  /** The document with anything malformed left out. Always present, so a broken file can still be shown. */
  doc: OpenArchDocument;
  /** Problems with the file's shape. */
  diagnostics: Diagnostic[];
  /** False when anything was left out. Writing a document that isn't valid would lose those parts. */
  valid: boolean;
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
const ELEMENT_KEYS = ["kind", "name", "parent", "description", "technology", "external", "shape", "tags", "notes", "uses"];
const RELATIONSHIP_KEYS = ["to", "bidirectional", "description", "technology", "tags", "notes"];
const VIEW_KEYS = ["title", "description", "level", "scope", "include", "exclude", "notes", "steps", "stickies", "layout"];
/** Fields a sequence view doesn't take: its participants and their places come from its steps. */
const NOT_ON_SEQUENCE = ["include", "exclude", "layout"];
const STEP_KEYS = ["from", "to", "description", "technology", "reply"];
const STICKY_KEYS = ["text", "color", "at"];

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
        : `Unsupported format version ${JSON.stringify(raw.openarch)}; this tool reads version ${FORMAT_VERSION}, and upgrades versions 1 to 4.`,
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
  for (const key of ["description", "technology", "notes"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) element[key] = v;
  }
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
  for (const key of sequence ? NOT_ON_SEQUENCE : ["steps"]) {
    if (value[key] === undefined) continue;
    report(
      `${path}.${key}`,
      "field-not-allowed",
      sequence ? `Sequence views don't take \`${key}\`: they show the elements in their steps, in the order they first appear.` : `Only sequence views have \`steps\`.`,
      `Remove \`${key}\`.`,
    );
  }
  const description = str(value.description, `${path}.description`, report);
  if (description !== undefined) view.description = description;
  const scope = str(value.scope, `${path}.scope`, report);
  if (scope !== undefined) view.scope = scope;
  const include = sequence ? undefined : strList(value.include, `${path}.include`, report);
  if (include) view.include = include;
  const exclude = sequence ? undefined : strList(value.exclude, `${path}.exclude`, report);
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
  if (value.stickies !== undefined) {
    if (!isObject(value.stickies)) report(`${path}.stickies`, "field-type", "Must be an object keyed by sticky note ID.");
    else {
      view.stickies = {};
      for (const [stickyId, sticky] of Object.entries(value.stickies)) {
        const s = readSticky(stickyId, sticky, `${path}.stickies.${stickyId}`, report);
        if (s) view.stickies[stickyId] = s;
      }
    }
  }
  if (!sequence && value.layout !== undefined) {
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

function readSticky(id: string, value: unknown, path: string, report: Report): StickyData | undefined {
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
  if (value.color !== undefined) {
    if ((STICKY_COLORS as readonly unknown[]).includes(value.color)) sticky.color = value.color as StickyData["color"];
    else report(`${path}.color`, "color-invalid", `\`color\` must be one of: ${STICKY_COLORS.join(", ")}.`);
  }
  if (value.at !== undefined) {
    if (Array.isArray(value.at) && value.at.length === 2 && value.at.every((n) => typeof n === "number" && Number.isFinite(n))) sticky.at = value.at as [number, number];
    else report(`${path}.at`, "field-type", "Must be a position, [x, y].");
  }
  return sticky;
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
  if (present(e.tags, (v) => Object.keys(v).length > 0)) {
    entries.push(["tags", block(tagEntries(e.tags).map(([k, v]) => [k, JSON.stringify(v)]), `${indent}  `)]);
  }
  if (present(e.notes, (v) => v !== "")) entries.push(["notes", JSON.stringify(e.notes)]);
  if (present(e.uses, (v) => v.length > 0)) {
    const rels = e.uses.map((r) =>
      inline({
        to: r.to,
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

function viewText(v: ViewData, indent: string): string {
  const entries: [string, string][] = [["title", JSON.stringify(v.title)]];
  if (present(v.description, (d) => d !== "")) entries.push(["description", JSON.stringify(v.description)]);
  entries.push(["level", JSON.stringify(v.level)]);
  const sequence = v.level === "sequence";
  if (present(v.scope)) entries.push(["scope", JSON.stringify(v.scope)]);
  if (!sequence) entries.push(["include", inline(v.include ?? ["*"])]);
  if (!sequence && present(v.exclude, (x) => x.length > 0)) entries.push(["exclude", inline(v.exclude)]);
  if (present(v.notes, (n) => n !== "")) entries.push(["notes", JSON.stringify(v.notes)]);
  if (sequence) {
    const steps = (v.steps ?? []).map((s) =>
      inline({ from: s.from, to: s.to, description: s.description || undefined, technology: s.technology || undefined, reply: s.reply || undefined }),
    );
    entries.push(["steps", steps.length ? `[\n${steps.map((s) => `${indent}    ${s}`).join(",\n")}\n${indent}  ]` : "[]"]);
  }
  if (present(v.stickies, (s) => Object.keys(s).length > 0)) {
    const keys = Object.keys(v.stickies).sort();
    const sticky = (s: StickyData) => inline({ text: s.text, color: s.color && s.color !== "yellow" ? s.color : undefined, at: s.at?.map((n) => Math.round(n)) });
    entries.push(["stickies", block(keys.map((k) => [k, sticky(v.stickies![k]!)]), `${indent}  `)]);
  }
  if (!sequence && present(v.layout, (l) => Object.keys(l).length > 0)) {
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
