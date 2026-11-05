/**
 * A deployment view's diagram: its nodes as frames, nested, round the containers and systems they
 * run; infrastructure, and nodes that hold nothing, as boxes in their shape; and the arrows between
 * them. It's laid out automatically, so nothing but sticky notes moves. Drag from the dot under a
 * box or a node to another to add an arrow: between two containers, that's a relationship in the
 * model; to or from a node, a connection of this view.
 */
import { kindLabel, nodeKindLabel, type ComputedView, type DeploymentArrow, type DeploymentNode, type Operation, type Sticky, type ViewEdge, type Workspace } from "@open-arch/core";
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
import { uniqueNodeId } from "../model.js";
import { MenuButton, type MenuAction, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { freeSpotAmong, NODE_W, placeStickies, STICKY, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { fitBelowToolbar, STICKY_Z, type Selection } from "./Canvas.js";
import { holdsAnything, layOutDeployment, placeDeploymentLabels, type DeploymentLayout } from "./deploymentLayout.js";
import { StickyNode, type StickyFlowNode } from "./nodes.js";
import { labelLines, measureLabelSizes, pathThrough } from "./RoutedEdge.js";

/** A node that holds something, drawn as a frame round it. `depth` is how many nodes it's inside. */
type FrameData = { node: DeploymentNode; width: number; height: number; selected: boolean; depth: number };
type FrameFlowNode = Node<FrameData, "deploymentFrame">;
/** A frame's name, kind and technology: drawn above the arrows, as an arrow's label is, so an arrow into the frame passes under it. */
type FrameLabelData = { node: DeploymentNode; maxWidth: number; selected: boolean };
type FrameLabelFlowNode = Node<FrameLabelData, "deploymentLabel">;
/** A box: a container or system running in a node, or a node that holds nothing, such as infrastructure. */
type BoxData = { node: DeploymentNode; element?: ComputedView["nodes"][number]; width: number; height: number; selected: boolean };
type BoxFlowNode = Node<BoxData, "deploymentBox">;
type FlowNode = FrameFlowNode | FrameLabelFlowNode | BoxFlowNode | StickyFlowNode;

type ArrowData = { arrow: DeploymentArrow; points: Point[]; label?: Point; onSelect(): void };
type DeploymentEdge = Edge<ArrowData, "deploymentArrow">;

const stickyNodeId = (id: string) => `sticky:${id}`;
/** Node and element IDs have no colon, so neither can be a label's. */
const labelNodeId = (id: string) => `label:${id}`;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";
/** Frames go under the arrows, the deepest on top, so a click on a frame inside another selects it. */
const frameZ = (depth: number) => -100 + depth;

/** The dot to drag a new arrow from, and while one is dragged, the whole box or frame to drop it on. */
function Handles({ id }: { id: string }) {
  const connection = useConnection();
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  return (
    <>
      <Handle type="target" position={Position.Top} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      <Handle type="source" position={Position.Bottom} className="handle-source" title="Drag to another box or node to add an arrow" />
    </>
  );
}

/** A node's name, then its kind and technology, and how many copies run. */
function NodeTitle({ node }: { node: DeploymentNode }) {
  return (
    <>
      <div className="c4-name">
        {node.name}
        {node.instances > 1 && <span className="deployment-copies"> ×{node.instances}</span>}
      </div>
      <div className="c4-kind">
        [{nodeKindLabel(node)}
        {node.technology ? `: ${node.technology}` : ""}]
      </div>
    </>
  );
}

function FrameNode({ id, data }: NodeProps<FrameFlowNode>) {
  const { node } = data;
  return (
    <div
      className={`deployment-frame${node.instances > 1 ? " copies" : ""}${data.selected ? " selected" : ""}`}
      style={{ width: data.width, height: data.height }}
      title={node.description}
    >
      <Handles id={id} />
    </div>
  );
}

function FrameLabel({ data }: NodeProps<FrameLabelFlowNode>) {
  return (
    <div className={`deployment-frame-label${data.selected ? " selected" : ""}`} style={{ maxWidth: data.maxWidth }}>
      <NodeTitle node={data.node} />
    </div>
  );
}

function BoxNode({ id, data }: NodeProps<BoxFlowNode>) {
  const { node, element } = data;
  const shape = element ? element.shape : node.shape;
  const classes = ["c4", element ? `c4-${element.external ? "external" : element.kind}` : "c4-node", shape !== "box" ? `c4-shape-${shape}` : "", !element && node.instances > 1 ? "copies" : "", data.selected ? "selected" : ""];
  return (
    <div className={classes.filter(Boolean).join(" ")} style={{ height: data.height }}>
      {element ? (
        <>
          <div className="c4-name">{element.name}</div>
          <div className="c4-kind">
            [{kindLabel(element)}
            {element.technology ? `: ${element.technology}` : ""}]
          </div>
          {element.description && <div className="c4-desc">{element.description}</div>}
        </>
      ) : (
        <>
          <NodeTitle node={node} />
          {node.description && <div className="c4-desc">{node.description}</div>}
        </>
      )}
      <Handles id={id} />
    </div>
  );
}

function Arrow({ id, data, markerStart, markerEnd, selected }: EdgeProps<DeploymentEdge>) {
  if (!data || data.points.length < 2) return null;
  const lines = labelLines({ description: data.arrow.description, technology: data.arrow.technology, implied: false });
  return (
    <>
      <BaseEdge id={id} path={pathThrough(data.points)} markerStart={markerStart} markerEnd={markerEnd} className={`arrow${data.arrow.connection ? " connection" : ""}${selected ? " selected" : ""}`} interactionWidth={18} />
      {lines.length > 0 && data.label && (
        <EdgeLabelRenderer>
          <div className={`arrow-label nodrag nopan${selected ? " selected" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${data.label.x}px, ${data.label.y}px)` }} onClick={data.onSelect}>
            {lines.map((line, k) => (
              <div key={k} className={line.className}>
                {line.text}
              </div>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { deploymentFrame: FrameNode, deploymentLabel: FrameLabel, deploymentBox: BoxNode, sticky: StickyNode };
const edgeTypes = { deploymentArrow: Arrow };

/** "note", or "note-2", "note-3", ... whichever the view doesn't have yet. */
function newStickyId(stickies: Sticky[]): string {
  const taken = new Set(stickies.map((s) => s.id));
  if (!taken.has("note")) return "note";
  for (let i = 2; ; i++) if (!taken.has(`note-${i}`)) return `note-${i}`;
}

/** What a box or frame stands for, from its ID: a node of the view, or an element running in one. */
export function boxEnd(id: string): { node: string; element?: string } {
  const at = id.indexOf("/");
  return at < 0 ? { node: id } : { node: id.slice(0, at), element: id.slice(at + 1) };
}

/**
 * The edit that draws an arrow from one box or frame to another: a relationship in the model
 * between two elements, or else a connection of the view, whose ends are nodes or elements. None
 * from an element to itself.
 */
export function deploymentConnectOps(view: string, source: string, target: string): Operation[] {
  const [from, to] = [boxEnd(source), boxEnd(target)];
  if (from.element && to.element) return from.element === to.element ? [] : [{ op: "add-relationship", from: from.element, to: to.element }];
  return [{ op: "add-connection", view, from: from.element ?? from.node, to: to.element ?? to.node }];
}

/** Whether an arrow is part of what's selected: itself, or a box or node at one of its ends. */
export function arrowSelected(arrow: DeploymentArrow, selection: Selection): boolean {
  if (selection?.kind === "connection") return arrow.connection?.number === selection.number;
  if (selection?.kind === "arrow" && arrow.edge) {
    const { from, to, bidirectional } = arrow.edge;
    return (from === selection.from && to === selection.to) || (bidirectional && from === selection.to && to === selection.from);
  }
  return false;
}

interface DeploymentDiagramProps {
  ws: Workspace;
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** A problem drawing the diagram, to tell the person about. */
  onError(text: string): void;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
}

export function DeploymentDiagram({ ws, computed: cv, selection, onSelect, edit, onError, exportItems }: DeploymentDiagramProps) {
  const view = cv.view;
  const d = cv.deployment!;
  const rf = useReactFlow<FlowNode, DeploymentEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;

  // Labels are sized as arrows' labels are, from the same styles, at their widest.
  const labels = useMemo(() => {
    const labelled = d.arrows.filter((a) => a.description || a.technology);
    const pseudo = labelled.map((a): ViewEdge => ({ from: a.from, to: a.to, description: a.description, technology: a.technology, kind: "association", implied: false, bidirectional: false, sources: [] }));
    const measured = measureLabelSizes(pseudo);
    return new Map(labelled.flatMap((a, k) => (measured[k]![0] ? [[a.id, measured[k]![0]] as const] : [])));
  }, [d]);

  // Laid out again whenever what's drawn changes: everything ELK looks at is in the key.
  const graphKey = JSON.stringify([
    d.nodes.map((n) => [n.id, n.parent, n.name, n.technology, n.description, n.instances]),
    d.instances.map((i) => [i.id, i.element.name, i.element.description]),
    d.arrows.map((a) => [a.id, a.from, a.to, labels.get(a.id)]),
  ]);
  const [layout, setLayout] = useState<{ key: string; layout: DeploymentLayout } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void layOutDeployment(d, labels).then(({ layout, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the diagram automatically, so its boxes are in rows for now. Reload the page to try again.");
      setLayout({ key: graphKey, layout });
    });
    return () => {
      cancelled = true;
    };
    // The graph key captures everything ELK looks at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);
  const ready = layout?.key === graphKey;
  // While a new layout is worked out, the last one is drawn, so the diagram doesn't flash empty.
  const drawnLayout = layout?.layout;

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

  useEffect(() => {
    if (!drawnLayout) return setNodes([]);
    const depth = (n: DeploymentNode): number => (n.parent ? 1 + depth(d.nodes.find((p) => p.id === n.parent)!) : 0);
    const isSelected = (id: string, element?: string) =>
      selection?.kind === "node" ? selection.id === id && !element : selection?.kind === "instance" ? `${selection.node}/${selection.element}` === id : selection?.kind === "element" ? !!element && selection.id === element : false;
    const out: FlowNode[] = [];
    for (const node of d.nodes) {
      const box = drawnLayout.boxes.get(node.id);
      if (!box) continue;
      const position = { x: box.x, y: box.y };
      if (holdsAnything(d, node)) {
        const selected = isSelected(node.id);
        out.push({ id: node.id, type: "deploymentFrame", position, data: { node, width: box.w, height: box.h, selected, depth: depth(node) }, width: box.w, height: box.h, draggable: false, selectable: false, zIndex: frameZ(depth(node)) });
        out.push({ id: labelNodeId(node.id), type: "deploymentLabel", position: { x: box.x + 10, y: box.y + 6 }, data: { node, maxWidth: box.w - 20, selected }, draggable: false, selectable: false, connectable: false });
      } else {
        out.push({ id: node.id, type: "deploymentBox", position, data: { node, width: box.w, height: box.h, selected: isSelected(node.id) }, width: box.w, height: box.h, draggable: false, selectable: false });
      }
    }
    for (const instance of d.instances) {
      const box = drawnLayout.boxes.get(instance.id);
      const node = d.nodes.find((n) => n.id === instance.node);
      if (!box || !node) continue;
      out.push({
        id: instance.id,
        type: "deploymentBox",
        position: { x: box.x, y: box.y },
        data: { node, element: instance.element, width: box.w, height: box.h, selected: isSelected(instance.id, instance.element.id) },
        width: box.w,
        height: box.h,
        draggable: false,
        selectable: false,
      });
    }
    // Notes go to the right of the diagram, unless they've been placed.
    const all = [...drawnLayout.boxes.values()];
    const corner = all.length ? [{ x: Math.max(...all.map((b) => b.x + b.w)) - NODE_W, y: Math.min(...all.map((b) => b.y)) }] : [];
    const stickyAt = placeStickies(view.stickies, corner, stickySize);
    setNodes((previous) => [
      // Each keeps what React Flow measured of it. Given a node without `measured`, React Flow starts
      // watching its size again, and when that happens inside a resize callback the browser reports
      // a resize loop.
      ...out.map((n) => ({ ...n, measured: previous.find((p) => p.id === n.id)?.measured })),
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
  }, [drawnLayout, d, view, selection, editing, finishEditing, stickySize]);

  const select = useCallback((s: Selection) => onSelect(s), [onSelect]);
  const selectArrow = useCallback(
    (a: DeploymentArrow) => select(a.connection ? { kind: "connection", number: a.connection.number } : { kind: "arrow", from: a.edge!.from, to: a.edge!.to }),
    [select],
  );

  const labelAt = useMemo(() => (drawnLayout ? placeDeploymentLabels(d, drawnLayout, labels) : new Map<string, Point>()), [d, drawnLayout, labels]);

  const edges = useMemo<DeploymentEdge[]>(() => {
    if (!drawnLayout) return [];
    const head = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" };
    return d.arrows.flatMap((a): DeploymentEdge[] => {
      const points = drawnLayout.arrows.get(a.id);
      if (!points) return [];
      return [
        {
          id: a.id,
          type: "deploymentArrow",
          source: a.from,
          target: a.to,
          selected: arrowSelected(a, selection),
          markerEnd: head,
          // React Flow turns a start marker round, so it points back at the box it starts from.
          ...(a.bidirectional && { markerStart: head }),
          data: { arrow: a, points, label: labelAt.get(a.id), onSelect: () => selectArrow(a) },
        },
      ];
    });
  }, [drawnLayout, d, selection, selectArrow, labelAt]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const ops = dragged.flatMap((n): Operation[] => (n.type === "sticky" ? [{ op: "update-sticky", view: view.id, id: n.data.sticky.id, at: [Math.round(n.position.x), Math.round(n.position.y)] }] : []));
      if (ops.length) void edit(ops);
    },
    [edit, view.id],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const ops = deploymentConnectOps(view.id, c.source, c.target);
      const add = ops[0];
      if (!add) return;
      const number = view.connections.length + 1;
      void edit(ops).then((ok) => {
        if (!ok) return;
        if (add.op === "add-relationship") select({ kind: "arrow", from: add.from, to: add.to });
        else select({ kind: "connection", number });
      });
    },
    [view, edit, select],
  );

  const clickNode = (node: FlowNode) => {
    if (node.type === "sticky") return select({ kind: "sticky", id: node.data.sticky.id });
    if (node.type === "deploymentLabel") return select({ kind: "node", id: node.data.node.id });
    const { node: id, element } = boxEnd(node.id);
    select(element ? { kind: "instance", node: id, element } : { kind: "node", id });
  };

  /** The node new ones go inside: the selected node, unless it's infrastructure, which holds none. */
  const holder = selection?.kind === "node" ? d.nodes.find((n) => n.id === selection.id && !n.infrastructure) : undefined;
  const addNode = (infrastructure: boolean) => {
    const id = uniqueNodeId(ws, view, infrastructure ? "new-infrastructure" : "new-node");
    void edit([{ op: "add-node", view: view.id, id, name: infrastructure ? "New infrastructure" : "New node", parent: holder?.id, infrastructure: infrastructure || undefined }]).then(
      (ok) => ok && onSelect({ kind: "node", id }, { isNew: true }),
    );
  };

  const addSticky = () => {
    const rect = wrapper.current!.getBoundingClientRect();
    const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const id = newStickyId(view.stickies);
    const occupied = nodesRef.current.filter((n) => n.type === "deploymentBox" || n.type === "sticky").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - stickySize.width / 2, y: center.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [spot.x, spot.y] }]).then((ok) => {
      if (!ok) return;
      select({ kind: "sticky", id });
      setEditing(id);
    });
  };

  const addItems: MenuAction[] = [
    { label: holder ? `Deployment node in ${holder.name}` : "Deployment node", onSelect: () => addNode(false) },
    { label: holder ? `Infrastructure node in ${holder.name}` : "Infrastructure node", onSelect: () => addNode(true) },
    { label: "Sticky note", divider: true, onSelect: addSticky },
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

  // Fit the diagram to the window once, after it's first laid out.
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [ready, fitDiagram]);

  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow<FlowNode, DeploymentEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target && ![c.source, c.target].some((id) => id.includes(":"))}
        onNodeClick={(_, node) => clickNode(node)}
        onNodeDragStart={(_, node) => node.type === "sticky" && select({ kind: "sticky", id: node.data.sticky.id })}
        onEdgeClick={(_, edge) => edge.data && selectArrow(edge.data.arrow)}
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
            <span>deployment view</span>
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
      {ready && d.nodes.length === 0 && (
        <div className="empty-hint">
          This view has no nodes yet. Use <strong>+ Add</strong> to add one, then choose what runs in it in its details.
        </div>
      )}
    </div>
  );
}
