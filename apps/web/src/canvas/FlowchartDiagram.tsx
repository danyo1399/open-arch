/**
 * A flowchart view's diagram: its blocks, each in its kind's shape (a pill where the process
 * starts and ends, a box for a step, a diamond for a decision, and so on), and the flows between
 * them as arrows, each with its text. Drag a block to move it, or from the dot under one to
 * another to add a flow. The element whose process it is, if the view says, is the frame.
 */
import { BLOCK_KIND_LABELS, BLOCK_KINDS, kindLabel, type Block, type BlockKind, type ComputedView, type Flow, type Operation, type Sticky, type ViewEdge } from "@open-arch/core";
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
import { idFromName, newStickyId, uniqueAmong } from "../model.js";
import { MenuButton, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { elkLayout, freeSpotAmong, layOut, NODE_W, placeMissing, placeStickies, STICKY, stickyHeight, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { fitBelowToolbar, STICKY_Z, type Selection } from "./Canvas.js";
import { blockHeight, blockWidth, routeToOutlines } from "./flowchartLayout.js";
import { FrameNode, StickyNode, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import { measureLabelSizes, pathThrough } from "./RoutedEdge.js";
import { layoutArrows, type Box } from "./routing.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";

type BlockNodeData = { block: Block };
type BlockFlowNode = Node<BlockNodeData, "block">;
type FlowNode = BlockFlowNode | StickyFlowNode | FrameFlowNode;

type FlowEdgeData = {
  flow: Flow;
  /** The route, from the outline of one block to the outline of the next. */
  points: readonly Readonly<Point>[];
  /** Where the label's centre goes, and how wide it can be. */
  label?: Point & { maxWidth?: number };
  onSelect(): void;
};
type FlowEdge = Edge<FlowEdgeData, "flow">;

const FRAME_ID = "__frame";
const FRAME_PAD = { x: 60, top: 64, bottom: 48 };
const stickyNodeId = (id: string) => `sticky:${id}`;
const flowId = (f: Flow) => `flow:${f.number}`;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";
/** How far below a block one added after it goes. */
const BELOW = 70;
/**
 * A flowchart reads from its first block down, so ELK keeps the blocks and flows in the file's
 * order, and an arrow back up, as from "Try again" to an earlier step, is the one turned round
 * to break a loop: the one a walk from the first block finds it's come back along.
 */
const FLOWCHART_ELK = { "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES" };
export const flowchartLayout = (nodes: Parameters<typeof elkLayout>[0], edges: Parameters<typeof elkLayout>[1]) => elkLayout(nodes, edges, FLOWCHART_ELK);

/** Blocks and notes snap as they're dragged, and line up with each other. The frame grows round the blocks, so it's neither. */
const snapsHere = (n: FlowNode) => n.type !== "frame";

/** The outline of each kind that isn't a plain box, drawn behind its text, stretched to the block (see .flow-shape). */
function Outline({ kind }: { kind: BlockKind }) {
  const shape =
    kind === "decision" ? (
      <polygon points="50,0 100,50 50,100 0,50" />
    ) : kind === "input-output" ? (
      // 10 of the 100 is SLANT of the block's 180 pixels.
      <polygon points="10,0 100,0 90,100 0,100" />
    ) : kind === "document" ? (
      <path d="M 0 0 H 100 V 88 C 75 74, 50 100, 25 92 C 14 88, 6 86, 0 88 Z" />
    ) : kind === "database" ? (
      <>
        <path d="M 0 10 A 50 10 0 0 1 100 10 V 90 A 50 10 0 0 1 0 90 Z" />
        <path className="flow-shape-line" d="M 0 10 A 50 10 0 0 0 100 10" />
      </>
    ) : null;
  if (!shape) return null;
  return (
    <svg className="flow-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {shape}
    </svg>
  );
}

/** One block: its text and description, in its kind's shape. */
function BlockNode({ id, data, selected }: NodeProps<BlockFlowNode>) {
  const { block } = data;
  const connection = useConnection();
  // While someone drags a new flow, the whole block is a drop target.
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  return (
    <div className={`flow-block flow-${block.kind}${selected ? " selected" : ""}`} style={{ width: blockWidth(block.kind) }} title={BLOCK_KIND_LABELS[block.kind]}>
      <Handle type="target" position={Position.Top} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      <Outline kind={block.kind} />
      <div className="flow-content">
        <div className="flow-text">{block.text}</div>
        {block.description && <div className="flow-desc">{block.description}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="handle-source" title="Drag to another block to add a flow" />
    </div>
  );
}

/** A flow, along its route, with its text. */
function FlowArrow({ id, data, markerEnd, selected }: EdgeProps<FlowEdge>) {
  if (!data || data.points.length < 2) return null;
  const text = data.flow.text;
  return (
    <>
      <BaseEdge id={id} path={pathThrough(data.points)} markerEnd={markerEnd} className={`arrow${selected ? " selected" : ""}`} interactionWidth={18} />
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

const nodeTypes = { block: BlockNode, sticky: StickyNode, frame: FrameNode };
const edgeTypes = { flow: FlowArrow };

/** The blocks arrows meet only at the four tips of their diamond, the middles of their boxes' sides: the decisions. */
export function tipsOf(blocks: readonly Pick<Block, "id" | "kind">[]): Set<string> {
  return new Set(blocks.filter((b) => b.kind === "decision").map((b) => b.id));
}

/** What a new block of each kind says, until it's given text. */
function newBlockText(kind: BlockKind): string {
  return kind === "start" || kind === "end" ? BLOCK_KIND_LABELS[kind] : `New ${BLOCK_KIND_LABELS[kind].toLowerCase()}`;
}

/**
 * The edit that adds a block of this kind at `at`. After the selected block, it's the next in the
 * list, with a flow to it from the selected one, unless that's an end, where the process stops.
 */
export function addBlockOps(view: ComputedView["view"], kind: BlockKind, selection: Selection, at: [number, number]): { ops: Operation[]; id: string } {
  const text = newBlockText(kind);
  // Its ID is made from its text, so it follows the text it's given next.
  const id = uniqueAmong(view.blocks.map((b) => b.id), idFromName(text));
  const after = selection?.kind === "block" ? view.blocks.find((b) => b.id === selection.id) : undefined;
  const ops: Operation[] = [{ op: "add-block", view: view.id, id, kind, text, at, ...(after && { position: after.number + 1 }) }];
  if (after && after.kind !== "end") ops.push({ op: "add-flow", view: view.id, from: after.id, to: id });
  return { ops, id };
}

/** A block or a sticky note as the diagram draws it: where it is now, and for a block, whether the file gives it a position. */
export interface DrawnItem {
  kind: "block" | "sticky";
  id: string;
  position: Point;
  /** True for a block the designer placed, as its file gives it no `at`. */
  placed?: boolean;
}

const at = (p: Point): [number, number] => [Math.round(p.x), Math.round(p.y)];

/**
 * Positions for the blocks the designer placed, all but `except`, where they're drawn now, so
 * they stay put once a block moves or a flow is added, which would lay them out again.
 */
export function pinOps(view: ComputedView["view"], drawn: DrawnItem[], except: ReadonlySet<string> = new Set()): Operation[] {
  return drawn.flatMap((d): Operation[] => (d.kind === "block" && d.placed && !except.has(d.id) ? [{ op: "update-block", view: view.id, id: d.id, at: at(d.position) }] : []));
}

/** The edit that keeps blocks and notes where they were dragged to, with the rest of the blocks where they are. */
export function moveOps(view: ComputedView["view"], drawn: DrawnItem[], dragged: DrawnItem[]): Operation[] {
  const moved = new Set(dragged.filter((d) => d.kind === "block").map((d) => d.id));
  return [
    ...pinOps(view, drawn, moved),
    ...dragged.map((d): Operation => (d.kind === "block" ? { op: "update-block", view: view.id, id: d.id, at: at(d.position) } : { op: "update-sticky", view: view.id, id: d.id, at: at(d.position) })),
  ];
}

/**
 * The edit that adds a flow dragged from one block to another, with the blocks where they are,
 * and the number the flow gets. None from a block to itself, or to or from what isn't a block.
 */
export function connectOps(view: ComputedView["view"], drawn: DrawnItem[], from: string, to: string): { ops: Operation[]; number: number } | null {
  const blocks = new Set(view.blocks.map((b) => b.id));
  if (from === to || !blocks.has(from) || !blocks.has(to)) return null;
  return { ops: [...pinOps(view, drawn), { op: "add-flow", view: view.id, from, to }], number: view.flows.length + 1 };
}

/** What's on the diagram, as moveOps and connectOps take it. */
function items(nodes: FlowNode[]): DrawnItem[] {
  return nodes.flatMap((n): DrawnItem[] =>
    n.type === "block" ? [{ kind: "block", id: n.id, position: n.position, placed: !n.data.block.at }] : n.type === "sticky" ? [{ kind: "sticky", id: n.data.sticky.id, position: n.position }] : [],
  );
}

interface FlowchartDiagramProps {
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** A problem drawing the diagram, to tell the person about. */
  onError(text: string): void;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
  /** What blocks and notes snap to as they're dragged, and its buttons. */
  snap: SnapControl;
}

export function FlowchartDiagram({ computed: cv, selection, onSelect, edit, onError, exportItems, snap }: FlowchartDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, FlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => view.blocks.map((b) => b.id), [view]);
  const saved = useMemo<Record<string, Point>>(() => Object.fromEntries(view.blocks.flatMap((b) => (b.at ? [[b.id, { x: b.at[0], y: b.at[1] }]] : []))), [view]);
  /** The flows that are drawn: between two blocks of the view, and not from one to itself. */
  const between = useMemo(() => view.flows.filter((f) => f.from !== f.to && ids.includes(f.from) && ids.includes(f.to)), [view, ids]);
  const graphKey = `${view.id}|${view.blocks.map((b) => `${b.id}:${b.kind}`).join(",")}|${between.map((f) => `${f.from}>${f.to}`).join(",")}`;
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  // Blocks without a position are laid out by ELK, top to bottom, each in the middle of the column ELK gives it.
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void layOut(
      view.blocks.map((b) => ({ id: b.id, inside: false, height: blockHeight(b) })),
      between,
      flowchartLayout,
    ).then(({ positions, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the new blocks automatically, so they're in rows for now. Reload the page to try again.");
      const centred = Object.fromEntries(
        view.blocks.flatMap((b) => {
          const p = positions[b.id];
          return p ? [[b.id, { x: Math.round(p.x + (NODE_W - blockWidth(b.kind)) / 2), y: Math.round(p.y) }]] : [];
        }),
      );
      setAuto({ key: graphKey, positions: centred });
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
      ...view.blocks.map(
        (block): BlockFlowNode => ({
          id: block.id,
          type: "block",
          position: positions[block.id]!,
          data: { block },
          selected: selection?.kind === "block" && selection.id === block.id,
          measured: previous.find((p) => p.id === block.id)?.measured,
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

  /** Each block as drawn now, measured once it has been, with its kind. */
  const drawnBlocks = useMemo(() => {
    const out = new Map<string, { kind: BlockKind; box: Box }>();
    for (const n of nodes) {
      if (n.type !== "block") continue;
      const b = n.data.block;
      out.set(n.id, { kind: b.kind, box: { x: n.position.x, y: n.position.y, w: n.measured?.width ?? blockWidth(b.kind), h: n.measured?.height ?? blockHeight(b) } });
    }
    return out;
  }, [nodes]);
  const boxes = useMemo(() => new Map([...drawnBlocks].map(([id, b]) => [id, b.box])), [drawnBlocks]);

  /** The frame's size as React Flow last measured it. */
  const frameMeasured = useRef<FrameFlowNode["measured"]>(undefined);

  // The frame round the blocks, for the element whose process they are.
  const frame = useMemo((): FrameFlowNode | null => {
    if (!cv.boundary || boxes.size === 0) return null;
    const all = [...boxes.values()];
    const left = Math.round(Math.min(...all.map((b) => b.x)) - FRAME_PAD.x);
    const top = Math.round(Math.min(...all.map((b) => b.y)) - FRAME_PAD.top);
    const width = Math.round(Math.max(...all.map((b) => b.x + b.w)) + FRAME_PAD.x) - left;
    const height = Math.round(Math.max(...all.map((b) => b.y + b.h)) + FRAME_PAD.bottom) - top;
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
  }, [cv.boundary, boxes]);

  // Labels are sized as arrows' labels are, from the same styles.
  const sizes = useMemo(() => {
    const labelled = between.filter((f) => f.text);
    const pseudo = labelled.map((f): ViewEdge => ({ from: f.from, to: f.to, description: f.text, kind: "association", implied: true, bidirectional: false, sources: [] }));
    const measured = measureLabelSizes(pseudo);
    return new Map(labelled.map((f, k) => [flowId(f), measured[k]!] as const));
  }, [between]);

  const { routes, labels } = useMemo(() => {
    const notes = nodes.filter((n) => n.type === "sticky").map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? stickySize.width, h: n.measured?.height ?? stickyHeight((n as StickyFlowNode).data.sticky.text, stickySize) }));
    return layoutArrows(
      boxes,
      between.map((f) => ({ id: flowId(f), from: f.from, to: f.to })),
      sizes,
      { notes, tips: tipsOf(view.blocks) },
    );
  }, [boxes, view, between, sizes, nodes, stickySize]);

  const select = useCallback((s: Selection) => onSelect(s), [onSelect]);

  const edges = useMemo<FlowEdge[]>(
    () =>
      between.map((f): FlowEdge => {
        const id = flowId(f);
        const route = routes.get(id);
        return {
          id,
          type: "flow",
          source: f.from,
          target: f.to,
          selected: selection?.kind === "flow" && selection.number === f.number,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
          data: { flow: f, points: route ? routeToOutlines(route, drawnBlocks.get(f.from)!, drawnBlocks.get(f.to)!) : [], label: labels.get(id), onSelect: () => select({ kind: "flow", number: f.number }) },
        };
      }),
    [between, routes, labels, drawnBlocks, selection, select],
  );

  const drawn = useMemo(() => (frame ? [frame, ...nodes] : nodes), [frame, nodes]);

  /** Positions for the blocks placed automatically, so they stay put as others move or flows are added. */
  const fixPlaced = useCallback((): Operation[] => pinOps(view, items(nodesRef.current)), [view]);

  const { snapChanges, dropped, guides } = useSnap<FlowNode>(snap.settings, { snaps: snapsHere, isTarget: snapsHere });

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
      const ops = moveOps(view, items(nodesRef.current), items(dropped(letGo)));
      if (ops.length) void edit(ops);
    },
    [edit, view, dropped],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const made = connectOps(view, items(nodesRef.current), c.source, c.target);
      if (made) void edit(made.ops).then((ok) => ok && select({ kind: "flow", number: made.number }));
    },
    [view, edit, select],
  );

  /** The middle of the canvas, on the diagram. */
  const middle = (): Point => {
    const rect = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  /** A new block goes under the one selected, or else in the middle of the canvas: in the nearest free spot. */
  const addBlock = (kind: BlockKind) => {
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => n.position);
    const after = selection?.kind === "block" ? drawnBlocks.get(selection.id)?.box : undefined;
    const width = blockWidth(kind);
    const start = after ? { x: after.x + (after.w - width) / 2, y: after.y + after.h + BELOW } : { x: middle().x - width / 2, y: middle().y - 30 };
    const spot = freeSpotAmong(start, occupied);
    const { ops, id } = addBlockOps(view, kind, selection, [spot.x, spot.y]);
    void edit([...fixPlaced(), ...ops]).then((ok) => ok && onSelect({ kind: "block", id }, { isNew: true }));
  };

  const addSticky = () => {
    const center = middle();
    const id = newStickyId(view);
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

  // Fit the diagram to the window once, after its blocks have been measured.
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [ready, fitDiagram]);

  // Process first, as most blocks are steps, then the rest in the order they're listed.
  const kinds: BlockKind[] = ["process", ...BLOCK_KINDS.filter((k) => k !== "process")];
  const addItems: MenuItem[] = [...kinds.map((kind) => ({ label: BLOCK_KIND_LABELS[kind], onSelect: () => addBlock(kind) })), { label: "Sticky note", divider: true, onSelect: addSticky }];

  const scope = cv.boundary;
  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={drawn}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target && ids.includes(c.source) && ids.includes(c.target)}
        onNodeClick={(_, node) => {
          if (node.type === "block") select({ kind: "block", id: node.id });
          else if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
        }}
        onNodeDragStart={(_, node) => {
          if (node.type === "block") select({ kind: "block", id: node.id });
          else if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
        }}
        onEdgeClick={(_, edge) => edge.data && select({ kind: "flow", number: edge.data.flow.number })}
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
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <SnapGuides guides={guides} />
        <Controls showInteractive={false} onFitView={() => fitDiagram({ padding: 0.1 })}>
          <SnapButtons snap={snap} />
        </Controls>
        <Panel position="top-left" className="toolbar">
          <div className="toolbar-title">
            <strong>{view.title}</strong>
            <span>flowchart view{scope ? ` of ${scope.name} [${kindLabel(scope)}]` : ""}</span>
            {view.description && (
              <span className="toolbar-description" title={view.description}>
                {view.description}
              </span>
            )}
          </div>
          <MenuButton className="primary" items={addItems} title={selection?.kind === "block" ? "Add a block after the one selected, or a sticky note" : "Add a block or a sticky note"}>
            + Add
          </MenuButton>
          {exportItems.length > 0 && (
            <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
              Export
            </MenuButton>
          )}
        </Panel>
      </ReactFlow>
      {ready && view.blocks.length === 0 && (
        <div className="empty-hint">
          This flowchart has no blocks yet. Use <strong>+ Add</strong> to add a start, then each step after it, with the step before it selected. Drag from the dot under a block to another to add a flow.
        </div>
      )}
    </div>
  );
}
