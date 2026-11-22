/**
 * A flowchart view's diagram: its blocks, each in its kind's shape (a pill where the process
 * starts and ends, a box for a step, a diamond for a decision, and so on), and the flows between
 * them as arrows, each with its text. Drag a block to move it, or from the dot under one to
 * another to add a flow. The element whose process it is, if the view says, is the frame. A
 * right-click on a block, a flow, a lane, a sticky note or the background opens a menu of what
 * can be done there. A sticky note can be on a block, with a line to it: drag from the dot under
 * a note to a block.
 */
import { BLOCK_KIND_LABELS, BLOCK_KINDS, kindLabel, STICKY_COLORS, type Block, type BlockKind, type ComputedView, type Flow, type Lane, type Operation, type Sticky, type ViewDef, type ViewEdge, type Workspace } from "@open-arch/core";
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
import { blockText, idFromName, newStickyId, uniqueAmong } from "../model.js";
import { MenuButton, type MenuAction, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { elkLayout, freeSpotAmong, layOut, NODE_W, placeMissing, placeStickies, rowGap, STICKY, stickiesBackOps, stickyHeight, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { AutoLayoutButton, DRAWING_Z, fitBelowToolbar, noteRect, STICKY_Z, useAutoLayout, type AutoLayout, type Selection } from "./Canvas.js";
import { blockHeight, blockWidth, dropInLane, LANE, laneColumns, laneOf, outlineToward, placeInLanes, routeToOutlines, savedAt, type LaneColumn } from "./flowchartLayout.js";
import { useDiagramMenu, type MenuHost } from "./DiagramMenu.js";
import { diagramItems, moveItems, noSuchArrow, stickyItems, withDelete, type MenuEdits } from "./menuItems.js";
import { FrameNode, FrameNotes, NotesOpener, StickyLines, StickyLinking, StickyNode, type FrameFlowNode, type StickyFlowNode, type StickyLine } from "./nodes.js";
import { measureLabelSizes, pathThrough } from "./RoutedEdge.js";
import { layoutArrows, type Box } from "./routing.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";
import { stickyLine } from "./stickyLines.js";

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

/**
 * How far right of its block a note on it goes, before it's moved. placeStickies takes every block
 * to be NODE_W wide, so this is far enough for a note beside the narrowest, a start or an end, to
 * count as clear of it.
 */
const BESIDE = 80;

/** Where each note on a block that hasn't been moved goes, by the note's ID: to the right of its block, level with its top. `positions` are the blocks'. */
export function besideBlocks(view: Pick<ViewDef, "blocks" | "stickies">, positions: Record<string, Point>): Record<string, Point> {
  const out: Record<string, Point> = {};
  for (const sticky of view.stickies) {
    const on = sticky.at ? undefined : sticky.on;
    const block = on && "block" in on ? view.blocks.find((b) => b.id === on.block) : undefined;
    const at = block && positions[block.id];
    if (at) out[sticky.id] = { x: at.x + blockWidth(block.kind) + BESIDE, y: at.y };
  }
  return out;
}

/**
 * The block at this point on the diagram, by its ID: the last of `boxes`, which is drawn on top,
 * where blocks overlap. None under a note, which hides the blocks under it.
 */
export function blockUnder(at: Point, boxes: ReadonlyMap<string, Box>, notes: readonly Box[]): string | undefined {
  const within = (r: Box) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h;
  if (notes.some(within)) return undefined;
  return [...boxes].findLast(([, box]) => within(box))?.[0];
}

/**
 * The edit that puts a note on the block its dot was let go on, or none when it's on that block
 * already. The note stays where it's drawn, `drawnAt`, rather than going beside the block, as one
 * the designer placed would.
 */
export function noteOnBlockOps(view: Pick<ViewDef, "id">, sticky: Sticky, block: string, drawnAt: Point): Operation[] {
  if (sticky.on && "block" in sticky.on && sticky.on.block === block) return [];
  return [{ op: "update-sticky", view: view.id, id: sticky.id, on: { block }, ...(!sticky.at && { at: at(drawnAt) }) }];
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

/**
 * Where a new block of this kind goes when it's added at a point on the diagram, from a
 * right-click menu: with its middle there, or in the nearest free spot. In a flowchart with
 * lanes it's in `lane`, the one that was clicked, or else in the lane it lands in.
 */
export function blockPlaceAt(kind: BlockKind, point: Point, { columns, occupied }: Pick<Surroundings, "columns" | "occupied">, lane?: string): { at: [number, number]; lane?: string } {
  const width = blockWidth(kind);
  const spot = freeSpotAmong({ x: point.x - width / 2, y: point.y - blockHeight({ kind, text: newBlockText(kind) }) / 2 }, occupied);
  const column = lane === undefined ? undefined : columns?.find((c) => c.lane?.id === lane);
  if (column) return { at: savedAt(column, spot), lane };
  return columns?.length ? dropInLane(columns, spot, width) : { at: [spot.x, spot.y] };
}

/**
 * Whether the view can have a flow from one block to another with this text, as add-flow and
 * update-flow check: not from a block to itself, and not one it has already, with the same ends
 * and text. `but` is the flow being changed, which doesn't count.
 */
export function canFlow(view: Pick<ViewDef, "flows">, from: string, to: string, text?: string, but?: Flow): boolean {
  return from !== to && noSuchArrow(view.flows, from, to, text, but);
}

interface FlowchartDiagramProps {
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
  /** A note just added from a block's details, to edit in place. */
  editSticky?: string | null;
  /** What blocks and notes snap to as they're dragged, and its buttons. */
  snap: SnapControl;
  /** Given the diagram's Auto layout, for the top bar's More menu on a narrow screen. */
  autoLayoutHandle?: RefObject<AutoLayout | null>;
}

export function FlowchartDiagram({ computed: cv, selection, onSelect, edit, menus, onError, exportItems, editSticky, snap, autoLayoutHandle }: FlowchartDiagramProps) {
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
    if (editSticky) setEditing(editSticky);
  }, [editSticky]);

  /** A note whose dot is being dragged to a block, to put the note on it: the note, and where the dot is on the diagram. */
  const [linking, setLinking] = useState<{ sticky: string; at: Point } | null>(null);
  /** Puts the note on the block its dot was let go on, if any: set below, once the blocks are drawn. */
  const dropLink = useRef<(id: string, at: Point | null) => void>(() => {});

  useEffect(() => {
    if (!positions) return setNodes([]);
    // Notes without a place go beside the block they're on, or else right of everything, the lanes too: a point at the right of the last lane stands for them.
    const lastLane = columns?.at(-1);
    const stickyAt = placeStickies(
      view.stickies,
      [...Object.values(positions), ...(lastLane ? [{ x: lastLane.x + lastLane.w - NODE_W, y: Math.min(0, ...Object.values(positions).map((p) => p.y)) }] : [])],
      stickySize,
      besideBlocks(view, positions),
    );
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
          data: {
            sticky,
            editing: editing === sticky.id,
            onEdit: () => setEditing(sticky.id),
            onDone: (text) => finishEditing(sticky, text),
            onLinkDrag: (at) => setLinking({ sticky: sticky.id, at }),
            onLinkDrop: (at) => dropLink.current(sticky.id, at),
            linkTo: "a block",
          },
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

  // The line from each note on a block to the block's outline, as drawn now. Not a note whose dot
  // is being dragged: it has the line being dragged instead.
  const linkingNote = linking?.sticky;
  const stickyLines = useMemo(
    () =>
      nodes.flatMap((n): StickyLine[] => {
        const on = n.type === "sticky" ? n.data.sticky.on : undefined;
        const block = on && "block" in on ? drawnBlocks.get(on.block) : undefined;
        if (n.type !== "sticky" || !block || n.data.sticky.id === linkingNote) return [];
        const line = stickyLine(noteRect(n, stickySize), { rect: block.box });
        return line ? [{ id: n.data.sticky.id, from: line.from, to: outlineToward(block.kind, block.box, line.from), selected: !!n.selected }] : [];
      }),
    [nodes, drawnBlocks, stickySize, linkingNote],
  );

  /** The block a note's dot let go at this point on the diagram puts the note on. */
  const linkDropAt = (at: Point) =>
    blockUnder(
      at,
      boxes,
      nodesRef.current.flatMap((n) => (n.type === "sticky" ? [noteRect(n, stickySize)] : [])),
    );
  /** The block the note whose dot is being dragged would go on, outlined while the dot is over it. */
  const linkDrop = linking ? linkDropAt(linking.at) : undefined;
  /** The line from a note whose dot is being dragged to where the dot is: none while the dot is over the note. */
  const linkingNode = linking ? nodes.find((n): n is StickyFlowNode => n.id === stickyNodeId(linking.sticky)) : undefined;
  const linkLine = linking && linkingNode ? stickyLine(noteRect(linkingNode, stickySize), { point: linking.at }) : null;

  // A note's dot let go on a block puts the note on it, as one step for Undo, and selects the note
  // (see noteOnBlockOps). Let go on the block it's on already, it just selects the note.
  dropLink.current = (id, at) => {
    setLinking(null);
    const sticky = view.stickies.find((s) => s.id === id);
    const node = nodesRef.current.find((n): n is StickyFlowNode => n.id === stickyNodeId(id));
    const block = at && linkDropAt(at);
    if (!sticky || !node || !block) return;
    const ops = noteOnBlockOps(view, sticky, block, node.position);
    if (!ops.length) return onSelect({ kind: "sticky", id });
    void edit(ops).then((ok) => ok && onSelect({ kind: "sticky", id }));
  };

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

  // The block a note's dot would put the note on is outlined while the dot is over it.
  const drawn = useMemo(
    () => [...(frame ? [frame] : []), ...laneNodes, ...(linkDrop ? nodes.map((n) => (n.id === linkDrop ? { ...n, className: "drop-target" } : n)) : nodes)],
    [frame, laneNodes, nodes, linkDrop],
  );

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

  /**
   * Adds a block of this kind. From + Add it goes after the block selected, or in the lane
   * selected, and from a block's menu, after that block: `after`. From a right-click on a lane
   * or the background, it goes where that was, `at`, in that lane, on its own: after no block, so
   * with no flow to it.
   */
  const addBlock = (kind: BlockKind, where: { after: Selection } | { at: Point; lane?: string }) => {
    const occupied = nodesRef.current.filter((n) => n.type === "block" || n.type === "sticky").map((n) => n.position);
    const after = "after" in where ? where.after : null;
    const place = "at" in where ? blockPlaceAt(kind, where.at, { columns, occupied }, where.lane) : newBlockPlace(view, kind, after, { columns, boxes, top: laneNodes[0]?.position.y ?? 0, head, middle: middle(), occupied });
    const { ops, id } = addBlockOps(view, kind, after, place.at, place.lane);
    void edit([...fixPlaced(), ...ops]).then((ok) => ok && onSelect({ kind: "block", id }, { isNew: true }));
  };

  /** A new lane goes after this one, or else at the right. */
  const addLane = (after?: Lane) => {
    const id = uniqueAmong(view.lanes.map((l) => l.id), "new-lane");
    void edit([...fixPlaced(), { op: "add-lane", view: view.id, id, name: "New lane", ...(after && { position: after.number + 1 }) }]).then((ok) => ok && onSelect({ kind: "lane", id }, { isNew: true }));
  };

  /** A new note goes in the middle of the canvas, or from a right-click menu, where that was. */
  const addSticky = (at?: Point) => {
    const center = at ?? middle();
    const id = newStickyId(view);
    const occupied = nodesRef.current.filter((n) => n.type !== "frame").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - stickySize.width / 2, y: center.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [spot.x, spot.y] }]).then((ok) => {
      if (!ok) return;
      select({ kind: "sticky", id });
      setEditing(id);
    });
  };

  /** A new note on a block, from the block's menu: beside the block, with its text to type. */
  const addStickyOn = (block: Block) => {
    const id = newStickyId(view);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", on: { block: block.id } }]).then((ok) => {
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
  /**
   * What + Add adds, and the right-click menus. From + Add, a block goes after the block selected
   * or in the lane selected, and a lane after the lane selected. From a menu, `clicked` says
   * where it opened: a block or a note goes there, the block in the lane that was clicked, and a
   * lane goes after that lane, or else at the right, whatever is selected.
   */
  const addItems = (clicked?: { at: Point; lane?: Lane }): MenuAction[] => [
    ...kinds.map((kind) => ({ label: BLOCK_KIND_LABELS[kind], onSelect: () => addBlock(kind, clicked ? { at: clicked.at, lane: clicked.lane?.id } : { after: selection }) })),
    { label: "Lane", divider: true, onSelect: () => addLane(clicked ? clicked.lane : selection?.kind === "lane" ? view.lanes.find((l) => l.id === selection.id) : undefined) },
    { label: "Sticky note", onSelect: () => addSticky(clicked?.at) },
  ];

  const notes = useContext(NotesOpener);

  const edits: MenuEdits = { edit, select };

  // Each item does what it does in the toolbar or the details, which have them all too.
  const blockMenu = (block: Block): MenuItem[] => {
    const set = (fields: Omit<Extract<Operation, { op: "update-block" }>, "op" | "view" | "id">) => () => void edit([{ op: "update-block", view: view.id, id: block.id, ...fields }]);
    const addFlow = (to: string) => () => {
      const number = view.flows.length + 1;
      void edit([{ op: "add-flow", view: view.id, from: block.id, to }]).then((ok) => ok && select({ kind: "flow", number }));
    };
    const flowTo = view.blocks.filter((b) => canFlow(view, block.id, b.id));
    // In another lane, its place was in its old one, where it could land on a block in the new one: it's laid out again.
    const lanes: MenuAction[] = [
      ...view.lanes.filter((l) => l.id !== block.lane).map((l) => ({ label: l.name, onSelect: set({ lane: l.id, at: null }) })),
      ...(block.lane !== undefined ? [{ label: "No lane", onSelect: set({ lane: null, at: null }) }] : []),
    ];
    return withDelete(
      edits,
      [
        { label: "Add after", items: kinds.map((kind) => ({ label: BLOCK_KIND_LABELS[kind], onSelect: () => addBlock(kind, { after: { kind: "block", id: block.id } }) })) },
        ...(flowTo.length ? [{ label: "Add flow to", items: flowTo.map((b) => ({ label: blockText(b), onSelect: addFlow(b.id) })) }] : []),
        { label: "Add sticky note", onSelect: () => addStickyOn(block) },
        { label: "Change kind", items: kinds.filter((kind) => kind !== block.kind).map((kind) => ({ label: BLOCK_KIND_LABELS[kind], onSelect: set({ kind }) })) },
        ...(lanes.length ? [{ label: "Move to lane", items: lanes }] : []),
        ...(block.at ? [{ label: "Lay out again", onSelect: set({ at: null }) }] : []),
      ],
      "Delete block",
      { op: "remove-block", view: view.id, id: block.id },
    );
  };

  const flowMenu = (flow: Flow): MenuItem[] => {
    const update = (fields: Omit<Extract<Operation, { op: "update-flow" }>, "op" | "view" | "flow">) => edit([{ op: "update-flow", view: view.id, flow: flow.number, ...fields }]);
    const ends = (end: "from" | "to") =>
      view.blocks
        .filter((b) => b.id !== flow[end] && canFlow(view, end === "from" ? b.id : flow.from, end === "to" ? b.id : flow.to, flow.text, flow))
        .map((b) => ({ label: blockText(b), onSelect: () => void update({ [end]: b.id }) }));
    const [from, to] = [ends("from"), ends("to")];
    return withDelete(
      edits,
      [
        ...(from.length ? [{ label: "Change from", items: from }] : []),
        ...(to.length ? [{ label: "Change to", items: to }] : []),
        ...moveItems("flow", flow.number, view.flows.length, (to) => void update({ newFlow: to }).then((ok) => ok && select({ kind: "flow", number: to }))),
      ],
      "Delete flow",
      { op: "remove-flow", view: view.id, flow: flow.number },
    );
  };

  const laneMenu = (lane: Lane, at: Point): MenuItem[] => {
    const move = (position: number) => () => void edit([{ op: "update-lane", view: view.id, id: lane.id, position }]);
    return withDelete(
      edits,
      [
        { label: "Add", items: addItems({ at, lane }) },
        ...(lane.number > 1 ? [{ label: "Move left", onSelect: move(lane.number - 1) }] : []),
        ...(lane.number < view.lanes.length ? [{ label: "Move right", onSelect: move(lane.number + 1) }] : []),
      ],
      "Delete lane",
      { op: "remove-lane", view: view.id, id: lane.id },
    );
  };

  const stickyMenu = (sticky: Sticky): MenuItem[] => {
    // A note that was moved goes back beside the block it's on, when it's on one the flowchart has, or else beside the diagram.
    const on = sticky.on;
    const onBlock = !!on && "block" in on && view.blocks.some((b) => b.id === on.block);
    return stickyItems(edits, view.id, sticky, {
      editText: () => setEditing(sticky.id),
      openNotes: notes ? () => notes.sticky(sticky.id) : undefined,
      back: onBlock ? "Move next to what it's on" : "Move beside the diagram",
    });
  };

  /** The background's menu: what the toolbar does, with what's added put where the click was. */
  const diagramMenu = (at: Point): MenuItem[] => diagramItems(addItems({ at }), view.blocks.length > 0 ? autoLayout.run : undefined, exportItems);

  /**
   * The right-click menus: for a block, a flow, a lane or a sticky note, which the click selects,
   * and for the diagram, after a click on the background, the frame or the column for blocks in
   * no lane. See useDiagramMenu for how one opens and closes.
   */
  const menu = useDiagramMenu({
    view,
    selection,
    select,
    host: menus,
    toDiagram: (point) => rf.screenToFlowPosition(point),
    items: (on, at) => {
      if (on.kind === "diagram") return diagramMenu(at);
      const block = on.kind === "block" && view.blocks.find((b) => b.id === on.id);
      if (block) return blockMenu(block);
      const flow = on.kind === "flow" && view.flows[on.number - 1];
      if (flow) return flowMenu(flow);
      const lane = on.kind === "lane" && view.lanes.find((l) => l.id === on.id);
      if (lane) return laneMenu(lane, at);
      const sticky = on.kind === "sticky" && view.stickies.find((s) => s.id === on.id);
      return sticky ? stickyMenu(sticky) : [];
    },
  });

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
        onNodeContextMenu={(event, node) => {
          if (node.type === "block") menu.open(event, { kind: "block", id: node.id });
          else if (node.type === "sticky") menu.open(event, { kind: "sticky", id: node.data.sticky.id });
          // The column for blocks in no lane is no lane: it's the diagram's menu there.
          else if (node.type === "lane") menu.open(event, node.data.column.lane ? { kind: "lane", id: node.data.column.lane.id } : null);
        }}
        // A flow's text is drawn apart from its line, but a right-click on it comes here too.
        onEdgeContextMenu={(event, edge) => edge.data && menu.open(event, { kind: "flow", number: edge.data.flow.number })}
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
        <StickyLines lines={stickyLines} />
        {linking && <StickyLinking at={linking.at} line={linkLine} zIndex={DRAWING_Z} />}
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
            items={addItems()}
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
      {menu.menu}
    </div>
  );
}
