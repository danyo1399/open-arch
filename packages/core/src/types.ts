/**
 * C4's four levels of detail, people aside: a class is code inside a component. A library is
 * code shared by several containers, such as a logging library: it holds components and classes,
 * and each container that lists it in `libraries` is built with its own copy.
 */
export const ELEMENT_KINDS = ["person", "system", "container", "component", "library", "class"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/**
 * A sequence view isn't a C4 level of detail: it draws steps between elements, in order. Nor is
 * a state view: it draws the states something can be in, and the transitions between them. A
 * deployment view draws where containers run: the servers, clusters and cloud services, nested.
 * An event view draws what happens in a business process, as event storming does: commands,
 * events and the other notes, in order along a timeline, in swimlanes. A wireframe view draws an
 * app's screens, as rough sketches of what's on each, and how a button or link on one leads to
 * another. A whiteboard view is a freehand sketch, to share an idea: shapes, text, arrows and
 * lines drawn with a pen, each where it's put, none of them part of the model. A flowchart view
 * draws the steps of a process: where it starts and ends, what's done, the decisions on the
 * way, and the arrows from one to the next, in a swimlane for each actor, team or system if it
 * has them. An entity view draws the data something keeps, as an entity-relationship diagram:
 * its entities, like a database's tables, each with its attributes, and the links between them,
 * with how many of each end there can be.
 */
export const VIEW_LEVELS = ["landscape", "context", "container", "component", "class", "sequence", "state", "deployment", "event", "wireframe", "whiteboard", "flowchart", "entity"] as const;
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

/**
 * What a relationship means on a class diagram, in UML's terms. Association, the default, is
 * what every relationship is elsewhere: the element uses the other one. The rest are only
 * between classes:
 * - dependency: it depends on the other class, without keeping a reference to it
 * - inheritance: it extends the other class
 * - realization: it implements the other class, an interface
 * - composition: it's made of the other class, which can't exist without it
 * - aggregation: it holds the other class, which can exist on its own
 */
export const RELATIONSHIP_KINDS = ["association", "dependency", "inheritance", "realization", "composition", "aggregation"] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** Each kind of relationship, as the designer lists it. */
export const RELATIONSHIP_KIND_LABELS: Record<RelationshipKind, string> = {
  association: "Association (uses)",
  dependency: "Dependency (depends on)",
  inheritance: "Inheritance (extends)",
  realization: "Realization (implements)",
  composition: "Composition (is made of)",
  aggregation: "Aggregation (holds)",
};

/**
 * What a card on an event view is, as event storming colours its notes:
 * - event: something that happened, in the past tense, like "Order placed" (orange)
 * - command: a decision or request to do something, like "Place order" (blue)
 * - actor: the person who gives a command (yellow)
 * - policy: a rule that reacts to an event, "whenever this, then that" (lilac)
 * - read-model: what someone looks at to decide, like a list of orders (green)
 * - external-system: a system outside, that sends events or takes commands (pink)
 * - aggregate: the thing a command changes, which keeps its rules, like an order (pale yellow)
 * - hotspot: a question, problem or disagreement to come back to (red)
 */
export const CARD_KINDS = ["event", "command", "actor", "policy", "read-model", "external-system", "aggregate", "hotspot"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** Each kind of card, as the designer and the docs name it. */
export const CARD_KIND_LABELS: Record<CardKind, string> = {
  event: "Event",
  command: "Command",
  actor: "Actor",
  policy: "Policy",
  "read-model": "Read model",
  "external-system": "External system",
  aggregate: "Aggregate",
  hotspot: "Hotspot",
};

/**
 * What a widget on a wireframe's screen is. Each is drawn with its text:
 * - heading: a title, in large type
 * - text: a paragraph; without text, grey lines stand in for it
 * - button and link: what they say
 * - input: a box to type in, with its text as its label, like "Email"
 * - checkbox: a box to tick, with its text beside it
 * - select: a drop-down list, with its text as its label
 * - image: where a picture goes, with its text saying what it shows
 * - list: one item for each line of its text
 * - table: one row for each line of its text, with the cells split by "|"; the first row is its headings
 * - tabs: one tab for each line of its text; the first is the one that's open
 * - divider: a line across, with its text in the middle, if it has any
 * - panel: a box that holds other widgets, top to bottom, with its text as its title
 * - row: holds other widgets side by side, with its text above them, if it has any
 */
export const WIDGET_KINDS = ["heading", "text", "button", "link", "input", "checkbox", "select", "image", "list", "table", "tabs", "divider", "panel", "row"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** Each kind of widget, as the designer and the docs name it. */
export const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
  heading: "Heading",
  text: "Text",
  button: "Button",
  link: "Link",
  input: "Text field",
  checkbox: "Checkbox",
  select: "Drop-down",
  image: "Image",
  list: "List",
  table: "Table",
  tabs: "Tabs",
  divider: "Divider",
  panel: "Panel",
  row: "Row",
};

/** The kinds of widget that hold other widgets: a panel, top to bottom, and a row, side by side. */
export const WIDGET_HOLDERS: readonly WidgetKind[] = ["panel", "row"];

/** What a wireframe's screen is drawn for: its width. Desktop is the default. */
export const SCREEN_DEVICES = ["desktop", "tablet", "phone"] as const;
export type ScreenDevice = (typeof SCREEN_DEVICES)[number];

/** Each device, as the designer and the docs name it. */
export const SCREEN_DEVICE_LABELS: Record<ScreenDevice, string> = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };

/**
 * What a shape on a whiteboard view is:
 * - rectangle, ellipse and diamond: an outline, with its text inside
 * - text: just its text, with no outline
 * - pen: a line drawn freehand, through its points
 */
export const SHAPE_KINDS = ["rectangle", "ellipse", "diamond", "text", "pen"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Each kind of shape, as the designer and the docs name it. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = { rectangle: "Rectangle", ellipse: "Ellipse", diamond: "Diamond", text: "Text", pen: "Pen" };

/** How big a rectangle, ellipse or diamond is when its `at` gives no width and height. */
export const SHAPE_SIZE: readonly [number, number] = [160, 80];

/** The colour of a whiteboard shape's outline and text, or of an arrow. Black is the default, and is white in dark mode. */
export const SHAPE_COLORS = ["black", "grey", "red", "orange", "green", "blue", "purple"] as const;
export type ShapeColor = (typeof SHAPE_COLORS)[number];

/** What a whiteboard shape is filled with: a pale tint of the colour, or white, which hides what's behind it. Without one, it's see-through. */
export const SHAPE_FILLS = ["white", "grey", "red", "orange", "yellow", "green", "blue", "purple"] as const;
export type ShapeFill = (typeof SHAPE_FILLS)[number];

/** How big a whiteboard shape's text is. Medium is the default. */
export const TEXT_SIZES = ["small", "medium", "large", "huge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** A side of a whiteboard shape, which an arrow's end can stay on: the middle of that edge of its box, as a diamond's tips are. */
export const ARROW_SIDES = ["top", "right", "bottom", "left"] as const;
export type ArrowSide = (typeof ARROW_SIDES)[number];

/** Where a whiteboard arrow has heads: at its end (the default), at both ends, or none, which makes it a line. */
export const ARROW_HEADS = ["end", "both", "none"] as const;
export type ArrowHeads = (typeof ARROW_HEADS)[number];

/**
 * What a block on a flowchart view is, each in the usual flowchart shape:
 * - start and end: where the process starts, and where it ends (a rounded pill)
 * - process: a step, something that's done, like "Pack the order" (a box)
 * - decision: a question with more than one way on, like "In stock?" (a diamond)
 * - input-output: something that comes in or goes out, like "Read the card details" (a slanted box)
 * - subprocess: a process drawn in full somewhere else (a box with a double line down each side)
 * - document: a document or report that's made or read (a page with a wavy bottom edge)
 * - database: data that's kept, like a database (a cylinder)
 */
export const BLOCK_KINDS = ["start", "end", "process", "decision", "input-output", "subprocess", "document", "database"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** Each kind of block, as the designer and the docs name it. */
export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  start: "Start",
  end: "End",
  process: "Process",
  decision: "Decision",
  "input-output": "Input or output",
  subprocess: "Subprocess",
  document: "Document",
  database: "Database",
};

/**
 * What an attribute of an entity is, as a key:
 * - pk: its primary key, or part of it, which tells one of the entity from another
 * - fk: a foreign key, which names one of another entity, like an order's customer
 * - uk: unique: no two of the entity have the same, like a customer's email
 */
export const ATTRIBUTE_KEYS = ["pk", "fk", "uk"] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** Each kind of key, as the designer and the docs name it in full. */
export const ATTRIBUTE_KEY_LABELS: Record<AttributeKey, string> = { pk: "Primary key", fk: "Foreign key", uk: "Unique" };

/**
 * How many of an entity there can be at one end of a link, for each one at the other end, as
 * crow's foot notation draws it: exactly one, zero or one, one or more, or zero or more.
 */
export const CARDINALITIES = ["one", "zero-or-one", "one-or-more", "zero-or-more"] as const;
export type Cardinality = (typeof CARDINALITIES)[number];

/** Each cardinality, as the designer and the docs name it. */
export const CARDINALITY_LABELS: Record<Cardinality, string> = { one: "Exactly one", "zero-or-one": "Zero or one", "one-or-more": "One or more", "zero-or-more": "Zero or more" };

/** A link's cardinality when it doesn't say: one of `from` to zero or more of `to`, like a customer and their orders. */
export const DEFAULT_CARDINALITY: readonly [Cardinality, Cardinality] = ["one", "zero-or-more"];

/** Name/value pairs. A tag can have an empty value, which makes it a plain label. */
export type Tags = Record<string, string>;

/** Element, view and sticky note IDs: lowercase kebab-case, like "checkout-api". */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const FORMAT_VERSION = 21;
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
  /** Default: box. Not used on people or classes. */
  shape?: ElementShape;
  /** Classes only: what sort of class it is, e.g. interface, abstract or enum. Drawn as «interface». */
  stereotype?: string;
  /** Containers only: the IDs of the libraries built into it. */
  libraries?: string[];
  /** Free-form facts, e.g. owner or repository. */
  tags?: Tags;
  /** Longer documentation, as markdown. */
  notes?: string;
  /**
   * Classes only: its attributes and methods, one per line, in UML's notation, like
   * "+id: OrderId" or "+total(): Money". A line with brackets is a method.
   */
  members?: string[];
  uses?: RelationshipData[];
}

export interface RelationshipData {
  to: string;
  /** Default: association. The other kinds are only between classes. */
  kind?: RelationshipKind;
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
  /** State views only: the states, keyed by an ID unique within the view. */
  states?: Record<string, StateData>;
  /** State views only: the ID of the state it starts in. */
  initial?: string;
  /** State views only: the ways from one state to another, or back to itself. */
  transitions?: TransitionData[];
  /** Deployment views only: where things run, keyed by an ID unique within the view. */
  nodes?: Record<string, DeploymentNodeData>;
  /** Deployment views only: arrows to or from nodes, like a load balancer forwarding to the web app. */
  connections?: ConnectionData[];
  /** Event and flowchart views only: the swimlanes, from the top down on an event view, and left to right on a flowchart. */
  lanes?: LaneData[];
  /** Event views only: the cards, in order along the timeline. */
  cards?: CardData[];
  /** Wireframe views only: the screens, in order, left to right. */
  screens?: ScreenData[];
  /** Whiteboard views only: the shapes, from the back to the front: each is drawn over those before it. */
  shapes?: ShapeData[];
  /** Whiteboard views only: the arrows and lines, drawn over the shapes. */
  arrows?: ArrowData[];
  /** Flowchart views only: the blocks, in reading order. */
  blocks?: BlockData[];
  /** Flowchart views only: the arrows from one block to the next. */
  flows?: FlowData[];
  /** Entity views only: the entities, in reading order. */
  entities?: EntityData[];
  /** Entity views only: the links between two entities, or from one to itself. */
  links?: EntityLinkData[];
}

/** One entity of an entity view: a thing whose data is kept, like a database's table. */
export interface EntityData {
  /** Unique among the view's entities. */
  id: string;
  name: string;
  description?: string;
  /** What's kept about it, like a table's columns, in order. */
  attributes?: AttributeData[];
  /** Top-left corner. Without it, the designer lays the entity out. */
  at?: [number, number];
}

/** One attribute of an entity: something kept about it, like a table's column. */
export interface AttributeData {
  /** Unique among its entity's attributes. */
  name: string;
  /** What it holds, like "uuid", "text" or "decimal(10,2)". */
  type?: string;
  /** The keys it's part of: the primary key, a foreign key, or unique. */
  keys?: AttributeKey[];
  description?: string;
}

/** A link between two entities of an entity view, or from one to itself: a relationship, in an ERD's terms. */
export interface EntityLinkData {
  from: string;
  to: string;
  /**
   * How many of each end there can be: of `from` for each `to`, drawn at `from`'s end, then of
   * `to` for each `from`, drawn at `to`'s end. Default: ["one", "zero-or-more"].
   */
  cardinality?: [Cardinality, Cardinality];
  /** What it says, like "places". */
  text?: string;
}

/** One block of a flowchart view: where the process starts or ends, a step, a decision, and so on. */
export interface BlockData {
  /** Unique among the view's blocks. */
  id: string;
  /** Default: process. */
  kind?: BlockKind;
  /** What it says, like "Pack the order", or for a decision a question, like "In stock?". */
  text: string;
  description?: string;
  /** The ID of the lane it's in. Without it, in a flowchart with lanes, it's in a column of its own left of them. */
  lane?: string;
  /**
   * Top-left corner. Without it, the designer lays the block out. In a flowchart with lanes, x
   * is from the left of its lane, or of the column for blocks in no lane.
   */
  at?: [number, number];
}

/** An arrow on a flowchart view, from one block to the next. */
export interface FlowData {
  from: string;
  to: string;
  /** What it says, like "Yes" or "No" on the ways out of a decision. */
  text?: string;
}

/** One shape on a whiteboard view: a rectangle, an ellipse, a diamond, text, or a line drawn with the pen. */
export interface ShapeData {
  /** Unique among the view's shapes. */
  id: string;
  kind: ShapeKind;
  /** What it says. Not on pens. */
  text?: string;
  /**
   * Its top-left corner, and its width and height: [x, y, width, height]. Without them, a
   * rectangle, ellipse or diamond is 160 by 80, and text is as big as what it says. A pen's is
   * [x, y]: how big it is comes from its points.
   */
  at: Position;
  /** Pens only: the points it goes through, from its corner, `at`: [[x, y], ...]. Two or more. */
  points?: [number, number][];
  /** How big its text is. Default: medium. Not on pens. */
  size?: TextSize;
  /** Its outline's and text's colour, or a pen's. Default: black. */
  color?: ShapeColor;
  /** Default: none, so it's see-through. Not on pens. */
  fill?: ShapeFill;
  /** True for a dashed outline, or a dashed pen line. Not on text. */
  dashed?: boolean;
}

/**
 * An end of a whiteboard arrow: the ID of a shape, which the arrow is drawn to the edge of, facing
 * its other end, and follows as it moves; a shape and the side of it the end stays on, wherever
 * the other end is, like a diamond's right tip; or a point on the whiteboard, [x, y].
 */
export type ArrowEnd = string | { shape: string; side: ArrowSide } | [number, number];

/** The ID of the shape an arrow's end is on, or nothing for an end at a point. */
export function endShape(end: ArrowEnd): string | undefined {
  return typeof end === "string" ? end : Array.isArray(end) ? undefined : end.shape;
}

/** The side of its shape an arrow's end stays on, if it says. */
export function endSide(end: ArrowEnd): ArrowSide | undefined {
  return typeof end === "object" && !Array.isArray(end) ? end.side : undefined;
}

/** An arrow, or a line, on a whiteboard view. */
export interface ArrowData {
  /** Unique among the view's arrows. */
  id: string;
  from: ArrowEnd;
  to: ArrowEnd;
  /** What it says, drawn in the middle of it. */
  text?: string;
  /** Default: end. "none" makes it a line. */
  heads?: ArrowHeads;
  /** Default: black. */
  color?: ShapeColor;
  dashed?: boolean;
}

/** One screen of a wireframe view, like "Cart": a page of a website, or of an app. */
export interface ScreenData {
  /** Unique among the view's screens. */
  id: string;
  name: string;
  description?: string;
  /** Default: desktop. */
  device?: ScreenDevice;
  /** What's on it, top to bottom. */
  widgets?: WidgetData[];
}

/** One widget on a wireframe's screen: a heading, a button, a box to type in, and so on. */
export interface WidgetData {
  /** Unique among all the widgets of the view, on every screen. */
  id: string;
  kind: WidgetKind;
  /** What it says. A list's items, a table's rows and tabs go one to a line. */
  text?: string;
  /** What it does or why it's there, e.g. "Greyed out until the form is filled in". */
  description?: string;
  /** The ID of the screen it leads to, like the one a button opens. Drawn as an arrow to that screen. */
  to?: string;
  /** Rows and panels only: what's inside it, side by side in a row, and top to bottom in a panel. */
  widgets?: WidgetData[];
}

/**
 * One swimlane: on an event view, a row for the cards of one actor, team or system, like
 * "Customer"; on a flowchart, a column for its blocks.
 */
export interface LaneData {
  /** Unique among the view's lanes. */
  id: string;
  name: string;
  description?: string;
  /**
   * Flowchart views only: the ID of the element of the model the lane is for, like the container
   * or the person that does its steps.
   */
  element?: string;
}

/**
 * One card of an event view: a command, an event or another of event storming's notes. Cards are
 * drawn left to right in the order they're listed, each in its lane.
 */
export interface CardData {
  /** Unique among the view's cards. */
  id: string;
  kind: CardKind;
  name: string;
  description?: string;
  /** The ID of the lane it's in. Without it, it's in a row of its own above the lanes. */
  lane?: string;
  /** The IDs of the cards that lead to it, like the command an event comes from. Each is drawn as an arrow to it. */
  from?: string[];
}

/**
 * One node of a deployment view: something things run on or in, like a server, a Kubernetes
 * cluster or a cloud region. Nodes nest, and each lists the containers and systems that run in it.
 * An infrastructure node, like a load balancer, DNS or a firewall, runs nothing and holds nothing.
 */
export interface DeploymentNodeData {
  name: string;
  /** The ID of the node of the same view it's inside. */
  parent?: string;
  description?: string;
  /** What it is, e.g. "Ubuntu 24.04" or "Amazon ECS". */
  technology?: string;
  /** True for infrastructure, like a load balancer: it runs no containers and holds no nodes. */
  infrastructure?: boolean;
  /** How many copies of it run, with everything inside. Default: 1. */
  instances?: number;
  /** Default: box. */
  shape?: ElementShape;
  /** The IDs of the containers and systems of the model that run in it. */
  runs?: string[];
}

/**
 * An arrow on a deployment view to or from a node. Each end is a node of the view, or a container
 * or system that one of its nodes runs; at least one end is a node. Arrows between two containers
 * come from the model's relationships instead.
 */
export interface ConnectionData {
  from: string;
  to: string;
  /** What it does, e.g. "Forwards requests to". */
  description?: string;
  technology?: string;
}

/** One state of a state view, like "Paid". */
export interface StateData {
  name: string;
  description?: string;
  /** True when the state machine can end in this state. */
  final?: boolean;
  /** Top-left corner. Without it, the designer lays the state out. */
  at?: [number, number];
}

/** A way from one state to another (or the same one), written in UML as `event [guard] / action`. */
export interface TransitionData {
  from: string;
  to: string;
  /** What makes it happen, e.g. "Payment taken". */
  event?: string;
  /** What has to be true for it to happen, e.g. "amount is paid in full". */
  guard?: string;
  /** What's done as it happens, e.g. "Send a receipt". */
  action?: string;
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
  /** What it's on, which the designer draws a line to. Only on views of boxes (landscape, context, container, component and class views) and flowchart views. */
  on?: StickyTargetData;
  /** Default: yellow. */
  color?: StickyColor;
  /** Top-left corner. Without it, the designer puts the note beside what it's on, or else beside the diagram. */
  at?: [number, number];
  /** Longer documentation, as markdown, for more than the note's text should say. */
  notes?: string;
}

/**
 * What a sticky note is on. On a view of boxes: an element, drawn as the box that shows it, or a
 * relationship, named as add-relationship names it (`from` uses `to`, and its kind when it isn't
 * an association), drawn as the arrow that shows it. On a flowchart view: one of its blocks.
 */
export type StickyTargetData = { element: string } | { from: string; to: string; kind?: RelationshipKind } | { block: string };

// --- The model built from a document -------------------------------------------

export interface Relationship {
  to: string;
  kind: RelationshipKind;
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
  /** Always "box" for people and classes: they're drawn as a person or a class, whatever the file says. */
  shape: ElementShape;
  /** Classes only. */
  stereotype?: string;
  /** Containers only: the libraries built into it; empty on other elements. */
  libraries: string[];
  tags: Tags;
  notes?: string;
  /** Classes only; empty on other elements. */
  members: string[];
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
  /** State views only, in reading order: the initial state, then the states its transitions lead to, then the rest by ID. */
  states: State[];
  /** State views only. */
  initial?: string;
  /** State views only, in the file's order; empty on other views. */
  transitions: Transition[];
  /** Deployment views only, in reading order: each top-level node, then the nodes inside it. Empty on other views. */
  nodes: DeploymentNode[];
  /** Deployment views only, in the file's order; empty on other views. */
  connections: Connection[];
  /** Event views, from the top down, and flowchart views, left to right; empty on other views. */
  lanes: Lane[];
  /** Event views only, in order along the timeline; empty on other views. */
  cards: Card[];
  /** Wireframe views only, in order, left to right; empty on other views. */
  screens: Screen[];
  /** Whiteboard views only, from the back to the front; empty on other views. */
  shapes: Shape[];
  /** Whiteboard views only, in the file's order; empty on other views. */
  arrows: Arrow[];
  /** Flowchart views only, in the file's order; empty on other views. */
  blocks: Block[];
  /** Flowchart views only, in the file's order; empty on other views. */
  flows: Flow[];
  /** Entity views only, in the file's order; empty on other views. */
  entities: Entity[];
  /** Entity views only, in the file's order; empty on other views. */
  links: EntityLink[];
}

export interface Entity {
  id: string;
  /** Where it lives in the document, e.g. `views.orders-data.entities[0]`. */
  path: string;
  /** Its place in the file's order: 1 is the first. */
  number: number;
  name: string;
  description?: string;
  /** In order. */
  attributes: Attribute[];
  at?: [number, number];
}

export interface Attribute {
  /** Where it lives in the document, e.g. `views.orders-data.entities[0].attributes[1]`. */
  path: string;
  /** Its place in its entity: 1 is the first. */
  number: number;
  name: string;
  type?: string;
  /** Each once, in the order of ATTRIBUTE_KEYS. */
  keys: AttributeKey[];
  description?: string;
}

export interface EntityLink {
  /** Where it lives in the document, e.g. `views.orders-data.links[0]`. */
  path: string;
  /** Its number: 1 is the first. */
  number: number;
  from: string;
  to: string;
  /** At `from`'s end, then at `to`'s. */
  cardinality: [Cardinality, Cardinality];
  text?: string;
}

export interface Block {
  id: string;
  /** Where it lives in the document, e.g. `views.returns.blocks[0]`. */
  path: string;
  /** Its place in the file's order: 1 is the first. */
  number: number;
  kind: BlockKind;
  text: string;
  description?: string;
  lane?: string;
  at?: [number, number];
}

export interface Flow {
  /** Where it lives in the document, e.g. `views.returns.flows[0]`. */
  path: string;
  /** Its number: 1 is the first. */
  number: number;
  from: string;
  to: string;
  text?: string;
}

export interface Shape {
  id: string;
  /** Where it lives in the document, e.g. `views.ideas.shapes[0]`. */
  path: string;
  /** Its place from the back: 1 is drawn first, under the rest. */
  number: number;
  kind: ShapeKind;
  text?: string;
  at: Position;
  /** Pens only; empty on other shapes. */
  points: [number, number][];
  size: TextSize;
  color: ShapeColor;
  fill?: ShapeFill;
  dashed: boolean;
}

export interface Arrow {
  id: string;
  /** Where it lives in the document, e.g. `views.ideas.arrows[0]`. */
  path: string;
  from: ArrowEnd;
  to: ArrowEnd;
  text?: string;
  heads: ArrowHeads;
  color: ShapeColor;
  dashed: boolean;
}

export interface Screen {
  id: string;
  /** Where it lives in the document, e.g. `views.checkout.screens[0]`. */
  path: string;
  /** Its place, left to right: 1 is the first. */
  number: number;
  name: string;
  description?: string;
  device: ScreenDevice;
  /** Top to bottom. */
  widgets: Widget[];
}

export interface Widget {
  id: string;
  /** Where it lives in the document, e.g. `views.checkout.screens[0].widgets[2]`. */
  path: string;
  /** Its place among the widgets beside it, in its screen or in its row or panel: 1 is the first. */
  number: number;
  kind: WidgetKind;
  text?: string;
  description?: string;
  to?: string;
  /** The ID of the screen it's on. */
  screen: string;
  /** The ID of the row or panel it's in, if it's in one. */
  parent?: string;
  /** What's inside it, for a row or a panel; empty on other widgets. */
  widgets: Widget[];
}

export interface Lane {
  id: string;
  /** Where it lives in the document, e.g. `views.placing-an-order.lanes[0]`. */
  path: string;
  /** Its place from the top: 1 is the first. */
  number: number;
  name: string;
  description?: string;
  /** Flowchart views only: the element it's for. */
  element?: string;
}

export interface Card {
  id: string;
  /** Where it lives in the document, e.g. `views.placing-an-order.cards[0]`. */
  path: string;
  /** Its place along the timeline: 1 is the first. */
  number: number;
  kind: CardKind;
  name: string;
  description?: string;
  lane?: string;
  /** Each once, in the file's order. */
  from: string[];
}

export interface DeploymentNode {
  id: string;
  /** Where it lives in the document, e.g. `views.production.nodes.web-server`. */
  path: string;
  name: string;
  parent?: string;
  description?: string;
  technology?: string;
  infrastructure: boolean;
  /** 1 or more. */
  instances: number;
  shape: ElementShape;
  /** Each once, in the file's order. */
  runs: string[];
}

export interface Connection {
  /** Where it lives in the document, e.g. `views.production.connections[0]`. */
  path: string;
  /** Its number: 1 is the first. */
  number: number;
  from: string;
  to: string;
  description?: string;
  technology?: string;
}

export interface State {
  id: string;
  /** Where it lives in the document, e.g. `views.order-states.states.paid`. */
  path: string;
  name: string;
  description?: string;
  final: boolean;
  at?: [number, number];
}

export interface Transition {
  /** Where it lives in the document, e.g. `views.order-states.transitions[0]`. */
  path: string;
  /** Its number: 1 is the first. */
  number: number;
  from: string;
  to: string;
  event?: string;
  guard?: string;
  action?: string;
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
  on?: StickyTarget;
  color: StickyColor;
  at?: [number, number];
  notes?: string;
}

/** What a sticky note is on (see StickyTargetData), with a relationship's kind always given. */
export type StickyTarget = { element: string } | { from: string; to: string; kind: RelationshipKind } | { block: string };

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
