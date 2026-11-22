/**
 * A whiteboard view's diagram: a freehand sketch, to share an idea. Its shapes are drawn as by
 * hand where they're put, each over the ones before it, with the arrows between them on top.
 *
 * Pick a tool along the bottom, or press its key: drag to draw a rectangle, an ellipse or a
 * diamond, an arrow or a line (from or to a shape, which it then follows), or a line with the
 * pen; click to type text. With the selection tool, drag a shape to move it, drag its corners to
 * resize it, double-click it to write in it, and drag from the dot under it to another shape to
 * draw an arrow. Shapes snap as they're moved and resized. Double-click the background to type
 * text there.
 */
import {
  ARROW_HEADS,
  ARROW_SIDES,
  endShape,
  endSide,
  SHAPE_COLORS,
  SHAPE_FILLS,
  SHAPE_KIND_LABELS,
  SHAPE_SIZE,
  TEXT_SIZES,
  type Arrow,
  type ArrowEnd,
  type ComputedView,
  type Operation,
  type Shape,
  type ShapeKind,
  type Sticky,
  type ViewDef,
} from "@open-arch/core";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  ViewportPortal,
  applyNodeChanges,
  useConnection,
  useReactFlow,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@fontsource/architects-daughter/400.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useMediaQuery } from "../mediaQuery.js";
import { boardItemsOf, HEADS_TEXT, newStickyId, selectBoard, uniqueAmong, whiteboardDeleteOps } from "../model.js";
import { MenuButton, type MenuAction, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import { freeSpotAmong, placeStickies, STICKY, TOUCH_STICKY } from "./autoLayout.js";
import { fitBelowToolbar, STICKY_Z, type Selection } from "./Canvas.js";
import { useDiagramMenu, type MenuHost } from "./DiagramMenu.js";
import { diagramItems, stickyItems, withDelete, type MenuEdits } from "./menuItems.js";
import { NotesOpener, StickyNode, type StickyFlowNode } from "./nodes.js";
import { GRID, SnapButtons, SnapGuides, useSnap, type SnapControl } from "./snap.js";
import {
  arrowEnds,
  arrowSketch,
  contains,
  middle,
  penPath,
  seedOf,
  shapeAt,
  shapeBox,
  shapeSketch,
  SIDE_REACH,
  sideNear,
  sidePoint,
  simplifyLine,
  LINE_HEIGHT,
  TEXT_PAD,
  TEXT_PX,
  type PlacedShape,
  type Point,
  type Rect,
} from "./whiteboard.js";

/** What a drag on the board does: selects and moves, or draws one of these. */
export type Tool = "select" | "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "pen" | "text";

const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode }[] = [
  { tool: "select", label: "Select and move", key: "V", icon: <path d="M4 3 L4 15 L7.5 11.5 L10 17 L12 16 L9.5 10.5 L14 10.5 Z" /> },
  { tool: "rectangle", label: "Rectangle", key: "R", icon: <rect x="3" y="5" width="14" height="10" rx="2" /> },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: <ellipse cx="10" cy="10" rx="7.5" ry="5.5" /> },
  { tool: "diamond", label: "Diamond", key: "D", icon: <path d="M10 3 L17 10 L10 17 L3 10 Z" /> },
  { tool: "arrow", label: "Arrow", key: "A", icon: <path d="M3 16 L16 4 M9 4 L16 4 L16 11" /> },
  { tool: "line", label: "Line", key: "L", icon: <path d="M3 16 L17 4" /> },
  { tool: "pen", label: "Pen", key: "P", icon: <path d="M3 14 C 6 6, 8 18, 11 10 S 15 6, 17 8" /> },
  { tool: "text", label: "Text", key: "T", icon: <path d="M4 5 L16 5 M10 5 L10 16 M7 16 L13 16" /> },
];
const TOOL_KEYS = new Map(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));
/** The tools that draw a shape from corner to corner. */
const BOXES: readonly Tool[] = ["rectangle", "ellipse", "diamond"];

type ShapeNodeData = {
  shape: Shape;
  /** Showing a text box in place of the text. */
  editing: boolean;
  onEdit(): void;
  /** The new text, or null to keep the old one. */
  onDone(text: string | null): void;
  /** Its new corner and size, once it's been resized. */
  onResize(box: Rect): void;
};
type ShapeFlowNode = Node<ShapeNodeData, "shape">;
/** A grip on an arrow's end: always there for an end at a point, which it is, and on the selected arrow's ends. */
type EndFlowNode = Node<{ arrow: string; end: "from" | "to" }, "end">;
type FlowNode = ShapeFlowNode | StickyFlowNode | EndFlowNode;

type ArrowEdgeData = {
  arrow: Arrow;
  from: Point;
  to: Point;
  /** Its text's place in front of the rest, so the arrows' lines don't cross it. */
  labelZ: number;
  editing: boolean;
  onEdit(): void;
  onDone(text: string | null): void;
};
type ArrowFlowEdge = Edge<ArrowEdgeData, "arrow">;

const stickyNodeId = (id: string) => `sticky:${id}`;
const endNodeId = (arrow: string, end: "from" | "to") => `end:${arrow}:${end}`;
/** How big an end's grip is: bigger than the dot it draws, so it's easy to grab. */
const GRIP = 18;
/** The smallest a shape can be resized to, across or down. */
const MIN_SIZE = 20;
/** How a view's diagram is fitted to the canvas, as Canvas does. */
const FIT = { padding: 0.15, maxZoom: 1.2 };
const TOUCH = "(any-pointer: coarse)";
/** Over everything on the board: what's being drawn, and the text being typed. */
const DRAWING_Z = STICKY_Z + 2000;
/** How far, on the screen, a drag has to go to draw something, not just click. */
const DRAG_MIN = 6;
/** Whether this is a Mac, asked as it's needed. */
const onMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const isMac = onMac();
const MULTI_KEYS = isMac ? ["Meta", "Shift"] : ["Control", "Shift"];
const addsToSelection = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => e.shiftKey || (isMac ? e.metaKey : e.ctrlKey);
/** Shapes and notes snap as they're dragged, shapes as they're resized too, and they line up with each other. Arrows' ends don't. */
const snapsHere = (n: FlowNode) => n.type !== "end";

/** A text box that saves when it's left, or with Ctrl+Enter (⌘Enter on a Mac), and keeps the text as it was on Escape. */
function TextEditor({ text, className, label, onDone, style }: { text: string; className: string; label: string; onDone(text: string | null): void; style?: React.CSSProperties }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  const fit = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    // A new node stays hidden until React Flow has measured it, and hidden elements can't take focus.
    let frame = 0;
    const focus = () => {
      const el = input.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) {
        el.select();
        fit();
      } else frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, []);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value);
  };
  return (
    <textarea
      ref={input}
      className={`${className} nodrag nowheel nopan`}
      style={style}
      defaultValue={text}
      aria-label={label}
      rows={1}
      onInput={fit}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(null);
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
      }}
    />
  );
}

