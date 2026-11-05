/**
 * A state view's diagram: its states as rounded boxes, the transitions between them as arrows
 * labelled `event [guard] / action`, a dot pointing into the state it starts in, and a bullseye
 * out of each state it can end in. Drag a state to move it, or from the dot under one to another
 * to add a transition. The element the states are of, if the view says, is the frame.
 */
import { kindLabel, transitionLabel, type ComputedView, type Operation, type State, type Sticky, type Transition, type ViewEdge } from "@open-arch/core";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
  useConnection,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import { uniqueStateId } from "../model.js";
import { MenuButton, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { freeSpotAmong, layOut, placeMissing, placeStickies, STICKY, stickyHeight, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { fitBelowToolbar, STICKY_Z, type Selection } from "./Canvas.js";
import { FrameNode, StickyNode, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import { measureLabelSizes, pathThrough } from "./RoutedEdge.js";
import { layoutArrows, type Box } from "./routing.js";
import { loopsRise, selfLoop, STATE_W, stateHeight } from "./stateLayout.js";

type StateNodeData = { state: State; initial: boolean };
type StateFlowNode = Node<StateNodeData, "state">;
type FlowNode = StateFlowNode | StickyFlowNode | FrameFlowNode;

type TransitionEdgeData = {
  transition: Transition;
  /** The route, between two states; or for a transition back to its own state, the loop beside it. */
  points: readonly Readonly<Point>[];
  loop?: string;
  /** Where the label's centre goes, and how wide it can be. */
  label?: Point & { maxWidth?: number };
  onSelect(): void;
};
type TransitionEdge = Edge<TransitionEdgeData, "transition">;

const FRAME_ID = "__frame";
const FRAME_PAD = { x: 60, top: 64, bottom: 48 };
const stickyNodeId = (id: string) => `sticky:${id}`;
const transitionId = (t: Transition) => `transition:${t.number}`;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";

/** One state: its name and description, with a start dot when it's where the view starts, and an end when it can end. */
function StateNode({ id, data, selected }: NodeProps<StateFlowNode>) {
  const { state, initial } = data;
  const connection = useConnection();
  // While someone drags a new transition, the whole state is a drop target.
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  return (
    <div className={`state-box${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      {initial && (
        <svg className="state-start" width="46" height="16" viewBox="0 0 46 16" aria-label="Starts here" role="img">
          <circle cx="7" cy="8" r="6" />
          <path d="M 13 8 H 44" />
          <path d="M 38 4 L 44 8 L 38 12 Z" />
        </svg>
      )}
      <div className="state-name">{state.name}</div>
      {state.description && <div className="state-desc">{state.description}</div>}
      {state.final && (
        <svg className="state-end" width="50" height="18" viewBox="0 0 50 18" aria-label="Can end here" role="img">
          <path d="M 0 9 H 32" />
          <path d="M 26 5 L 32 9 L 26 13 Z" />
          <circle className="ring" cx="41" cy="9" r="7" />
          <circle cx="41" cy="9" r="4" />
        </svg>
      )}
      <Handle type="source" position={Position.Bottom} className="handle-source" title="Drag to another state to add a transition" />
    </div>
  );
}

/** A transition, along its route or round its loop, with its label. */
function TransitionArrow({ id, data, markerEnd, selected }: EdgeProps<TransitionEdge>) {
  if (!data || (!data.loop && data.points.length < 2)) return null;
  const text = transitionLabel(data.transition);
  const path = data.loop ?? pathThrough(data.points);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`arrow${selected ? " selected" : ""}`} interactionWidth={18} />
      {text && data.label && (
        <EdgeLabelRenderer>
          <div
            className={`arrow-label nodrag nopan${selected ? " selected" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${data.label.x}px, ${data.label.y}px)`, maxWidth: data.label.maxWidth }}
            onClick={data.onSelect}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { state: StateNode, sticky: StickyNode, frame: FrameNode };
const edgeTypes = { transition: TransitionArrow };

interface StateDiagramProps {
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** A problem drawing the diagram, to tell the person about. */
  onError(text: string): void;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
}

/** "note", or "note-2", "note-3", ... whichever the view doesn't have yet. */
function newStickyId(stickies: Sticky[]): string {
  const taken = new Set(stickies.map((s) => s.id));
  if (!taken.has("note")) return "note";
  for (let i = 2; ; i++) if (!taken.has(`note-${i}`)) return `note-${i}`;
}

export function StateDiagram({ computed: cv, selection, onSelect, edit, onError, exportItems }: StateDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, TransitionEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => view.states.map((s) => s.id), [view]);
  const saved = useMemo<Record<string, Point>>(() => Object.fromEntries(view.states.flatMap((s) => (s.at ? [[s.id, { x: s.at[0], y: s.at[1] }]] : []))), [view]);
  const between = useMemo(() => view.transitions.filter((t) => t.from !== t.to && ids.includes(t.from) && ids.includes(t.to)), [view, ids]);
  const graphKey = `${view.id}|${ids.join(",")}|${between.map((t) => `${t.from}>${t.to}`).join(",")}`;
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  // States without a position are laid out by ELK, as boxes are.
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void layOut(
      view.states.map((s) => ({ id: s.id, inside: false, height: stateHeight(s) })),
      between,
    ).then(({ positions, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the new states automatically, so they're in rows for now. Reload the page to try again.");
      setAuto({ key: graphKey, positions });
    });
    return () => {
      cancelled = true;
    };
    // The graph key captures everything ELK looks at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, missing]);

  const ready = !missing || auto?.key === graphKey;
  const positions = useMemo(() => (ready ? placeMissing(ids, saved, auto?.key === graphKey ? auto.positions : {}) : null), [ready, ids, saved, auto, graphKey]);
  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** The sticky note whose text is being edited in place. */
  const [editing, setEditing] = useState<string | null>(null);
  const finishEditing = useCallback(
    (sticky: Sticky, text: string | null) => {
      setEditing(null);
      if (text === null || !text.trim() || text.trim() === sticky.text) return;
      void edit([{ op: "update-sticky", view: view.id, id: sticky.id, text }]);
    },
    [edit, view.id],
  );

  useEffect(() => {
    if (!positions) return setNodes([]);
    const stickyAt = placeStickies(view.stickies, Object.values(positions), stickySize);
    setNodes((previous) => [
      ...view.states.map(
        (state): StateFlowNode => ({
          id: state.id,
          type: "state",
          position: positions[state.id]!,
          data: { state, initial: state.id === view.initial },
          selected: selection?.kind === "state" && selection.id === state.id,
          measured: previous.find((p) => p.id === state.id)?.measured,
        }),
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
  }, [positions, view, selection, editing, finishEditing, stickySize]);

  /** Each state as drawn now, measured once it has been. */
  const boxes = useMemo(() => {
    const out = new Map<string, Box>();
    for (const n of nodes) if (n.type === "state") out.set(n.id, { x: n.position.x, y: n.position.y, w: n.measured?.width ?? STATE_W, h: n.measured?.height ?? stateHeight(n.data.state) });
    return out;
  }, [nodes]);

  // The frame round the states, for the element they're the states of.
  const frame = useMemo((): FrameFlowNode | null => {
    if (!cv.boundary || boxes.size === 0) return null;
    const all = [...boxes.entries()];
    // Room for each state's loops back to itself, which go up above it.
    const rise = (id: string) => loopsRise(view.transitions.filter((t) => t.from === id && t.to === id).length);
    // And for the start dot, left of its state, and the ends, right of theirs.
    const state = (id: string) => view.states.find((st) => st.id === id);
    const left = Math.round(Math.min(...all.map(([id, b]) => b.x - (id === view.initial ? 48 : 0))) - FRAME_PAD.x);
    const top = Math.round(Math.min(...all.map(([id, b]) => b.y - rise(id))) - FRAME_PAD.top);
    const width = Math.round(Math.max(...all.map(([id, b]) => b.x + b.w + (state(id)?.final ? 52 : 0))) + FRAME_PAD.x) - left;
    const height = Math.round(Math.max(...all.map(([, b]) => b.y + b.h)) + FRAME_PAD.bottom) - top;
    return {
      id: FRAME_ID,
      type: "frame",
      position: { x: left, y: top },
      data: { element: cv.boundary, width, height, selected: false },
      width,
      height,
      draggable: false,
      connectable: false,
      selectable: false,
      zIndex: -1,
      style: { pointerEvents: "none" },
    };
  }, [cv.boundary, boxes, view]);

  // Labels are sized as arrows' labels are, from the same styles.
  const sizes = useMemo(() => {
    const labelled = between.filter((t) => transitionLabel(t));
    const pseudo = labelled.map((t): ViewEdge => ({ from: t.from, to: t.to, description: transitionLabel(t), kind: "association", implied: true, bidirectional: false, sources: [] }));
    const measured = measureLabelSizes(pseudo);
    return new Map(labelled.map((t, k) => [transitionId(t), measured[k]!] as const));
  }, [between]);

  const { routes, labels } = useMemo(() => {
    const notes = nodes.filter((n) => n.type === "sticky").map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? stickySize.width, h: n.measured?.height ?? stickyHeight((n as StickyFlowNode).data.sticky.text, stickySize) }));
    // The start dot and the ends are drawn beside their states (see .state-start and .state-end), and arrows go round them.
    const markers = view.states.flatMap((st) => {
      const b = boxes.get(st.id);
      if (!b) return [];
      return [
        ...(st.id === view.initial ? [{ x: b.x - 48, y: b.y + b.h / 2 - 10, w: 46, h: 20 }] : []),
        ...(st.final ? [{ x: b.x + b.w + 2, y: b.y + b.h / 2 - 11, w: 50, h: 22 }] : []),
      ];
    });
    return layoutArrows(
      boxes,
      between.map((t) => ({ id: transitionId(t), from: t.from, to: t.to })),
      sizes,
      { notes: [...notes, ...markers] },
    );
  }, [boxes, between, sizes, nodes, stickySize, view]);

  const select = useCallback((s: Selection) => onSelect(s), [onSelect]);

  const edges = useMemo<TransitionEdge[]>(() => {
    const loops = new Map<string, number>();
    return view.transitions.flatMap((t): TransitionEdge[] => {
      const box = boxes.get(t.from);
      if (!box || !boxes.has(t.to)) return [];
      const id = transitionId(t);
      const common = {
        id,
        type: "transition" as const,
        source: t.from,
        target: t.to,
        selected: selection?.kind === "transition" && selection.number === t.number,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
      };
      if (t.from === t.to) {
        const k = loops.get(t.from) ?? 0;
        loops.set(t.from, k + 1);
        const loop = selfLoop(box, k);
        return [{ ...common, data: { transition: t, points: [], loop: loop.path, label: loop.label, onSelect: () => select({ kind: "transition", number: t.number }) } }];
      }
      return [{ ...common, data: { transition: t, points: routes.get(id) ?? [], label: labels.get(id), onSelect: () => select({ kind: "transition", number: t.number }) } }];
    });
  }, [view, boxes, routes, labels, selection, select]);

  const drawn = useMemo(() => (frame ? [frame, ...nodes] : nodes), [frame, nodes]);

  /** Positions for the states placed automatically, so they stay put as others move or transitions are added. */
  const fixPlaced = useCallback((): Operation[] => {
    return nodesRef.current.flatMap((n) => (n.type === "state" && !n.data.state.at ? [{ op: "update-state" as const, view: view.id, id: n.id, at: [Math.round(n.position.x), Math.round(n.position.y)] as [number, number] }] : []));
  }, [view.id]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((nds) => applyNodeChanges(changes.filter((c) => !("id" in c) || c.id !== FRAME_ID), nds)), []);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const at = (n: FlowNode): [number, number] => [Math.round(n.position.x), Math.round(n.position.y)];
      const moved = new Set(dragged.map((n) => n.id));
      const ops: Operation[] = [
        ...fixPlaced().filter((op) => op.op === "update-state" && !moved.has(op.id)),
        ...dragged.flatMap((n): Operation[] =>
          n.type === "state" ? [{ op: "update-state", view: view.id, id: n.id, at: at(n) }] : n.type === "sticky" ? [{ op: "update-sticky", view: view.id, id: n.data.sticky.id, at: at(n) }] : [],
        ),
      ];
      if (ops.length) void edit(ops);
    },
    [edit, view.id, fixPlaced],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!ids.includes(c.source) || !ids.includes(c.target)) return;
      const number = view.transitions.length + 1;
      void edit([...fixPlaced(), { op: "add-transition", view: view.id, from: c.source, to: c.target }]).then((ok) => ok && select({ kind: "transition", number }));
    },
    [ids, view, edit, fixPlaced, select],
  );

  /** The middle of the canvas, on the diagram. */
  const middle = (): Point => {
    const rect = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const addState = () => {
    const center = middle();
    const id = uniqueStateId(view, "new-state");
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - STATE_W / 2, y: center.y - 30 }, occupied);
    // The first state is where the view starts.
    const first = view.states.length === 0;
    void edit([...fixPlaced(), { op: "add-state", view: view.id, id, name: "New state", at: [spot.x, spot.y], initial: first || undefined }]).then(
      (ok) => ok && onSelect({ kind: "state", id }, { isNew: true }),
    );
  };

  const addSticky = () => {
    const center = middle();
    const id = newStickyId(view.stickies);
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - stickySize.width / 2, y: center.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [spot.x, spot.y] }]).then((ok) => {
      if (!ok) return;
      select({ kind: "sticky", id });
      setEditing(id);
    });
  };

  const fitDiagram = useCallback(
    (options: { padding: number; maxZoom?: number } = FIT) => {
      const canvas = wrapper.current;
      const toolbar = canvas?.querySelector(".toolbar");
      if (!canvas || !toolbar) return void rf.fitView(options);
      void rf.fitView(fitBelowToolbar(options, canvas.clientHeight, toolbar.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top));
    },
    [rf],
  );

  // Fit the diagram to the window once, after its states have been measured.
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [ready, fitDiagram]);

  const scope = cv.boundary;
  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow<FlowNode, TransitionEdge>
        nodes={drawn}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target && ids.includes(c.source) && ids.includes(c.target)}
        onNodeClick={(_, node) => {
          if (node.type === "state") select({ kind: "state", id: node.id });
          else if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
        }}
        onNodeDragStart={(_, node) => {
          if (node.type === "state") select({ kind: "state", id: node.id });
          else if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
        }}
        onEdgeClick={(_, edge) => edge.data && select({ kind: "transition", number: edge.data.transition.number })}
        onPaneClick={() => select(null)}
        nodeClickDistance={4}
        paneClickDistance={4}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panOnScroll
        minZoom={0.1}
        colorMode="system"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} onFitView={() => fitDiagram({ padding: 0.1 })} />
        <Panel position="top-left" className="toolbar">
          <div className="toolbar-title">
            <strong>{view.title}</strong>
            <span>state view{scope ? ` of ${scope.name} [${kindLabel(scope)}]` : ""}</span>
            {view.description && (
              <span className="toolbar-description" title={view.description}>
                {view.description}
              </span>
            )}
          </div>
          <MenuButton
            className="primary"
            items={[
              { label: "State", onSelect: addState },
              { label: "Sticky note", divider: true, onSelect: addSticky },
            ]}
          >
            + Add
          </MenuButton>
          {exportItems.length > 0 && (
            <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
              Export
            </MenuButton>
          )}
        </Panel>
      </ReactFlow>
      {ready && view.states.length === 0 && (
        <div className="empty-hint">
          This view has no states yet. Use <strong>+ Add</strong> to create one, then drag from the dot under a state to another to add a transition.
        </div>
      )}
    </div>
  );
}
