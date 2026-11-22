import {
  computeView,
  diagnosticTarget,
  inFrame,
  isInside,
  KIND_RANK,
  kindLabel,
  scopeProblems,
  stickyAnchor,
  STICKY_TARGET_LEVELS,
  type ArchElement,
  type ComputedView,
  type Diagnostic,
  type ElementKind,
  type Operation,
  type Position,
  type RelationshipKind,
  type Sticky,
  type StickyAnchor,
  type StickyTargetData,
  type ViewDef,
  type ViewEdge,
  type ViewLevel,
  type Workspace,
} from "@open-arch/core";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  ViewportPortal,
  type Connection,
  type FitViewOptions,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import {
  arrowRelation,
  isArrow,
  newStickyId,
  relationshipRef,
  sameShapes,
  selectedShapes,
  selectShapes,
  stickyTargetFor,
  toggleShape,
  uniqueId,
  type Rename,
  type Shapes,
} from "../model.js";
import { ContextMenu, MenuButton, menuPoint, type MenuAction, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { elkLayout, freeSpotAmong, layOut, NODE_H, NODE_W, placeMissing, placeStickies, rowGap, STICKY, stickiesBackOps, stickyHeight, TOUCH_STICKY, type LayoutEdge, type LayoutNode, type Point, type StickySize } from "./autoLayout.js";
import { classHeight, FrameNotes, nodeTypes, StickyLines, StickyLinking, type ElementFlowNode, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import { edgeTypes, INTERACTION_WIDTH, measureLabelSizes, type ArrowEdge, type ArrowEnd } from "./RoutedEdge.js";
import { crossings, layoutArrows, type Box } from "./routing.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";
import { besideArrow, besideBox, besideFrame, distanceToRoute, midpoint, stickyLine, type LineEnd, type Rect } from "./stickyLines.js";

/** What's selected. `several` is two or more boxes and sticky notes on the open view, which move together. */
export type Selection =
  | { kind: "element"; id: string }
  /** `relation`, on a class view, is the kind of relationship the arrow draws, when it isn't an association. */
  | { kind: "arrow"; from: string; to: string; relation?: RelationshipKind }
  | { kind: "sticky"; id: string }
  /** A sequence view's step, by its number: 1 is the first. */
  | { kind: "step"; number: number }
  /** A state view's state, and its transition, by its number: 1 is the first. */
  | { kind: "state"; id: string }
  | { kind: "transition"; number: number }
  /** A deployment view's node, its connection, by its number, and a container or system running in one of its nodes. */
  | { kind: "node"; id: string }
  | { kind: "connection"; number: number }
  | { kind: "instance"; node: string; element: string }
  /** An event view's lane, its card, and the arrow from one card to another. */
  | { kind: "lane"; id: string }
  | { kind: "card"; id: string }
  | { kind: "cardArrow"; from: string; to: string }
  /** A wireframe view's screen, and a widget on one. */
  | { kind: "screen"; id: string }
  | { kind: "widget"; id: string }
  /** A whiteboard view's shape, its arrow, and two or more of its shapes, arrows and sticky notes, which move together. */
  | { kind: "shape"; id: string }
  | { kind: "boardArrow"; id: string }
  | { kind: "board"; shapes: string[]; arrows: string[]; stickies: string[] }
  /** A flowchart view's block, and its flow, by its number: 1 is the first. */
  | { kind: "block"; id: string }
  | { kind: "flow"; number: number }
  /** An entity view's entity, an attribute of one, by its entity and its name, and a link, by its number: 1 is the first. */
  | { kind: "entity"; id: string }
  | { kind: "attribute"; entity: string; name: string }
  | { kind: "link"; number: number }
  | { kind: "several"; elements: string[]; stickies: string[] }
  | { kind: "workspace" }
  | null;

type FlowNode = ElementFlowNode | FrameFlowNode | StickyFlowNode;

const FRAME_ID = "__frame";
/** Sticky note IDs are only unique within their view, so their nodes get a prefix no element ID has. */
const stickyNodeId = (id: string) => `sticky:${id}`;
/** An arrow's ID: its ends, and its kind when it isn't an association, as a class view can draw an arrow of each kind between two boxes. */
const arrowId = (e: { from: string; to: string; kind: RelationshipKind }) => `${e.from}->${e.to}${e.kind === "association" ? "" : `:${e.kind}`}`;
const FRAME_PAD = { x: 40, top: 56, bottom: 40 };
/** How a view's diagram is fitted to the canvas. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
/** How React Flow's own fit button fits it: its default padding. */
const FIT_BUTTON = { padding: 0.1 };
/** Space kept between the toolbar and a fitted diagram. */
const TOOLBAR_GAP = 12;

/**
 * Fit options with enough padding at the top to keep the diagram below the toolbar, which
 * floats over the canvas and is taller when the view has a description. `toolbarBottom` is
 * how far down the canvas the toolbar ends. A number padding is a share of the canvas's size,
 * which React Flow turns into pixels as `usual` does.
 */
export function fitBelowToolbar(options: { padding: number; maxZoom?: number }, canvasHeight: number, toolbarBottom: number): FitViewOptions {
  const usual = Math.floor((canvasHeight - canvasHeight / (1 + options.padding)) * 0.5);
  const top = Math.max(usual, Math.ceil(toolbarBottom + TOOLBAR_GAP));
  return { ...options, padding: { x: options.padding, y: options.padding, top: `${top}px` } };
}
/**
 * How far React Flow lifts a node it has selected above the others, so a box being dragged
 * passes over the rest. It's SELECTED_NODE_Z in @xyflow/system, which doesn't export it:
 * stacking.test.ts checks it against React Flow, in case a new version changes it.
 */
export const SELECTED_LIFT = 1000;
/** A note's z-index: above the arrows and boxes, even a selected box, like a note stuck on a printed diagram. */
export const STICKY_Z = SELECTED_LIFT + 1;
/** An arrow being drawn, or one whose end is being moved, stays over everything, as React Flow means a new one to, even a selected note. */
export const DRAWING_Z = STICKY_Z + SELECTED_LIFT + 1;
/** Any touch screen, as in styles.css, where sticky notes are drawn bigger. */
const TOUCH = "(any-pointer: coarse)";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** Held while clicking a box or note, these add it to the selection or take it out: Ctrl (⌘ on a Mac), or Shift. */
const MULTI_KEYS = isMac ? ["Meta", "Shift"] : ["Control", "Shift"];
const addsToSelection = (e: MouseEvent) => e.shiftKey || (isMac ? e.metaKey : e.ctrlKey);
/** Boxes and notes snap as they're dragged, and line up with each other. The frame grows round the boxes inside it, so it's neither. */
const snapsHere = (n: FlowNode) => n.type !== "frame";

interface CanvasProps {
  ws: Workspace;
  view: ViewDef;
  diagnostics: Diagnostic[];
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** A right-click on an element's box or on the frame, at that point on the screen. */
  onElementMenu(id: string, at: { x: number; y: number }): void;
  /** A right-click on an arrow or its label, at that point on the screen. */
  onArrowMenu(from: string, to: string, relation: RelationshipKind | undefined, at: { x: number; y: number }): void;
  /** A problem drawing the diagram, to tell the person about. */
  onError(text: string): void;
  /** Every rename this render's IDs reflect, in order. */
  renames: Rename[];
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
  /** A note just added from a menu or the details, to edit in place. */
  editSticky?: string | null;
  /** What boxes and notes snap to as they're dragged, and its buttons. */
  snap: SnapControl;
  /** Given the diagram's Auto layout, for the top bar's More menu on a narrow screen. */
  autoLayoutHandle?: RefObject<AutoLayout | null>;
}

/** Something + Add can add to a view: an element of this kind, with the parent it gets. */
export interface Addable {
  kind: ElementKind;
  parent?: string;
  /** For a library added to a component view: the view's container, which is built with it. */
  builtInto?: string;
  label: string;
}

/**
 * Element kinds that can be added to a view at its level, and the parent each gets. A library
 * added to a component view is built into the view's container: `builtInto`. One added to a
 * container view is built into nothing yet: its details say which containers it's built into.
 */
export function addableKinds(ws: Workspace, view: ViewDef): Addable[] {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  const top = [
    { kind: "person" as const, label: "Person" },
    { kind: "system" as const, label: "Software system" },
  ];
  if (view.level === "container" && scope) {
    return [{ kind: "container", parent: scope.id, label: `Container in ${scope.name}` }, { kind: "library", label: "Shared library" }, ...top];
  }
  if (view.level === "component" && scope?.kind === "library") {
    return [{ kind: "component", parent: scope.id, label: `Component in ${scope.name}` }, { kind: "class", parent: scope.id, label: `Class in ${scope.name}` }, ...top];
  }
  if (view.level === "component" && scope) {
    const system = scope.parent ? ws.elements.get(scope.parent) : undefined;
    return [
      { kind: "component", parent: scope.id, label: `Component in ${scope.name}` },
      { kind: "library", builtInto: scope.id, label: `Library built into ${scope.name}` },
      ...(system ? [{ kind: "container" as const, parent: system.id, label: `Container in ${system.name}` }] : []),
      ...top,
    ];
  }
  if (view.level === "class" && scope?.kind === "library") return [{ kind: "class", parent: scope.id, label: `Class in ${scope.name}` }, ...top];
  if (view.level === "class" && scope) {
    const container = scope.parent ? ws.elements.get(scope.parent) : undefined;
    return [
      { kind: "class", parent: scope.id, label: `Class in ${scope.name}` },
      ...(container ? [{ kind: "component" as const, parent: container.id, label: `Component in ${container.name}` }] : []),
      ...top,
    ];
  }
  return top;
}

/**
 * The frame, when this point on the diagram is inside it. The frame takes no pointer events, so a
 * drag that starts on it draws a selection box, or pans on a touch screen, as on the background
 * around it. A click or right-click on it lands on the background, and this tells them apart.
 */
export function frameAt(nodes: FlowNode[], at: Point): FrameFlowNode | undefined {
  const frame = nodes.find((n): n is FrameFlowNode => n.type === "frame");
  if (!frame) return undefined;
  const { x, y } = frame.position;
  return at.x >= x && at.x <= x + frame.data.width && at.y >= y && at.y <= y + frame.data.height ? frame : undefined;
}

/**
 * The edit that keeps boxes and notes where they were dragged to, as one step for Undo. `layout`
 * is every box's position as shown, when boxes were dragged: that fixes boxes placed automatically
 * in place too. A note keeps its own position, so moving only notes leaves the boxes as they are.
 */
export function moveOps(view: string, layout: Record<string, Position> | null, notes: Record<string, [number, number]>): Operation[] {
  return [
    ...(layout ? [{ op: "set-layout" as const, view, positions: layout }] : []),
    ...Object.entries(notes).map(([id, at]) => ({ op: "update-sticky" as const, view, id, at })),
  ];
}

/**
 * The edit that adds a new element to a view, as one step for Undo: the element, at `spot` among
 * the boxes' positions as shown. A library is built into `added.builtInto`, a component view's
 * container. A view that can't draw a library, such as a container view, keeps its boxes as they
 * are: the library is only in the model, for its details to build containers with.
 */
export function addElementOps(ws: Workspace, view: ViewDef, id: string, added: Omit<Addable, "label">, layout: Record<string, Position>, spot: Point): Operation[] {
  const container = added.builtInto ? ws.elements.get(added.builtInto) : undefined;
  const element: Operation = { op: "add-element", id, kind: added.kind, parent: added.parent, name: `New ${added.kind}` };
  if (added.kind === "library" && !container) return [element];
  return [
    element,
    ...(container ? [{ op: "update-element" as const, id: container.id, libraries: [...container.libraries, id] }] : []),
    { op: "show-in-view", view: view.id, id },
    { op: "set-layout", view: view.id, positions: { ...layout, [id]: [spot.x, spot.y] } },
  ];
}

/**
 * The edit that draws a new arrow: the relationship, and every box's position as shown, as one
 * step for Undo. Without the positions, a view with boxes placed automatically would be laid out
 * again, as its arrows changed, and its boxes would jump.
 */
export function connectOps(view: string, from: string, to: string, layout: Record<string, Position>): Operation[] {
  return [
    { op: "add-relationship", from, to },
    { op: "set-layout", view, positions: layout },
  ];
}

/**
 * The boxes for ELK to lay out: whether each is inside the frame, and how tall it is. That's its
 * height as drawn, in `drawn` by element ID, once it has been; before that, a class's from its
 * text, and NODE_H for the rest.
 */
export function layoutNodes(cv: ComputedView, drawn: ReadonlyMap<string, number> = new Map()): LayoutNode[] {
  return cv.nodes.map((n) => ({ id: n.id, inside: inFrame(cv.boundary, n), height: drawn.get(n.id) ?? (n.kind === "class" ? classHeight(n) : undefined) }));
}

/** The arrows for ELK to lay out, each with its label's size at its widest, so the boxes are put far enough apart for the labels. */
export function layoutEdges(edges: ViewEdge[]): LayoutEdge[] {
  const sizes = measureLabelSizes(edges);
  return edges.map((e, k) => ({ from: e.from, to: e.to, label: sizes[k]![0] }));
}

/**
 * The edit Auto layout makes on a view of boxes, as one step for Undo: every box where ELK put it,
 * `positions`, and the sticky notes back beside what they're on, or beside the diagram (see
 * stickiesBackOps). It's made from the workspace as it is when it's applied, so a box deleted or
 * renamed while ELK worked is left out of it.
 */
export function autoLayoutOps(ws: Workspace, viewId: string, positions: Record<string, Point>): Operation[] {
  const view = ws.views.get(viewId);
  if (!view) return [];
  const layout = Object.fromEntries(Object.entries(positions).flatMap(([id, p]) => (ws.elements.has(id) ? [[id, [Math.round(p.x), Math.round(p.y)] as Position]] : [])));
  return [...(Object.keys(layout).length ? [{ op: "set-layout" as const, view: viewId, positions: layout }] : []), ...stickiesBackOps(view)];
}

/** The toolbar's Auto layout button's work, and whether it's under way. */
export interface AutoLayout {
  run(): void;
  busy: boolean;
}

/** Levels whose views are laid out automatically all the time, or, on a whiteboard, never: they have no Auto layout. */
const NO_AUTO_LAYOUT: readonly ViewLevel[] = ["sequence", "deployment", "event", "wireframe", "whiteboard"];

/** Whether a view has Auto layout, and anything to lay out: a view of boxes with a box in it, a state view with a state, a flowchart with a block, or an entity view with an entity. */
export function canAutoLayout(cv: ComputedView): boolean {
  const { view } = cv;
  if (view.level === "state") return view.states.length > 0;
  if (view.level === "flowchart") return view.blocks.length > 0;
  if (view.level === "entity") return view.entities.length > 0;
  return !NO_AUTO_LAYOUT.includes(view.level) && cv.nodes.length > 0;
}

/**
 * What the toolbar's Auto layout button does. `layOutAll` has ELK work out where everything on
 * the diagram goes, and gives the edit that puts it all there, as one step for Undo. Then the
 * diagram is fitted to the canvas, with `fit`. It's busy while ELK works, and a second click
 * then does nothing. When ELK can't lay it out, as when its file can't be loaded, `onError`
 * says so, and nothing moves. Nothing moves either when the diagram is closed before ELK is
 * done, as when another view is opened: the person isn't there to see it, so a later Undo
 * would take back what they never saw. `handle` is given it, for the top bar's More menu on a
 * narrow screen, where the toolbar has no room for its button.
 */
export function useAutoLayout(
  layOutAll: () => Promise<Edit>,
  edit: (edit: Edit) => Promise<boolean>,
  onError: (text: string) => void,
  fit: () => void,
  handle?: RefObject<AutoLayout | null>,
): AutoLayout {
  const [busy, setBusy] = useState(false);
  // A ref too, as two clicks can come before the first one's render.
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    void layOutAll()
      .then(
        (change) => mounted.current && edit(change).then((ok) => ok && mounted.current && requestAnimationFrame(() => requestAnimationFrame(fit))),
        () => onError("Couldn't lay out the diagram automatically, so nothing moved. Reload the page to try again."),
      )
      .finally(() => {
        working.current = false;
        if (mounted.current) setBusy(false);
      });
  };
  const layout = { run, busy };
  // Each render's, so the menu runs it with what's drawn now.
  useEffect(() => {
    if (!handle) return;
    handle.current = layout;
    return () => {
      if (handle.current === layout) handle.current = null;
    };
  });
  return layout;
}

/** The toolbar's Auto layout button. `empty` when there's nothing on the diagram to lay out. */
export function AutoLayoutButton({ layout, empty }: { layout: AutoLayout; empty: boolean }) {
  return (
    <button className="auto-layout" onClick={layout.run} disabled={layout.busy || empty} title="Lay out the whole diagram again, so it's easy to read. Undo puts it back.">
      Auto layout
    </button>
  );
}

/**
 * Where each note on something that hasn't been moved goes, by the note's ID: beside the box, the
 * frame or the arrow it's on. `positions` are the boxes'; the frame is worked out from those inside it.
 */
export function besideTargets(ws: Workspace, cv: ComputedView, positions: Record<string, Point>): Record<string, Point> {
  const out: Record<string, Point> = {};
  const inside = cv.nodes.filter((n) => inFrame(cv.boundary, n) && positions[n.id]).map((n) => positions[n.id]!);
  for (const sticky of cv.view.stickies) {
    const anchor = !sticky.at && sticky.on ? stickyAnchor(ws, cv, sticky.on) : undefined;
    if (anchor?.kind === "box" && positions[anchor.id]) out[sticky.id] = besideBox(positions[anchor.id]!);
    if (anchor?.kind === "frame" && inside.length) {
      const [left, top] = [Math.min(...inside.map((p) => p.x)) - FRAME_PAD.x, Math.min(...inside.map((p) => p.y)) - FRAME_PAD.top];
      out[sticky.id] = besideFrame({ x: left, y: top, w: Math.max(...inside.map((p) => p.x)) + NODE_W + FRAME_PAD.x - left, h: 0 });
    }
    if (anchor?.kind === "arrow" && positions[anchor.edge.from] && positions[anchor.edge.to]) out[sticky.id] = besideArrow(positions[anchor.edge.from]!, positions[anchor.edge.to]!);
  }
  return out;
}

/** The box at this point on the diagram, if there is one: the one drawn on top, where boxes overlap. The frame isn't a box. */
export function boxAt(nodes: FlowNode[], at: Point): ElementFlowNode | undefined {
  return nodes.findLast((n): n is ElementFlowNode => {
    if (n.type !== "element") return false;
    const { x, y } = n.position;
    return at.x >= x && at.x <= x + (n.measured?.width ?? NODE_W) && at.y >= y && at.y <= y + (n.measured?.height ?? NODE_H);
  });
}

/** Where a note is drawn on the diagram: as React Flow measured it, or else as big as it should be, at `size`. */
export function noteRect(n: StickyFlowNode, size: StickySize): Rect {
  return { x: n.position.x, y: n.position.y, w: n.measured?.width ?? size.width, h: n.measured?.height ?? stickyHeight(n.data.sticky.text, size) };
}

/** An arrow as the canvas draws it: its route, and the box its label is drawn in, when it has one. */
export interface DrawnArrow {
  id: string;
  edge: ViewEdge;
  points: readonly Point[];
  label?: Rect;
}

/**
 * What a note's dot let go here puts the note on, where the view draws that, and the box or
 * frame's node, or the arrow, to outline while the dot is over it.
 */
export type NoteDrop = { on: StickyTargetData; anchor: StickyAnchor; node?: string; arrow?: string };

/**
 * What a note's dot let go at this point on the diagram puts the note on: the box there, the one
 * drawn on top; else the arrow whose label is there, or whose line is nearest, no further than
 * `reach`; else the frame, when the point is inside it. Nothing over a note, which the boxes and
 * arrows under it are hidden by, or over a box a note can't be on (see stickyTargetFor). An arrow
 * a note can't be on is passed over, as if it weren't there. `elementOf` is the element a box or
 * the frame is for.
 */
export function noteDropAt(
  ws: Workspace,
  cv: ComputedView,
  nodes: FlowNode[],
  arrows: DrawnArrow[],
  at: Point,
  { reach, noteSize, elementOf = (n) => n.data.element.id }: { reach: number; noteSize: StickySize; elementOf?: (node: ElementFlowNode | FrameFlowNode) => string },
): NoteDrop | undefined {
  const within = (r: Rect) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h;
  if (nodes.some((n) => n.type === "sticky" && within(noteRect(n, noteSize)))) return undefined;
  const box = boxAt(nodes, at);
  if (box) {
    const id = elementOf(box);
    const on = stickyTargetFor(ws, cv, { kind: "element", id });
    return on && { on, anchor: { kind: "box", id }, node: box.id };
  }
  let found: NoteDrop | undefined;
  let nearest = reach;
  for (const a of arrows) {
    const distance = a.label && within(a.label) ? 0 : distanceToRoute(a.points, at);
    if (distance > nearest) continue;
    const on = stickyTargetFor(ws, cv, { kind: "arrow", from: a.edge.from, to: a.edge.to, ...arrowRelation(a.edge) });
    if (on) [found, nearest] = [{ on, anchor: { kind: "arrow", edge: a.edge }, arrow: a.id }, distance];
  }
  if (found) return found;
  const frame = frameAt(nodes, at);
  if (!frame) return undefined;
  const id = elementOf(frame);
  const on = stickyTargetFor(ws, cv, { kind: "element", id });
  return on && { on, anchor: { kind: "frame", id }, node: frame.id };
}

/** Whether a view draws two things a note can be on as the same box, frame or arrow. */
function sameAnchor(a: StickyAnchor, b: StickyAnchor): boolean {
  if (a.kind === "arrow") return b.kind === "arrow" && arrowId(a.edge) === arrowId(b.edge);
  return a.kind === b.kind && a.id === b.id;
}

/**
 * The edit that puts a note on what its dot was let go on, or none when its line goes there
 * already: a note on the second relationship an arrow stands for, or on an element inside a box,
 * stays on it. The note stays where it's drawn, `drawnAt`, rather than going beside what it's on
 * now, as one placed beside what it was on would.
 */
export function noteDropOps(ws: Workspace, cv: ComputedView, sticky: Sticky, drop: NoteDrop, drawnAt: Point): Operation[] {
  const current = sticky.on && stickyAnchor(ws, cv, sticky.on);
  if (current && sameAnchor(current, drop.anchor)) return [];
  return [{ op: "update-sticky", view: cv.view.id, id: sticky.id, on: drop.on, ...(!sticky.at && { at: [Math.round(drawnAt.x), Math.round(drawnAt.y)] as [number, number] }) }];
}

/**
 * The edit that moves an arrow's start or end to another box: each relationship the arrow stands
 * for then starts or ends at that box's element, and keeps the element at its other end. An arrow
 * that goes both ways can stand for relationships in either direction, and each moves whichever
 * of its own ends is at that end of the arrow. An operation names a relationship by its place
 * among the ones from its element to the same target, and moving one takes it out of them, so
 * each names its place among the ones still left.
 */
export function reconnectOps(ws: Workspace, edge: ViewEdge, end: ArrowEnd, box: string): Operation[] {
  const moved = new Map<string, number>();
  const at = end === "from" ? edge.from : edge.to;
  return edge.sources.map(({ element, index }) => {
    const ref = relationshipRef(ws.elements.get(element)!, index);
    const key = `${ref.from}\u0000${ref.to}`;
    const before = moved.get(key) ?? 0;
    moved.set(key, before + 1);
    const starts = element === at || isInside(ws, element, at);
    return { op: "update-relationship", ...ref, index: ref.index - before, ...(starts ? { newFrom: box } : { newTo: box }) };
  });
}

/** The nodes with a frame round the boxes inside the boundary. `selected` sets its highlight; left out, the frame keeps the one it had. */
export function withFrame(nodes: FlowNode[], boundary: ArchElement | undefined, selected?: boolean): FlowNode[] {
  const elements = nodes.filter((n): n is ElementFlowNode => n.type === "element");
  const rest = nodes.filter((n) => n.type !== "frame");
  const inside = elements.filter((n) => inFrame(boundary, n.data.element));
  if (!boundary || inside.length === 0) return rest;
  // Whole pixels: fractional sizes from high-DPI screens would make the frame resize itself forever.
  const left = Math.round(Math.min(...inside.map((n) => n.position.x)) - FRAME_PAD.x);
  const top = Math.round(Math.min(...inside.map((n) => n.position.y)) - FRAME_PAD.top);
  const right = Math.round(Math.max(...inside.map((n) => n.position.x + (n.measured?.width ?? NODE_W))) + FRAME_PAD.x);
  const bottom = Math.round(Math.max(...inside.map((n) => n.position.y + (n.measured?.height ?? NODE_H))) + FRAME_PAD.bottom);
  const previous = nodes.find((n): n is FrameFlowNode => n.id === FRAME_ID);
  const highlighted = selected ?? previous?.data.selected ?? false;
  // Reuse the frame when nothing about it changed. A new object without `measured`
  // makes React Flow measure it again, which updates the nodes, which rebuilds the frame...
  // React Flow also starts watching its size again, and when that happens inside a resize
  // callback the browser reports a resize loop. So pass the frame drawn now in `nodes`.
  if (
    previous &&
    previous.data.element === boundary &&
    previous.data.selected === highlighted &&
    previous.position.x === left &&
    previous.position.y === top &&
    previous.width === right - left &&
    previous.height === bottom - top
  ) {
    return [previous, ...rest];
  }
  const frame: FrameFlowNode = {
    measured: previous?.measured,
    id: FRAME_ID,
    type: "frame",
    position: { x: left, y: top },
    data: { element: boundary, width: right - left, height: bottom - top, selected: highlighted },
    width: right - left,
    height: bottom - top,
    draggable: false,
    connectable: false,
    // Clicking it still selects it (see frameAt). React Flow lifts a node it has selected
    // above the others, and the frame would then cover the boxes inside it and take their clicks.
    // A selection box doesn't pick it either.
    selectable: false,
    zIndex: -1,
    style: { pointerEvents: "none" },
  };
  return [frame, ...rest];
}

/**
 * The React Flow node ID of each box, by its element's ID, after these renames. A box keeps its
 * node through a rename, so a drag or a connection begun just before one finishes normally:
 * React Flow drops a node it's dragging when the node goes, and a click on a dot that's been
 * replaced never comes. A new box's node ID is its element's ID, or that numbered when another
 * box's node has it: after new-system becomes payments, another new-system can be added.
 */
export function nodeIds(previous: ReadonlyMap<string, string>, renames: Rename[], ids: string[]): Map<string, string> {
  const moved = new Map(previous);
  for (const r of renames) {
    const node = moved.get(r.id);
    if (node === undefined) continue;
    moved.delete(r.id);
    moved.set(r.to, node);
  }
  // Boxes that left the view are forgotten.
  const next = new Map(ids.flatMap((id) => (moved.has(id) ? [[id, moved.get(id)!] as const] : [])));
  const taken = new Set(next.values());
  for (const id of ids) {
    if (next.has(id)) continue;
    let node = id;
    // # isn't in element IDs, so no other box's ID can be the same.
    for (let n = 2; taken.has(node); n++) node = `${id}#${n}`;
    next.set(id, node);
    taken.add(node);
  }
  return next;
}

/**
 * Boxes in the order computeView gives them, by kind and then ID, but by node ID, so a rename
 * doesn't move a box among the others. React would move its DOM node, and the browser drops a
 * click whose button went down before the move: one on a box's dot, to connect it, just after
 * typing its name.
 */
export function inNodeOrder(elements: ArchElement[], nodeIdOf: ReadonlyMap<string, string>): ArchElement[] {
  const node = (e: ArchElement) => nodeIdOf.get(e.id) ?? e.id;
  return [...elements].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (node(a) < node(b) ? -1 : node(a) > node(b) ? 1 : 0));
}