/** A shape: a sketched outline with its text in it, text on its own, or a line drawn with the pen. */
function ShapeNode({ id, data, selected, width, height }: NodeProps<ShapeFlowNode>) {
  const { shape, editing } = data;
  const connection = useConnection();
  // While someone drags a new arrow, the whole shape is a drop target.
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  const box = shapeBox(shape);
  // React Flow gives the size it measured, which is 0 before it has: text without a size of its own is as big as what it says.
  const sized = shape.at.length === 4 || shape.kind !== "text";
  const [w, h] = [width || box.w, height || box.h];
  const outlined = shape.kind === "rectangle" || shape.kind === "ellipse" || shape.kind === "diamond";
  const sketch = useMemo(() => (outlined ? shapeSketch(shape.kind, w, h, seedOf(shape.id), { filled: !!shape.fill, dashed: shape.dashed }) : null), [outlined, shape, w, h]);
  const text = shape.text ?? "";
  const classes = [
    "wb-shape",
    `wb-shape-${shape.kind}`,
    sized ? "sized" : "",
    `wb-ink-${shape.color}`,
    shape.fill ? `wb-fill-${shape.fill}` : "",
    `wb-size-${shape.size}`,
    shape.dashed ? "dashed" : "",
    selected ? "selected" : "",
    editing ? "editing" : "",
    "nopan",
  ];
  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      // Text grows taller than its box when what it says doesn't fit.
      style={!sized ? undefined : shape.kind === "text" ? { width: w, minHeight: shape.at[3] } : { width: w, height: h }}
      onDoubleClick={shape.kind === "pen" ? undefined : data.onEdit}
    >
      {shape.kind !== "pen" && <NodeResizer isVisible={selected && !editing} color="var(--accent)" minWidth={MIN_SIZE} minHeight={MIN_SIZE} onResizeEnd={(_, r) => data.onResize({ x: r.x, y: r.y, w: r.width, h: r.height })} />}
      <Handle type="target" position={Position.Top} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      {sketch && (
        <svg className="wb-sketch" width={w} height={h} aria-hidden="true">
          {sketch.fill.map((d, i) => (
            <path key={`f${i}`} className="wb-fill" d={d} />
          ))}
          {sketch.stroke.map((d, i) => (
            <path key={`s${i}`} className="wb-stroke" d={d} />
          ))}
        </svg>
      )}
      {shape.kind === "pen" && (
        <svg className="wb-sketch" width={w} height={h} aria-hidden="true">
          <path className="wb-pen-line" d={penPath(shape.points, shape.at[0] - box.x, shape.at[1] - box.y)} />
        </svg>
      )}
      {shape.kind !== "pen" &&
        (editing ? (
          <TextEditor text={text} className="wb-text wb-editor" label={`${SHAPE_KIND_LABELS[shape.kind]} text`} onDone={data.onDone} />
        ) : (
          text && <div className="wb-text">{text}</div>
        ))}
      {/* A pen's line can be pointed to, by drawing an arrow to it, but has no dot to drag one from. */}
      {shape.kind === "pen" ? (
        <Handle type="source" position={Position.Bottom} className="handle-hidden" isConnectable={false} />
      ) : (
        <Handle type="source" position={Position.Bottom} className="handle-source" title="Drag to another shape to draw an arrow, or anywhere to draw one there" />
      )}
    </div>
  );
}

/** A grip on an arrow's end, to drag it to another shape or a point. */
function EndNode({ selected }: NodeProps<EndFlowNode>) {
  return (
    <div className={`wb-end${selected ? " selected" : ""}`}>
      <Handle type="source" position={Position.Top} className="handle-hidden" isConnectable={false} />
    </div>
  );
}

