import { computeView, diagnosticTarget, kindLabel, scopeProblems, type ArchElement, type Diagnostic, type ElementKind, type Position, type Sticky, type ViewDef, type Workspace } from "@open-arch/core";
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
  type Connection,
  type NodeChange,
  type OnConnectStart,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uniqueId } from "../model.js";
import { menuPoint } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { elkLayout, freeSpotAmong, NODE_H, NODE_W, placeMissing, placeStickies, STICKY_W, stickyHeight, type Point } from "./autoLayout.js";
import { nodeTypes, type ElementFlowNode, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import { edgeTypes, measureLabelSizes, type ArrowEdge } from "./RoutedEdge.js";
import { crossings, layoutArrows, type Box } from "./routing.js";

export type Selection = { kind: "element"; id: string } | { kind: "arrow"; from: string; to: string } | { kind: "sticky"; id: string } | { kind: "workspace" } | null;

type FlowNode = ElementFlowNode | FrameFlowNode | StickyFlowNode;

const FRAME_ID = "__frame";
/** Sticky note IDs are only unique within their view, so their nodes get a prefix no element ID has. */
const stickyNodeId = (id: string) => `sticky:${id}`;
const arrowId = (e: { from: string; to: string }) => `${e.from}->${e.to}`;
const FRAME_PAD = { x: 40, top: 56, bottom: 40 };
/** How a view's diagram is fitted to the canvas. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
/**
 * How far React Flow lifts a node it has selected above the others, so a box being dragged
 * passes over the rest. It's SELECTED_NODE_Z in @xyflow/system, which doesn't export it:
 * stacking.test.ts checks it against React Flow, in case a new version changes it.
 */
export const SELECTED_LIFT = 1000;
/** A note's z-index: above the arrows and boxes, even a selected box, like a note stuck on a printed diagram. */
export const STICKY_Z = SELECTED_LIFT + 1;

interface CanvasProps {
  ws: Workspace;
  view: ViewDef;
  diagnostics: Diagnostic[];
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** A right-click on an element's box or on the frame, at that point on the screen. */
  onElementMenu(id: string, at: { x: number; y: number }): void;
  /** An ID this render shows, after any rename applied since. */
  current(id: string): string;
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
    // Clicking it still selects it (see selectNode). React Flow lifts a node it has selected
    // above the others, and the frame would then cover the boxes inside it and take their clicks.
    selectable: false,
    zIndex: -1,
  };
  return [frame, ...rest];
}

