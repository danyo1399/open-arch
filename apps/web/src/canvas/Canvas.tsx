import {
  computeView,
  diagnosticTarget,
  KIND_RANK,
  kindLabel,
  scopeProblems,
  type ArchElement,
  type Diagnostic,
  type ElementKind,
  type Operation,
  type Position,
  type Sticky,
  type ViewDef,
  type ViewEdge,
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import { relationshipRef, sameShapes, selectedShapes, selectShapes, toggleShape, uniqueId, type Rename, type Shapes } from "../model.js";
import { ContextMenu, menuPoint, type MenuAction } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { freeSpotAmong, layOut, NODE_H, NODE_W, placeMissing, placeStickies, STICKY, stickyHeight, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { nodeTypes, type ElementFlowNode, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import { edgeTypes, measureLabelSizes, type ArrowEdge, type ArrowEnd } from "./RoutedEdge.js";
import { crossings, layoutArrows, type Box } from "./routing.js";

/** What's selected. `several` is two or more boxes and sticky notes on the open view, which move together. */
export type Selection =
  | { kind: "element"; id: string }
  | { kind: "arrow"; from: string; to: string }
  | { kind: "sticky"; id: string }
  | { kind: "several"; elements: string[]; stickies: string[] }
  | { kind: "workspace" }
  | null;

type FlowNode = ElementFlowNode | FrameFlowNode | StickyFlowNode;

const FRAME_ID = "__frame";
/** Sticky note IDs are only unique within their view, so their nodes get a prefix no element ID has. */
const stickyNodeId = (id: string) => `sticky:${id}`;
const arrowId = (e: { from: string; to: string }) => `${e.from}->${e.to}`;
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
const DRAWING_Z = STICKY_Z + SELECTED_LIFT + 1;
/** Any touch screen, as in styles.css, where sticky notes are drawn bigger. */
const TOUCH = "(any-pointer: coarse)";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** Held while clicking a box or note, these add it to the selection or take it out: Ctrl (⌘ on a Mac), or Shift. */
const MULTI_KEYS = isMac ? ["Meta", "Shift"] : ["Control", "Shift"];
const addsToSelection = (e: MouseEvent) => e.shiftKey || (isMac ? e.metaKey : e.ctrlKey);

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
  onArrowMenu(from: string, to: string, at: { x: number; y: number }): void;
  /** A problem drawing the diagram, to tell the person about. */
  onError(text: string): void;
  /** Every rename this render's IDs reflect, in order. */
  renames: Rename[];
}

/** Element kinds that can be added to a view at its level, and the parent each gets. */
export function addableKinds(ws: Workspace, view: ViewDef): { kind: ElementKind; parent?: string; label: string }[] {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  const top = [
    { kind: "person" as const, label: "Person" },
    { kind: "system" as const, label: "Software system" },
  ];
  if (view.level === "container" && scope) return [{ kind: "container", parent: scope.id, label: `Container in ${scope.name}` }, ...top];
  if (view.level === "component" && scope) {
    const system = scope.parent ? ws.elements.get(scope.parent) : undefined;
    return [
      { kind: "component", parent: scope.id, label: `Component in ${scope.name}` },
      ...(system ? [{ kind: "container" as const, parent: system.id, label: `Container in ${system.name}` }] : []),
      ...top,
    ];
  }
  return top;
}

/** "note", or "note-2", "note-3", ... whichever the view doesn't have yet. */
function newStickyId(view: ViewDef): string {
  const taken = new Set(view.stickies.map((s) => s.id));
  if (!taken.has("note")) return "note";
  for (let i = 2; ; i++) if (!taken.has(`note-${i}`)) return `note-${i}`;
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

/** The box at this point on the diagram, if there is one: the one drawn on top, where boxes overlap. The frame isn't a box. */
export function boxAt(nodes: FlowNode[], at: Point): ElementFlowNode | undefined {
  return nodes.findLast((n): n is ElementFlowNode => {
    if (n.type !== "element") return false;
    const { x, y } = n.position;
    return at.x >= x && at.x <= x + (n.measured?.width ?? NODE_W) && at.y >= y && at.y <= y + (n.measured?.height ?? NODE_H);
  });
}

/**
 * The edit that moves an arrow's start or end to another box: each relationship the arrow stands
 * for then starts or ends at that box's element, and keeps the element at its other end. An
 * operation names a relationship by its place among the ones from its element to the same target,
 * and moving one takes it out of them, so each names its place among the ones still left.
 */
export function reconnectOps(ws: Workspace, edge: ViewEdge, end: ArrowEnd, box: string): Operation[] {
  const moved = new Map<string, number>();
  return edge.sources.map(({ element, index }) => {
    const ref = relationshipRef(ws.elements.get(element)!, index);
    const key = `${ref.from}\u0000${ref.to}`;
    const before = moved.get(key) ?? 0;
    moved.set(key, before + 1);
    return { op: "update-relationship", ...ref, index: ref.index - before, ...(end === "from" ? { newFrom: box } : { newTo: box }) };
  });
}

/** The nodes with a frame round the boxes inside the boundary. `selected` sets its highlight; left out, the frame keeps the one it had. */
export function withFrame(nodes: FlowNode[], boundary: ArchElement | undefined, selected?: boolean): FlowNode[] {
  const elements = nodes.filter((n): n is ElementFlowNode => n.type === "element");
  const rest = nodes.filter((n) => n.type !== "frame");
  const inside = boundary ? elements.filter((n) => n.data.element.parent === boundary.id) : [];
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

export function Canvas({ ws, view, diagnostics, selection, onSelect, edit, onElementMenu, onArrowMenu, onError, renames }: CanvasProps) {
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
  const graphKey = `${view.id}|${ids.join(",")}|${cv?.edges.map((e) => `${e.from}>${e.to}`).join(",") ?? ""}`;
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  useEffect(() => {
    if (!cv || !missing) return;
    let cancelled = false;
    const boundary = cv.boundary?.id;
    void layOut(
      cv.nodes.map((n) => ({ id: n.id, inside: !!boundary && n.parent === boundary })),
      cv.edges,
    ).then(({ positions, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the new boxes automatically, so they're in rows for now. Reload the page to try again.");
      setAuto({ key: graphKey, positions });
    });
    return () => {
      cancelled = true;
    };
    // The graph key captures everything ELK looks at.
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

  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;

  useEffect(() => {
    if (!cv || !positions) return setNodes([]);
    const stickyAt = placeStickies(view.stickies, Object.values(positions), stickySize);
    setNodes((previous) => [
      ...withFrame(
        inNodeOrder(cv.nodes, nodeIdOf).map((element) => ({
          id: nodeIdOf.get(element.id)!,
          type: "element",
          position: positions[element.id]!,
          data: { element, problems: problemCounts.get(element.id) ?? 0 },
          selected: picked.elements.includes(element.id),
          measured: previous.find((p) => p.id === nodeIdOf.get(element.id))?.measured,
        })),
        cv.boundary,
        selection?.kind === "element" && selection.id === cv.boundary?.id,
      ),
      ...view.stickies.map(
        (sticky): StickyFlowNode => ({
          id: stickyNodeId(sticky.id),
          type: "sticky",
          position: stickyAt[sticky.id]!,
          data: { sticky, editing: editing === sticky.id, onEdit: () => setEditing(sticky.id), onDone: (text) => finishEditing(sticky, text) },
          selected: picked.stickies.includes(sticky.id),
          measured: previous.find((p) => p.id === stickyNodeId(sticky.id))?.measured,
          connectable: false,
          zIndex: STICKY_Z,
        }),
      ),
    ]);
  }, [cv, nodeIdOf, positions, problemCounts, selection, picked, view.stickies, stickySize, editing, finishEditing]);

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
        notes.push({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? stickySize.width, h: n.measured?.height ?? stickyHeight(n.data.sticky.text, stickySize) });
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
        (ok) => ok && onSelect({ kind: "arrow", from: end === "from" ? id : edge.from, to: end === "to" ? id : edge.to }),
      );
    },
    [dropBox, elementOfNode, edit, ws, view.id, currentLayout, onSelect],
  );

  const edges = useMemo<ArrowEdge[]>(
    () =>
      cv?.edges.map((e) => {
        const id = arrowId(e);
        return {
          id,
          type: "arrow",
          source: nodeIdOf.get(e.from) ?? e.from,
          target: nodeIdOf.get(e.to) ?? e.to,
          selected: selection?.kind === "arrow" && selection.from === e.from && selection.to === e.to,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
          data: {
            edge: e,
            points: routes.get(id) ?? [],
            label: labels.get(id),
            crossings: crossed.get(id) ?? [],
            onSelect: () => onSelect({ kind: "arrow", from: e.from, to: e.to }),
            onEndDrag: (end, at) => setMoving({ edge: e, end, at }),
            onEndDrop: (end, at) => dropEnd(e, end, at),
            moving: movingArrow === id ? movingEnd : undefined,
          },
        };
      }) ?? [],
    [cv, nodeIdOf, routes, labels, crossed, selection, onSelect, dropEnd, movingArrow, movingEnd],
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

  /** The box a moving end would go to, outlined while it's over it. */
  const dropOn = moving ? dropBox(moving.edge, moving.at)?.id : undefined;
  const drawnNodes = useMemo(() => (dropOn ? nodes.map((n) => (n.id === dropOn ? { ...n, className: "drop-target" } : n)) : nodes), [nodes, dropOn]);
  /** The arrow whose end is moving, drawn straight from its other end to where the moving end is. */
  const movingRoute = moving ? routes.get(arrowId(moving.edge)) : undefined;
  const movingLine =
    moving && movingRoute && movingRoute.length >= 2
      ? { from: moving.end === "from" ? moving.at : movingRoute[0]!, to: moving.end === "to" ? moving.at : movingRoute[movingRoute.length - 1]! }
      : null;

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

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const picking = boxed.current;
      if (picking) for (const c of changes) if (c.type === "select") picking[c.selected ? "add" : "delete"](c.id);
      // Boxes being measured: fit the frame around them on the next frame, not inside
      // React Flow's resize callback, which would make the browser report a resize loop.
      const measuring = changes.every((c) => c.type === "dimensions");
      setNodes((nds) => (measuring ? applyNodeChanges(changes, nds) : withFrame(applyNodeChanges(changes, nds), cv?.boundary)));
      if (measuring) requestAnimationFrame(() => setNodes((nds) => withFrame(nds, cv?.boundary)));
    },
    [cv],
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
    setMenuOpen(false);
    const frame = frameAt(nodesRef.current, rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    onSelect(frame ? { kind: "element", id: elementOfNode(frame) } : null);
  };

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const at = (n: FlowNode): [number, number] => [Math.round(n.position.x), Math.round(n.position.y)];
      const movedBoxes = dragged.filter((n): n is ElementFlowNode => n.type === "element");
      const movedNotes = dragged.filter((n): n is StickyFlowNode => n.type === "sticky");
      const layout = movedBoxes.length ? { ...currentLayout(), ...Object.fromEntries(movedBoxes.map((n) => [elementOfNode(n), at(n)])) } : null;
      void edit(moveOps(view.id, layout, Object.fromEntries(movedNotes.map((n) => [n.data.sticky.id, at(n)]))));
    },
    [currentLayout, edit, view.id, elementOfNode],
  );

  // Pressing a box saves a name being typed in the details, and the rename that follows can land
  // before the drop. The boxes keep their nodes (see nodeIds), so an arrow joins the elements
  // they're for as this render has them, and the edit follows any rename since.
  const onConnect = useCallback(
    (c: Connection) => {
      const [from, to] = [elementOf.get(c.source) ?? c.source, elementOf.get(c.target) ?? c.target];
      void edit([{ op: "add-relationship", from, to }]).then((ok) => ok && onSelect({ kind: "arrow", from, to }));
    },
    [edit, onSelect, elementOf],
  );

  /** Where on the diagram something added goes: at a point, or else in the middle of the canvas. */
  const addPoint = (at?: Point): Point => {
    if (at) return at;
    const rect = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const add = (kind: ElementKind, parent?: string, at?: Point) => {
    const center = addPoint(at);
    const id = uniqueId(ws, `new-${kind}`);
    const existing = currentLayout();
    const spot = freeSpotAmong({ x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 }, Object.values(existing).map(([x, y]) => ({ x, y })));
    void edit([
      { op: "add-element", id, kind, parent, name: `New ${kind}` },
      { op: "show-in-view", view: view.id, id },
      { op: "set-layout", view: view.id, positions: { ...existing, [id]: [spot.x, spot.y] } },
    ]).then((ok) => ok && onSelect({ kind: "element", id }, { isNew: true }));
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
    ...addableKinds(ws, view).map((k) => ({ label: k.label, onSelect: () => add(k.kind, k.parent, at) })),
    { label: "Sticky note", divider: true, onSelect: () => addSticky(at) },
  ];

  const [menuOpen, setMenuOpen] = useState(false);
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
        onEdgeClick={(_, edge) => onSelect({ kind: "arrow", from: elementOf.get(edge.source) ?? edge.source, to: elementOf.get(edge.target) ?? edge.target })}
        // An arrow's label is drawn apart from its line, but a right-click on it comes here too.
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          onArrowMenu(elementOf.get(edge.source) ?? edge.source, elementOf.get(edge.target) ?? edge.target, menuPoint(event));
        }}
        // Right-clicking the diagram's background offers what + Add does, added where it was
        // clicked. On the frame, it's the menu for the element the frame is.
        onPaneContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(false);
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
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
        {/* The fit button fits the view with its own options, then calls onFitView. React Flow fits
            once, with the last options it was asked for, so these are the ones it uses. */}
        <Controls showInteractive={false} onFitView={() => fitDiagram(FIT_BUTTON)} />
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
          <div className="menu">
            <button className="primary" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
              + Add
            </button>
            {menuOpen && (
              <div className="menu-items" role="menu">
                {addItems().map((item) => (
                  <Fragment key={item.label}>
                    {item.divider && <hr />}
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        item.onSelect();
                      }}
                    >
                      {item.label}
                    </button>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
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
