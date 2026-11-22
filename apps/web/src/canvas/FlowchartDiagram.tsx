/**
 * A flowchart view's diagram: its blocks, each in its kind's shape (a pill where the process
 * starts and ends, a box for a step, a diamond for a decision, and so on), and the flows between
 * them as arrows, each with its text. Drag a block to move it, or from the dot under one to
 * another to add a flow. The element whose process it is, if the view says, is the frame.
 */
import { BLOCK_KIND_LABELS, BLOCK_KINDS, kindLabel, type Block, type BlockKind, type ComputedView, type Flow, type Operation, type Sticky, type ViewDef, type ViewEdge, type Workspace } from "@open-arch/core";
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
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import { idFromName, newStickyId, uniqueAmong } from "../model.js";
import { MenuButton, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { elkLayout, freeSpotAmong, layOut, NODE_W, placeMissing, placeStickies, rowGap, STICKY, stickiesBackOps, stickyHeight, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { AutoLayoutButton, fitBelowToolbar, STICKY_Z, useAutoLayout, type AutoLayout, type Selection } from "./Canvas.js";
import { blockHeight, blockWidth, dropInLane, LANE, laneColumns, laneOf, placeInLanes, routeToOutlines, savedAt, type LaneColumn } from "./flowchartLayout.js";
import { FrameNode, FrameNotes, StickyNode, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import { measureLabelSizes, pathThrough } from "./RoutedEdge.js";
import { layoutArrows, type Box } from "./routing.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";

type BlockNodeData = { block: Block };
type BlockFlowNode = Node<BlockNodeData, "block">;
/** `head` is how tall its name is drawn, and `height` the whole column, its name included. */
type LaneNodeData = { column: LaneColumn; head: number; height: number; selected: boolean };
type LaneFlowNode = Node<LaneNodeData, "lane">;
type FlowNode = BlockFlowNode | StickyFlowNode | FrameFlowNode | LaneFlowNode;

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
/** A lane's column: no block ID has a colon. The column for blocks in no lane has no lane's ID. */
const laneNodeId = (column: LaneColumn) => `lane:${column.lane?.id ?? ""}`;
const isLaneNode = (id: string) => id.startsWith("lane:");
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

/** ELK's positions for blocks, each moved to the middle of the column ELK gives it, which is NODE_W wide. */
export function centredBlocks(blocks: readonly Pick<Block, "id" | "kind">[], positions: Record<string, Point>): Record<string, Point> {
  return Object.fromEntries(
    blocks.flatMap((b) => {
      const p = positions[b.id];
      return p ? [[b.id, { x: Math.round(p.x + (NODE_W - blockWidth(b.kind)) / 2), y: Math.round(p.y) }]] : [];
    }),
  );
}

/**
 * The edit Auto layout makes on a flowchart, as one step for Undo: every block where ELK put it,
 * `auto`, as from centredBlocks, and the sticky notes back beside the diagram. In a flowchart
 * with lanes, each block goes down the middle of its lane, at the height ELK gives it, as on a
 * new flowchart. It's made from the workspace as it is when it's applied, so a block deleted or
 * renamed while ELK worked is left out of it.
 */
export function autoLayoutBlockOps(ws: Workspace, viewId: string, auto: Record<string, Point>): Operation[] {
  const view = ws.views.get(viewId);
  if (view?.level !== "flowchart") return [];
  const blocks = view.blocks.filter((b) => auto[b.id]);
  const at = view.lanes.length ? placeInLanes({ lanes: view.lanes, blocks }, {}, auto) : auto;
  return [...blocks.map((b): Operation => ({ op: "update-block", view: viewId, id: b.id, at: [Math.round(at[b.id]!.x), Math.round(at[b.id]!.y)] })), ...stickiesBackOps(view)];
}

/** Blocks and notes snap as they're dragged, and line up with each other. The frame grows round the blocks, so it's neither. */
const snapsHere = (n: FlowNode) => n.type !== "frame" && n.type !== "lane";

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

/** What a column says at its top: its lane's name, or that its blocks are in no lane. */
const laneName = (column: LaneColumn) => column.lane?.name ?? "No lane";

/**
 * How tall the lanes' names are drawn: as tall as the longest one needs, wrapped to its lane's
 * width, and the same for every lane, so the line under them runs straight across. No less than
 * LANE.head, which fits a name on one line. Each name is measured in a hidden lane with the same
 * styles as a drawn one, all of them together, laying the page out once.
 */
export function laneHead(columns: readonly LaneColumn[]): number {
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position: absolute; visibility: hidden; left: -10000px; top: 0";
  const names = columns.map((column) => {
    const lane = holder.appendChild(document.createElement("div"));
    lane.className = `flow-lane${column.lane ? "" : " loose"}`;
    lane.style.width = `${column.w}px`;
    const name = lane.appendChild(document.createElement("div"));
    name.className = "flow-lane-name";
    name.textContent = laneName(column);
    return name;
  });
  document.body.appendChild(holder);
  try {
    return Math.max(LANE.head, ...names.map((name) => Math.ceil(name.getBoundingClientRect().height)));
  } finally {
    holder.remove();
  }
}

/** A lane: a column with its name at the top, on as many lines as it needs. The column for blocks in no lane says so. */
function LaneNode({ data }: NodeProps<LaneFlowNode>) {
  const { lane } = data.column;
  return (
    <div className={`flow-lane${lane ? "" : " loose"}${data.selected ? " selected" : ""}`} style={{ width: data.column.w, height: data.height }} title={lane?.description}>
      <div className="flow-lane-name" style={{ minHeight: data.head }}>
        {laneName(data.column)}
      </div>
    </div>
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

const nodeTypes = { block: BlockNode, sticky: StickyNode, frame: FrameNode, lane: LaneNode };
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
 * The edit that adds a block of this kind at `at`, in `lane` if it says. After the selected
 * block, it's the next in the list, with a flow to it from the selected one, unless that's an
 * end, where the process stops.
 */
export function addBlockOps(view: ComputedView["view"], kind: BlockKind, selection: Selection, at: [number, number], lane?: string): { ops: Operation[]; id: string } {
  const text = newBlockText(kind);
  // Its ID is made from its text, so it follows the text it's given next.
  const id = uniqueAmong(view.blocks.map((b) => b.id), idFromName(text));
  const after = selection?.kind === "block" ? view.blocks.find((b) => b.id === selection.id) : undefined;
  const ops: Operation[] = [{ op: "add-block", view: view.id, id, kind, text, ...(lane && { lane }), at, ...(after && { position: after.number + 1 }) }];
  if (after && after.kind !== "end") ops.push({ op: "add-flow", view: view.id, from: after.id, to: id });
  return { ops, id };
}

/** A block or a sticky note as the diagram draws it: where it is now, and for a block, whether the file gives it a position, the lane it's drawn in and its width. */
export interface DrawnItem {
  kind: "block" | "sticky";
  id: string;
  position: Point;
  /** True for a block the designer placed, as its file gives it no `at`. */
  placed?: boolean;
  /** A block's lane, in a flowchart with lanes. */
  lane?: string;
  /** A block's width. */
  w?: number;
}

const at = (p: Point): [number, number] => [Math.round(p.x), Math.round(p.y)];

/** Where a block drawn at `d.position` is kept: in a flowchart with lanes, from the inside of its lane's left. */
function keptAt(d: DrawnItem, columns: LaneColumn[] | undefined): [number, number] {
  const column = columns?.find((c) => c.lane?.id === d.lane);
  return column ? savedAt(column, d.position) : at(d.position);
}

/**
 * Positions for the blocks the designer placed, all but `except`, where they're drawn now, so
 * they stay put once a block moves or a flow is added, which would lay them out again. In a
 * flowchart with lanes, `columns` are its lanes, as drawn.
 */
export function pinOps(view: ComputedView["view"], drawn: DrawnItem[], except: ReadonlySet<string> = new Set(), columns?: LaneColumn[]): Operation[] {
  return drawn.flatMap((d): Operation[] => (d.kind === "block" && d.placed && !except.has(d.id) ? [{ op: "update-block", view: view.id, id: d.id, at: keptAt(d, columns) }] : []));
}

/**
 * The edit that keeps blocks and notes where they were dragged to, with the rest of the blocks
 * where they are. In a flowchart with lanes, a block let go of over another lane goes in it.
 */
export function moveOps(view: ComputedView["view"], drawn: DrawnItem[], dragged: DrawnItem[], columns?: LaneColumn[]): Operation[] {
  const moved = new Set(dragged.filter((d) => d.kind === "block").map((d) => d.id));
  return [
    ...pinOps(view, drawn, moved, columns),
    ...dragged.map((d): Operation => {
      if (d.kind === "sticky") return { op: "update-sticky", view: view.id, id: d.id, at: at(d.position) };
      if (!columns?.length) return { op: "update-block", view: view.id, id: d.id, at: at(d.position) };
      const drop = dropInLane(columns, d.position, d.w ?? 0);
      return { op: "update-block", view: view.id, id: d.id, ...(drop.lane !== d.lane && { lane: drop.lane ?? null }), at: drop.at };
    }),
  ];
}

/**
 * The edit that adds a flow dragged from one block to another, with the blocks where they are,
 * and the number the flow gets. None from a block to itself, or to or from what isn't a block.
 */
export function connectOps(view: ComputedView["view"], drawn: DrawnItem[], from: string, to: string, columns?: LaneColumn[]): { ops: Operation[]; number: number } | null {
  const blocks = new Set(view.blocks.map((b) => b.id));
  if (from === to || !blocks.has(from) || !blocks.has(to)) return null;
  return { ops: [...pinOps(view, drawn, new Set(), columns), { op: "add-flow", view: view.id, from, to }], number: view.flows.length + 1 };
}

/** What's on the diagram, as moveOps and connectOps take it. */
function items(view: ViewDef, nodes: FlowNode[]): DrawnItem[] {
  return nodes.flatMap((n): DrawnItem[] =>
    n.type === "block"
      ? [{ kind: "block", id: n.id, position: n.position, placed: !n.data.block.at, lane: laneOf(view, n.data.block), w: blockWidth(n.data.block.kind) }]
      : n.type === "sticky"
        ? [{ kind: "sticky", id: n.data.sticky.id, position: n.position }]
        : [],
  );
}

/** What's on the diagram round a new block: the lanes as drawn, if any, each block's box, the lanes' top and how tall their names are, the middle of the canvas, and where the blocks and notes are. */
export interface Surroundings {
  columns?: LaneColumn[];
  boxes: ReadonlyMap<string, Box>;
  top: number;
  /** Left out where there are no lanes. */
  head?: number;
  middle: Point;
  occupied: Point[];
}

/**
 * Where a new block of this kind goes, in the nearest free spot: under the block selected, in its
 * lane; at the bottom of the lane selected; or else in the middle of the canvas, in the lane
 * there. Its `at` is as the file keeps it, so from the inside of its lane's left in a flowchart
 * with lanes.
 */
export function newBlockPlace(view: ViewDef, kind: BlockKind, selection: Selection, { columns, boxes, top, head = LANE.head, middle, occupied }: Surroundings): { at: [number, number]; lane?: string } {
  const afterBlock = selection?.kind === "block" ? view.blocks.find((b) => b.id === selection.id) : undefined;
  const after = afterBlock && boxes.get(afterBlock.id);
  const lane = selection?.kind === "lane" ? columns?.find((c) => c.lane?.id === selection.id) : undefined;
  const width = blockWidth(kind);
  const inLane = lane ? view.blocks.filter((b) => laneOf(view, b) === lane.lane?.id).flatMap((b) => boxes.get(b.id) ?? []) : [];
  const start = after
    ? { x: after.x + (after.w - width) / 2, y: after.y + after.h + BELOW }
    : lane
      ? { x: lane.x + LANE.pad + Math.max(0, LANE.centre - width / 2), y: inLane.length ? Math.max(...inLane.map((b) => b.y + b.h)) + BELOW : top + head + LANE.pad }
      : { x: middle.x - width / 2, y: middle.y - 30 };
  const spot = freeSpotAmong(start, occupied);
  if (!columns?.length) return { at: [spot.x, spot.y] };
  // After a block it's in that block's lane, and in a lane selected, that one; else in the one it lands in.
  const column = afterBlock ? columns.find((c) => c.lane?.id === laneOf(view, afterBlock)) : lane;
  return column ? { at: savedAt(column, spot), lane: column.lane?.id } : dropInLane(columns, spot, width);
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
  /** Given the diagram's Auto layout, for the top bar's More menu on a narrow screen. */
  autoLayoutHandle?: RefObject<AutoLayout | null>;
}

export function FlowchartDiagram({ computed: cv, selection, onSelect, edit, onError, exportItems, snap, autoLayoutHandle }: FlowchartDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, FlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => view.blocks.map((b) => b.id), [view]);
  const saved = useMemo<Record<string, Point>>(() => Object.fromEntries(view.blocks.flatMap((b) => (b.at ? [[b.id, { x: b.at[0], y: b.at[1] }]] : []))), [view]);
  /** The flows that are drawn: between two blocks of the view, and not from one to itself. */
  const between = useMemo(() => view.flows.filter((f) => f.from !== f.to && ids.includes(f.from) && ids.includes(f.to)), [view, ids]);
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  /** The blocks for ELK to lay out, each as tall as it's drawn, in `drawn` by its ID, once it has been. */
  const layoutBlocks = useCallback((drawn: ReadonlyMap<string, number> = new Map()) => view.blocks.map((b) => ({ id: b.id, inside: false, height: drawn.get(b.id) ?? blockHeight(b) })), [view]);

  // Labels are sized as arrows' labels are, from the same styles.
  const sizes = useMemo(() => {
    const labelled = between.filter((f) => f.text);
    const pseudo = labelled.map((f): ViewEdge => ({ from: f.from, to: f.to, description: f.text, kind: "association", implied: true, bidirectional: false, sources: [] }));
    const measured = measureLabelSizes(pseudo);
    return new Map(labelled.map((f, k) => [flowId(f), measured[k]!] as const));
  }, [between]);
  /** The flows for ELK to lay out, each with its label's size at its widest, so the blocks are put far enough apart for the labels. */
  const arrows = useMemo(() => between.map((f) => ({ from: f.from, to: f.to, label: sizes.get(flowId(f))?.[0] })), [between, sizes]);
  const graphKey = `${view.id}|${view.blocks.map((b) => `${b.id}:${b.kind}`).join(",")}|${between.map((f) => `${f.from}>${f.to}`).join(",")}|${rowGap(arrows)}`;

  // Blocks without a position are laid out by ELK, top to bottom, each in the middle of the column ELK gives it.
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void layOut(layoutBlocks(), arrows, flowchartLayout).then(({ positions, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the new blocks automatically, so they're in rows for now. Reload the page to try again.");
      setAuto({ key: graphKey, positions: centredBlocks(view.blocks, positions) });
    });
    return () => {
      cancelled = true;
    };
    // The graph key captures everything ELK looks at: the labels only change how far apart it puts the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, missing]);

  const ready = !missing || auto?.key === graphKey;
  // With lanes, each is a column, and a block's position is from the left of its lane: see laneColumns.
  const laned = view.lanes.length > 0;
  const lanesAt = useMemo(() => {
    if (!ready || !laned) return null;
    return laneColumns(view, placeInLanes(view, saved, auto?.key === graphKey ? auto.positions : {}));
  }, [ready, laned, view, saved, auto, graphKey]);
  const columns = lanesAt?.columns;
  /** How tall the lanes' names are: more than one line's room when a name is too long for its lane. */
  const head = useMemo(() => (columns ? laneHead(columns) : LANE.head), [columns]);
  const positions = useMemo(
    () => (!ready ? null : lanesAt ? lanesAt.positions : placeMissing(ids, saved, auto?.key === graphKey ? auto.positions : {})),
    [ready, lanesAt, ids, saved, auto, graphKey],
  );
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
    // Notes without a place go right of everything, the lanes too: a point at the right of the last lane stands for them.
    const lastLane = columns?.at(-1);
    const stickyAt = placeStickies(view.stickies, [...Object.values(positions), ...(lastLane ? [{ x: lastLane.x + lastLane.w - NODE_W, y: Math.min(0, ...Object.values(positions).map((p) => p.y)) }] : [])], stickySize);
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
  }, [positions, columns, view, selection, editing, finishEditing, stickySize]);

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

  /** The lanes' sizes as React Flow last measured them, by node ID: see the frame's. */
  const lanesMeasured = useRef(new Map<string, LaneFlowNode["measured"]>());

  // Each lane, as a column behind the blocks, from above the highest of them to below the lowest.
  const laneNodes = useMemo((): LaneFlowNode[] => {
    if (!columns) return [];
    const all = [...boxes.values()];
    const top = all.length ? Math.min(...all.map((b) => b.y)) - head - LANE.pad : 0;
    const bottom = all.length ? Math.max(...all.map((b) => b.y + b.h)) + LANE.pad : head + 200;
    return columns.map((column) => ({
      id: laneNodeId(column),
      type: "lane",
      position: { x: column.x, y: Math.round(top) },
      data: { column, head, height: Math.round(bottom - top), selected: !!column.lane && selection?.kind === "lane" && selection.id === column.lane.id },
      measured: lanesMeasured.current.get(laneNodeId(column)),
      draggable: false,
      connectable: false,
      selectable: false,
      zIndex: -1,
    }));
  }, [columns, head, boxes, selection]);

  /** The frame's size as React Flow last measured it. */
  const frameMeasured = useRef<FrameFlowNode["measured"]>(undefined);

  // The frame round the blocks, and the lanes, for the element whose process they are.
  const frame = useMemo((): FrameFlowNode | null => {
    if (!cv.boundary || boxes.size + laneNodes.length === 0) return null;
    const all = [...boxes.values(), ...laneNodes.map((n) => ({ x: n.position.x, y: n.position.y, w: n.data.column.w, h: n.data.height }))];
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
      zIndex: -2,
      style: { pointerEvents: "none" },
    };
  }, [cv.boundary, boxes, laneNodes]);

  const { routes, labels } = useMemo(() => {
    const notes = nodes.filter((n) => n.type === "sticky").map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? stickySize.width, h: n.measured?.height ?? stickyHeight((n as StickyFlowNode).data.sticky.text, stickySize) }));
    // Arrows cross lanes freely, but keep off their sides, as off a frame's.
    const frames = laneNodes.map((n) => ({ x: n.position.x, y: n.position.y, w: n.data.column.w, h: n.data.height }));
    return layoutArrows(
      boxes,
      between.map((f) => ({ id: flowId(f), from: f.from, to: f.to })),
      sizes,
      { frames, notes, tips: tipsOf(view.blocks) },
    );
  }, [boxes, view, between, sizes, nodes, stickySize, laneNodes]);

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

  const drawn = useMemo(() => [...(frame ? [frame] : []), ...laneNodes, ...nodes], [frame, laneNodes, nodes]);

  /** Positions for the blocks placed automatically, so they stay put as others move or flows are added. */
  const fixPlaced = useCallback((): Operation[] => pinOps(view, items(view, nodesRef.current), new Set(), columns), [view, columns]);

  const { snapChanges, dropped, guides } = useSnap<FlowNode>(snap.settings, { snaps: snapsHere, isTarget: snapsHere });

  const onNodesChange = useCallback(
    (made: NodeChange<FlowNode>[]) => {
      const changes = snapChanges(made);
      for (const c of changes) {
        if (c.type !== "dimensions" || !c.dimensions) continue;
        if (c.id === FRAME_ID) frameMeasured.current = c.dimensions;
        else if (isLaneNode(c.id)) lanesMeasured.current.set(c.id, c.dimensions);
      }
      setNodes((nds) => applyNodeChanges(changes.filter((c) => !("id" in c) || (c.id !== FRAME_ID && !isLaneNode(c.id))), nds));
    },
    [snapChanges],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, letGo: FlowNode[]) => {
      const ops = moveOps(view, items(view, nodesRef.current), items(view, dropped(letGo)), columns);
      if (ops.length) void edit(ops);
    },
    [edit, view, dropped, columns],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const made = connectOps(view, items(view, nodesRef.current), c.source, c.target, columns);
      if (made) void edit(made.ops).then((ok) => ok && select({ kind: "flow", number: made.number }));
    },
    [view, edit, select, columns],
  );

  /** The middle of the canvas, on the diagram. */
  const middle = (): Point => {
    const rect = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const addBlock = (kind: BlockKind) => {
    const occupied = nodesRef.current.filter((n) => n.type === "block" || n.type === "sticky").map((n) => n.position);
    const place = newBlockPlace(view, kind, selection, { columns, boxes, top: laneNodes[0]?.position.y ?? 0, head, middle: middle(), occupied });
    const { ops, id } = addBlockOps(view, kind, selection, place.at, place.lane);
    void edit([...fixPlaced(), ...ops]).then((ok) => ok && onSelect({ kind: "block", id }, { isNew: true }));
  };

  /** A new lane goes after the one selected, or else at the right. */
  const addLane = () => {
    const id = uniqueAmong(view.lanes.map((l) => l.id), "new-lane");
    const after = selection?.kind === "lane" ? view.lanes.find((l) => l.id === selection.id) : undefined;
    void edit([...fixPlaced(), { op: "add-lane", view: view.id, id, name: "New lane", ...(after && { position: after.number + 1 }) }]).then((ok) => ok && onSelect({ kind: "lane", id }, { isNew: true }));
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

  // Auto layout places every block as ELK would on a new flowchart, but at the height each is drawn.
  const autoLayout = useAutoLayout(
    async () => {
      const drawn = new Map(nodesRef.current.flatMap((n) => (n.type === "block" && n.measured?.height ? [[n.id, n.measured.height] as const] : [])));
      const positions = centredBlocks(view.blocks, await flowchartLayout(layoutBlocks(drawn), arrows));
      return (ws: Workspace) => autoLayoutBlockOps(ws, view.id, positions);
    },
    edit,
    onError,
    () => fitDiagram(),
    autoLayoutHandle,
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
  const addItems: MenuItem[] = [
    ...kinds.map((kind) => ({ label: BLOCK_KIND_LABELS[kind], onSelect: () => addBlock(kind) })),
    { label: "Lane", divider: true, onSelect: addLane },
    { label: "Sticky note", onSelect: addSticky },
  ];

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
          else if (node.type === "lane") select(node.data.column.lane ? { kind: "lane", id: node.data.column.lane.id } : null);
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
        <FrameNotes frame={frame} />
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
          <MenuButton
            className="primary"
            items={addItems}
            title={
              selection?.kind === "block"
                ? "Add a block after the one selected, a lane or a sticky note"
                : selection?.kind === "lane"
                  ? "Add a block in the lane selected, a lane after it, or a sticky note"
                  : "Add a block, a lane or a sticky note"
            }
          >
            + Add
          </MenuButton>
          <AutoLayoutButton layout={autoLayout} empty={view.blocks.length === 0} />
          {exportItems.length > 0 && (
            <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
              Export
            </MenuButton>
          )}
        </Panel>
      </ReactFlow>
      {ready && view.blocks.length === 0 && (
        <div className="empty-hint">
          {view.lanes.length ? (
            <>
              This flowchart has lanes but no blocks yet. Select a lane and use <strong>+ Add</strong> to add a block in it, then each step after it, with the step before it selected. Drag from the dot under a block to another to add a flow.
            </>
          ) : (
            <>
              This flowchart has no blocks yet. Use <strong>+ Add</strong> to add a start, then each step after it, with the step before it selected. Drag from the dot under a block to another to add a flow. + Add adds lanes too.
            </>
          )}
        </div>
      )}
    </div>
  );
}
