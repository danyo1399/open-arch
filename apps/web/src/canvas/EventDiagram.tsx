/**
 * An event view's diagram: a row for each lane, and the cards left to right in their order along
 * the timeline, each in its lane and in the colour event storming gives its kind, with an arrow
 * to each card from the cards it comes from. Drag a card along the timeline or to another lane
 * to move it, or from the dot beside one to another to add an arrow. Nothing is placed by hand,
 * so only sticky notes keep a position.
 */
import { CARD_KIND_LABELS, CARD_KINDS, cardArrows, type Card, type CardArrow, type CardKind, type ComputedView, type Lane, type Operation, type Sticky } from "@open-arch/core";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
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
import { uniqueAmong } from "../model.js";
import { MenuButton, type MenuAction, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { freeSpotAmong, NODE_W, placeStickies, STICKY, stickyHeight, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { fitBelowToolbar, STICKY_Z, type Selection } from "./Canvas.js";
import { dropOps, eventLayout, EVT } from "./eventLayout.js";
import { StickyNode, type StickyFlowNode } from "./nodes.js";
import { pathThrough } from "./RoutedEdge.js";
import { layoutArrows, type Box } from "./routing.js";

/** A row: a lane, or the row for the cards in no lane, which has none. */
type LaneNodeData = { lane?: Lane; width: number; height: number; selected: boolean };
type LaneFlowNode = Node<LaneNodeData, "lane">;
type CardNodeData = { card: Card };
type CardFlowNode = Node<CardNodeData, "card">;
type FlowNode = LaneFlowNode | CardFlowNode | StickyFlowNode;

type CardArrowData = { arrow: CardArrow; points: readonly Readonly<Point>[] };
type CardArrowEdge = Edge<CardArrowData, "cardArrow">;

/** Card IDs have no colon, so none can be a lane's or a note's node. */
const laneNodeId = (id: string | undefined) => (id === undefined ? "lane:" : `lane:${id}`);
const stickyNodeId = (id: string) => `sticky:${id}`;
const arrowId = (a: CardArrow) => `${a.from}->${a.to}`;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";

/** A lane: its name at the left of its row. The row for cards in no lane says so, when there are lanes too. */
function LaneNode({ data }: NodeProps<LaneFlowNode>) {
  const { lane } = data;
  return (
    <div className={`event-lane${lane ? "" : " loose"}${data.selected ? " selected" : ""}`} style={{ width: data.width, height: data.height }} title={lane?.description}>
      <div className="event-lane-name" style={{ width: EVT.headWidth }}>
        {lane ? lane.name : "No lane"}
      </div>
    </div>
  );
}

/** One card: its kind, its name and its description, on paper of its kind's colour. */
function CardNode({ id, data, selected }: NodeProps<CardFlowNode>) {
  const { card } = data;
  const connection = useConnection();
  // While someone drags a new arrow, the whole card is a drop target.
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  return (
    <div className={`event-card event-card-${card.kind}${selected ? " selected" : ""}`} title={card.description ? `${card.name}\n${card.description}` : card.name}>
      <Handle type="target" position={Position.Left} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      {/* The text is cut off at the card's edge. The dot to drag an arrow from sits half outside it, so it's outside this. */}
      <div className="event-card-text">
        <div className="event-card-kind">{CARD_KIND_LABELS[card.kind]}</div>
        <div className="event-card-name">{card.name}</div>
        {card.description && <div className="event-card-desc">{card.description}</div>}
      </div>
      <Handle type="source" position={Position.Right} className="handle-source" title="Drag to another card to add an arrow to it" />
    </div>
  );
}

function CardArrowPath({ id, data, markerEnd, selected }: EdgeProps<CardArrowEdge>) {
  if (!data || data.points.length < 2) return null;
  return <BaseEdge id={id} path={pathThrough(data.points)} markerEnd={markerEnd} className={`arrow${selected ? " selected" : ""}`} interactionWidth={18} />;
}

const nodeTypes = { lane: LaneNode, card: CardNode, sticky: StickyNode };
const edgeTypes = { cardArrow: CardArrowPath };

/** "note", or "note-2", "note-3", ... whichever the view doesn't have yet. */
function newStickyId(stickies: Sticky[]): string {
  return uniqueAmong(stickies.map((s) => s.id), "note");
}

/**
 * The edit that draws an arrow from one card to another: the card it goes to comes from the other
 * too. None from a card to itself, or where there's an arrow already.
 */
export function cardConnectOps(view: ComputedView["view"], source: string, target: string): Operation[] {
  const to = view.cards.find((c) => c.id === target);
  if (!to || source === target || to.from.includes(source) || !view.cards.some((c) => c.id === source)) return [];
  return [{ op: "update-card", view: view.id, id: to.id, from: [...to.from, source] }];
}

/**
 * The edit that adds a card of this kind: after the selected card and in its lane, or in the
 * selected lane, or else at the end, in the lane of the last card.
 */
export function addCardOp(view: ComputedView["view"], kind: CardKind, selection: Selection): Extract<Operation, { op: "add-card" }> {
  const after = selection?.kind === "card" ? view.cards.find((c) => c.id === selection.id) : undefined;
  const inLane = selection?.kind === "lane" ? view.lanes.find((l) => l.id === selection.id)?.id : undefined;
  const lane = inLane ?? (after ?? view.cards.at(-1))?.lane;
  const id = uniqueAmong(view.cards.map((c) => c.id), `new-${kind}`);
  return { op: "add-card", view: view.id, id, kind, name: `New ${CARD_KIND_LABELS[kind].toLowerCase()}`, ...(lane !== undefined && view.lanes.some((l) => l.id === lane) && { lane }), ...(after && { position: after.number + 1 }) };
}

interface EventDiagramProps {
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
}

export function EventDiagram({ computed: cv, selection, onSelect, edit, exportItems }: EventDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, CardArrowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;
  const layout = useMemo(() => eventLayout(view), [view]);
  const arrows = useMemo(() => cardArrows(view), [view]);

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

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** Counts the cards dropped back where they were, each of which is drawn in its place again. */
  const [putBack, setPutBack] = useState(0);

  useEffect(() => {
    // Notes go to the right of the diagram, unless they've been placed.
    const stickyAt = placeStickies(view.stickies, [{ x: layout.width - NODE_W, y: 0 }], stickySize);
    // A view with no lanes has one row, for its cards, which needs no frame.
    const rows = view.lanes.length ? layout.rows : [];
    setNodes((previous) => {
      // Each keeps what React Flow measured of it. Given a node without `measured`, React Flow starts
      // watching its size again, and when that happens inside a resize callback the browser reports
      // a resize loop.
      const measured = (id: string) => previous.find((p) => p.id === id)?.measured;
      return [
        ...rows.map(
          (row): LaneFlowNode => ({
            id: laneNodeId(row.lane?.id),
            type: "lane",
            position: { x: row.box.x, y: row.box.y },
            data: { lane: row.lane, width: row.box.w, height: row.box.h, selected: !!row.lane && selection?.kind === "lane" && selection.id === row.lane.id },
            width: row.box.w,
            height: row.box.h,
            measured: measured(laneNodeId(row.lane?.id)),
            draggable: false,
            selectable: false,
            connectable: false,
            zIndex: -1,
          }),
        ),
        ...view.cards.map((card): CardFlowNode => {
          const box = layout.cards.get(card.id)!;
          return { id: card.id, type: "card", position: { x: box.x, y: box.y }, data: { card }, selected: selection?.kind === "card" && selection.id === card.id, measured: measured(card.id) };
        }),
        ...view.stickies.map(
          (sticky): StickyFlowNode => ({
            id: stickyNodeId(sticky.id),
            type: "sticky",
            position: stickyAt[sticky.id]!,
            data: { sticky, editing: editing === sticky.id, onEdit: () => setEditing(sticky.id), onDone: (text) => finishEditing(sticky, text) },
            selected: selection?.kind === "sticky" && selection.id === sticky.id,
            measured: measured(stickyNodeId(sticky.id)),
            connectable: false,
            zIndex: STICKY_Z,
          }),
        ),
      ];
    });
  }, [layout, view, selection, editing, finishEditing, stickySize, putBack]);

  // Arrows go round the cards as laid out, not as dragged: a card that's dropped moves to its new place, or back.
  const routes = useMemo(() => {
    const notes = nodes.flatMap((n): Box[] => (n.type === "sticky" ? [{ x: n.position.x, y: n.position.y, w: n.measured?.width ?? stickySize.width, h: n.measured?.height ?? stickyHeight(n.data.sticky.text, stickySize) }] : []));
    return layoutArrows(layout.cards, arrows.map((a) => ({ id: arrowId(a), from: a.from, to: a.to })), new Map(), { notes }).routes;
  }, [layout, arrows, nodes, stickySize]);

  const select = useCallback((s: Selection) => onSelect(s), [onSelect]);

  const edges = useMemo<CardArrowEdge[]>(
    () =>
      arrows.map((a) => ({
        id: arrowId(a),
        type: "cardArrow",
        source: a.from,
        target: a.to,
        selected: selection?.kind === "cardArrow" && selection.from === a.from && selection.to === a.to,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
        data: { arrow: a, points: routes.get(arrowId(a)) ?? [] },
      })),
    [arrows, routes, selection],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const ops = dragged.flatMap((n): Operation[] => {
        if (n.type === "sticky") return [{ op: "update-sticky", view: view.id, id: n.data.sticky.id, at: [Math.round(n.position.x), Math.round(n.position.y)] }];
        if (n.type !== "card") return [];
        return dropOps(view, layout, n.data.card, { x: n.position.x + EVT.cardWidth / 2, y: n.position.y + EVT.cardHeight / 2 });
      });
      // A card that stays where it was, or whose move is refused, goes back to its place.
      if (ops.length) void edit(ops).then((ok) => ok || setPutBack((n) => n + 1));
      else setPutBack((n) => n + 1);
    },
    [edit, view, layout],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const ops = cardConnectOps(view, c.source, c.target);
      if (ops.length) void edit(ops).then((ok) => ok && select({ kind: "cardArrow", from: c.source, to: c.target }));
    },
    [view, edit, select],
  );

  const clickNode = (node: FlowNode) => {
    if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
    else if (node.type === "card") select({ kind: "card", id: node.id });
    else select(node.data.lane ? { kind: "lane", id: node.data.lane.id } : null);
  };

  const addCard = (kind: CardKind) => {
    const op = addCardOp(view, kind, selection);
    void edit([op]).then((ok) => ok && onSelect({ kind: "card", id: op.id }, { isNew: true }));
  };

  const addLane = () => {
    const id = uniqueAmong(view.lanes.map((l) => l.id), "new-lane");
    void edit([{ op: "add-lane", view: view.id, id, name: "New lane" }]).then((ok) => ok && onSelect({ kind: "lane", id }, { isNew: true }));
  };

  const addSticky = () => {
    const rect = wrapper.current!.getBoundingClientRect();
    const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const id = newStickyId(view.stickies);
    const occupied = nodesRef.current.filter((n) => n.type !== "lane").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - stickySize.width / 2, y: center.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [spot.x, spot.y] }]).then((ok) => {
      if (!ok) return;
      select({ kind: "sticky", id });
      setEditing(id);
    });
  };

  const addItems: MenuAction[] = [
    ...CARD_KINDS.map((kind) => ({ label: CARD_KIND_LABELS[kind], onSelect: () => addCard(kind) })),
    { label: "Lane", divider: true, onSelect: addLane },
    { label: "Sticky note", onSelect: addSticky },
  ];

  const fitDiagram = useCallback(
    (options: { padding: number; maxZoom?: number } = FIT) => {
      const canvas = wrapper.current;
      const toolbar = canvas?.querySelector(".toolbar");
      if (!canvas || !toolbar) return void rf.fitView(options);
      void rf.fitView(fitBelowToolbar(options, canvas.clientHeight, toolbar.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top));
    },
    [rf],
  );

  // Fit the diagram to the window once, after it's first drawn.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [fitDiagram]);

  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow<FlowNode, CardArrowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => cardConnectOps(view, c.source, c.target).length > 0}
        onNodeClick={(_, node) => clickNode(node)}
        onNodeDragStart={(_, node) => node.type !== "lane" && clickNode(node)}
        onEdgeClick={(_, edge) => edge.data && select({ kind: "cardArrow", from: edge.data.arrow.from, to: edge.data.arrow.to })}
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
            <span>event view</span>
            {view.description && (
              <span className="toolbar-description" title={view.description}>
                {view.description}
              </span>
            )}
          </div>
          <MenuButton className="primary" items={addItems}>
            + Add
          </MenuButton>
          {exportItems.length > 0 && (
            <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
              Export
            </MenuButton>
          )}
        </Panel>
      </ReactFlow>
      {view.cards.length === 0 && view.lanes.length === 0 && (
        <div className="empty-hint">
          This view has no cards yet. Use <strong>+ Add</strong> to add an event or a command, and a lane to put them in. Drag from the dot beside a card to another to add an arrow.
        </div>
      )}
    </div>
  );
}
