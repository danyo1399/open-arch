/**
 * A state view's diagram: its states as rounded boxes, the transitions between them as arrows
 * labelled `event [guard] / action`, a dot pointing into the state it starts in, and a bullseye
 * out of each state it can end in. Drag a state to move it, or from the dot under one to another
 * to add a transition. Select a transition and drag the dot at either end to another state to
 * move it. The element the states are of, if the view says, is the frame.
 */
import { kindLabel, transitionLabel, type ComputedView, type Operation, type State, type Sticky, type Transition, type ViewDef, type ViewEdge, type Workspace } from "@open-arch/core";
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
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import { uniqueStateId } from "../model.js";
import { MenuButton, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { elkLayout, freeSpotAmong, layOut, newStickySpace, placeMissing, placeStickies, rowGap, STICKY, STICKY_MIN, stickiesBackOps, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { AutoLayoutButton, DRAWING_Z, fitBelowToolbar, noteRect, spotOf, STICKY_Z, useAutoLayout, type AutoLayout, type Selection } from "./Canvas.js";
import { useDiagramMenu, type MenuHost } from "./DiagramMenu.js";
import { diagramItems, moveItems, stickyItems, withDelete, type MenuEdits } from "./menuItems.js";
import { FrameNode, FrameNotes, NotesOpener, StickyNode, stickyNodeSize, stickyResizeOp, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import type { Rect } from "./stickyLines.js";
import { EndGrips, measureLabelSizes, MovingArrow, movingLine, pathThrough, type ArrowData, type ArrowEnd } from "./RoutedEdge.js";
import { boxUnder, layoutArrows, type Box } from "./routing.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";
import { loopsRise, selfLoop, STATE_W, stateHeight } from "./stateLayout.js";

type StateNodeData = { state: State; initial: boolean };
type StateFlowNode = Node<StateNodeData, "state">;
type FlowNode = StateFlowNode | StickyFlowNode | FrameFlowNode;

type TransitionEdgeData = {
  transition: Transition;
  /** The route, between two states; or for a transition back to its own state, where its loop starts and ends. */
  points: readonly Readonly<Point>[];
  /** The loop beside its state, for a transition back to it. */
  loop?: string;
  /** Where the label's centre goes, and how wide it can be. */
  label?: Point & { maxWidth?: number };
  onSelect(): void;
} & Pick<ArrowData, "onEndDrag" | "onEndDrop" | "moving">;
type TransitionEdge = Edge<TransitionEdgeData, "transition">;

const FRAME_ID = "__frame";
const FRAME_PAD = { x: 60, top: 64, bottom: 48 };
const stickyNodeId = (id: string) => `sticky:${id}`;
const transitionId = (t: Transition) => `transition:${t.number}`;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";
/** States and notes snap as they're dragged, and line up with each other. The frame grows round the states, so it's neither. */
const snapsHere = (n: FlowNode) => n.type !== "frame";

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

/**
 * A transition, along its route or round its loop, with its label. Selected, it has a grip at each
 * end, to drag that end to another state; while one is dragged, the diagram draws the transition
 * instead.
 */
function TransitionArrow({ id, data, markerEnd, selected }: EdgeProps<TransitionEdge>) {
  if (!data || data.points.length < 2) return null;
  const text = transitionLabel(data.transition);
  const path = data.loop ?? pathThrough(data.points);
  return (
    <>
      {!data.moving && <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`arrow${selected ? " selected" : ""}`} interactionWidth={18} />}
      {selected && <EndGrips points={data.points} moving={data.moving} onEndDrag={data.onEndDrag} onEndDrop={data.onEndDrop} names={{ line: "transition", box: "state" }} />}
      {text && data.label && !data.moving && (
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
  /** What the right-click menus need from the designer. */
  menus: MenuHost;
  /** A problem drawing the diagram, to tell the person about. */
  onError(text: string): void;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
  /** What states and notes snap to as they're dragged, and its buttons. */
  snap: SnapControl;
  /** Given the diagram's Auto layout, for the top bar's More menu on a narrow screen. */
  autoLayoutHandle?: RefObject<AutoLayout | null>;
}

/**
 * The edit Auto layout makes on a state view, as one step for Undo: every state where ELK put it,
 * `positions`, and the sticky notes back beside the diagram. It's made from the workspace as it is
 * when it's applied, so a state deleted or renamed while ELK worked is left out of it.
 */
export function autoLayoutStateOps(ws: Workspace, viewId: string, positions: Record<string, Point>): Operation[] {
  const view = ws.views.get(viewId);
  if (view?.level !== "state") return [];
  return [
    ...view.states.flatMap((s): Operation[] => {
      const p = positions[s.id];
      return p ? [{ op: "update-state", view: viewId, id: s.id, at: [Math.round(p.x), Math.round(p.y)] }] : [];
    }),
    ...stickiesBackOps(view),
  ];
}

/**
 * The edit that moves a transition's start or end, `end`, to another state, as its event, guard,
 * action and number stay. None when it's at that state already. Let go on the state at its other
 * end, it becomes a transition back to that state.
 */
export function reconnectTransitionOps(view: Pick<ViewDef, "id" | "states">, transition: Transition, end: ArrowEnd, state: string): Operation[] | null {
  if (state === transition[end] || !view.states.some((s) => s.id === state)) return null;
  return [{ op: "update-transition", view: view.id, transition: transition.number, [end]: state }];
}

/** "note", or "note-2", "note-3", ... whichever the view doesn't have yet. */
function newStickyId(stickies: Sticky[]): string {
  const taken = new Set(stickies.map((s) => s.id));
  if (!taken.has("note")) return "note";
  for (let i = 2; ; i++) if (!taken.has(`note-${i}`)) return `note-${i}`;
}

export function StateDiagram({ computed: cv, selection, onSelect, edit, menus, onError, exportItems, snap, autoLayoutHandle }: StateDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, TransitionEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => view.states.map((s) => s.id), [view]);
  const saved = useMemo<Record<string, Point>>(() => Object.fromEntries(view.states.flatMap((s) => (s.at ? [[s.id, { x: s.at[0], y: s.at[1] }]] : []))), [view]);
  const between = useMemo(() => view.transitions.filter((t) => t.from !== t.to && ids.includes(t.from) && ids.includes(t.to)), [view, ids]);
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  /** The states for ELK to lay out, each as tall as it's drawn, in `drawn` by its ID, once it has been. */
  const layoutStates = useCallback((drawn: ReadonlyMap<string, number> = new Map()) => view.states.map((s) => ({ id: s.id, inside: false, height: drawn.get(s.id) ?? stateHeight(s) })), [view]);

  // Labels are sized as arrows' labels are, from the same styles.
  const sizes = useMemo(() => {
    const labelled = between.filter((t) => transitionLabel(t));
    const pseudo = labelled.map((t): ViewEdge => ({ from: t.from, to: t.to, description: transitionLabel(t), kind: "association", implied: true, bidirectional: false, sources: [] }));
    const measured = measureLabelSizes(pseudo);
    return new Map(labelled.map((t, k) => [transitionId(t), measured[k]!] as const));
  }, [between]);
  /** The transitions for ELK to lay out, each with its label's size at its widest, so the states are put far enough apart for the labels. */
  const arrows = useMemo(() => between.map((t) => ({ from: t.from, to: t.to, label: sizes.get(transitionId(t))?.[0] })), [between, sizes]);
  const graphKey = `${view.id}|${ids.join(",")}|${between.map((t) => `${t.from}>${t.to}`).join(",")}|${rowGap(arrows)}`;

  // States without a position are laid out by ELK, as boxes are.
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void layOut(layoutStates(), arrows).then(({ positions, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the new states automatically, so they're in rows for now. Reload the page to try again.");
      setAuto({ key: graphKey, positions });
    });
    return () => {
      cancelled = true;
    };
    // The graph key captures everything ELK looks at: the labels only change how far apart it puts the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, missing]);

  const ready = !missing || auto?.key === graphKey;
  const positions = useMemo(() => (ready ? placeMissing(ids, saved, auto?.key === graphKey ? auto.positions : {}) : null), [ready, ids, saved, auto, graphKey]);
  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;
  /** Gives a note the corner and size its resizer was let go at: set below, once the snap is known. */
  const resizeNote = useRef<(sticky: Sticky, box: Rect, moved: boolean) => void>(() => {});

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
          ...stickyNodeSize(sticky),
          position: stickyAt[sticky.id]!,
          data: { sticky, editing: editing === sticky.id, onEdit: () => setEditing(sticky.id), onDone: (text) => finishEditing(sticky, text), onResize: (box: Rect, moved: boolean) => resizeNote.current(sticky, box, moved) },
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

  /** The frame's size as React Flow last measured it. */
  const frameMeasured = useRef<FrameFlowNode["measured"]>(undefined);

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
      // A frame without `measured` makes React Flow start watching its size again, and when
      // that happens inside a resize callback the browser reports a resize loop.
      measured: frameMeasured.current,
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

  const { routes, labels } = useMemo(() => {
    const notes = nodes.filter((n) => n.type === "sticky").map((n) => noteRect(n as StickyFlowNode, stickySize));
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

  /** A selected transition's start or end being dragged to another state: the transition's number, which end, and where it is on the diagram. */
  const [moving, setMoving] = useState<{ number: number; end: ArrowEnd; at: Point } | null>(null);
  const movingTransition = moving?.number;
  const movingEnd = moving?.end;
  /** The state a transition's end let go at this point goes to, if it can go there (see reconnectTransitionOps). Not one under a note, which hides it. */
  const endDropAt = (transition: Transition, end: ArrowEnd, at: Point) => {
    const notes = nodesRef.current.flatMap((n) => (n.type === "sticky" ? [noteRect(n, stickySize)] : []));
    const state = boxUnder(at, boxes, notes);
    const ops = state && reconnectTransitionOps(view, transition, end, state);
    return ops ? { state: state!, ops } : undefined;
  };
  const movingTransitionOf = moving ? view.transitions[moving.number - 1] : undefined;
  /** The state the end being dragged would go to, outlined while it's over it. */
  const endDrop = moving && movingTransitionOf ? endDropAt(movingTransitionOf, moving.end, moving.at)?.state : undefined;
  /** Moves the end of a transition let go on another state there, as one step for Undo, with the states where they are: set each time it's drawn. */
  const dropEnd = useRef<(transition: Transition, end: ArrowEnd, at: Point | null) => void>(() => {});

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
      const handlers = {
        onSelect: () => select({ kind: "transition", number: t.number }),
        onEndDrag: (end: ArrowEnd, at: Point) => setMoving({ number: t.number, end, at }),
        onEndDrop: (end: ArrowEnd, at: Point | null) => dropEnd.current(t, end, at),
        moving: movingTransition === t.number ? movingEnd : undefined,
      };
      if (t.from === t.to) {
        const k = loops.get(t.from) ?? 0;
        loops.set(t.from, k + 1);
        const loop = selfLoop(box, k);
        return [{ ...common, data: { transition: t, points: [loop.start, loop.end], loop: loop.path, label: loop.label, ...handlers } }];
      }
      return [{ ...common, data: { transition: t, points: routes.get(id) ?? [], label: labels.get(id), ...handlers } }];
    });
  }, [view, boxes, routes, labels, selection, select, movingTransition, movingEnd]);
  /** The transition whose end is being dragged, drawn straight from its other end to where the moving end is. */
  const movingTransitionLine = moving && movingLine(edges.find((e) => e.data?.transition.number === moving.number)?.data?.points, moving.end, moving.at);

  // The state a transition's end would go to is outlined while the end is over it.
  const drawn = useMemo(() => {
    const shown = endDrop ? nodes.map((n) => (n.id === endDrop ? { ...n, className: "drop-target" } : n)) : nodes;
    return frame ? [frame, ...shown] : shown;
  }, [frame, nodes, endDrop]);

  /** Positions for the states placed automatically, so they stay put as others move or transitions are added. */
  const fixPlaced = useCallback((): Operation[] => {
    return nodesRef.current.flatMap((n) => (n.type === "state" && !n.data.state.at ? [{ op: "update-state" as const, view: view.id, id: n.id, at: [Math.round(n.position.x), Math.round(n.position.y)] as [number, number] }] : []));
  }, [view.id]);

  const { snapChanges, dropped, resized, guides } = useSnap<FlowNode>(snap.settings, { snaps: snapsHere, isTarget: snapsHere, minSize: STICKY_MIN });
  // As it's drawn: snapped, as it was when it was let go.
  resizeNote.current = (sticky, box, moved) => void edit([stickyResizeOp(view.id, sticky, resized(stickyNodeId(sticky.id), box), moved)]);

  const onNodesChange = useCallback(
    (made: NodeChange<FlowNode>[]) => {
      const changes = snapChanges(made);
      for (const c of changes) if (c.type === "dimensions" && c.id === FRAME_ID && c.dimensions) frameMeasured.current = c.dimensions;
      setNodes((nds) => applyNodeChanges(changes.filter((c) => !("id" in c) || c.id !== FRAME_ID), nds));
    },
    [snapChanges],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, letGo: FlowNode[]) => {
      const dragged = dropped(letGo);
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
    [edit, view.id, fixPlaced, dropped],
  );

  dropEnd.current = (transition, end, at) => {
    setMoving(null);
    const drop = at && endDropAt(transition, end, at);
    if (drop) void edit([...fixPlaced(), ...drop.ops]);
  };

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

  /** A new state goes in the middle of the canvas, or from a right-click menu, where that was. */
  const addState = (at?: Point) => {
    const center = at ?? middle();
    const id = uniqueStateId(view, "new-state");
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => spotOf(n, stickySize));
    const spot = freeSpotAmong({ x: center.x - STATE_W / 2, y: center.y - 30 }, occupied);
    // The first state is where the view starts.
    const first = view.states.length === 0;
    void edit([...fixPlaced(), { op: "add-state", view: view.id, id, name: "New state", at: [spot.x, spot.y], initial: first || undefined }]).then(
      (ok) => ok && onSelect({ kind: "state", id }, { isNew: true }),
    );
  };

  /** A new note goes in the middle of the canvas, or from a right-click menu, where that was. */
  const addSticky = (at?: Point) => {
    const center = at ?? middle();
    const id = newStickyId(view.stickies);
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => spotOf(n, stickySize));
    const spot = freeSpotAmong({ x: center.x - stickySize.width / 2, y: center.y - 50 }, occupied, newStickySpace(stickySize));
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

  // Auto layout places every state as ELK would on a new view, but at the height each is drawn.
  const autoLayout = useAutoLayout(
    async () => {
      const drawn = new Map(nodesRef.current.flatMap((n) => (n.type === "state" && n.measured?.height ? [[n.id, n.measured.height] as const] : [])));
      const positions = await elkLayout(layoutStates(drawn), arrows);
      return (ws: Workspace) => autoLayoutStateOps(ws, view.id, positions);
    },
    edit,
    onError,
    () => fitDiagram(),
    autoLayoutHandle,
  );

  // Fit the diagram to the window once, after its states have been measured.
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [ready, fitDiagram]);

  /** What + Add adds, and the background's menu, which puts it where the click was, `at`. */
  const addItems = (at?: Point): MenuItem[] => [
    { label: "State", onSelect: () => addState(at) },
    { label: "Sticky note", divider: true, onSelect: () => addSticky(at) },
  ];

  const notes = useContext(NotesOpener);
  const edits: MenuEdits = { edit, select };

  // Each item does what it does in the toolbar or the details, which have them all too.
  const stateMenu = (state: State): MenuItem[] => {
    const set = (fields: Omit<Extract<Operation, { op: "update-state" }>, "op" | "view" | "id">) => () => void edit([{ op: "update-state", view: view.id, id: state.id, ...fields }]);
    const addTransition = (to: string) => () => {
      const number = view.transitions.length + 1;
      void edit([{ op: "add-transition", view: view.id, from: state.id, to }]).then((ok) => ok && select({ kind: "transition", number }));
    };
    const starts = view.initial === state.id;
    return withDelete(
      edits,
      [
        // A state can go back to itself.
        { label: "Add transition to", items: view.states.map((s) => ({ label: s.id === state.id ? `${s.name} (itself)` : s.name, onSelect: addTransition(s.id) })) },
        { label: starts ? "It doesn't start here" : "It starts here", onSelect: set({ initial: !starts }) },
        { label: state.final ? "It can't end here" : "It can end here", onSelect: set({ final: !state.final }) },
        ...(state.at ? [{ label: "Lay out again", onSelect: set({ at: null }) }] : []),
      ],
      "Delete state",
      { op: "remove-state", view: view.id, id: state.id },
    );
  };

  const transitionMenu = (transition: Transition): MenuItem[] => {
    const update = (fields: Omit<Extract<Operation, { op: "update-transition" }>, "op" | "view" | "transition">) => edit([{ op: "update-transition", view: view.id, transition: transition.number, ...fields }]);
    const ends = (end: "from" | "to") => view.states.filter((s) => s.id !== transition[end]).map((s) => ({ label: s.name, onSelect: () => void update({ [end]: s.id }) }));
    const [from, to] = [ends("from"), ends("to")];
    return withDelete(
      edits,
      [
        ...(from.length ? [{ label: "Change from", items: from }] : []),
        ...(to.length ? [{ label: "Change to", items: to }] : []),
        ...moveItems("transition", transition.number, view.transitions.length, (to) => void update({ newTransition: to }).then((ok) => ok && select({ kind: "transition", number: to }))),
      ],
      "Delete transition",
      { op: "remove-transition", view: view.id, transition: transition.number },
    );
  };

  /**
   * The right-click menus: for a state, a transition or a sticky note, which the click selects,
   * and for the diagram, after a click on the background or the frame. See useDiagramMenu for
   * how one opens and closes.
   */
  const menu = useDiagramMenu({
    view,
    selection,
    select,
    host: menus,
    toDiagram: (point) => rf.screenToFlowPosition(point),
    items: (on, at) => {
      if (on.kind === "diagram") return diagramItems(addItems(at), view.states.length > 0 ? autoLayout.run : undefined, exportItems);
      const state = on.kind === "state" && view.states.find((s) => s.id === on.id);
      if (state) return stateMenu(state);
      const transition = on.kind === "transition" && view.transitions[on.number - 1];
      if (transition) return transitionMenu(transition);
      const sticky = on.kind === "sticky" && view.stickies.find((s) => s.id === on.id);
      if (!sticky) return [];
      return stickyItems(edits, view.id, sticky, { editText: () => setEditing(sticky.id), openNotes: notes ? () => notes.sticky(sticky.id) : undefined, back: "Move beside the diagram" });
    },
  });

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
        onNodeContextMenu={(event, node) => {
          if (node.type === "state") menu.open(event, { kind: "state", id: node.id });
          else if (node.type === "sticky") menu.open(event, { kind: "sticky", id: node.data.sticky.id });
        }}
        // A transition's label is drawn apart from its line, but a right-click on it comes here too.
        onEdgeContextMenu={(event, edge) => edge.data && menu.open(event, { kind: "transition", number: edge.data.transition.number })}
        // The frame takes no clicks, so a right-click on it is one on the background.
        onPaneContextMenu={(event) => menu.open(event, null)}
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
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <FrameNotes frame={frame} />
        <SnapGuides guides={guides} />
        {movingTransitionLine && moving && <MovingArrow line={movingTransitionLine} end={moving.end} zIndex={DRAWING_Z} />}
        <Controls showInteractive={false} onFitView={() => fitDiagram({ padding: 0.1 })}>
          <SnapButtons snap={snap} />
        </Controls>
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
          <MenuButton className="primary" items={addItems()}>
            + Add
          </MenuButton>
          <AutoLayoutButton layout={autoLayout} empty={view.states.length === 0} />
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
      {menu.menu}
    </div>
  );
}
