/**
 * Reading and writing the .openarch file. Parsing checks the file's shape and
 * reports every problem it finds; writing always produces the same canonical
 * text for the same model, so diffs stay small and merges stay local.
 */
import { KIND_RANK } from "./model.js";
import {
  ELEMENT_KINDS,
  FORMAT_VERSION,
  ID_PATTERN,
  VIEW_LEVELS,
  type Diagnostic,
  type ElementData,
  type OpenArchDocument,
  type Position,
  type RelationshipData,
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
const ELEMENT_KEYS = ["kind", "name", "parent", "description", "technology", "external", "tags", "properties", "notes", "uses"];
const RELATIONSHIP_KEYS = ["to", "description", "technology", "tags"];
const VIEW_KEYS = ["title", "description", "level", "scope", "include", "exclude", "layout"];

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

function readDocument(raw: unknown, report: Report): OpenArchDocument {
  if (!isObject(raw)) {
    report("", "field-type", "The file must hold a JSON object.");
    return emptyDocument("Untitled");
  }
  unknownKeys(raw, TOP_KEYS, "", report);
  if (raw.openarch !== FORMAT_VERSION) {
    report("openarch", "version-unsupported", raw.openarch === undefined ? `Missing "openarch": ${FORMAT_VERSION}.` : `Unsupported format version ${JSON.stringify(raw.openarch)}; this tool reads version ${FORMAT_VERSION}.`);
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
  const tags = strList(value.tags, `${path}.tags`, report);
  if (tags) element.tags = tags;
  if (value.properties !== undefined) {
    if (isObject(value.properties) && Object.values(value.properties).every((v) => typeof v === "string")) element.properties = value.properties as Record<string, string>;
    else report(`${path}.properties`, "field-type", "Must be an object of string values.");
  }
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
  for (const key of ["description", "technology"] as const) {
    const v = str(value[key], `${path}.${key}`, report);
    if (v !== undefined) rel[key] = v;
  }
  const tags = strList(value.tags, `${path}.tags`, report);
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
  const description = str(value.description, `${path}.description`, report);
  if (description !== undefined) view.description = description;
  const scope = str(value.scope, `${path}.scope`, report);
  if (scope !== undefined) view.scope = scope;
  const include = strList(value.include, `${path}.include`, report);
  if (include) view.include = include;
  const exclude = strList(value.exclude, `${path}.exclude`, report);
  if (exclude) view.exclude = exclude;
  if (value.layout !== undefined) {
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
  if (present(e.tags, (v) => v.length > 0)) entries.push(["tags", inline(e.tags)]);
  if (present(e.properties, (v) => Object.keys(v).length > 0)) {
    const keys = Object.keys(e.properties).sort();
    entries.push(["properties", block(keys.map((k) => [k, JSON.stringify(e.properties![k])]), `${indent}  `)]);
  }
  if (present(e.notes, (v) => v !== "")) entries.push(["notes", JSON.stringify(e.notes)]);
  if (present(e.uses, (v) => v.length > 0)) {
    const rels = e.uses.map((r) =>
      inline({ to: r.to, description: r.description || undefined, technology: r.technology || undefined, tags: r.tags?.length ? r.tags : undefined }),
    );
    entries.push(["uses", `[\n${rels.map((r) => `${indent}    ${r}`).join(",\n")}\n${indent}  ]`]);
  }
  return block(entries, indent);
}

function viewText(v: ViewData, indent: string): string {
  const entries: [string, string][] = [["title", JSON.stringify(v.title)]];
  if (present(v.description, (d) => d !== "")) entries.push(["description", JSON.stringify(v.description)]);
  entries.push(["level", JSON.stringify(v.level)]);
  if (present(v.scope)) entries.push(["scope", JSON.stringify(v.scope)]);
  entries.push(["include", inline(v.include ?? ["*"])]);
  if (present(v.exclude, (x) => x.length > 0)) entries.push(["exclude", inline(v.exclude)]);
  if (present(v.layout, (l) => Object.keys(l).length > 0)) {
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