export function Canvas({ ws, view, diagnostics, selection, onSelect, edit, onElementMenu, current }: CanvasProps) {
  const rf = useReactFlow<FlowNode, ArrowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const scopeErrors = useMemo(() => scopeProblems(ws, view), [ws, view]);
  const cv = useMemo(() => (scopeErrors.length ? null : computeView(ws, view)), [ws, view, scopeErrors]);

  // Saved positions, as points.
  const saved = useMemo<Record<string, Point>>(() => Object.fromEntries(Object.entries(view.layout).map(([id, p]) => [id, { x: p[0], y: p[1] }])), [view]);

  const ids = useMemo(() => cv?.nodes.map((n) => n.id) ?? [], [cv]);
  const graphKey = `${view.id}|${ids.join(",")}|${cv?.edges.map((e) => `${e.from}>${e.to}`).join(",") ?? ""}`;
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  useEffect(() => {
    if (!cv || !missing) return;
    let cancelled = false;
    const boundary = cv.boundary?.id;
    void elkLayout(
      cv.nodes.map((n) => ({ id: n.id, inside: !!boundary && n.parent === boundary })),
      cv.edges,
    ).then((positions) => !cancelled && setAuto({ key: graphKey, positions }));
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

  useEffect(() => {
    if (!cv || !positions) return setNodes([]);
    const stickyAt = placeStickies(view.stickies, Object.values(positions));
    setNodes((previous) => [
      ...withFrame(
        cv.nodes.map((element) => ({
          id: element.id,
          type: "element",
          position: positions[element.id]!,
          data: { element, problems: problemCounts.get(element.id) ?? 0 },
          selected: selection?.kind === "element" && selection.id === element.id,
          measured: previous.find((p) => p.id === element.id)?.measured,
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
          selected: selection?.kind === "sticky" && selection.id === sticky.id,
          measured: previous.find((p) => p.id === stickyNodeId(sticky.id))?.measured,
          connectable: false,
          zIndex: STICKY_Z,
        }),
      ),
    ]);
  }, [cv, positions, problemCounts, selection, view.stickies, editing, finishEditing]);

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
        boxes.set(n.id, { x: n.position.x, y: n.position.y, w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? NODE_H });
      } else if (n.type === "sticky") {
        // No arrow starts or ends at a note, but any it's in the way of goes around it.
        notes.push({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? STICKY_W, h: n.measured?.height ?? stickyHeight(n.data.sticky.text) });
      } else {
        frames.push({ x: n.position.x, y: n.position.y, w: n.data.width, h: n.data.height });
        const width = n.data.element.name.length * 8 + kindLabel(n.data.element).length * 6.5 + 12;
        frameNames.push({ x: n.position.x + 14, y: n.position.y + n.data.height - 28, w: width, h: 20 });
      }
    }
    const links = (cv?.edges ?? []).map((e) => ({ id: arrowId(e), from: e.from, to: e.to }));
    const { routes, labels } = layoutArrows(boxes, links, sizes, { frames, notes, keepClear: frameNames });
    return { routes, labels, crossed: crossings(routes) };
  }, [nodes, cv, sizes]);

  const edges = useMemo<ArrowEdge[]>(
    () =>
      cv?.edges.map((e) => {
        const id = arrowId(e);
        return {
          id,
          type: "arrow",
          source: e.from,
          target: e.to,
          selected: selection?.kind === "arrow" && selection.from === e.from && selection.to === e.to,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
          data: {
            edge: e,
            points: routes.get(id) ?? [],
            label: labels.get(id),
            crossings: crossed.get(id) ?? [],
            onSelect: () => onSelect({ kind: "arrow", from: e.from, to: e.to }),
          },
        };
      }) ?? [],
    [cv, routes, labels, crossed, selection, onSelect],
  );

  // Fit the diagram to the window once per view, after its boxes have been measured.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || fitted.current === view.id) return;
    fitted.current = view.id;
    requestAnimationFrame(() => requestAnimationFrame(() => void rf.fitView(FIT)));
  }, [ready, view.id, rf]);

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
      frame = requestAnimationFrame(() => void rf.fitView(FIT));
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
  }, [rf]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      // Boxes being measured: fit the frame around them on the next frame, not inside
      // React Flow's resize callback, which would make the browser report a resize loop.
      const measuring = changes.every((c) => c.type === "dimensions");
      setNodes((nds) => (measuring ? applyNodeChanges(changes, nds) : withFrame(applyNodeChanges(changes, nds), cv?.boundary)));
      if (measuring) requestAnimationFrame(() => setNodes((nds) => withFrame(nds, cv?.boundary)));
    },
    [cv],
  );

  /** Every box's position as shown now, including ones placed automatically. */
  const currentLayout = useCallback((): Record<string, Position> => {
    const out: Record<string, Position> = {};
    for (const n of nodesRef.current) if (n.type === "element") out[n.id] = [Math.round(n.position.x), Math.round(n.position.y)];
    return out;
  }, []);

  const selectNode = (node: FlowNode) => {
    if (node.type === "sticky") {
      if (selection?.kind !== "sticky" || selection.id !== node.data.sticky.id) onSelect({ kind: "sticky", id: node.data.sticky.id });
      return;
    }
    const id = node.type === "frame" ? node.data.element.id : node.id;
    if (selection?.kind !== "element" || selection.id !== id) onSelect({ kind: "element", id });
  };

  const onNodeDragStop = useCallback(
    (_: unknown, node: FlowNode) => {
      // A note keeps its own position; moving it doesn't fix the boxes in place.
      if (node.type === "sticky") void edit([{ op: "update-sticky", view: view.id, id: node.data.sticky.id, at: [Math.round(node.position.x), Math.round(node.position.y)] }]);
      else void edit([{ op: "set-layout", view: view.id, positions: currentLayout() }]);
    },
    [currentLayout, edit, view.id],
  );

  // An arrow comes from the ID its box had when the drag, or the first click, began. Pressing the
  // box saves a name being typed in the details, and the rename that follows can land before the drop.
  // A click waits for the next click on a dot, and a drag can come and go in between, so each box
  // an arrow started from keeps its own way to follow renames.
  const startedFrom = useRef(new Map<string, (id: string) => string>());
  const onConnectStart: OnConnectStart = (_, { nodeId }) => {
    if (nodeId) startedFrom.current.set(nodeId, current);
  };
  /** The ID now of the box an arrow started from. */
  const sourceNow = (id: string) => startedFrom.current.get(id)?.(id) ?? id;

  const onConnect = useCallback(
    (c: Connection) => {
      const from = sourceNow(c.source);
      void edit([{ op: "add-relationship", from, to: c.target }]).then((ok) => ok && onSelect({ kind: "arrow", from, to: c.target }));
    },
    [edit, onSelect],
  );

  const add = (kind: ElementKind, parent?: string) => {
    const rect = wrapper.current!.getBoundingClientRect();
    const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const id = uniqueId(ws, `new-${kind}`);
    const existing = currentLayout();
    const spot = freeSpotAmong({ x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 }, Object.values(existing).map(([x, y]) => ({ x, y })));
    void edit([
      { op: "add-element", id, kind, parent, name: `New ${kind}` },
      { op: "show-in-view", view: view.id, id },
      { op: "set-layout", view: view.id, positions: { ...existing, [id]: [spot.x, spot.y] } },
    ]).then((ok) => ok && onSelect({ kind: "element", id }, { isNew: true }));
  };

  const addSticky = () => {
    const rect = wrapper.current!.getBoundingClientRect();
    const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const id = newStickyId(view);
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - STICKY_W / 2, y: center.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [spot.x, spot.y] }]).then((ok) => {
      if (!ok) return;
      onSelect({ kind: "sticky", id });
      setEditing(id);
    });
  };

  const [menuOpen, setMenuOpen] = useState(false);

  if (scopeErrors.length) {
    return <div className="canvas-message">This view can't be drawn: {scopeErrors[0]!.message}</div>;
  }

  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow<FlowNode, ArrowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnectStart={onConnectStart}
        onClickConnectStart={onConnectStart}
        onConnect={onConnect}
        isValidConnection={(c) => sourceNow(c.source) !== c.target && c.target !== FRAME_ID && c.source !== FRAME_ID}
        onNodeClick={(_, node) => selectNode(node)}
        onNodeContextMenu={(event, node) => {
          if (node.type !== "element" && node.type !== "frame") return;
          event.preventDefault();
          onElementMenu(node.type === "frame" ? node.data.element.id : node.id, menuPoint(event));
        }}
        // Dragging a box swallows its click, so select it when the drag starts; otherwise the
        // layout saved on drop redraws the boxes with the old selection.
        onNodeDragStart={(_, node) => selectNode(node)}
        // A click that wobbles a few pixels is still a click, not nothing.
        nodeClickDistance={4}
        onEdgeClick={(_, edge) => onSelect({ kind: "arrow", from: edge.source, to: edge.target })}
        onPaneClick={() => {
          setMenuOpen(false);
          onSelect(null);
        }}
        connectionMode={ConnectionMode.Loose}
        // The arrow being drawn stays over everything, as React Flow means it to, even a selected note.
        connectionLineContainerStyle={{ zIndex: STICKY_Z + SELECTED_LIFT + 1 }}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        minZoom={0.1}
        colorMode="system"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="toolbar">
          <div className="toolbar-title">
            <strong>{view.title}</strong>
            <span>
              {view.level} view{view.scope ? ` of ${ws.elements.get(view.scope)?.name ?? view.scope}` : ""}
            </span>
          </div>
          <div className="menu">
            <button className="primary" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
              + Add
            </button>
            {menuOpen && (
              <div className="menu-items" role="menu">
                {addableKinds(ws, view).map((k) => (
                  <button
                    key={`${k.kind}-${k.parent ?? ""}`}
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      add(k.kind, k.parent);
                    }}
                  >
                    {k.label}
                  </button>
                ))}
                <hr />
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    addSticky();
                  }}
                >
                  Sticky note
                </button>
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
    </div>
  );
}
