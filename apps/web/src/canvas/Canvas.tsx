import {
  computeView,
  newElement,
  parseLayout,
  scopeProblems,
  setLayout,
  showInView,
  addRelationship,
  type ArchElement,
  type Diagnostic,
  type ElementKind,
  type NodeLayout,
  type ViewDef,
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
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uniqueId } from "../ids.js";
import { chain, type Edit } from "../state.js";
import { elkLayout, freeSpotAmong, NODE_H, NODE_W, placeMissing, type Point } from "./autoLayout.js";
import { edgeTypes, type ArrowEdge } from "./FloatingEdge.js";
import { nodeTypes, type ElementFlowNode, type FrameFlowNode } from "./nodes.js";

export type Selection = { kind: "element"; id: string } | { kind: "arrow"; from: string; to: string } | null;

type FlowNode = ElementFlowNode | FrameFlowNode;

const FRAME_ID = "__frame";
const FRAME_PAD = { x: 40, top: 56, bottom: 40 };

interface CanvasProps {
  ws: Workspace;
  view: ViewDef;
  diagnostics: Diagnostic[];
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(fn: Edit): Promise<boolean>;
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

function withFrame(nodes: FlowNode[], boundary: ArchElement | undefined): FlowNode[] {
  const elements = nodes.filter((n): n is ElementFlowNode => n.type === "element");
  const inside = boundary ? elements.filter((n) => n.data.element.parent === boundary.id) : [];
  if (!boundary || inside.length === 0) return elements;
  // Whole pixels: fractional sizes from high-DPI screens would make the frame resize itself forever.
  const left = Math.round(Math.min(...inside.map((n) => n.position.x)) - FRAME_PAD.x);
  const top = Math.round(Math.min(...inside.map((n) => n.position.y)) - FRAME_PAD.top);
  const right = Math.round(Math.max(...inside.map((n) => n.position.x + (n.measured?.width ?? NODE_W))) + FRAME_PAD.x);
  const bottom = Math.round(Math.max(...inside.map((n) => n.position.y + (n.measured?.height ?? NODE_H))) + FRAME_PAD.bottom);
  const previous = nodes.find((n): n is FrameFlowNode => n.id === FRAME_ID);
  // Reuse the frame when nothing about it changed. A new object without `measured`
  // makes React Flow measure it again, which updates the nodes, which rebuilds the frame...
  if (
    previous &&
    previous.data.element === boundary &&
    previous.position.x === left &&
    previous.position.y === top &&
    previous.width === right - left &&
    previous.height === bottom - top
  ) {
    return [previous, ...elements];
  }
  const frame: FrameFlowNode = {
    measured: previous?.measured,
    id: FRAME_ID,
    type: "frame",
    position: { x: left, y: top },
    data: { element: boundary, width: right - left, height: bottom - top },
    width: right - left,
    height: bottom - top,
    draggable: false,
    connectable: false,
    zIndex: -1,
    selected: previous?.selected ?? false,
  };
  return [frame, ...elements];
}

export function Canvas({ ws, view, diagnostics, selection, onSelect, edit }: CanvasProps) {
  const rf = useReactFlow<FlowNode, ArrowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const scopeErrors = useMemo(() => scopeProblems(ws, view), [ws, view]);
  const cv = useMemo(() => (scopeErrors.length ? null : computeView(ws, view)), [ws, view, scopeErrors]);

  const saved = useMemo<Record<string, NodeLayout>>(() => {
    const block = ws.files.get(view.path)?.blocks.layout;
    const parsed = block ? parseLayout(block.json) : undefined;
    return parsed?.ok ? parsed.layout.nodes : {};
  }, [ws, view]);

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
    for (const d of diagnostics) counts.set(d.path, (counts.get(d.path) ?? 0) + 1);
    return counts;
  }, [diagnostics]);

  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    if (!cv || !positions) return setNodes([]);
    setNodes((previous) =>
      withFrame(
        cv.nodes.map((element) => ({
          id: element.id,
          type: "element",
          position: positions[element.id]!,
          data: { element, problems: problemCounts.get(element.path) ?? 0 },
          selected: selection?.kind === "element" && selection.id === element.id,
          measured: previous.find((p) => p.id === element.id)?.measured,
        })),
        cv.boundary,
      ).map((n) => (n.type === "frame" ? { ...n, selected: selection?.kind === "element" && selection.id === cv.boundary?.id } : n)),
    );
  }, [cv, positions, problemCounts, selection]);

  const edges = useMemo<ArrowEdge[]>(
    () =>
      cv?.edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        type: "arrow",
        source: e.from,
        target: e.to,
        selected: selection?.kind === "arrow" && selection.from === e.from && selection.to === e.to,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
        data: { edge: e, offset: cv.edges.some((o) => o.from === e.to && o.to === e.from) ? 14 : 0, onSelect: () => onSelect({ kind: "arrow", from: e.from, to: e.to }) },
      })) ?? [],
    [cv, selection, onSelect],
  );

  // Fit the diagram to the window once per view, after its boxes have been measured.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || fitted.current === view.id) return;
    fitted.current = view.id;
    requestAnimationFrame(() => requestAnimationFrame(() => void rf.fitView({ padding: 0.15, maxZoom: 1.2 })));
  }, [ready, view.id, rf]);

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

  const currentLayout = useCallback((): Record<string, NodeLayout> => {
    const out: Record<string, NodeLayout> = {};
    for (const n of nodesRef.current) if (n.type === "element") out[n.id] = { ...saved[n.id], x: n.position.x, y: n.position.y };
    return out;
  }, [saved]);

  const onNodeDragStop = useCallback(() => {
    const layout = currentLayout();
    void edit((w) => setLayout(w, view.id, layout));
  }, [currentLayout, edit, view.id]);

  const onConnect = useCallback(
    (c: Connection) => {
      void edit((w) => addRelationship(w, c.source, c.target)).then((ok) => ok && onSelect({ kind: "arrow", from: c.source, to: c.target }));
    },
    [edit, onSelect],
  );

  const add = (kind: ElementKind, parent?: string) => {
    const rect = wrapper.current!.getBoundingClientRect();
    const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const id = uniqueId(ws, `new-${kind}`);
    const existing = currentLayout();
    const spot = freeSpotAmong({ x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 }, Object.values(existing));
    const layout: Record<string, NodeLayout> = { ...existing, [id]: { ...spot } };
    void edit((w) =>
      chain(
        w,
        (x) => newElement(x, { id, kind, parent, name: `New ${kind}` }),
        (x) => showInView(x, view.id, id),
        (x) => setLayout(x, view.id, layout),
      ),
    ).then((ok) => ok && onSelect({ kind: "element", id }, { isNew: true }));
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
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target && c.target !== FRAME_ID && c.source !== FRAME_ID}
        onNodeClick={(_, node) => onSelect({ kind: "element", id: node.type === "frame" ? node.data.element.id : node.id })}
        onEdgeClick={(_, edge) => onSelect({ kind: "arrow", from: edge.source, to: edge.target })}
        onPaneClick={() => {
          setMenuOpen(false);
          onSelect(null);
        }}
        connectionMode={ConnectionMode.Loose}
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
