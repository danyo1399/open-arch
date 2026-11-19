/**
 * An entity view's diagram, an entity-relationship diagram: each entity as a table, its name at
 * the top and a row for each attribute below, with its keys and type, and the links between them
 * as lines with a crow's foot at each end, saying how many of the entity at that end there can
 * be. A link from an entity to itself is a loop above it. Drag an entity to move it, or from the
 * dot under one to another to add a link. The element whose data it is, if the view says, is the
 * frame.
 */
import { kindLabel, type Cardinality, type ComputedView, type Entity, type EntityLink, type Operation, type Sticky, type ViewDef, type ViewEdge, type Workspace } from "@open-arch/core";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
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
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import { newStickyId, uniqueAmong } from "../model.js";
import { MenuButton, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { elkLayout, freeSpotAmong, layOut, placeMissing, placeStickies, STICKY, stickiesBackOps, stickyHeight, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { AutoLayoutButton, fitBelowToolbar, STICKY_Z, useAutoLayout, type AutoLayout, type Selection } from "./Canvas.js";
import { CROW_FOOT, crowFoot, ENTITY, entityHeight, entityWidth, keyColumns } from "./entityLayout.js";
import { FrameNode, StickyNode, type FrameFlowNode, type StickyFlowNode } from "./nodes.js";
import { measureLabelSizes, pathThrough } from "./RoutedEdge.js";
import { layoutArrows, type Box } from "./routing.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";
import { loopsRise, selfLoop } from "./stateLayout.js";

/** `attribute`: the name of its attribute that's selected, if one is. */
type EntityNodeData = { entity: Entity; attribute?: string };
type EntityFlowNode = Node<EntityNodeData, "entity">;
type FlowNode = EntityFlowNode | StickyFlowNode | FrameFlowNode;

type LinkEdgeData = {
  link: EntityLink;
  /** The route, between two entities; or for a link from an entity to itself, the loop above it. */
  points: readonly Readonly<Point>[];
  loop?: string;
  /** Where the label's centre goes, and how wide it can be. */
  label?: Point & { maxWidth?: number };
  onSelect(): void;
};
type LinkEdge = Edge<LinkEdgeData, "link">;

const FRAME_ID = "__frame";
const FRAME_PAD = { x: 60, top: 64, bottom: 48 };
const stickyNodeId = (id: string) => `sticky:${id}`;
const linkId = (l: Pick<EntityLink, "number">) => `link:${l.number}`;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";
/**
 * Entities are laid out left to right, a link's `from` before its `to`, so a customer comes
 * before their orders, and tall tables stand side by side; in the file's order where nothing says.
 */
const ENTITY_ELK = { "elk.direction": "RIGHT", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES" };
export const entityLayout = (nodes: Parameters<typeof elkLayout>[0], edges: Parameters<typeof elkLayout>[1]) => elkLayout(nodes, edges, ENTITY_ELK);

/**
 * The edit Auto layout makes on an entity view, as one step for Undo: every entity where ELK put
 * it, `auto`, and the sticky notes back beside the diagram. It's made from the workspace as it is
 * when it's applied, so an entity deleted or renamed while ELK worked is left out of it.
 */
export function autoLayoutEntityOps(ws: Workspace, viewId: string, auto: Record<string, Point>): Operation[] {
  const view = ws.views.get(viewId);
  if (view?.level !== "entity") return [];
  const entities = view.entities.filter((e) => auto[e.id]);
  return [...entities.map((e): Operation => ({ op: "update-entity", view: viewId, id: e.id, at: [Math.round(auto[e.id]!.x), Math.round(auto[e.id]!.y)] })), ...stickiesBackOps(view)];
}

/** Entities and notes snap as they're dragged, and line up with each other. The frame grows round the entities, so it's neither. */
const snapsHere = (n: FlowNode) => n.type !== "frame";

/** An attribute's row, as its tooltip says it: its name, type, keys and description. */
function attributeTitle(a: Entity["attributes"][number]): string {
  return [`${a.name}${a.type ? `: ${a.type}` : ""}${a.keys.length ? ` (${a.keys.map((k) => k.toUpperCase()).join(", ")})` : ""}`, a.description].filter(Boolean).join("\n");
}

/** One entity: a table with its name and description at the top, and a row for each attribute. */
function EntityNode({ id, data, selected }: NodeProps<EntityFlowNode>) {
  const { entity, attribute } = data;
  const connection = useConnection();
  // While someone drags a new link, the whole entity is a drop target.
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  const keys = keyColumns(entity);
  return (
    <div className={`entity-box${selected ? " selected" : ""}`} style={{ width: entityWidth(entity) }}>
      <Handle type="target" position={Position.Top} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      <div className="entity-head" title={entity.description}>
        <div className="entity-name">{entity.name}</div>
        {entity.description && <div className="entity-desc">{entity.description}</div>}
      </div>
      <div className="entity-attrs">
        {entity.attributes.length ? (
          entity.attributes.map((a) => (
            <div key={a.name} className={`entity-attr${attribute === a.name ? " selected" : ""}`} data-attribute={a.name} title={attributeTitle(a)}>
              {keys > 0 && (
                <span className="entity-keys" style={{ width: keys * ENTITY.key }}>
                  {a.keys.map((k) => (
                    <span key={k} className={`entity-key entity-key-${k}`}>
                      {k.toUpperCase()}
                    </span>
                  ))}
                </span>
              )}
              <span className="entity-attr-name">{a.name}</span>
              {a.type && <span className="entity-attr-type">{a.type}</span>}
            </div>
          ))
        ) : (
          <div className="entity-empty">No attributes yet</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="handle-source" title="Drag to another entity to add a link" />
    </div>
  );
}

/** An ID for a marker of this link's, made only of characters a url() takes without escaping. */
const markerId = (link: string, end: "start" | "end") => `crow-${link.replace(/[^a-zA-Z0-9-]/g, (c) => `_${c.charCodeAt(0)}`)}-${end}`;

/** The crow's foot at one end of a link, pointing along the line, its tip on the entity's border. At the start, the marker is turned round, so it points back at the entity there. */
function CrowFootMarker({ id, cardinality, selected }: { id: string; cardinality: Cardinality; selected: boolean }) {
  const { paths, circle } = crowFoot(cardinality);
  return (
    <marker id={id} viewBox={`0 0 ${CROW_FOOT.w} ${CROW_FOOT.h}`} markerWidth={CROW_FOOT.w} markerHeight={CROW_FOOT.h} refX={CROW_FOOT.w} refY={CROW_FOOT.h / 2} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
      <g className={`crow-foot${selected ? " selected" : ""}`}>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
        {circle && <circle cx={circle.cx} cy={circle.cy} r={circle.r} />}
      </g>
    </marker>
  );
}

/** A link, along its route or round its loop, with a crow's foot at each end and its text. */
function LinkArrow({ id, data, selected }: EdgeProps<LinkEdge>) {
  if (!data || (!data.loop && data.points.length < 2)) return null;
  const [from, to] = data.link.cardinality;
  const ends = { start: markerId(id, "start"), end: markerId(id, "end") };
  const text = data.link.text;
  return (
    <>
      <defs>
        <CrowFootMarker id={ends.start} cardinality={from} selected={!!selected} />
        <CrowFootMarker id={ends.end} cardinality={to} selected={!!selected} />
      </defs>
      <BaseEdge id={id} path={data.loop ?? pathThrough(data.points)} markerStart={`url(#${ends.start})`} markerEnd={`url(#${ends.end})`} className={`arrow entity-link${selected ? " selected" : ""}`} interactionWidth={18} />
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

const nodeTypes = { entity: EntityNode, sticky: StickyNode, frame: FrameNode };
const edgeTypes = { link: LinkArrow };

/** The edit that adds an entity at `at`, named "New entity", with an ID no entity of the view has. */
export function addEntityOps(view: ViewDef, at: [number, number]): { ops: Operation[]; id: string } {
  const id = uniqueAmong(view.entities.map((e) => e.id), "new-entity");
  return { ops: [{ op: "add-entity", view: view.id, id, name: "New entity", at }], id };
}

/** "new_attribute", or "new_attribute_2", ..., whichever the entity doesn't have yet. */
function newAttributeName(entity: Entity): string {
  const taken = new Set(entity.attributes.map((a) => a.name));
  if (!taken.has("new_attribute")) return "new_attribute";
  for (let i = 2; ; i++) if (!taken.has(`new_attribute_${i}`)) return `new_attribute_${i}`;
}

/**
 * The edit that adds an attribute to the entity selected, at its end, or to the entity of the
 * attribute selected, after it; or nothing, when neither is selected.
 */
export function addAttributeOps(view: ViewDef, selection: Selection): { ops: Operation[]; entity: string; name: string } | null {
  const id = selection?.kind === "entity" ? selection.id : selection?.kind === "attribute" ? selection.entity : undefined;
  const entity = view.entities.find((e) => e.id === id);
  if (!entity) return null;
  const after = selection?.kind === "attribute" ? entity.attributes.find((a) => a.name === selection.name) : undefined;
  const name = newAttributeName(entity);
  return { ops: [{ op: "add-attribute", view: view.id, entity: entity.id, name, ...(after && after.number < entity.attributes.length && { position: after.number + 1 }) }], entity: entity.id, name };
}

/** An entity or a sticky note as the diagram draws it: where it is now, and for an entity, whether the file gives it a position. */
export interface DrawnItem {
  kind: "entity" | "sticky";
  id: string;
  position: Point;
  /** True for an entity the designer placed, as its file gives it no `at`. */
  placed?: boolean;
}

const at = (p: Point): [number, number] => [Math.round(p.x), Math.round(p.y)];

/**
 * Positions for the entities the designer placed, all but `except`, where they're drawn now, so
 * they stay put once an entity moves or a link is added, which would lay them out again.
 */
export function pinOps(view: ViewDef, drawn: DrawnItem[], except: ReadonlySet<string> = new Set()): Operation[] {
  return drawn.flatMap((d): Operation[] => (d.kind === "entity" && d.placed && !except.has(d.id) ? [{ op: "update-entity", view: view.id, id: d.id, at: at(d.position) }] : []));
}

/** The edit that keeps entities and notes where they were dragged to, with the rest of the entities where they are. */
export function moveOps(view: ViewDef, drawn: DrawnItem[], dragged: DrawnItem[]): Operation[] {
  const moved = new Set(dragged.filter((d) => d.kind === "entity").map((d) => d.id));
  return [
    ...pinOps(view, drawn, moved),
    ...dragged.map((d): Operation => (d.kind === "sticky" ? { op: "update-sticky", view: view.id, id: d.id, at: at(d.position) } : { op: "update-entity", view: view.id, id: d.id, at: at(d.position) })),
  ];
}

/**
 * The edit that adds a link dragged from one entity to another, one of `from` to zero or more of
 * `to`, with the entities where they are, and the number the link gets. None from an entity to
 * itself, which the details add, or to or from what isn't an entity.
 */
export function connectOps(view: ViewDef, drawn: DrawnItem[], from: string, to: string): { ops: Operation[]; number: number } | null {
  const entities = new Set(view.entities.map((e) => e.id));
  if (from === to || !entities.has(from) || !entities.has(to)) return null;
  return { ops: [...pinOps(view, drawn), { op: "add-link", view: view.id, from, to }], number: view.links.length + 1 };
}

/** What's on the diagram, as moveOps and connectOps take it. */
function items(nodes: FlowNode[]): DrawnItem[] {
  return nodes.flatMap((n): DrawnItem[] =>
    n.type === "entity" ? [{ kind: "entity", id: n.id, position: n.position, placed: !n.data.entity.at }] : n.type === "sticky" ? [{ kind: "sticky", id: n.data.sticky.id, position: n.position }] : [],
  );
}

/** What a click on an entity selects: the attribute whose row it's on, or else the entity. */
export function clickedOn(entity: string, target: EventTarget | null): Selection {
  const row = target instanceof Element ? target.closest<HTMLElement>("[data-attribute]") : null;
  return row?.dataset.attribute !== undefined ? { kind: "attribute", entity, name: row.dataset.attribute } : { kind: "entity", id: entity };
}

interface EntityDiagramProps {
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** A problem drawing the diagram, to tell the person about. */
  onError(text: string): void;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
  /** What entities and notes snap to as they're dragged, and its buttons. */
  snap: SnapControl;
  /** Given the diagram's Auto layout, for the top bar's More menu on a narrow screen. */
  autoLayoutHandle?: RefObject<AutoLayout | null>;
}

export function EntityDiagram({ computed: cv, selection, onSelect, edit, onError, exportItems, snap, autoLayoutHandle }: EntityDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, LinkEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => view.entities.map((e) => e.id), [view]);
  const saved = useMemo<Record<string, Point>>(() => Object.fromEntries(view.entities.flatMap((e) => (e.at ? [[e.id, { x: e.at[0], y: e.at[1] }]] : []))), [view]);
  /** The links that are drawn: between entities of the view, one from an entity to itself as a loop. */
  const drawnLinks = useMemo(() => view.links.filter((l) => ids.includes(l.from) && ids.includes(l.to)), [view, ids]);
  const between = useMemo(() => drawnLinks.filter((l) => l.from !== l.to), [drawnLinks]);
  const graphKey = `${view.id}|${view.entities.map((e) => `${e.id}:${entityWidth(e)}x${entityHeight(e)}`).join(",")}|${between.map((l) => `${l.from}>${l.to}`).join(",")}`;
  const missing = ids.some((id) => !saved[id]);
  const [auto, setAuto] = useState<{ key: string; positions: Record<string, Point> } | null>(null);

  /** The entities for ELK to lay out, each as big as it's drawn, in `drawn` by its ID, once it has been. */
  const layoutEntities = useCallback(
    (drawn: ReadonlyMap<string, number> = new Map()) => view.entities.map((e) => ({ id: e.id, inside: false, width: entityWidth(e), height: drawn.get(e.id) ?? entityHeight(e) })),
    [view],
  );

  // Entities without a position are laid out by ELK, left to right, each as big as it's drawn.
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void layOut(layoutEntities(), between, entityLayout).then(({ positions, failed }) => {
      if (cancelled) return;
      if (failed) onError("Couldn't lay out the new entities automatically, so they're in rows for now. Reload the page to try again.");
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
      ...view.entities.map(
        (entity): EntityFlowNode => ({
          id: entity.id,
          type: "entity",
          position: positions[entity.id]!,
          data: { entity, attribute: selection?.kind === "attribute" && selection.entity === entity.id ? selection.name : undefined },
          selected: selection?.kind === "entity" && selection.id === entity.id,
          measured: previous.find((p) => p.id === entity.id)?.measured,
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

  /** Each entity as drawn now, measured once it has been. */
  const boxes = useMemo(() => {
    const out = new Map<string, Box>();
    for (const n of nodes) if (n.type === "entity") out.set(n.id, { x: n.position.x, y: n.position.y, w: n.measured?.width ?? entityWidth(n.data.entity), h: n.measured?.height ?? entityHeight(n.data.entity) });
    return out;
  }, [nodes]);

  /** The frame's size as React Flow last measured it. */
  const frameMeasured = useRef<FrameFlowNode["measured"]>(undefined);

  // The frame round the entities, for the element whose data they are.
  const frame = useMemo((): FrameFlowNode | null => {
    if (!cv.boundary || boxes.size === 0) return null;
    const all = [...boxes.entries()];
    // Room for each entity's loops back to itself, which go up above it.
    const rise = (id: string) => loopsRise(drawnLinks.filter((l) => l.from === id && l.to === id).length);
    const left = Math.round(Math.min(...all.map(([, b]) => b.x)) - FRAME_PAD.x);
    const top = Math.round(Math.min(...all.map(([id, b]) => b.y - rise(id))) - FRAME_PAD.top);
    const width = Math.round(Math.max(...all.map(([, b]) => b.x + b.w)) + FRAME_PAD.x) - left;
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
  }, [cv.boundary, boxes, drawnLinks]);

  // Labels are sized as arrows' labels are, from the same styles.
  const sizes = useMemo(() => {
    const labelled = between.filter((l) => l.text);
    const pseudo = labelled.map((l): ViewEdge => ({ from: l.from, to: l.to, description: l.text, kind: "association", implied: true, bidirectional: false, sources: [] }));
    const measured = measureLabelSizes(pseudo);
    return new Map(labelled.map((l, k) => [linkId(l), measured[k]!] as const));
  }, [between]);

  const { routes, labels } = useMemo(() => {
    const notes = nodes.filter((n) => n.type === "sticky").map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? stickySize.width, h: n.measured?.height ?? stickyHeight((n as StickyFlowNode).data.sticky.text, stickySize) }));
    return layoutArrows(
      boxes,
      between.map((l) => ({ id: linkId(l), from: l.from, to: l.to })),
      sizes,
      { notes },
    );
  }, [boxes, between, sizes, nodes, stickySize]);

  const select = useCallback((s: Selection) => onSelect(s), [onSelect]);

  const edges = useMemo<LinkEdge[]>(() => {
    const loops = new Map<string, number>();
    return drawnLinks.flatMap((l): LinkEdge[] => {
      const box = boxes.get(l.from);
      if (!box || !boxes.has(l.to)) return [];
      const id = linkId(l);
      const common = { id, type: "link" as const, source: l.from, target: l.to, selected: selection?.kind === "link" && selection.number === l.number };
      const onSelectLink = () => select({ kind: "link", number: l.number });
      if (l.from === l.to) {
        const k = loops.get(l.from) ?? 0;
        loops.set(l.from, k + 1);
        const loop = selfLoop(box, k);
        return [{ ...common, data: { link: l, points: [], loop: loop.path, label: loop.label, onSelect: onSelectLink } }];
      }
      return [{ ...common, data: { link: l, points: routes.get(id) ?? [], label: labels.get(id), onSelect: onSelectLink } }];
    });
  }, [drawnLinks, boxes, routes, labels, selection, select]);

  const drawn = useMemo(() => (frame ? [frame, ...nodes] : nodes), [frame, nodes]);

  /** Positions for the entities placed automatically, so they stay put as others move or links are added. */
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
      if (made) void edit(made.ops).then((ok) => ok && select({ kind: "link", number: made.number }));
    },
    [view, edit, select],
  );

  /** The middle of the canvas, on the diagram. */
  const middle = (): Point => {
    const rect = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const addEntity = () => {
    const center = middle();
    const occupied = nodesRef.current.filter((n) => n.type === "entity" || n.type === "sticky").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - 110, y: center.y - 40 }, occupied);
    const { ops, id } = addEntityOps(view, [spot.x, spot.y]);
    void edit([...fixPlaced(), ...ops]).then((ok) => ok && onSelect({ kind: "entity", id }, { isNew: true }));
  };

  const addAttribute = () => {
    const made = addAttributeOps(view, selection);
    if (made) void edit([...fixPlaced(), ...made.ops]).then((ok) => ok && onSelect({ kind: "attribute", entity: made.entity, name: made.name }, { isNew: true }));
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

  // Auto layout places every entity as ELK would on a new entity view, but at the height each is drawn.
  const autoLayout = useAutoLayout(
    async () => {
      const drawn = new Map(nodesRef.current.flatMap((n) => (n.type === "entity" && n.measured?.height ? [[n.id, n.measured.height] as const] : [])));
      const positions = await entityLayout(layoutEntities(drawn), between);
      return (ws: Workspace) => autoLayoutEntityOps(ws, view.id, positions);
    },
    edit,
    onError,
    () => fitDiagram(),
    autoLayoutHandle,
  );

  // Fit the diagram to the window once, after its entities have been measured.
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [ready, fitDiagram]);

  const onEntity = selection?.kind === "entity" || selection?.kind === "attribute" ? view.entities.find((e) => e.id === (selection.kind === "entity" ? selection.id : selection.entity)) : undefined;
  const addItems: MenuItem[] = [
    { label: "Entity", onSelect: addEntity },
    ...(onEntity ? [{ label: `Attribute of ${onEntity.name}`, onSelect: addAttribute }] : []),
    { label: "Sticky note", divider: true, onSelect: addSticky },
  ];

  const scope = cv.boundary;
  return (
    <div className="canvas" ref={wrapper}>
      <ReactFlow<FlowNode, LinkEdge>
        nodes={drawn}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => c.source !== c.target && ids.includes(c.source) && ids.includes(c.target)}
        onNodeClick={(event: MouseEvent, node) => {
          if (node.type === "entity") select(clickedOn(node.id, event.target));
          else if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
        }}
        onNodeDragStart={(_, node) => {
          if (node.type === "entity") select({ kind: "entity", id: node.id });
          else if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
        }}
        onEdgeClick={(_, edge) => edge.data && select({ kind: "link", number: edge.data.link.number })}
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
            <span>entity view{scope ? ` of ${scope.name} [${kindLabel(scope)}]` : ""}</span>
            {view.description && (
              <span className="toolbar-description" title={view.description}>
                {view.description}
              </span>
            )}
          </div>
          <MenuButton className="primary" items={addItems} title={onEntity ? `Add an entity, an attribute of ${onEntity.name}, or a sticky note` : "Add an entity or a sticky note"}>
            + Add
          </MenuButton>
          <AutoLayoutButton layout={autoLayout} empty={view.entities.length === 0} />
          {exportItems.length > 0 && (
            <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
              Export
            </MenuButton>
          )}
        </Panel>
      </ReactFlow>
      {ready && view.entities.length === 0 && (
        <div className="empty-hint">
          This entity view has no entities yet. Use <strong>+ Add</strong> to add one, then, with it selected, + Add adds its attributes. Drag from the dot under an entity to another to add a link between them.
        </div>
      )}
    </div>
  );
}