/** An arrow, or a line, sketched from one end to the other, with its text in the middle. */
function ArrowLine({ id, data, selected }: EdgeProps<ArrowFlowEdge>) {
  const sketch = useMemo(() => (data ? arrowSketch(data.from, data.to, data.arrow.heads, seedOf(data.arrow.id), data.arrow.dashed) : null), [data]);
  if (!data || !sketch) return null;
  const { arrow, from, to } = data;
  const at = middle(from, to);
  return (
    <>
      <g className={`wb-arrow wb-ink-${arrow.color}${arrow.dashed ? " dashed" : ""}${selected ? " selected" : ""}`}>
        {sketch.line.map((d, i) => (
          <path key={`l${i}`} className="react-flow__edge-path wb-stroke wb-line" d={d} />
        ))}
        {sketch.heads.map((d, i) => (
          <path key={`h${i}`} className="react-flow__edge-path wb-stroke" d={d} />
        ))}
        <path id={id} className="react-flow__edge-interaction" d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} fill="none" strokeOpacity={0} strokeWidth={18} />
      </g>
      {(arrow.text || data.editing) && (
        <EdgeLabelRenderer>
          <div
            className={`wb-label wb-ink-${arrow.color}${selected ? " selected" : ""} nodrag nopan`}
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`, zIndex: data.labelZ }}
            onDoubleClick={data.onEdit}
          >
            {data.editing ? <TextEditor text={arrow.text ?? ""} className="wb-label-editor" label="Arrow text" onDone={data.onDone} /> : arrow.text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** The shapes as drawn now, for the line drawn while an arrow is dragged from a shape's dot. */
const BoardShapes = createContext<{ shapes: readonly PlacedShape[]; placed: ReadonlyMap<string, PlacedShape> }>({ shapes: [], placed: new Map() });

/**
 * The arrow being dragged from a shape's dot, straight to where it goes if it's let go now: the
 * side of a shape, as the dots show, the shape, or the pointer. React Flow's own line would go to
 * the shape's handle instead.
 */
function ConnectingLine({ fromNode, pointer, toNode, connectionStatus }: ConnectionLineComponentProps) {
  const { shapes, placed } = useContext(BoardShapes);
  const rf = useReactFlow();
  const { x, y, zoom } = rf.getViewport();
  // React Flow gives where the pointer is from the board's corner, on the screen.
  const p = { x: (pointer.x - x) / zoom, y: (pointer.y - y) / zoom };
  const onto = dropEnd(shapes, p, SIDE_REACH / zoom, fromNode.id, connectionStatus === "valid" ? toNode?.id : undefined);
  const ends = arrowEnds({ from: fromNode.id, to: onto ?? [p.x, p.y] }, placed);
  if (!ends) return null;
  return <path className="wb-connecting" d={`M ${ends.from.x} ${ends.from.y} L ${ends.to.x} ${ends.to.y}`} />;
}

const nodeTypes = { shape: ShapeNode, sticky: StickyNode, end: EndNode };
const edgeTypes = { arrow: ArrowLine };

/** What's being drawn: where the drag started and is now, and the pen's points. */
interface Drawing {
  tool: Tool;
  pointer: number;
  start: Point;
  now: Point;
  points: Point[];
}

interface WhiteboardDiagramProps {
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  edit(edit: Edit): Promise<boolean>;
  /** What the right-click menus need from the designer. */
  menus: MenuHost;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
  /** What shapes and notes snap to as they're dragged or resized, and its buttons. */
  snap: SnapControl;
}

/** A rectangle from one corner to the other, whichever way it was dragged. */
function between(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function WhiteboardDiagram({ computed: cv, selection, onSelect, edit, menus, exportItems, snap }: WhiteboardDiagramProps) {
  const view = cv.view;
  const rf = useReactFlow<FlowNode, ArrowFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const stickySize = useMediaQuery(TOUCH) ? TOUCH_STICKY : STICKY;
  const [tool, setTool] = useState<Tool>("select");
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  /** Text being typed where there's no shape yet: it becomes one when it's saved. */
  const [draft, setDraft] = useState<Point | null>(null);
  /** The shape, note or arrow whose text is being edited in place. */
  const [editing, setEditing] = useState<{ kind: "shape" | "sticky" | "arrow"; id: string } | null>(null);
  /** Where arrows' ends are while they're dragged, until the move is saved. */
  const [ends, setEnds] = useState<ReadonlyMap<string, Point>>(new Map());
  /** The grip of an arrow's end being dragged on its own, which goes onto what it's let go on. */
  const [grip, setGrip] = useState<string | null>(null);
  /** Where the pointer is on the board while the arrow or line tool is picked, to show the sides of the shape under it. */
  const [hover, setHover] = useState<Point | null>(null);
  /** The shape and side the dots show for `hover`, so moving the pointer draws them again only when that changes. */
  const hoverKey = useRef("");
  /** No dots for where the pointer was: it's pressed to draw, or the board moved or zoomed under it, until it moves again. */
  const clearHover = useCallback(() => {
    if (!hoverKey.current) return;
    hoverKey.current = "";
    setHover(null);
  }, []);
  const [nodes, setNodes] = useState<(ShapeFlowNode | StickyFlowNode)[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** IDs given to shapes and arrows not yet in the view, as their edits wait their turn to be saved: the next one mustn't take them too. */
  const issued = useRef(new Set<string>());
  /** Changed to draw the shapes and notes where the file has them again, as after a move that couldn't be saved. */
  const [redraw, setRedraw] = useState(0);
  /** A drag just ended in drawing something: the click that follows it isn't a click on the board. */
  const drew = useRef(false);

  const items = boardItemsOf(selection);
  const selectedArrow = selection?.kind === "boardArrow" ? selection.id : null;

  useEffect(() => {
    // An ID given out is the view's own once its edit has landed. Edits still waiting keep theirs.
    issued.current = new Set([...issued.current].filter((id) => !view.shapes.some((s) => s.id === id) && !view.arrows.some((a) => a.id === id)));
    setEnds(new Map());
  }, [view]);

  /**
   * Adds a shape or an arrow, with its kind as its ID, or its kind and a number, that nothing has,
   * not even what an edit still on its way adds, and selects it once it's saved. A refused one
   * frees the ID again. It's selected straight on from the edit, as an edit's own select is on
   * every view: a right-click menu waiting for the edit opens a step after, on what was clicked.
   */
  const addNew = (base: string, make: (id: string) => Operation, selects?: (id: string) => Selection) => {
    const id = uniqueAmong([...view.shapes.map((s) => s.id), ...view.arrows.map((a) => a.id), ...issued.current], base);
    issued.current.add(id);
    void edit([make(id)]).then((ok) => {
      if (!ok) issued.current.delete(id);
      else if (selects) select(selects(id));
    });
  };

  const finishShape = useCallback(
    (shape: Shape, text: string | null) => {
      setEditing(null);
      if (text === null || text === (shape.text ?? "")) return;
      // Text with nothing to say would be nothing on the board: it goes.
      if (shape.kind === "text" && !text.trim()) void edit([{ op: "remove-shape", view: view.id, id: shape.id }]).then((ok) => ok && onSelect(null));
      else void edit([{ op: "update-shape", view: view.id, id: shape.id, text: text === "" ? null : text }]);
    },
    [edit, view.id, onSelect],
  );
  const finishSticky = useCallback(
    (sticky: Sticky, text: string | null) => {
      setEditing(null);
      if (text === null || !text.trim() || text.trim() === sticky.text) return;
      void edit([{ op: "update-sticky", view: view.id, id: sticky.id, text }]);
    },
    [edit, view.id],
  );
  const { snapChanges, dropped, resized, guides } = useSnap<FlowNode>(snap.settings, { snaps: snapsHere, isTarget: snapsHere, minSize: MIN_SIZE });
  const resize = useCallback(
    (shape: Shape, box: Rect) => {
      // As it's drawn: snapped, as it was when it was let go.
      const r = resized(shape.id, box);
      void edit([{ op: "update-shape", view: view.id, id: shape.id, at: [Math.round(r.x), Math.round(r.y), Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h))] }]);
    },
    [edit, view.id, resized],
  );

  useEffect(() => {
    const boxes = view.shapes.map((s) => shapeBox(s));
    const stickyAt = placeStickies(view.stickies, boxes.map((b) => ({ x: b.x, y: b.y })), stickySize);
    setNodes((previous) => [
      ...view.shapes.map((shape, i): ShapeFlowNode => {
        const box = boxes[i]!;
        // Text is as tall as what it says, at least: React Flow measures it.
        const size = shape.kind === "text" ? (shape.at.length === 4 ? { width: box.w } : {}) : { width: box.w, height: box.h };
        return {
          id: shape.id,
          type: "shape",
          position: { x: box.x, y: box.y },
          ...size,
          data: {
            shape,
            editing: editing?.kind === "shape" && editing.id === shape.id,
            onEdit: () => setEditing({ kind: "shape", id: shape.id }),
            onDone: (text) => finishShape(shape, text),
            onResize: (r) => resize(shape, r),
          },
          selected: items.shapes.includes(shape.id),
          measured: previous.find((p) => p.id === shape.id)?.measured,
          // Each over the ones before it; a pen's line can't be connected to by dragging, only drawn to.
          zIndex: shape.number,
          connectable: shape.kind !== "pen",
        };
      }),
      ...view.stickies.map(
        (sticky): StickyFlowNode => ({
          id: stickyNodeId(sticky.id),
          type: "sticky",
          position: stickyAt[sticky.id]!,
          data: { sticky, editing: editing?.kind === "sticky" && editing.id === sticky.id, onEdit: () => setEditing({ kind: "sticky", id: sticky.id }), onDone: (text) => finishSticky(sticky, text) },
          selected: items.stickies.includes(sticky.id),
          measured: previous.find((p) => p.id === stickyNodeId(sticky.id))?.measured,
          connectable: false,
          zIndex: STICKY_Z,
        }),
      ),
    ]);
    // The items' lists are new each render; what they hold is in `selection`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selection, editing, finishShape, finishSticky, resize, stickySize, redraw]);

  /** Each shape as drawn now, from the back to the front, measured once it has been. */
  const placed = useMemo(() => {
    const out = new Map<string, PlacedShape>();
    for (const n of nodes) {
      if (n.type !== "shape") continue;
      const own = shapeBox(n.data.shape, n.measured);
      out.set(n.id, { id: n.id, kind: n.data.shape.kind, box: { x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? own.w, h: n.height ?? n.measured?.height ?? own.h } });
    }
    return out;
  }, [nodes]);
  const inOrder = useMemo(() => view.shapes.flatMap((s) => placed.get(s.id) ?? []), [view, placed]);
  const boardShapes = useMemo(() => ({ shapes: inOrder, placed }), [inOrder, placed]);
  const inOrderRef = useRef(inOrder);
  inOrderRef.current = inOrder;

  /**
   * Where each arrow's ends are drawn now: dragged ends where they're dragged, the rest from their
   * shapes. A grip dragged on its own is drawn on what it goes onto if it's let go there.
   */
  const lines = useMemo(() => {
    const out = new Map<string, { from: Point; to: Point }>();
    for (const a of view.arrows) {
      const moved = { from: ends.get(endNodeId(a.id, "from")), to: ends.get(endNodeId(a.id, "to")) };
      let arrow: { from: ArrowEnd; to: ArrowEnd } = a;
      for (const end of ["from", "to"] as const) {
        const at = moved[end];
        if (!at || grip !== endNodeId(a.id, end)) continue;
        const onto = endAt(inOrder, at, SIDE_REACH / rf.getZoom(), endShape(a[end === "from" ? "to" : "from"]));
        if (onto) {
          arrow = { ...arrow, [end]: onto };
          moved[end] = undefined;
        }
      }
      const at = arrowEnds(arrow, placed, moved);
      if (at) out.set(a.id, at);
    }
    return out;
  }, [view, placed, ends, grip, inOrder, rf]);

  const zArrows = view.shapes.length + 1;
  /** Grips on arrows' ends: on each end at a point, and on both ends of the arrow selected. */
  const endNodes = useMemo(
    () =>
      view.arrows.flatMap((a): EndFlowNode[] => {
        const at = lines.get(a.id);
        if (!at) return [];
        return (["from", "to"] as const).flatMap((end): EndFlowNode[] => {
          const point = Array.isArray(a[end]);
          if (!point && selectedArrow !== a.id) return [];
          return [
            {
              id: endNodeId(a.id, end),
              type: "end",
              position: { x: at[end].x - GRIP / 2, y: at[end].y - GRIP / 2 },
              width: GRIP,
              height: GRIP,
              measured: { width: GRIP, height: GRIP },
              data: { arrow: a.id, end },
              // Selected with the arrow among others, so it moves with them; on its own, each grip moves alone.
              selected: point && items.arrows.includes(a.id) && selection?.kind === "board",
              className: selectedArrow === a.id || (point && items.arrows.includes(a.id)) ? "shown" : "",
              connectable: false,
              zIndex: zArrows + 1,
            },
          ];
        });
      }),
    // The items' lists are new each render; what they hold is in `selection`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, lines, selectedArrow, selection, zArrows],
  );
  const drawn = useMemo<FlowNode[]>(() => [...nodes, ...endNodes], [nodes, endNodes]);
  const drawingArrow = !!drawing && (drawing.tool === "arrow" || drawing.tool === "line");
  /** The shape an arrow being drawn starts on, which its other end can't go onto too. */
  const drawingFrom = useMemo(() => {
    if (!drawing || (drawing.tool !== "arrow" && drawing.tool !== "line")) return undefined;
    const start = endAt(inOrder, drawing.start, SIDE_REACH / rf.getZoom());
    return start === undefined ? undefined : endShape(start);
    // Only where it starts matters, not where the pointer is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing?.start, drawing?.tool, inOrder, rf]);
  /** The shape at the other end of the arrow whose grip is dragged, which that end can't go onto too. */
  const gripOther = useMemo(() => {
    for (const a of view.arrows) for (const [end, other] of [["from", "to"], ["to", "from"]] as const) if (grip === endNodeId(a.id, end)) return endShape(a[other]);
    return undefined;
  }, [view, grip]);

  const finishArrow = useCallback(
    (arrow: Arrow, text: string | null) => {
      setEditing(null);
      if (text === null || text === (arrow.text ?? "")) return;
      void edit([{ op: "update-arrow", view: view.id, id: arrow.id, text: text === "" ? null : text }]);
    },
    [edit, view.id],
  );

  const edges = useMemo<ArrowFlowEdge[]>(
    () =>
      view.arrows.flatMap((a): ArrowFlowEdge[] => {
        const at = lines.get(a.id);
        if (!at) return [];
        const nodeOf = (end: "from" | "to") => endShape(a[end]) ?? endNodeId(a.id, end);
        return [
          {
            id: `arrow:${a.id}`,
            type: "arrow",
            source: nodeOf("from"),
            target: nodeOf("to"),
            zIndex: zArrows,
            selected: items.arrows.includes(a.id),
            data: { arrow: a, from: at.from, to: at.to, labelZ: zArrows + 1, editing: editing?.kind === "arrow" && editing.id === a.id, onEdit: () => setEditing({ kind: "arrow", id: a.id }), onDone: (text) => finishArrow(a, text) },
          },
        ];
      }),
    // The items' lists are new each render; what they hold is in `selection`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, lines, selection, editing, finishArrow, zArrows],
  );

  /** The nodes a drag across the background selects, as it selects them. */
  const boxed = useRef<Set<string> | null>(null);

  const onNodesChange = useCallback(
    (made: NodeChange<FlowNode>[]) => {
      const changes = snapChanges(made);
      const picking = boxed.current;
      if (picking) for (const c of changes) if (c.type === "select") c.selected ? picking.add(c.id) : picking.delete(c.id);
      const moved = changes.flatMap((c) => (c.type === "position" && c.position && c.id.startsWith("end:") ? [[c.id, { x: c.position.x + GRIP / 2, y: c.position.y + GRIP / 2 }] as const] : []));
      if (moved.length) setEnds((before) => new Map([...before, ...moved]));
      // Only this diagram selects: React Flow's own selecting would undo it.
      setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== "select" && (!("id" in c) || !c.id.startsWith("end:"))) as NodeChange<ShapeFlowNode | StickyFlowNode>[], nds));
    },
    [snapChanges],
  );

  const select = useCallback((s: Selection) => onSelect(s), [onSelect]);

  /** Adds this shape, arrow or note to the selection, or takes it out. */
  const toggle = (which: "shapes" | "arrows" | "stickies", id: string) => {
    const now = boardItemsOf(selection);
    const list = now[which].includes(id) ? now[which].filter((x) => x !== id) : [...now[which], id];
    select(selectBoard({ ...now, [which]: list }));
  };

  const onNodeDragStop = useCallback(
    (_: unknown, _node: FlowNode, letGo: FlowNode[]) => {
      const moves = dropped(letGo).map((n): Moved => {
        if (n.type === "shape") return { kind: "shape", id: n.id, position: n.position };
        if (n.type === "sticky") return { kind: "sticky", id: (n as StickyFlowNode).data.sticky.id, position: n.position };
        const { arrow, end } = (n as EndFlowNode).data;
        return { kind: "end", arrow, end, point: { x: n.position.x + GRIP / 2, y: n.position.y + GRIP / 2 } };
      });
      setGrip(null);
      const ops = moveOps(view, moves, inOrder, SIDE_REACH / rf.getZoom());
      // A move that isn't saved is undone: everything goes back where the file has it.
      const undo = () => {
        setEnds(new Map());
        setRedraw((n) => n + 1);
      };
      if (ops.length) void edit(ops).then((ok) => !ok && undo());
      else undo();
    },
    [edit, view, dropped, inOrder, rf],
  );

  /** Draws an arrow from a shape to another, or to a point. */
  const addArrow = useCallback(
    (from: ArrowEnd, to: ArrowEnd, line = false) => {
      addNew(line ? "line" : "arrow", (id) => ({ op: "add-arrow", view: view.id, id, from, to, heads: line ? "none" : undefined }), (id) => ({ kind: "boardArrow", id }));
    },
    // addNew reads the view, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edit, view, select],
  );

  // An arrow dragged from a shape's dot goes to the side of a shape it's dropped near, the shape
  // it's dropped on, or else to where it's dropped. React Flow says which shape, but not where on it.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!state.fromNode || !placed.has(state.fromNode.id)) return;
      const touch = "changedTouches" in event ? event.changedTouches[0] : undefined;
      const client = touch ?? (event as MouseEvent);
      const at = rf.screenToFlowPosition({ x: client.clientX, y: client.clientY });
      const onto = dropEnd(inOrder, at, SIDE_REACH / rf.getZoom(), state.fromNode.id, state.isValid ? state.toNode?.id : undefined);
      if (onto) addArrow(state.fromNode.id, onto);
      else if (!inBox(placed.get(state.fromNode.id)!.box, at)) addArrow(state.fromNode.id, [Math.round(at.x), Math.round(at.y)]);
    },
    [placed, inOrder, rf, addArrow],
  );

  /** The middle of the canvas, on the diagram. */
  const middleOfCanvas = (): Point => {
    const rect = wrapper.current!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  /** Adds a shape, and selects it. */
  const addShape = (kind: ShapeKind, at: [number, number, number, number]) => {
    addNew(kind, (id) => ({ op: "add-shape", view: view.id, id, kind, at }), (id) => ({ kind: "shape", id }));
  };

  /** + Add's shapes go in the middle of the canvas, where nothing else starts. */
  const addInMiddle = (kind: ShapeKind) => {
    const c = middleOfCanvas();
    const occupied = nodesRef.current.map((n) => n.position);
    const spot = freeSpotAmong({ x: c.x - 80, y: c.y - 40 }, occupied);
    addShape(kind, [Math.round(spot.x), Math.round(spot.y), 160, 80]);
  };

  /** A new note goes in the middle of the canvas, or from a right-click menu, where that was. */
  const addSticky = (at?: Point) => {
    const c = at ?? middleOfCanvas();
    const id = newStickyId(view);
    const occupied = nodesRef.current.map((n) => n.position);
    const spot = freeSpotAmong({ x: c.x - stickySize.width / 2, y: c.y - 50 }, occupied);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", at: [Math.round(spot.x), Math.round(spot.y)] }]).then((ok) => {
      if (!ok) return;
      select({ kind: "sticky", id });
      setEditing({ kind: "sticky", id });
    });
  };

  /** Saves text typed where there was no shape, as a text shape there. */
  const finishDraft = (text: string | null) => {
    const at = draft;
    setDraft(null);
    setTool("select");
    if (!at || text === null || !text.trim()) return;
    addNew("text", (id) => ({ op: "add-shape", view: view.id, id, kind: "text", text, at: [Math.round(at.x), Math.round(at.y)] }), (id) => ({ kind: "shape", id }));
  };

  /** What a drag with a drawing tool made, once it's let go. */
  const finishDrawing = (d: Drawing) => {
    const zoom = rf.getZoom();
    if (BOXES.includes(d.tool)) {
      addShape(d.tool as ShapeKind, drawnBox(d.start, d.now, zoom));
      setTool("select");
    } else if (d.tool === "arrow" || d.tool === "line") {
      const ends = drawnArrowEnds(d.start, d.now, inOrder, zoom);
      if (!ends) return;
      addArrow(ends.from, ends.to, d.tool === "line");
      setTool("select");
    } else if (d.tool === "pen") {
      // Points nearer the line than a pixel on the screen add nothing to it.
      const line = simplifyLine(d.points, 1 / zoom);
      addNew("pen", (id) => ({ op: "add-shape", view: view.id, id, kind: "pen", at: line.at, points: line.points }));
    } else if (d.tool === "text") {
      // On a shape that has text, the text tool writes in it.
      const on = view.shapes.find((s) => s.id === shapeAt(inOrder, d.start));
      if (on && on.kind !== "pen") {
        setTool("select");
        select({ kind: "shape", id: on.id });
        setEditing({ kind: "shape", id: on.id });
      } else setDraft(textCorner(d.start));
    }
  };
  const finishRef = useRef(finishDrawing);
  finishRef.current = finishDrawing;

  // With a drawing tool, a drag anywhere on the board draws, over the shapes and notes too.
  useEffect(() => {
    const el = wrapper.current;
    if (!el || tool === "select") return;
    let current: Drawing | null = null;
    const flow = (e: PointerEvent) => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const down = (e: PointerEvent) => {
      const target = e.target as Element;
      // A Ctrl-click on a Mac is a right-click, sent as a press of the left button: it opens a menu, and draws nothing.
      if (e.button !== 0 || (e.ctrlKey && onMac()) || target.closest(".react-flow__panel, .wb-text-draft, textarea, input, button, select, a")) return;
      // A click away from text being typed saves it, and draws nothing.
      if (document.activeElement instanceof HTMLTextAreaElement && el.contains(document.activeElement)) {
        e.preventDefault();
        document.activeElement.blur();
        return;
      }
      // A second finger is a pinch, to zoom: what the first started isn't drawn.
      if (current) {
        current = null;
        setDrawing(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      clearHover();
      // Its moves come here even off the board, and its letting go off the window too.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the page no longer knows of, as a test's, draws all the same.
      }
      const at = flow(e);
      current = { tool, pointer: e.pointerId, start: at, now: at, points: [at] };
      setDrawing(current);
    };
    const move = (e: PointerEvent) => {
      if (!current && (tool === "arrow" || tool === "line")) {
        // Drawn again only when the dots would show another shape, or another side of it.
        const at = e.target instanceof Element && el.contains(e.target) ? flow(e) : null;
        const end = at && endAt(inOrderRef.current, at, SIDE_REACH / rf.getZoom());
        const key = end ? `${endShape(end)} ${endSide(end) ?? ""}` : "";
        if (key !== hoverKey.current) {
          hoverKey.current = key;
          setHover(end ? at : null);
        }
      }
      if (!current || e.pointerId !== current.pointer) return;
      const at = flow(e);
      current = { ...current, now: at, points: current.tool === "pen" ? [...current.points, at] : current.points };
      setDrawing(current);
    };
    const up = (e: PointerEvent) => {
      if (!current || e.pointerId !== current.pointer) return;
      const at = flow(e);
      const done = { ...current, now: at, points: current.tool === "pen" ? [...current.points, at] : current.points };
      current = null;
      setDrawing(null);
      drew.current = true;
      setTimeout(() => (drew.current = false), 0);
      finishRef.current(done);
    };
    const cancel = (e: PointerEvent) => {
      if (current && e.pointerId === current.pointer) {
        current = null;
        setDrawing(null);
      }
    };
    el.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrawing(null);
      setHover(null);
      hoverKey.current = "";
    };
  }, [tool, rf]);

  // A tool's key picks it, Escape goes back to selecting, and Enter writes in the shape selected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, dialog, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const picked = TOOL_KEYS.get(e.key.toLowerCase());
      if (picked) {
        e.preventDefault();
        setTool(picked);
      } else if (e.key === "Escape") setTool("select");
      else if (e.key === "Enter" && !(e.target as HTMLElement).closest("button, a") && selection?.kind === "shape" && view.shapes.find((s) => s.id === selection.id)?.kind !== "pen") {
        e.preventDefault();
        setEditing({ kind: "shape", id: selection.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, view]);

  const fitDiagram = useCallback(
    (options: { padding: number; maxZoom?: number } = FIT) => {
      const canvas = wrapper.current;
      const toolbar = canvas?.querySelector(".toolbar");
      if (!canvas || !toolbar) return void rf.fitView(options);
      void rf.fitView(fitBelowToolbar(options, canvas.clientHeight, toolbar.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top));
    },
    [rf],
  );

  // Fit the diagram to the window once, after its shapes have been measured. A whiteboard that
  // opens empty isn't fitted round the first shape drawn on it: that would move the board under the pen.
  const fitted = useRef(view.shapes.length === 0 && view.arrows.length === 0 && view.stickies.length === 0);
  useEffect(() => {
    if (fitted.current || drawn.length === 0) return;
    fitted.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => fitDiagram()));
  }, [drawn, fitDiagram]);

  /** What's being drawn, over everything, where it will go. */
  const preview = (() => {
    if (!drawing) return null;
    const d = drawing;
    if (BOXES.includes(d.tool)) {
      const r = between(d.start, d.now);
      if (r.w < 2 || r.h < 2) return null;
      const sketch = shapeSketch(d.tool as ShapeKind, r.w, r.h, 1);
      return (
        <g transform={`translate(${r.x} ${r.y})`}>
          {sketch.stroke.map((p, i) => (
            <path key={i} className="wb-stroke" d={p} />
          ))}
        </g>
      );
    }
    if (d.tool === "arrow" || d.tool === "line") {
      const drawn = drawnArrowEnds(d.start, d.now, inOrder, rf.getZoom());
      const ends = drawn && arrowEnds(drawn, placed);
      if (!ends) return null;
      const sketch = arrowSketch(ends.from, ends.to, d.tool === "line" ? "none" : "end", 1);
      return [...sketch.line, ...sketch.heads].map((p, i) => <path key={i} className="wb-stroke" d={p} />);
    }
    if (d.tool === "pen") return <path className="wb-pen-line" d={penPath(d.points.map((p) => [p.x, p.y] as [number, number]))} />;
    return null;
  })();

  /**
   * What + Add adds, in the middle of the canvas, and the background's right-click menu, where the
   * click was: a shape with its middle there, as it's meant to go just there, text beside the
   * point, as a double-click types it, and a note by it.
   */
  const addItems = (at?: Point): MenuAction[] => [
    ...(["rectangle", "ellipse", "diamond"] as const).map((kind) => ({
      label: SHAPE_KIND_LABELS[kind],
      onSelect: () => (at ? addShape(kind, [Math.round(at.x - 80), Math.round(at.y - 40), 160, 80]) : addInMiddle(kind)),
    })),
    { label: "Text", onSelect: () => setDraft(textCorner(at ?? middleOfCanvas())) },
    { label: "Sticky note", divider: true, onSelect: () => addSticky(at) },
  ];

  const notes = useContext(NotesOpener);
  const edits: MenuEdits = { edit, select };
  const named = (text: string) => text[0]!.toUpperCase() + text.slice(1);
  /** The colours a shape or an arrow can be given: every one but its own. */
  const colours = (now: string, set: (color: (typeof SHAPE_COLORS)[number]) => () => void): MenuAction[] => SHAPE_COLORS.filter((color) => color !== now).map((color) => ({ label: named(color), onSelect: set(color) }));

  // Each item does what it does in the details, which have them all too, or what a double-click does.
  const shapeMenu = (shape: Shape): MenuItem[] => {
    const set = (fields: Omit<Extract<Operation, { op: "update-shape" }>, "op" | "view" | "id">) => () => void edit([{ op: "update-shape", view: view.id, id: shape.id, ...fields }]);
    const pen = shape.kind === "pen";
    const count = view.shapes.length;
    // Text with nothing to say would be nothing on the board, so a shape with none can't be made text alone.
    const kinds = (["rectangle", "ellipse", "diamond", "text"] as const).filter((kind) => kind !== shape.kind && (kind !== "text" || !!shape.text?.trim()));
    const fills: MenuAction[] = [
      ...(shape.fill ? [{ label: "None: see-through", onSelect: set({ fill: null }) }] : []),
      ...SHAPE_FILLS.filter((fill) => fill !== shape.fill).map((fill) => ({ label: named(fill), onSelect: set({ fill }) })),
    ];
    return withDelete(
      edits,
      [
        // A line drawn with the pen has no text, and is no other shape.
        ...(pen
          ? []
          : [
              { label: "Edit text", onSelect: () => setEditing({ kind: "shape", id: shape.id }) },
              { label: "Shape", items: kinds.map((kind) => ({ label: SHAPE_KIND_LABELS[kind], onSelect: set({ kind }) })) },
            ]),
        { label: "Colour", items: colours(shape.color, (color) => set({ color })) },
        ...(pen
          ? []
          : [
              { label: "Fill", items: fills },
              { label: "Text size", items: TEXT_SIZES.filter((size) => size !== shape.size).map((size) => ({ label: named(size), onSelect: set({ size }) })) },
            ]),
        ...(shape.kind === "text" ? [] : [{ label: shape.dashed ? "Make it solid" : "Make it dashed", onSelect: set({ dashed: !shape.dashed }) }]),
        ...(shape.number < count ? [{ label: "Bring to front", onSelect: set({ position: count }) }] : []),
        ...(shape.number > 1 ? [{ label: "Send to back", onSelect: set({ position: 1 }) }] : []),
      ],
      "Delete",
      { op: "remove-shape", view: view.id, id: shape.id },
    );
  };

  const arrowMenu = (arrow: Arrow): MenuItem[] => {
    const set = (fields: Omit<Extract<Operation, { op: "update-arrow" }>, "op" | "view" | "id">) => () => void edit([{ op: "update-arrow", view: view.id, id: arrow.id, ...fields }]);
    /** An end that's on a shape stays on one side of it, or faces the other end. An end at a point has no sides. */
    const side = (end: ArrowEnd, which: "from" | "to"): MenuItem[] => {
      if (!view.shapes.some((s) => s.id === endShape(end))) return [];
      const now = endSide(end);
      const field = which === "from" ? "fromSide" : "toSide";
      return [
        {
          label: which === "from" ? "Side its start is on" : "Side its end is on",
          items: [...(now ? [{ label: "Any side, facing the other end", onSelect: set({ [field]: null }) }] : []), ...ARROW_SIDES.filter((s) => s !== now).map((s) => ({ label: named(s), onSelect: set({ [field]: s }) }))],
        },
      ];
    };
    return withDelete(
      edits,
      [
        { label: "Edit text", onSelect: () => setEditing({ kind: "arrow", id: arrow.id }) },
        { label: "Heads", items: ARROW_HEADS.filter((heads) => heads !== arrow.heads).map((heads) => ({ label: HEADS_TEXT[heads], onSelect: set({ heads }) })) },
        { label: "Colour", items: colours(arrow.color, (color) => set({ color })) },
        { label: arrow.dashed ? "Make it solid" : "Make it dashed", onSelect: set({ dashed: !arrow.dashed }) },
        ...side(arrow.from, "from"),
        ...side(arrow.to, "to"),
      ],
      "Delete",
      { op: "remove-arrow", view: view.id, id: arrow.id },
    );
  };

  /**
   * The right-click menus: for a shape, an arrow or a sticky note, which the click selects, and
   * for the board, after a click on the background. Several selected together stay selected when
   * the click is on one of them, and have a menu of their own. See useDiagramMenu for how one
   * opens and closes.
   */
  const menu = useDiagramMenu({
    view,
    selection,
    select,
    host: menus,
    toDiagram: (point) => rf.screenToFlowPosition(point),
    items: (on, at) => {
      // Everything on a whiteboard is where it was put, so there's nothing to lay out.
      if (on.kind === "diagram") return diagramItems(addItems(at), undefined, exportItems);
      if (on.kind === "board") return [{ label: "Delete them", danger: true, onSelect: () => void edit(whiteboardDeleteOps(view, on)).then((ok) => ok && select(null)) }];
      const shape = on.kind === "shape" && view.shapes.find((s) => s.id === on.id);
      if (shape) return shapeMenu(shape);
      const arrow = on.kind === "boardArrow" && view.arrows.find((a) => a.id === on.id);
      if (arrow) return arrowMenu(arrow);
      const sticky = on.kind === "sticky" && view.stickies.find((s) => s.id === on.id);
      if (!sticky) return [];
      return stickyItems(edits, view.id, sticky, { editText: () => setEditing({ kind: "sticky", id: sticky.id }), openNotes: notes ? () => notes.sticky(sticky.id) : undefined, back: "Move beside the diagram" });
    },
  });
  /** What a right-click on one of these is for: the several selected together, when it's one of them, or else itself. */
  const clicked = (which: "shapes" | "arrows" | "stickies", id: string, alone: Selection): Selection => (selection?.kind === "board" && items[which].includes(id) ? selection : alone);
  /** A stroke being drawn, as the press that started it left it: a menu asked for mid-stroke, as a long press on a touch screen asks for one, isn't opened. */
  const drawingNow = useRef(false);
  drawingNow.current = drawing !== null;
  const openMenu = (event: ReactMouseEvent | MouseEvent, on: Selection) => {
    if (drawingNow.current) return event.preventDefault();
    menu.open(event, on);
  };

  const empty = view.shapes.length === 0 && view.arrows.length === 0 && view.stickies.length === 0;
  const selecting = tool === "select";
  return (
    <div
      className={`canvas whiteboard${selecting ? "" : " drawing"}`}
      ref={wrapper}
      onDoubleClick={(e) => {
        // Double-clicking the background types text there.
        if (!selecting || !(e.target as Element).closest(".react-flow__pane")) return;
        setDraft(textCorner(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })));
      }}
    >
      <BoardShapes.Provider value={boardShapes}>
        <ReactFlow<FlowNode, ArrowFlowEdge>
          nodes={drawn}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnectEnd={onConnectEnd}
          isValidConnection={(c) => c.source !== c.target && placed.has(c.source) && placed.has(c.target)}
          onNodeClick={(event, node) => {
            const picked = pickedBy(node);
            if (drew.current || !selecting || !picked) return;
            if (addsToSelection(event)) toggle(picked.which, picked.id);
            else select(picked.selection);
          }}
          // Dragging swallows the click, so select what's dragged when the drag starts, unless it's
          // already selected, with others it moves with.
          onNodeDragStart={(_, node, dragging) => {
            if (node.type === "end" && dragging.length === 1) setGrip(node.id);
            const picked = pickedBy(node);
            if (picked && !items[picked.which].includes(picked.id)) select(picked.selection);
          }}
          onEdgeClick={(event, edge) => {
            if (drew.current || !selecting || !edge.data) return;
            if (addsToSelection(event)) toggle("arrows", edge.data.arrow.id);
            else select({ kind: "boardArrow", id: edge.data.arrow.id });
          }}
          onEdgeDoubleClick={(_, edge) => edge.data && setEditing({ kind: "arrow", id: edge.data.arrow.id })}
          onMove={clearHover}
          onPaneClick={() => !drew.current && select(null)}
          // A right-click opens a menu whichever tool is picked: only the left button draws.
          onNodeContextMenu={(event, node) => {
            // An arrow's grip is its arrow's.
            if (node.type === "end") return openMenu(event, clicked("arrows", (node as EndFlowNode).data.arrow, { kind: "boardArrow", id: (node as EndFlowNode).data.arrow }));
            const picked = pickedBy(node);
            if (picked) openMenu(event, clicked(picked.which, picked.id, picked.selection));
          }}
          onEdgeContextMenu={(event, edge) => edge.data && openMenu(event, clicked("arrows", edge.data.arrow.id, { kind: "boardArrow", id: edge.data.arrow.id }))}
          onPaneContextMenu={(event) => openMenu(event, null)}
          onSelectionStart={() => {
            boxed.current = new Set();
          }}
          onSelectionEnd={() => {
            const ids = boxed.current;
            boxed.current = null;
            if (ids) select(boxedSelection(view, ids));
          }}
          nodeClickDistance={4}
          paneClickDistance={4}
          // With a mouse, dragging the background selects what's inside, as on other views; the
          // wheel pans, and Ctrl (⌘ on a Mac) with the wheel, or a pinch, zooms. A drawing tool draws instead.
          selectionOnDrag={selecting}
          panOnDrag={selecting ? [1] : false}
          panOnScroll
          nodesDraggable={selecting}
          nodesConnectable={selecting}
          elementsSelectable={selecting}
          zoomOnDoubleClick={false}
          // A selected shape stays where it is among the others, in front of some and behind some.
          elevateNodesOnSelect={false}
          connectionMode={ConnectionMode.Loose}
          connectionLineContainerStyle={{ zIndex: DRAWING_Z }}
          connectionLineComponent={ConnectingLine}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={MULTI_KEYS}
          minZoom={0.1}
          colorMode="system"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
          <SnapGuides guides={guides} />
          {preview && (
            <ViewportPortal>
              <svg className="wb-preview" style={{ zIndex: DRAWING_Z }} aria-hidden="true">
                {preview}
              </svg>
            </ViewportPortal>
          )}
          <SideDots at={drawingArrow ? drawing!.now : grip ? (ends.get(grip) ?? null) : hover} shapes={inOrder} except={drawingArrow ? drawingFrom : gripOther} />
          {draft && (
            <ViewportPortal>
              <div className="wb-text-draft" style={{ transform: `translate(${draft.x}px, ${draft.y}px)`, zIndex: DRAWING_Z }}>
                <TextEditor text="" className="wb-text wb-editor" label="New text" onDone={finishDraft} />
              </div>
            </ViewportPortal>
          )}
          <Controls showInteractive={false} onFitView={() => fitDiagram({ padding: 0.1 })}>
            <SnapButtons snap={snap} />
          </Controls>
          <Panel position="top-left" className="toolbar">
            <div className="toolbar-title">
              <strong>{view.title}</strong>
              <span>whiteboard view</span>
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
          <Panel position="bottom-center" className="wb-tools" aria-label="Drawing tools">
            {TOOLS.map((t) => (
              <button key={t.tool} className={tool === t.tool ? "active" : undefined} aria-pressed={tool === t.tool} aria-label={t.label} title={`${t.label} (${t.key})`} onClick={() => setTool(t.tool)}>
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  {t.icon}
                </svg>
              </button>
            ))}
          </Panel>
        </ReactFlow>
      </BoardShapes.Provider>
      {empty && !drawing && !draft && (
        <div className="empty-hint">
          This whiteboard is empty. Pick a tool at the bottom and drag to draw, or double-click to type.
        </div>
      )}
      {menu.menu}
    </div>
  );
}

/** A node let go after a drag: a shape or a note, where its node is now, or an arrow's end, where its grip's middle is. */
export type Moved = { kind: "shape"; id: string; position: Point } | { kind: "sticky"; id: string; position: Point } | { kind: "end"; arrow: string; end: "from" | "to"; point: Point };

/**
 * The end an arrow gets at a point: on the side of a shape whose point it's within `reach` of, or
 * on the shape it's inside, or none. `shapes` are from the back to the front, and the one in front
 * wins: a point inside a shape goes onto it, or a side of it, not onto a side of one behind it.
 * `except` is the shape at the arrow's other end, which this one can't be on too.
 */
export function endAt(shapes: readonly PlacedShape[], p: Point, reach: number, except?: string): ArrowEnd | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (s.id === except) continue;
    const side = sideNear(s.box, p, reach);
    if (side) return { shape: s.id, side };
    if (contains(s.kind, s.box, p)) return s.id;
  }
  return undefined;
}

/**
 * Where an arrow's end let go at a point goes: as endAt says, or onto `onto`, the shape React Flow
 * joins an arrow dragged from a shape's dot to when it's dropped anywhere on that shape's box, on
 * the side of it the point is near, if any. The side dots show the same.
 */
export function dropEnd(shapes: readonly PlacedShape[], p: Point, reach: number, except?: string, onto?: string): ArrowEnd | undefined {
  const shape = onto === undefined ? undefined : shapes.find((s) => s.id === onto && s.id !== except);
  if (!shape) return endAt(shapes, p, reach, except);
  const side = sideNear(shape.box, p, reach);
  return side ? { shape: shape.id, side } : shape.id;
}

/**
 * The edits that save where shapes, notes and arrows' ends were dragged to. A grip dragged on its
 * own goes onto the side of a shape it's let go near, within `reach`, or onto the shape it's let go
 * on, other than the one at the arrow's other end, facing the other end, or stays at the point;
 * dragged with others, it stays at its point. `shapes` are from the back to the front.
 */
export function moveOps(view: ViewDef, moves: readonly Moved[], shapes: readonly PlacedShape[], reach = 0): Operation[] {
  const ops: Operation[] = [];
  const ends = new Map<string, Partial<Extract<Operation, { op: "update-arrow" }>>>();
  const alone = moves.length === 1 && moves[0]!.kind === "end";
  for (const m of moves) {
    if (m.kind === "sticky") {
      ops.push({ op: "update-sticky", view: view.id, id: m.id, at: [Math.round(m.position.x), Math.round(m.position.y)] });
    } else if (m.kind === "shape") {
      const shape = view.shapes.find((s) => s.id === m.id);
      if (!shape) continue;
      // A node is at its box's corner, and a pen's box is round its points: its own corner is where they start from.
      const box = shapeBox(shape);
      const at: [number, number] = [Math.round(m.position.x + shape.at[0] - box.x), Math.round(m.position.y + shape.at[1] - box.y)];
      if (at[0] !== shape.at[0] || at[1] !== shape.at[1]) ops.push({ op: "update-shape", view: view.id, id: shape.id, at });
    } else {
      const arrow = view.arrows.find((a) => a.id === m.arrow);
      if (!arrow) continue;
      const other = endShape(arrow[m.end === "from" ? "to" : "from"]);
      const onto = alone ? endAt(shapes, m.point, reach, other) : undefined;
      // On a shape away from its sides, the end faces the other end, even on the shape it was on a side of.
      const side = typeof onto === "string" ? { [m.end === "from" ? "fromSide" : "toSide"]: null } : {};
      ends.set(arrow.id, { ...ends.get(arrow.id), [m.end]: onto ?? [Math.round(m.point.x), Math.round(m.point.y)], ...side });
    }
  }
  for (const [id, move] of ends) ops.push({ op: "update-arrow", view: view.id, id, ...move });
  return ops;
}

/**
 * What a drag across the board selects, from the nodes inside it: the shapes and notes, and the
 * arrows all of whose ends are inside too, their shapes or the grips at their points.
 */
export function boxedSelection(view: ViewDef, ids: ReadonlySet<string>): Selection {
  const inside = (a: Arrow, end: "from" | "to") => ids.has(endShape(a[end]) ?? endNodeId(a.id, end));
  return selectBoard({
    shapes: view.shapes.filter((s) => ids.has(s.id)).map((s) => s.id),
    arrows: view.arrows.filter((a) => inside(a, "from") && inside(a, "to")).map((a) => a.id),
    stickies: view.stickies.filter((s) => ids.has(stickyNodeId(s.id))).map((s) => s.id),
  });
}

/**
 * Where a rectangle, ellipse or diamond drawn from one point to another goes: its corner and size.
 * A click, a drag shorter than a few pixels on the screen at this zoom, makes one the usual size,
 * centred on it.
 */
export function drawnBox(start: Point, now: Point, zoom: number): [number, number, number, number] {
  const far = Math.hypot(now.x - start.x, now.y - start.y) * zoom >= DRAG_MIN;
  const r = far ? between(start, now) : { x: start.x - SHAPE_SIZE[0] / 2, y: start.y - SHAPE_SIZE[1] / 2, w: SHAPE_SIZE[0], h: SHAPE_SIZE[1] };
  return [Math.round(r.x), Math.round(r.y), Math.max(10, Math.round(r.w)), Math.max(10, Math.round(r.h))];
}

/**
 * The ends of an arrow drawn from one point to another, each the end it gets there (see endAt):
 * the side of a shape it's near, the shape it's on, or else the point. They're never on one
 * shape. Null for a click, a drag of a few pixels on the screen at this zoom, that isn't from
 * one shape to another.
 */
export function drawnArrowEnds(start: Point, now: Point, shapes: readonly PlacedShape[], zoom: number): { from: ArrowEnd; to: ArrowEnd } | null {
  const reach = SIDE_REACH / zoom;
  const from = endAt(shapes, start, reach);
  const to = endAt(shapes, now, reach, from === undefined ? undefined : endShape(from));
  const far = Math.hypot(now.x - start.x, now.y - start.y) * zoom >= DRAG_MIN;
  if (!far && !(from && to)) return null;
  const point = (p: Point): [number, number] => [Math.round(p.x), Math.round(p.y)];
  return { from: from ?? point(start), to: to ?? point(now) };
}

/**
 * Dots at the sides of the shape under the pointer, or near it, while an arrow is drawn or an end
 * of one dragged: an end let go on one stays on that side of the shape. The one it would go onto
 * is bigger. While an arrow is dragged from a shape's dot, React Flow says where the pointer is.
 */
function SideDots({ at, shapes, except }: { at: Point | null; shapes: readonly PlacedShape[]; except?: string }) {
  const connection = useConnection();
  const rf = useReactFlow();
  const { x, y, zoom } = rf.getViewport();
  // React Flow gives where the pointer is from the board's corner, on the screen.
  const pointer = connection.inProgress ? { x: (connection.pointer.x - x) / zoom, y: (connection.pointer.y - y) / zoom } : null;
  const p = at ?? pointer;
  if (!p) return null;
  const end = connection.inProgress
    ? dropEnd(shapes, p, SIDE_REACH / zoom, connection.fromNode.id, connection.isValid ? connection.toNode?.id : undefined)
    : endAt(shapes, p, SIDE_REACH / zoom, except);
  const shape = end === undefined ? undefined : shapes.find((s) => s.id === endShape(end));
  if (!shape) return null;
  const near = endSide(end!);
  return (
    <ViewportPortal>
      <svg className="wb-sides" style={{ zIndex: DRAWING_Z }} aria-hidden="true">
        {(["top", "right", "bottom", "left"] as const).map((side) => {
          const dot = sidePoint(shape.box, side, 0);
          return <circle key={side} className={side === near ? "near" : undefined} cx={dot.x} cy={dot.y} r={(side === near ? 7 : 5) / rf.getZoom()} />;
        })}
      </svg>
    </ViewportPortal>
  );
}

/** What clicking a node selects: a shape or a sticky note. An arrow's grip selects nothing. */
function pickedBy(node: FlowNode): { which: "shapes" | "stickies"; id: string; selection: Selection } | undefined {
  if (node.type === "shape") return { which: "shapes", id: node.id, selection: { kind: "shape", id: node.id } };
  if (node.type === "sticky") {
    const id = (node as StickyFlowNode).data.sticky.id;
    return { which: "stickies", id, selection: { kind: "sticky", id } };
  }
  return undefined;
}

/** Where text typed at a point goes: its corner, so its first line is beside the point. */
function textCorner(p: Point): Point {
  return { x: Math.round(p.x - TEXT_PAD), y: Math.round(p.y - (TEXT_PX.medium * LINE_HEIGHT) / 2 - TEXT_PAD) };
}

/** Whether a point is inside a box. */
function inBox(box: Rect, p: Point): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}
