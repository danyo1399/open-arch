export const ELEMENT_KINDS = ["person", "system", "container", "component"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const VIEW_LEVELS = ["landscape", "context", "container", "component"] as const;
export type ViewLevel = (typeof VIEW_LEVELS)[number];

/** Element and view IDs: lowercase kebab-case, like "checkout-api". */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = ".openarch";

// --- The .openarch file, as stored -------------------------------------------

export interface OpenArchDocument {
  $schema?: string;
  openarch: typeof FORMAT_VERSION;
  name: string;
  description?: string;
  /** `docs`: folder, relative to the .openarch file, kept up to date with generated markdown. */
  export?: { docs?: string };
  /** Keyed by element ID. */
  elements: Record<string, ElementData>;
  /** Keyed by view ID. */
  views: Record<string, ViewData>;
}

export interface ElementData {
  kind: ElementKind;
  name: string;
  parent?: string;
  description?: string;
  technology?: string;
  external?: boolean;
  tags?: string[];
  /** Free-form key/value facts, e.g. owner or repository. */
  properties?: Record<string, string>;
  /** Longer documentation, as markdown. */
  notes?: string;
  uses?: RelationshipData[];
}

export interface RelationshipData {
  to: string;
  description?: string;
  technology?: string;
  tags?: string[];
}

/** A box's top-left corner, optionally with its width and height. */
export type Position = [number, number] | [number, number, number, number];

export interface ViewData {
  title: string;
  description?: string;
  level: ViewLevel;
  scope?: string;
  include?: string[];
  exclude?: string[];
  /** Box positions saved by the designer, keyed by element ID. */
  layout?: Record<string, Position>;
}

// --- The model built from a document -------------------------------------------

export interface Relationship {
  to: string;
  description?: string;
  technology?: string;
  tags: string[];
  /** Position in the element's `uses` list. */
  index: number;
}

export interface ArchElement {
  id: string;
  /** Where it lives in the document, e.g. `elements.checkout-api`. */
  path: string;
  kind: ElementKind;
  name: string;
  parent?: string;
  description?: string;
  technology?: string;
  external: boolean;
  tags: string[];
  properties: Record<string, string>;
  notes?: string;
  uses: Relationship[];
}

export interface ViewDef {
  id: string;
  /** Where it lives in the document, e.g. `views.shop-containers`. */
  path: string;
  title: string;
  description?: string;
  level: ViewLevel;
  scope?: string;
  include: string[];
  exclude: string[];
  layout: Record<string, Position>;
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** Stable rule name, e.g. `relationship-unknown-target`. */
  rule: string;
  message: string;
  /** Where in the document, e.g. `elements.web-app.uses[0].to`. */
  path: string;
  /** How to fix it, phrased as an instruction. */
  fix?: string;
}

/** The element or view a diagnostic is about, from its path. */
export function diagnosticTarget(d: Diagnostic): { kind: "element" | "view"; id: string } | undefined {
  const match = /^(elements|views)\.([a-z0-9-]+)/.exec(d.path);
  if (!match) return undefined;
  return { kind: match[1] === "elements" ? "element" : "view", id: match[2]! };
}
