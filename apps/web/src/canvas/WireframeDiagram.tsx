/**
 * A wireframe view's diagram: its screens left to right in their order, each a rough sketch of
 * what's on it, top to bottom, and an arrow from each widget that leads to another screen. Drag a
 * widget to move it on its screen, into a row or a panel, or onto another screen; drag a screen
 * to move it along; and drag from the dot beside a widget to a screen to make the widget lead
 * there. Nothing is placed by hand, so only sticky notes keep a position.
 */
import {
  allWidgets,
  screenArrows,
  SCREEN_DEVICE_LABELS,
  SCREEN_DEVICES,
  WIDGET_HOLDERS,
  WIDGET_KIND_LABELS,
  WIDGET_KINDS,
  type ComputedView,
  type Operation,
  type ScreenArrow,
  type Screen,
  type Sticky,
  type ViewDef,
  type Widget,
  type WidgetKind,
} from "@open-arch/core";
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
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import { uniqueAmong, widgetName } from "../model.js";
import { MenuButton, type MenuAction, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { freeSpotAmong, NODE_W, placeStickies, STICKY, TOUCH_STICKY, type Point } from "./autoLayout.js";
import { fitBelowToolbar, SELECTED_LIFT, STICKY_Z, type Selection } from "./Canvas.js";
import { useDiagramMenu, type MenuHost } from "./DiagramMenu.js";
import { diagramItems, stickyItems, withDelete, type MenuEdits } from "./menuItems.js";
import { NotesOpener, StickyNode, type StickyFlowNode } from "./nodes.js";
import type { Box } from "./routing.js";
import { pathThrough } from "./RoutedEdge.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";
import { arrowId, arrowRoutes, screenDropOps, screenPlace, screenSpot, textLines, WF, widgetDropOps, wireframeLayout } from "./wireframeLayout.js";

type ScreenNodeData = { screen: Screen; width: number; height: number };
type ScreenFlowNode = Node<ScreenNodeData, "screen">;
type WidgetNodeData = { widget: Widget; width: number; height: number };
type WidgetFlowNode = Node<WidgetNodeData, "widget">;
type FlowNode = ScreenFlowNode | WidgetFlowNode | StickyFlowNode;

type LeadsData = { arrow: ScreenArrow; points: readonly Readonly<Point>[] };
type LeadsEdge = Edge<LeadsData, "leads">;

/** Screen and widget IDs are each unique only among their own kind, so each kind's nodes get a prefix. */
const screenNodeId = (id: string) => `screen:${id}`;
const widgetNodeId = (id: string) => `widget:${id}`;
const stickyNodeId = (id: string) => `sticky:${id}`;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";
/** Screens and widgets go where they're let go among the others, so only notes snap as they're dragged. They line up with the screens and each other. */
const notesSnap = (n: FlowNode) => n.type === "sticky";
const linesUpWith = (n: FlowNode) => n.type !== "widget";
/**
 * Arrows are drawn over the screens, so an arrow is seen to leave the widget it comes from, but
 * under a widget or screen being dragged, which React Flow lifts by SELECTED_LIFT.
 */
const ARROW_Z = SELECTED_LIFT - 100;
/** Notes stay above a selected screen's widgets, which React Flow puts above the screen, as it does nested boxes. */
const NOTE_Z = STICKY_Z + 50;

/** A screen: its name in a bar at the top, and its device, unless it's a desktop one. While an arrow is dragged, all of it is a drop target. */
function ScreenNode({ id, data, selected }: NodeProps<ScreenFlowNode>) {
  const { screen } = data;
  const connection = useConnection();
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  return (
    <div className={`wf-screen wf-device-${screen.device}${selected ? " selected" : ""}`} style={{ width: data.width, height: data.height }} title={screen.description}>
      <Handle type="target" id="left" position={Position.Left} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      <Handle type="target" id="right" position={Position.Right} className="handle-hidden" isConnectable={false} />
      <div className="wf-screen-name" style={{ height: WF.head }}>
        <span>{screen.name}</span>
        {screen.device !== "desktop" && <span className="wf-screen-device">{SCREEN_DEVICE_LABELS[screen.device]}</span>}
      </div>
    </div>
  );
}

/** What a widget looks like, roughly: its text, in the shape of a button, a box to type in, and so on. */
function WidgetBody({ widget }: { widget: Widget }) {
  const lines = textLines(widget.text);
  const text = lines.join("\n");
  const placeholder = <span className="wf-placeholder">{WIDGET_KIND_LABELS[widget.kind]}</span>;
  switch (widget.kind) {
    case "heading":
      return <div className="wf-heading">{text || placeholder}</div>;
    case "text":
      return lines.length ? (
        <div className="wf-text">{text}</div>
      ) : (
        <div className="wf-lines" aria-label="Text">
          <span />
          <span />
          <span />
        </div>
      );
    case "button":
      return <span className="wf-button">{text || "Button"}</span>;
    case "link":
      return <span className="wf-link">{text || "Link"}</span>;
    case "input":
    case "select":
      return (
        <>
          {lines.length > 0 && <div className="wf-label">{lines.join(" ")}</div>}
          <div className={`wf-field${widget.kind === "select" ? " wf-select" : ""}`}>{lines.length === 0 && placeholder}</div>
        </>
      );
    case "checkbox":
      return (
        <div className="wf-checkbox">
          <span className="wf-tick" />
          <span>{text || "Checkbox"}</span>
        </div>
      );
    case "image":
      return (
        <div className="wf-image">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="0" x2="100" y2="100" />
            <line x1="100" y1="0" x2="0" y2="100" />
          </svg>
          <span>{text || "Image"}</span>
        </div>
      );
    case "list":
      return <ul className="wf-list">{(lines.length ? lines : ["", "", ""]).map((l, i) => <li key={i}>{l || <span className="wf-line" />}</li>)}</ul>;
    case "table":
      return (
        <table className="wf-table">
          <tbody>
            {(lines.length ? lines : ["|", "|", "|"]).map((row, i) => (
              <tr key={i}>
                {row.split("|").map((c, j) => (
                  <td key={j}>{c.trim()}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "tabs":
      return (
        <div className="wf-tabs">
          {(lines.length ? lines : ["Tab", "Tab"]).map((t, i) => (
            <span key={i} className={i === 0 ? "open" : undefined}>
              {t}
            </span>
          ))}
        </div>
      );
    case "divider":
      return <div className="wf-divider">{text && <span>{lines.join(" ")}</span>}</div>;
    case "panel":
    case "row":
      return (
        <>
          {lines.length > 0 && <div className="wf-holder-title">{lines.join(" ")}</div>}
          {widget.widgets.length === 0 && <div className="wf-holder-empty">Empty {widget.kind}: drag widgets here, or select it and use + Add</div>}
        </>
      );
  }
}

/** One widget, with a dot beside it to drag to a screen it leads to. While an arrow is dragged, all of it is a drop target for its screen. */
function WidgetNode({ id, data, selected }: NodeProps<WidgetFlowNode>) {
  const { widget } = data;
  const connection = useConnection();
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  return (
    <div className={`wf-widget wf-kind-${widget.kind}${selected ? " selected" : ""}`} style={{ width: data.width, height: data.height }} title={widget.description}>
      <Handle type="target" id="drop" position={Position.Left} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      {/* The text is cut off at the widget's edge. The dot to drag an arrow from sits half outside it, so it's outside this. */}
      <div className="wf-body">
        <WidgetBody widget={widget} />
      </div>
      <Handle type="source" id="right" position={Position.Right} className="handle-source" title="Drag to a screen to lead there" />
      <Handle type="source" id="left" position={Position.Left} className="handle-hidden" isConnectable={false} />
    </div>
  );
}

function LeadsArrow({ id, data, markerEnd, selected }: EdgeProps<LeadsEdge>) {
  if (!data || data.points.length < 2) return null;
  return <BaseEdge id={id} path={pathThrough(data.points)} markerEnd={markerEnd} className={`arrow${selected ? " selected" : ""}`} interactionWidth={18} />;
}

const nodeTypes = { screen: ScreenNode, widget: WidgetNode, sticky: StickyNode };
const edgeTypes = { leads: LeadsArrow };

/** The screen a node is, or is on: none for a note. */
function screenOfNode(view: ViewDef, nodeId: string | null | undefined): string | undefined {
  if (nodeId?.startsWith("screen:")) return nodeId.slice("screen:".length);
  if (nodeId?.startsWith("widget:")) return allWidgets(view).find((w) => w.id === nodeId.slice("widget:".length))?.screen;
  return undefined;
}

/**
 * The edit that makes a widget lead to the screen an arrow from it was dropped on, or onto a
 * widget on: none for its own screen, or the one it leads to already.
 */
export function leadOps(view: ViewDef, source: string, target: string | null | undefined): Operation[] {
  const widget = source.startsWith("widget:") ? allWidgets(view).find((w) => w.id === source.slice("widget:".length)) : undefined;
  const to = screenOfNode(view, target);
  if (!widget || !to || to === widget.screen || to === widget.to) return [];
  return [{ op: "update-widget", view: view.id, id: widget.id, to }];
}

/** Where a new widget goes: on a screen, or in a row or a panel, at a place among the widgets there, or else after them. */
export type WidgetPlace = { screen: string; position?: number } | { in: string; position?: number };

/** The place after a widget: beside it in its row or panel, or on its screen. */
export const afterWidget = (widget: Widget): WidgetPlace => (widget.parent ? { in: widget.parent, position: widget.number + 1 } : { screen: widget.screen, position: widget.number + 1 });

/** The edit that adds a widget of this kind at a place, under an ID the view doesn't have yet. */
export function newWidgetOps(view: ViewDef, kind: WidgetKind, place: WidgetPlace): { ops: Operation[]; id: string } {
  const id = uniqueAmong(allWidgets(view).map((w) => w.id), kind);
  return { ops: [{ op: "add-widget", view: view.id, id, kind, ...place }], id };
}

/**
 * The edits that add a widget of this kind: into the selected row or panel, after the selected
 * widget, or at the end of the selected screen, or else of the last one. With no screens yet, a
 * screen is added for it first.
 */
export function addWidgetOps(view: ViewDef, kind: WidgetKind, selection: Selection): { ops: Operation[]; id: string } {
  const selected = selection?.kind === "widget" ? allWidgets(view).find((w) => w.id === selection.id) : undefined;
  if (selected && WIDGET_HOLDERS.includes(selected.kind)) return newWidgetOps(view, kind, { in: selected.id });
  if (selected) return newWidgetOps(view, kind, afterWidget(selected));
  const screen = (selection?.kind === "screen" ? view.screens.find((s) => s.id === selection.id) : undefined) ?? view.screens.at(-1);
  if (screen) return newWidgetOps(view, kind, { screen: screen.id });
  const first = addScreenOp(view, null);
  const { ops, id } = newWidgetOps(view, kind, { screen: first.id });
  return { ops: [first, ...ops], id };
}

/**
 * The edit that adds a screen: after the selected one, or the one the selected widget is on, and
 * for the same device; or else at the end, for the last one's. Or at `position` among the
 * screens, for one added where a right-click on the background was, for the device of the screen
 * before that place.
 */
export function addScreenOp(view: ViewDef, selection: Selection, position?: number): Extract<Operation, { op: "add-screen" }> {
  const after =
    position !== undefined
      ? view.screens[position - 2]
      : selection?.kind === "screen"
        ? view.screens.find((s) => s.id === selection.id)
        : selection?.kind === "widget"
          ? view.screens.find((s) => s.id === allWidgets(view).find((w) => w.id === selection.id)?.screen)
          : undefined;
  // Before the first screen, it's like that one.
  const like = after ?? (position !== undefined ? view.screens[0] : view.screens.at(-1));
  const at = position ?? (after ? after.number + 1 : undefined);
  const id = uniqueAmong(view.screens.map((s) => s.id), "new-screen");
  return {
    op: "add-screen",
    view: view.id,
    id,
    name: "New screen",
    ...(like && like.device !== "desktop" && { device: like.device }),
    // The place after the last screen is the end, which needs no saying.
    ...(at !== undefined && at <= view.screens.length && { position: at }),
  };
}

interface WireframeDiagramProps {
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** What the right-click menus need from the designer. */
  menus: MenuHost;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
  /** What sticky notes snap to as they're dragged, and its buttons. */
  snap: SnapControl;
}

export function WireframeDiagram({ computed: cv, selection, onSelect, edit, menus, exportItems, snap }: WireframeDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, LeadsEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;
  const layout = useMemo(() => wireframeLayout(view), [view]);
  const arrows = useMemo(() => screenArrows(view), [view]);
  // Arrows go as the screens and widgets are laid out, not as dragged: one that's dropped moves to its new place, or back.
  const routes = useMemo(() => arrowRoutes(view, layout, arrows), [view, layout, arrows]);

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
  /** Counts the screens and widgets dropped back where they were, each of which is drawn in its place again. */
  const [putBack, setPutBack] = useState(0);

  /** Where a widget's box starts: its parent's, a row's, a panel's or a screen's, as React Flow places it within that. */
  const parentBox = useCallback((w: Widget): Box => (w.parent ? layout.widgets.get(w.parent)! : layout.screens.get(w.screen)!), [layout]);

  useEffect(() => {
    // Notes go to the right of the diagram, unless they've been placed.
    const stickyAt = placeStickies(view.stickies, [{ x: Math.max(0, layout.width - NODE_W), y: 0 }], stickySize);
    setNodes((previous) => {
      // Each keeps what React Flow measured of it, as EventDiagram explains.
      const measured = (id: string) => previous.find((p) => p.id === id)?.measured;
      const out: FlowNode[] = [];
      for (const screen of view.screens) {
        const box = layout.screens.get(screen.id)!;
        out.push({
          id: screenNodeId(screen.id),
          type: "screen",
          position: { x: box.x, y: box.y },
          data: { screen, width: box.w, height: box.h },
          width: box.w,
          height: box.h,
          selected: selection?.kind === "screen" && selection.id === screen.id,
          measured: measured(screenNodeId(screen.id)),
        });
        // In reading order, so each row or panel comes before what's inside it, as React Flow needs.
        for (const w of allWidgets(screen)) {
          const own = layout.widgets.get(w.id)!;
          const parent = parentBox(w);
          out.push({
            id: widgetNodeId(w.id),
            type: "widget",
            parentId: w.parent ? widgetNodeId(w.parent) : screenNodeId(w.screen),
            position: { x: own.x - parent.x, y: own.y - parent.y },
            data: { widget: w, width: own.w, height: own.h },
            width: own.w,
            height: own.h,
            selected: selection?.kind === "widget" && selection.id === w.id,
            measured: measured(widgetNodeId(w.id)),
          });
        }
      }
      for (const sticky of view.stickies) {
        out.push({
          id: stickyNodeId(sticky.id),
          type: "sticky",
          position: stickyAt[sticky.id]!,
          data: { sticky, editing: editing === sticky.id, onEdit: () => setEditing(sticky.id), onDone: (text) => finishEditing(sticky, text) },
          selected: selection?.kind === "sticky" && selection.id === sticky.id,
          measured: measured(stickyNodeId(sticky.id)),
          connectable: false,
          zIndex: NOTE_Z,
        });
      }
      return out;
    });
  }, [layout, view, selection, editing, finishEditing, stickySize, putBack, parentBox]);

  const select = useCallback((s: Selection) => onSelect(s), [onSelect]);

  const edges = useMemo<LeadsEdge[]>(
    () =>
      arrows.map((a) => {
        // React Flow wants handles at an arrow's ends, though it's drawn through the corners of its route.
        const forward = layout.screens.get(a.to)!.x > layout.screens.get(a.screen)!.x;
        return {
          id: arrowId(a),
          type: "leads",
          source: widgetNodeId(a.from),
          sourceHandle: forward ? "right" : "left",
          target: screenNodeId(a.to),
          targetHandle: forward ? "left" : "right",
          selected: selection?.kind === "widget" && selection.id === a.from,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
          zIndex: ARROW_Z,
          data: { arrow: a, points: routes.get(arrowId(a)) ?? [] },
        };
      }),
    [arrows, layout, routes, selection],
  );

  const { snapChanges, dropped, guides } = useSnap<FlowNode>(snap.settings, { snaps: notesSnap, isTarget: linesUpWith });
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((nds) => applyNodeChanges(snapChanges(changes), nds)), [snapChanges]);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, letGo: FlowNode[]) => {
      const dragged = dropped(letGo);
      const ops = dragged.flatMap((n): Operation[] => {
        if (n.type === "sticky") return [{ op: "update-sticky", view: view.id, id: n.data.sticky.id, at: [Math.round(n.position.x), Math.round(n.position.y)] }];
        if (n.type === "screen") return screenDropOps(view, layout, n.data.screen, { x: n.position.x + n.data.width / 2, y: n.position.y + n.data.height / 2 });
        // A widget's position is within its parent, which stays where it was.
        const parent = parentBox(n.data.widget);
        return widgetDropOps(view, layout, n.data.widget, { x: parent.x + n.position.x + n.data.width / 2, y: parent.y + n.position.y + n.data.height / 2 });
      });
      // A screen or widget that stays where it was, or whose move is refused, goes back to its place.
      if (ops.length) void edit(ops).then((ok) => ok || setPutBack((n) => n + 1));
      else setPutBack((n) => n + 1);
    },
    [edit, view, layout, parentBox, dropped],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const ops = leadOps(view, c.source, c.target);
      if (ops.length) void edit(ops).then((ok) => ok && select({ kind: "widget", id: c.source.slice("widget:".length) }));
    },
    [view, edit, select],
  );

  const clickNode = (node: FlowNode) => {
    if (node.type === "sticky") select({ kind: "sticky", id: node.data.sticky.id });
    else if (node.type === "widget") select({ kind: "widget", id: node.data.widget.id });
    else select({ kind: "screen", id: node.data.screen.id });
  };

  /** A new widget goes where + Add puts it (see addWidgetOps), or where a right-click menu says. */
  const addWidget = (kind: WidgetKind, { ops, id } = addWidgetOps(view, kind, selection)) => {
    void edit(ops).then((ok) => ok && onSelect({ kind: "widget", id }, { isNew: true }));
  };

  /** A new screen goes where + Add puts it (see addScreenOp), or where a right-click menu says. */
  const addScreen = (op = addScreenOp(view, selection)) => {
    void edit([op]).then((ok) => ok && onSelect({ kind: "screen", id: op.id }, { isNew: true }));
  };

  /** A new note goes in the middle of the canvas, or from a right-click menu, where that was. */
  const addSticky = (at?: Point) => {
    const rect = wrapper.current!.getBoundingClientRect();
    const center = at ?? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const id = uniqueAmong(view.stickies.map((s) => s.id), "note");
    // Notes are kept clear of each other, as screens and widgets are drawn where their order puts them.
    const occupied = nodesRef.current.filter((n) => n.type === "sticky").map((n) => n.position);
    const spot = freeSpotAmong({ x: center.x - stickySize.width / 2, y: center.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [spot.x, spot.y] }]).then((ok) => {
      if (!ok) return;
      select({ kind: "sticky", id });
      setEditing(id);
    });
  };

  /**
   * What + Add adds, and a right-click menu's Add, which puts it where the click was. On a
   * screen, a widget goes at that place among the screen's own, and a screen after that one. On
   * the background, a screen goes at that place among the screens; a widget has to be on a screen,
   * so it goes where + Add puts one with nothing selected, at the end of the last. A note goes at
   * the point.
   */
  const addItems = (clicked?: { at: Point; screen?: Screen }): MenuAction[] => {
    const on = clicked?.screen;
    const widgetOps = (kind: WidgetKind) => {
      if (!clicked) return undefined;
      if (!on) return addWidgetOps(view, kind, null);
      // The place after the screen's last widget is the end, which needs no saying.
      const position = screenSpot(layout, on, clicked.at);
      return newWidgetOps(view, kind, { screen: on.id, ...(position <= on.widgets.length && { position }) });
    };
    const screenOp = () => (on ? addScreenOp(view, { kind: "screen", id: on.id }) : clicked && addScreenOp(view, null, screenPlace(view, layout, clicked.at)));
    return [
      ...WIDGET_KINDS.map((kind) => ({ label: WIDGET_KIND_LABELS[kind], onSelect: () => addWidget(kind, widgetOps(kind)) })),
      { label: "Screen", divider: true, onSelect: () => addScreen(screenOp()) },
      { label: "Sticky note", onSelect: () => addSticky(clicked?.at) },
    ];
  };

  const notes = useContext(NotesOpener);
  const edits: MenuEdits = { edit, select };

  // Each item does what it does in the toolbar or the details, which have them all too.
  const screenMenu = (screen: Screen, at: Point): MenuItem[] => {
    const set = (fields: Omit<Extract<Operation, { op: "update-screen" }>, "op" | "view" | "id">) => () => void edit([{ op: "update-screen", view: view.id, id: screen.id, ...fields }]);
    return withDelete(
      edits,
      [
        { label: "Add", items: addItems({ at, screen }) },
        { label: "Device", items: SCREEN_DEVICES.filter((device) => device !== screen.device).map((device) => ({ label: SCREEN_DEVICE_LABELS[device], onSelect: set({ device }) })) },
        ...(screen.number > 1 ? [{ label: "Move left", onSelect: set({ position: screen.number - 1 }) }] : []),
        ...(screen.number < view.screens.length ? [{ label: "Move right", onSelect: set({ position: screen.number + 1 }) }] : []),
      ],
      "Delete screen",
      { op: "remove-screen", view: view.id, id: screen.id },
    );
  };

  const widgetMenu = (widget: Widget): MenuItem[] => {
    const set = (fields: Omit<Extract<Operation, { op: "update-widget" }>, "op" | "view" | "id">) => () => void edit([{ op: "update-widget", view: view.id, id: widget.id, ...fields }]);
    const kinds = (place: WidgetPlace): MenuAction[] => WIDGET_KINDS.map((kind) => ({ label: WIDGET_KIND_LABELS[kind], onSelect: () => addWidget(kind, newWidgetOps(view, kind, place)) }));
    const all = allWidgets(view);
    const holds = WIDGET_HOLDERS.includes(widget.kind);
    const parent = widget.parent ? all.find((w) => w.id === widget.parent) : undefined;
    const siblings = parent ? parent.widgets : (view.screens.find((s) => s.id === widget.screen)?.widgets ?? []);
    // What holds widgets can only become the other kind that does.
    const become = WIDGET_KINDS.filter((kind) => kind !== widget.kind && (widget.widgets.length === 0 || WIDGET_HOLDERS.includes(kind)));
    const leadsTo: MenuAction[] = [
      ...view.screens.filter((s) => s.id !== widget.screen && s.id !== widget.to).map((s) => ({ label: s.name, onSelect: set({ to: s.id }) })),
      ...(widget.to !== undefined ? [{ label: "Nowhere", onSelect: set({ to: null }) }] : []),
    ];
    const screens = view.screens.filter((s) => s.id !== widget.screen);
    // The rows and panels it can go into: those on its screen, but not itself, anything inside it, or the one it's in.
    const inside = new Set(allWidgets(widget).map((w) => w.id));
    const into: MenuAction[] = [
      ...all.filter((w) => w.screen === widget.screen && WIDGET_HOLDERS.includes(w.kind) && w.id !== widget.id && w.id !== widget.parent && !inside.has(w.id)).map((h) => ({ label: `${widgetName(h)} [${h.id}]`, onSelect: set({ in: h.id }) })),
      ...(widget.parent !== undefined ? [{ label: "The screen itself", onSelect: set({ in: null }) }] : []),
    ];
    const across = parent?.kind === "row";
    return withDelete(
      edits,
      [
        ...(holds ? [{ label: "Add inside", items: kinds({ in: widget.id }) }] : []),
        { label: "Add after", items: kinds(afterWidget(widget)) },
        ...(become.length ? [{ label: "Change kind", items: become.map((kind) => ({ label: WIDGET_KIND_LABELS[kind], onSelect: set({ kind }) })) }] : []),
        ...(leadsTo.length ? [{ label: "Leads to", items: leadsTo }] : []),
        ...(screens.length ? [{ label: "Move to screen", items: screens.map((s) => ({ label: s.name, onSelect: set({ screen: s.id }) })) }] : []),
        ...(into.length ? [{ label: "Move into", items: into }] : []),
        ...(widget.number > 1 ? [{ label: across ? "Move left" : "Move up", onSelect: set({ position: widget.number - 1 }) }] : []),
        ...(widget.number < siblings.length ? [{ label: across ? "Move right" : "Move down", onSelect: set({ position: widget.number + 1 }) }] : []),
      ],
      `Delete ${WIDGET_KIND_LABELS[widget.kind].toLowerCase()}`,
      { op: "remove-widget", view: view.id, id: widget.id },
    );
  };

  /**
   * The right-click menus: for a screen, a widget or a sticky note, which the click selects, and
   * for the diagram, after a click on the background. An arrow is its widget's, so a right-click
   * on one is one on the widget, as a click is. See useDiagramMenu for how one opens and closes.
   */
  const menu = useDiagramMenu({
    view,
    selection,
    select,
    host: menus,
    toDiagram: (point) => rf.screenToFlowPosition(point),
    items: (on, at) => {
      // Screens and widgets go where their order puts them, so there's nothing to lay out again.
      if (on.kind === "diagram") return diagramItems(addItems({ at }), undefined, exportItems);
      const screen = on.kind === "screen" && view.screens.find((s) => s.id === on.id);
      if (screen) return screenMenu(screen, at);
      const widget = on.kind === "widget" && allWidgets(view).find((w) => w.id === on.id);
      if (widget) return widgetMenu(widget);
      const sticky = on.kind === "sticky" && view.stickies.find((s) => s.id === on.id);
      if (!sticky) return [];
      return stickyItems(edits, view.id, sticky, { editText: () => setEditing(sticky.id), openNotes: notes ? () => notes.sticky(sticky.id) : undefined, back: "Move beside the diagram" });
    },
  });

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
      <ReactFlow<FlowNode, LeadsEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(c) => leadOps(view, c.source, c.target).length > 0}
        onNodeClick={(_, node) => clickNode(node)}
        onNodeDragStart={(_, node) => clickNode(node)}
        onEdgeClick={(_, edge) => edge.data && select({ kind: "widget", id: edge.data.arrow.from })}
        onPaneClick={() => select(null)}
        onNodeContextMenu={(event, node) => {
          if (node.type === "sticky") menu.open(event, { kind: "sticky", id: node.data.sticky.id });
          else if (node.type === "widget") menu.open(event, { kind: "widget", id: node.data.widget.id });
          else menu.open(event, { kind: "screen", id: node.data.screen.id });
        }}
        onEdgeContextMenu={(event, edge) => edge.data && menu.open(event, { kind: "widget", id: edge.data.arrow.from })}
        onPaneContextMenu={(event) => menu.open(event, null)}
        nodeClickDistance={4}
        paneClickDistance={4}
        connectionMode={ConnectionMode.Strict}
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
            <span>wireframe view{cv.boundary ? ` of ${cv.boundary.name}` : ""}</span>
            {view.description && (
              <span className="toolbar-description" title={view.description}>
                {view.description}
              </span>
            )}
          </div>
          <MenuButton className="primary" items={addItems()}>
            + Add
          </MenuButton>
          {exportItems.length > 0 && (
            <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
              Export
            </MenuButton>
          )}
        </Panel>
      </ReactFlow>
      {view.screens.length === 0 && (
        <div className="empty-hint">
          This view has no screens yet. Use <strong>+ Add</strong> to add a screen, and the headings, buttons and boxes to type in that go on it. Drag from the dot beside a widget to another screen to show where it leads.
        </div>
      )}
      {menu.menu}
    </div>
  );
}