export function Canvas({ ws, view, diagnostics, selection, onSelect, edit, onElementMenu, onArrowMenu, onError, renames, exportItems, editSticky, snap, autoLayoutHandle }: CanvasProps) {
  const rf = useReactFlow<FlowNode, ArrowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const scopeErrors = useMemo(() => scopeProblems(ws, view), [ws, view]);
  const cv = useMemo(() => (scopeErrors.length ? null : computeView(ws, view)), [ws, view, scopeErrors]);

  // Saved positions, as points.
  const saved = useMemo<Record<string, Point>>(() => Object.fromEntries(Object.entries(view.layout).map(([id, p]) => [id, { x: p[0], y: p[1] }])), [view]);

  const ids = useMemo(() => cv?.nodes.map((n) => n.id) ?? [], [cv]);
  // Each render's node IDs are worked out from the last one's, with the renames applied since.
  const nodeIdsSoFar = useRef({ renames: renames.length, ids: new Map<string, string>() });
  /** Each box's node ID, by its element's ID. */
  const nodeIdOf = useMemo(() => {
    const last = nodeIdsSoFar.current;
    const next = nodeIds(last.ids, renames.slice(last.renames), ids);
    nodeIdsSoFar.current = { renames: renames.length, ids: next };
    return next;
  }, [ids, renames]);
  /** Each box's element's ID, by its node ID. */
  const elementOf = useMemo(() => new Map([...nodeIdOf].map(([element, node]) => [node, element])), [nodeIdOf]);
  /** The elements drawn as boxes. */
  const boxes = useMemo(() => new Set(ids), [ids]);
  /** The boxes and notes selected. */
  const picked = useMemo(() => selectedShapes(selection, boxes), [selection, boxes]);
  /** The arrows for ELK to lay out, with their labels' sizes. */
  const arrows = useMemo(() => layoutEdges(cv?.edges ?? []), [cv]);
  const graphKey = `${view.id}|${ids.join(",")}|${arrows.map((e) => `${e.from}>${e.to}`).join(",")}|${rowGap(arrows)}`;
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  useEffect(() => {
    if (!cv || !missing) return;
    let cancelled = false;
    void layOut(layoutNodes(cv), arrows).then(({ positions, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the new boxes automatically, so they're in rows for now. Reload the page to try again.");
      setAuto({ key: graphKey, positions });
    });
    return () => {
      cancelled = true;
    };
    // The graph key captures everything ELK looks at: the labels only change how far apart it puts the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, missing]);

  const ready = !!cv && (!missing || auto?.key === graphKey);
  const positions = useMemo(() => (ready ? placeMissing(ids, saved, auto?.key === graphKey ? auto.positions : {}) : null), [ready, ids, saved, auto, graphKey]);

  const problemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of diagnostics) {
      const target = diagnosticTarget(d);
      if (target?.kind === "element") counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
    }
    return counts;
  }, [diagnostics]);

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  /** The sticky note whose text is being edited in place. */
  const [editing, setEditing] = useState<string | null>(null);
  const finishEditing = useCallback(
    (sticky: Sticky, text: string | null) => {
      setEditing(null);
      // Emptying a note keeps its old text: deleting it is a separate, deliberate step.
      if (text === null || !text.trim() || text.trim() === sticky.text) return;
      void edit([{ op: "update-sticky", view: view.id, id: sticky.id, text }]);
    },
    [edit, view.id],
  );

  useEffect(() => {
    if (editSticky) setEditing(editSticky);
  }, [editSticky]);

  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;

  /** A note whose dot is being dragged to a box, the frame or an arrow, to put the note on it: the note, and where the dot is on the diagram. */
  const [linking, setLinking] = useState<{ sticky: string; at: Point } | null>(null);
  /** Puts the note on what its dot was let go on, if anything: set below, once the arrows are drawn. */
  const dropLink = useRef<(id: string, at: Point | null) => void>(() => {});

  useEffect(() => {
    if (!cv || !positions) return setNodes([]);
    // Only views of boxes draw a line from a note to what it's on.
    const linkable = STICKY_TARGET_LEVELS.includes(view.level);
    const stickyAt = placeStickies(view.stickies, Object.values(positions), stickySize, besideTargets(ws, cv, positions));
    setNodes((previous) => [
      // With the frame drawn now, so the new one keeps what React Flow measured of it (see withFrame).
      ...withFrame(
        [
          ...previous.filter((n) => n.type === "frame"),
          ...inNodeOrder(cv.nodes, nodeIdOf).map((element) => ({
            id: nodeIdOf.get(element.id)!,
            type: "element" as const,
            position: positions[element.id]!,
            data: { element, problems: problemCounts.get(element.id) ?? 0 },
            selected: picked.elements.includes(element.id),
            measured: previous.find((p) => p.id === nodeIdOf.get(element.id))?.measured,
          })),
        ],
        cv.boundary,
        selection?.kind === "element" && selection.id === cv.boundary?.id,
      ),
      ...view.stickies.map(
        (sticky): StickyFlowNode => ({
          id: stickyNodeId(sticky.id),
          type: "sticky",
          position: stickyAt[sticky.id]!,
          data: {
            sticky,
            editing: editing === sticky.id,
            onEdit: () => setEditing(sticky.id),
            onDone: (text) => finishEditing(sticky, text),
            ...(linkable && { onLinkDrag: (at: Point) => setLinking({ sticky: sticky.id, at }), onLinkDrop: (at: Point | null) => dropLink.current(sticky.id, at) }),
          },
          selected: picked.stickies.includes(sticky.id),
          measured: previous.find((p) => p.id === stickyNodeId(sticky.id))?.measured,
          connectable: false,
          zIndex: STICKY_Z,
        }),
      ),
    ]);
  }, [ws, cv, nodeIdOf, positions, problemCounts, selection, picked, view.stickies, view.level, stickySize, editing, finishEditing]);

  /**
   * The ID of the element a node is for, as this render has it. React Flow has the nodes from an
   * effect, a render behind, so a node's own element can be from before a rename.
   */
  const elementOfNode = useCallback(
    (node: ElementFlowNode | FrameFlowNode) => (node.type === "frame" ? (cv?.boundary?.id ?? node.data.element.id) : (elementOf.get(node.id) ?? node.data.element.id)),
    [cv, elementOf],
  );

  // The sizes each arrow's label can be drawn at, which don't change as boxes move.
  const sizes = useMemo(() => {
    const edges = cv?.edges ?? [];
    const measured = measureLabelSizes(edges);
    return new Map(edges.flatMap((e, k) => (measured[k]!.length ? [[arrowId(e), measured[k]!] as const] : [])));
  }, [cv]);

  // Routed together from the boxes as drawn now, so arrows keep clear of each other and follow boxes being dragged.
  const { routes, labels, crossed } = useMemo(() => {
    const boxes = new Map<string, Box>();
    const notes: Box[] = [];
    const frames: Box[] = [];
    // The frame's name, in its bottom left corner (see .frame-label).
    const frameNames: Box[] = [];
    for (const n of nodes) {
      if (n.type === "element") {
        boxes.set(elementOfNode(n), { x: n.position.x, y: n.position.y, w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? NODE_H });
      } else if (n.type === "sticky") {
        // No arrow starts or ends at a note, but any it's in the way of goes around it.
        notes.push(noteRect(n, stickySize));
      } else {
        frames.push({ x: n.position.x, y: n.position.y, w: n.data.width, h: n.data.height });
        const width = n.data.element.name.length * 8 + kindLabel(n.data.element).length * 6.5 + 12;
        frameNames.push({ x: n.position.x + 14, y: n.position.y + n.data.height - 28, w: width, h: 20 });
      }
    }
    const links = (cv?.edges ?? []).map((e) => ({ id: arrowId(e), from: e.from, to: e.to }));
    const { routes, labels } = layoutArrows(boxes, links, sizes, { frames, notes, keepClear: frameNames });
    return { routes, labels, crossed: crossings(routes) };
  }, [nodes, cv, sizes, stickySize, elementOfNode]);

  // The line from each note on something to the box, the frame or the arrow that draws it, as drawn
  // now. Not a note whose dot is being dragged: it has the line being dragged instead.
  const linkingNote = linking?.sticky;
  const stickyLines = useMemo(() => {
    if (!cv) return [];
    const rectOf = (n: FlowNode) =>
      n.type === "frame" ? { x: n.position.x, y: n.position.y, w: n.data.width, h: n.data.height } : { x: n.position.x, y: n.position.y, w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? NODE_H };
    const box = (id: string) => nodes.find((n) => n.type === "element" && elementOfNode(n) === id);
    return nodes.flatMap((n) => {
      const on = n.type === "sticky" ? n.data.sticky.on : undefined;
      const anchor = on && stickyAnchor(ws, cv, on);
      if (n.type !== "sticky" || !anchor || n.data.sticky.id === linkingNote) return [];
      let end: LineEnd | undefined;
      if (anchor.kind === "box") {
        const target = box(anchor.id);
        end = target && { rect: rectOf(target) };
      } else if (anchor.kind === "frame") {
        const frame = nodes.find((f) => f.type === "frame");
        end = frame && { outline: rectOf(frame) };
      } else if (anchor.kind === "arrow") {
        const id = arrowId(anchor.edge);
        const label = labels.get(id);
        const point = midpoint(routes.get(id) ?? []);
        end = label ? { rect: { x: label.x - label.w / 2, y: label.y - label.h / 2, w: label.w, h: label.h } } : point && { point };
      }
      const line = end && stickyLine(noteRect(n, stickySize), end);
      return line ? [{ id: n.data.sticky.id, ...line, selected: !!n.selected }] : [];
    });
  }, [ws, cv, nodes, routes, labels, stickySize, elementOfNode, linkingNote]);

  /** The arrows as drawn now, to find the one a note's dot is let go on. */
  const drawnArrows = useMemo<DrawnArrow[]>(
    () =>
      (cv?.edges ?? []).map((edge) => {
        const id = arrowId(edge);
        const label = labels.get(id);
        return { id, edge, points: routes.get(id) ?? [], ...(label && { label: { x: label.x - label.w / 2, y: label.y - label.h / 2, w: label.w, h: label.h } }) };
      }),
    [cv, routes, labels],
  );

  /** What a note's dot let go at this point on the diagram puts the note on. An arrow is as easy to hit as to click. */
  const linkDropAt = (at: Point) =>
    cv ? noteDropAt(ws, cv, nodesRef.current, drawnArrows, at, { reach: INTERACTION_WIDTH / 2 / rf.getZoom(), noteSize: stickySize, elementOf: elementOfNode }) : undefined;
  /** What the note whose dot is being dragged would go on, outlined while the dot is over it. */
  const linkDrop = linking ? linkDropAt(linking.at) : undefined;

  /** Every box's position as shown now, including ones placed automatically. */
  const currentLayout = useCallback((): Record<string, Position> => {
    const out: Record<string, Position> = {};
    for (const n of nodesRef.current) if (n.type === "element") out[elementOfNode(n)] = [Math.round(n.position.x), Math.round(n.position.y)];
    return out;
  }, [elementOfNode]);

  /** A selected arrow's start or end being dragged to another box: the arrow, which end, and where it is on the diagram. */
  const [moving, setMoving] = useState<{ edge: ViewEdge; end: ArrowEnd; at: Point } | null>(null);
  const movingArrow = moving && arrowId(moving.edge);
  const movingEnd = moving?.end;

  /** The box an arrow's end dropped here moves it to: not the box at that end already, or the one at its other end. */
  const dropBox = useCallback(
    (edge: ViewEdge, at: Point) => {
      const box = boxAt(nodesRef.current, at);
      const id = box && elementOfNode(box);
      return box && id !== edge.from && id !== edge.to ? box : undefined;
    },
    [elementOfNode],
  );

  // An arrow's start or end let go on another box moves the relationships it stands for there,
  // as one step for Undo, and selects the arrow they make. The boxes stay where they are: a view
  // with boxes placed automatically would otherwise be laid out again, as its arrows changed.
  const dropEnd = useCallback(
    (edge: ViewEdge, end: ArrowEnd, at: Point | null) => {
      setMoving(null);
      const box = at && dropBox(edge, at);
      if (!box) return;
      const id = elementOfNode(box);
      void edit([...reconnectOps(ws, edge, end, id), { op: "set-layout", view: view.id, positions: currentLayout() }]).then(
        (ok) => ok && onSelect({ kind: "arrow", from: end === "from" ? id : edge.from, to: end === "to" ? id : edge.to, ...arrowRelation(edge) }),
      );
    },
    [dropBox, elementOfNode, edit, ws, view.id, currentLayout, onSelect],
  );

  // A note's dot let go on a box, the frame or an arrow puts the note on it, as one step for Undo,
  // and selects the note (see noteDropOps). Let go on what its line goes to already, it just
  // selects the note.
  dropLink.current = (id, at) => {
    setLinking(null);
    const sticky = view.stickies.find((s) => s.id === id);
    const node = nodesRef.current.find((n): n is StickyFlowNode => n.id === stickyNodeId(id));
    const drop = at && linkDropAt(at);
    if (!cv || !sticky || !node || !drop) return;
    const ops = noteDropOps(ws, cv, sticky, drop, node.position);
    if (!ops.length) return onSelect({ kind: "sticky", id });
    void edit(ops).then((ok) => ok && onSelect({ kind: "sticky", id }));
  };

  const linkArrow = linkDrop?.arrow;
  const edges = useMemo<ArrowEdge[]>(
    () =>
      cv?.edges.map((e) => {
        const id = arrowId(e);
        return {
          id,
          type: "arrow",
          source: nodeIdOf.get(e.from) ?? e.from,
          target: nodeIdOf.get(e.to) ?? e.to,
          selected: selection?.kind === "arrow" && isArrow(e, selection.from, selection.to, selection.relation),
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
          // React Flow turns a start marker round, so it points back at the box it starts from.
          ...(e.bidirectional && { markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" } }),
          data: {
            edge: e,
            points: routes.get(id) ?? [],
            label: labels.get(id),
            crossings: crossed.get(id) ?? [],
            onSelect: () => onSelect({ kind: "arrow", from: e.from, to: e.to, ...arrowRelation(e) }),
            onEndDrag: (end, at) => setMoving({ edge: e, end, at }),
            onEndDrop: (end, at) => dropEnd(e, end, at),
            moving: movingArrow === id ? movingEnd : undefined,
            dropTarget: linkArrow === id,
          },
        };
      }) ?? [],
    [cv, nodeIdOf, routes, labels, crossed, selection, onSelect, dropEnd, movingArrow, movingEnd, linkArrow],
  );

  /** Fit the diagram to the canvas, below the toolbar. */
  const fitDiagram = useCallback(
    (options: { padding: number; maxZoom?: number } = FIT) => {
      const canvas = wrapper.current;
      const toolbar = canvas?.querySelector(".toolbar");
      if (!canvas || !toolbar) return void rf.fitView(options);
      void rf.fitView(fitBelowToolbar(options, canvas.clientHeight, toolbar.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top));
    },
    [rf],
  );

  // Auto layout places every box as ELK would on a new view, but at the height each is drawn.
  const autoLayout = useAutoLayout(
    async () => {
      if (!cv) return [];
      const drawn = new Map(nodesRef.current.flatMap((n) => (n.type === "element" && n.measured?.height ? [[elementOfNode(n), n.measured.height] as const] : [])));
      const positions = await elkLayout(layoutNodes(cv, drawn), arrows);
      return (ws: Workspace) => autoLayoutOps(ws, view.id, positions);
    },
    edit,
    onError,
    () => fitDiagram(),
    autoLayoutHandle,
  );

  /** The box a moving end would go to, or the box or frame a note's dot would put the note on, outlined while it's over it. */
  const dropOn = moving ? dropBox(moving.edge, moving.at)?.id : linkDrop?.node;
  const drawnNodes = useMemo(() => (dropOn ? nodes.map((n) => (n.id === dropOn ? { ...n, className: "drop-target" } : n)) : nodes), [nodes, dropOn]);
  /** The arrow whose end is moving, drawn straight from its other end to where the moving end is. */
  const movingRoute = moving ? routes.get(arrowId(moving.edge)) : undefined;
  const movingLine =
    moving && movingRoute && movingRoute.length >= 2
      ? { from: moving.end === "from" ? moving.at : movingRoute[0]!, to: moving.end === "to" ? moving.at : movingRoute[movingRoute.length - 1]! }
      : null;
  /** The line from a note whose dot is being dragged to where the dot is: none while the dot is over the note. */
  const linkingNode = linking ? nodes.find((n): n is StickyFlowNode => n.id === stickyNodeId(linking.sticky)) : undefined;
  const linkLine = linking && linkingNode ? stickyLine(noteRect(linkingNode, stickySize), { point: linking.at }) : null;

  // Fit the diagram to the window once per view, after its boxes have been measured.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || fitted.current === view.id) return;
    fitted.current = view.id;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [ready, view.id, fitDiagram]);

  // Turning a phone or tablet round fits the diagram to its new shape, once the canvas has it.
  // (Not a window crossing square as it's resized: that keeps the zoom.) Browsers report the
  // turn just before or just after resizing the page. A half turn, from one side to the other,
  // resizes nothing, so it keeps the zoom too.
  useEffect(() => {
    const canvas = wrapper.current;
    if (!canvas) return;
    const SOON = 500;
    let resizedAt = -Infinity;
    let turnedAt = -Infinity;
    let frame = 0;
    // After React Flow, whose own observer has measured the canvas by the next frame.
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitDiagram());
    };
    const resized = new ResizeObserver(() => {
      resizedAt = performance.now();
      if (resizedAt - turnedAt < SOON) fit();
    });
    resized.observe(canvas);
    const turned = () => {
      turnedAt = performance.now();
      if (turnedAt - resizedAt < SOON) fit();
    };
    // Safari before 16.4 has only the older event.
    const source: EventTarget = screen.orientation ?? window;
    const event = screen.orientation ? "change" : "orientationchange";
    source.addEventListener(event, turned);
    return () => {
      source.removeEventListener(event, turned);
      resized.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fitDiagram]);

  /** What the selection box being drawn has picked so far, by node ID. */
  const boxed = useRef<Set<string> | null>(null);

  const { snapChanges, dropped, guides } = useSnap<FlowNode>(snap.settings, { snaps: snapsHere, isTarget: snapsHere });

  const onNodesChange = useCallback(
    (made: NodeChange<FlowNode>[]) => {
      const changes = snapChanges(made);
      const picking = boxed.current;
      if (picking) for (const c of changes) if (c.type === "select") picking[c.selected ? "add" : "delete"](c.id);
      // Boxes being measured: fit the frame around them on the next frame, not inside
      // React Flow's resize callback, which would make the browser report a resize loop.
      const measuring = changes.every((c) => c.type === "dimensions");
      setNodes((nds) => (measuring ? applyNodeChanges(changes, nds) : withFrame(applyNodeChanges(changes, nds), cv?.boundary)));
      if (measuring) requestAnimationFrame(() => setNodes((nds) => withFrame(nds, cv?.boundary)));
    },
    [cv, snapChanges],
  );

  /** The boxes and notes these nodes draw. */
  const shapesOf = (nodes: FlowNode[]): Shapes => ({
    elements: nodes.flatMap((n) => (n.type === "element" ? [elementOfNode(n)] : [])),
    stickies: nodes.flatMap((n) => (n.type === "sticky" ? [n.data.sticky.id] : [])),
  });

  /** Selects these boxes and notes. Selecting the ones selected already would redraw them for nothing, mid-drag. */
  const pick = (shapes: Shapes) => {
    if (shapes.elements.length + shapes.stickies.length === 0) onSelect(null);
    else if (!sameShapes(shapes, picked)) onSelect(selectShapes(shapes));
  };

  /** A click on a box or note selects it, or with Ctrl (⌘ on a Mac) or Shift held, adds it to the selection or takes it out. */
  const clickNode = (event: MouseEvent, node: FlowNode) => {
    if (node.type === "frame") return;
    const shape = node.type === "sticky" ? { kind: "sticky" as const, id: node.data.sticky.id } : { kind: "element" as const, id: elementOfNode(node) };
    if (addsToSelection(event)) onSelect(toggleShape(selection, boxes, shape));
    else pick(shapesOf([node]));
  };

  /**
   * A click on the background selects nothing, or the frame when it's inside it. This isn't React
   * Flow's onPaneClick, which a tap on a touch screen never reaches while a drag selects.
   */
  const clickPane = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) return;
    const frame = frameAt(nodesRef.current, rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    onSelect(frame ? { kind: "element", id: elementOfNode(frame) } : null);
  };

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, letGo: FlowNode[]) => {
      const dragged = dropped(letGo);
      const at = (n: FlowNode): [number, number] => [Math.round(n.position.x), Math.round(n.position.y)];
      const movedBoxes = dragged.filter((n): n is ElementFlowNode => n.type === "element");
      const movedNotes = dragged.filter((n): n is StickyFlowNode => n.type === "sticky");
      const layout = movedBoxes.length ? { ...currentLayout(), ...Object.fromEntries(movedBoxes.map((n) => [elementOfNode(n), at(n)])) } : null;
      void edit(moveOps(view.id, layout, Object.fromEntries(movedNotes.map((n) => [n.data.sticky.id, at(n)]))));
    },
    [currentLayout, edit, view.id, elementOfNode, dropped],
  );

  // Pressing a box saves a name being typed in the details, and the rename that follows can land
  // before the drop. The boxes keep their nodes (see nodeIds), so an arrow joins the elements
  // they're for as this render has them, and the edit follows any rename since.
  const onConnect = useCallback(
    (c: Connection) => {
      const [from, to] = [elementOf.get(c.source) ?? c.source, elementOf.get(c.target) ?? c.target];
      void edit(connectOps(view.id, from, to, currentLayout())).then((ok) => ok && onSelect({ kind: "arrow", from, to }));
    },
    [edit, onSelect, elementOf, view.id, currentLayout],
  );

  /** Where on the diagram something added goes: at a point, or else in the middle of the canvas. */
  const addPoint = (at?: Point): Point => {
    if (at) return at;
    const rect = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  // A library added to a view that draws none, such as a container view, is put nowhere on the
  // diagram, whatever point it was added at: addElementOps leaves the view as it is. It's in the
  // Model list, and its details open.
  const add = (kind: ElementKind, parent?: string, at?: Point, builtInto?: string) => {
    const center = addPoint(at);
    const id = uniqueId(ws, `new-${kind}`);
    const existing = currentLayout();
    const spot = freeSpotAmong({ x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 }, Object.values(existing).map(([x, y]) => ({ x, y })));
    void edit(addElementOps(ws, view, id, { kind, parent, builtInto }, existing, spot)).then((ok) => ok && onSelect({ kind: "element", id }, { isNew: true }));
  };

  const addSticky = (at?: Point) => {
    const center = addPoint(at);
    const id = newStickyId(view);
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - stickySize.width / 2, y: center.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [spot.x, spot.y] }]).then((ok) => {
      if (!ok) return;
      onSelect({ kind: "sticky", id });
      setEditing(id);
    });
  };

  /** What can be added to this view, by + Add and the diagram's right-click menu, centred on a point on the diagram or else in the middle. */
  const addItems = (at?: Point): MenuAction[] => [
    ...addableKinds(ws, view).map((k) => ({ label: k.label, onSelect: () => add(k.kind, k.parent, at, k.builtInto) })),
    { label: "Sticky note", divider: true, onSelect: () => addSticky(at) },
  ];

  /** The diagram's right-click menu: where it opened on the screen, and that point on the diagram. */
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; at: Point } | null>(null);
  const closePaneMenu = useCallback(() => setPaneMenu(null), []);

  if (scopeErrors.length) {
    return <div className="canvas-message">This view can't be drawn: {scopeErrors[0]!.message}</div>;
  }

  return (
    <div className="canvas" ref={wrapper} onClick={clickPane}>
      <ReactFlow<FlowNode, ArrowEdge>
        nodes={drawnNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target && c.target !== FRAME_ID && c.source !== FRAME_ID}
        onNodeClick={clickNode}
        onNodeContextMenu={(event, node) => {
          if (node.type !== "element") return;
          event.preventDefault();
          onElementMenu(elementOfNode(node), menuPoint(event));
        }}
        // Dragging swallows the click, so select what's dragged when the drag starts: the box or
        // note, or all those selected with it, which move together. Otherwise the layout saved on
        // drop redraws them with the old selection.
        onNodeDragStart={(_, _node, dragged) => pick(shapesOf(dragged))}
        // A click that wobbles a few pixels is still a click, not nothing.
        nodeClickDistance={4}
        paneClickDistance={4}
        onEdgeClick={(_, edge) =>
          onSelect({ kind: "arrow", from: elementOf.get(edge.source) ?? edge.source, to: elementOf.get(edge.target) ?? edge.target, ...(edge.data && arrowRelation(edge.data.edge)) })
        }
        // An arrow's label is drawn apart from its line, but a right-click on it comes here too.
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          onArrowMenu(elementOf.get(edge.source) ?? edge.source, elementOf.get(edge.target) ?? edge.target, edge.data?.edge.kind === "association" ? undefined : edge.data?.edge.kind, menuPoint(event));
        }}
        // Right-clicking the diagram's background offers what + Add does, added where it was
        // clicked. On the frame, it's the menu for the element the frame is.
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const point = { x: event.clientX, y: event.clientY };
          const at = rf.screenToFlowPosition(point);
          const frame = frameAt(nodesRef.current, at);
          if (frame) onElementMenu(elementOfNode(frame), point);
          else setPaneMenu({ ...point, at });
        }}
        // With a mouse, dragging the background draws a box, and selects the boxes and notes
        // inside it, as in most diagram editors. So the scroll wheel pans, as do Space and drag
        // and the middle button, and Ctrl (⌘ on a Mac) with the wheel, or a pinch, zooms.
        // A drag on a touch screen still pans.
        selectionOnDrag
        panOnDrag={[1]}
        panOnScroll
        onSelectionStart={() => {
          boxed.current = new Set();
        }}
        onSelectionEnd={() => {
          const ids = boxed.current;
          boxed.current = null;
          if (ids) pick(shapesOf(nodesRef.current.filter((n) => ids.has(n.id))));
        }}
        connectionMode={ConnectionMode.Loose}
        // The arrow being drawn stays over everything, as React Flow means it to, even a selected note.
        connectionLineContainerStyle={{ zIndex: DRAWING_Z }}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={MULTI_KEYS}
        minZoom={0.1}
        colorMode="system"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <FrameNotes frame={nodes.find((n): n is FrameFlowNode => n.type === "frame")} />
        <SnapGuides guides={guides} />
        <StickyLines lines={stickyLines} />
        {movingLine && (
          <ViewportPortal>
            <svg className="arrow-moving" style={{ zIndex: DRAWING_Z }} aria-hidden="true">
              <defs>
                <marker id="arrow-moving-head" viewBox="-10 -10 20 20" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
                  <polyline points="-5,-4 0,0 -5,4 -5,-4" />
                </marker>
              </defs>
              <path d={`M ${movingLine.from.x} ${movingLine.from.y} L ${movingLine.to.x} ${movingLine.to.y}`} markerEnd="url(#arrow-moving-head)" />
              {moving?.end === "from" && <circle cx={movingLine.from.x} cy={movingLine.from.y} r={5} />}
            </svg>
          </ViewportPortal>
        )}
        {linking && <StickyLinking at={linking.at} line={linkLine} zIndex={DRAWING_Z} />}
        {/* The fit button fits the view with its own options, then calls onFitView. React Flow fits
            once, with the last options it was asked for, so these are the ones it uses. */}
        <Controls showInteractive={false} onFitView={() => fitDiagram(FIT_BUTTON)}>
          <SnapButtons snap={snap} />
        </Controls>
        <Panel position="top-left" className="toolbar">
          <div className="toolbar-title">
            <strong>{view.title}</strong>
            <span>
              {view.level} view{view.scope ? ` of ${ws.elements.get(view.scope)?.name ?? view.scope}` : ""}
            </span>
            {view.description && (
              <span className="toolbar-description" title={view.description}>
                {view.description}
              </span>
            )}
          </div>
          <MenuButton className="primary" items={addItems()}>
            + Add
          </MenuButton>
          <AutoLayoutButton layout={autoLayout} empty={ids.length === 0} />
          {exportItems.length > 0 && (
            <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
              Export
            </MenuButton>
          )}
        </Panel>
      </ReactFlow>
      {ready && ids.length === 0 && (
        <div className="empty-hint">
          This view has no elements yet. Use <strong>+ Add</strong> to create one.
        </div>
      )}
      {paneMenu && <ContextMenu x={paneMenu.x} y={paneMenu.y} items={[{ label: "Add", items: addItems(paneMenu.at) }]} onClose={closePaneMenu} />}
    </div>
  );
}
