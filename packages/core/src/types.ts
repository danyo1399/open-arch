export const ELEMENT_KINDS = ["person", "system", "container", "component"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** A sequence view isn't a C4 level of detail: it draws steps between elements, in order. */
export const VIEW_LEVELS = ["landscape", "context", "container", "component", "sequence"] as const;
export type ViewLevel = (typeof VIEW_LEVELS)[number];

export const STICKY_COLORS = ["yellow", "pink", "blue", "green"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

/** How a box is drawn. People are always drawn as a person. */
export const ELEMENT_SHAPES = [
  "box",
  "database",
  "queue",
  "folder",
  "document",
  "web-browser",
  "mobile-app",
  "desktop-app",
  "terminal",
  "server",
  "email",
  "scheduled-job",
] as const;
export type ElementShape = (typeof ELEMENT_SHAPES)[number];

/** Each shape's name, as the designer lists it. */
export const SHAPE_LABELS: Record<ElementShape, string> = {
  box: "Box",
  database: "Database",
  queue: "Queue",
  folder: "Folder",
  document: "Document",
  "web-browser": "Web browser",
  "mobile-app": "Mobile app",
  "desktop-app": "Desktop app",
  terminal: "Terminal",
  server: "Server",
  email: "Email",
  "scheduled-job": "Scheduled job",
};

/** Name/value pairs. A tag can have an empty value, which makes it a plain label. */
export type Tags = Record<string, string>;

/** Element, view and sticky note IDs: lowercase kebab-case, like "checkout-api". */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const FORMAT_VERSION = 5;
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
  /** Default: box. Not used on people. */
  shape?: ElementShape;
  /** Free-form facts, e.g. owner or repository. */
  tags?: Tags;
  /** Longer documentation, as markdown. */
  notes?: string;
  uses?: RelationshipData[];
}

export interface RelationshipData {
  to: string;
  /** True when it goes both ways: `to` uses the element too. Drawn with an arrowhead at each end. */
  bidirectional?: boolean;
  description?: string;
  technology?: string;
  tags?: Tags;
  /** Longer documentation, as markdown. */
  notes?: string;
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
  /** Longer documentation, as markdown. */
  notes?: string;
  /** Notes for people reading the diagram, keyed by an ID unique within the view. */
  stickies?: Record<string, StickyData>;
  /** Box positions saved by the designer, keyed by element ID. Not used on sequence views. */
  layout?: Record<string, Position>;
  /** Sequence views only: what happens, in order. */
  steps?: StepData[];
}

/**
 * One step of a sequence view: `from` calls `to`, or with `reply`, answers it. A call needs a
 * relationship from `from` (or something inside it) to `to` (or something inside it); a reply
 * goes back along one from `to` to `from`.
 */
export interface StepData {
  from: string;
  to: string;
  /** What's sent, e.g. "Submits the order". Without it, a call is labelled with its relationship's description. */
  description?: string;
  technology?: string;
  /** True for an answer to an earlier call, drawn as a dashed arrow. */
  reply?: boolean;
}

/** A sticky note on a view. It explains the diagram; it isn't part of the model. */
export interface StickyData {
  text: string;
  /** Default: yellow. */
  color?: StickyColor;
  /** Top-left corner. Without it, the designer puts the note beside the diagram. */
  at?: [number, number];
}

// --- The model built from a document -------------------------------------------

export interface Relationship {
  to: string;
  bidirectional: boolean;
  description?: string;
  technology?: string;
  tags: Tags;
  notes?: string;
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
  /** Always "box" for people: they're drawn as a person, whatever the file says. */
  shape: ElementShape;
  tags: Tags;
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
  notes?: string;
  /** In reading order: placed notes top to bottom and left to right, then unplaced ones by ID. */
  stickies: Sticky[];
  layout: Record<string, Position>;
  /** Sequence views only, in order; empty on other views. */
  steps: Step[];
}

export interface Step {
  /** Where it lives in the document, e.g. `views.place-order.steps[0]`. */
  path: string;
  /** Its number on the diagram: 1 is the first. */
  number: number;
  from: string;
  to: string;
  description?: string;
  technology?: string;
  reply: boolean;
}

export interface Sticky {
  id: string;
  /** Where it lives in the document, e.g. `views.landscape.stickies.start-here`. */
  path: string;
  text: string;
  color: StickyColor;
  at?: [number, number];
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
