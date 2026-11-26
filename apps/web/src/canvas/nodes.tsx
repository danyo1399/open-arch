import { kindLabel, type ArchElement, type Operation, type RelationshipSource, type Sticky } from "@open-arch/core";
import { Handle, NodeResizer, Position, useConnection, useReactFlow, useStore, ViewportPortal, type Node, type NodeProps } from "@xyflow/react";
import { createContext, useContext, useEffect, useRef, type PointerEvent } from "react";
import { stickyName } from "../model.js";
import { STICKY_MIN, type Point } from "./autoLayout.js";
import type { Selection } from "./Canvas.js";
import { DRAG_DISTANCE } from "./RoutedEdge.js";
import type { Rect } from "./stickyLines.js";

export type ElementNodeData = { element: ArchElement; problems: number };
export type ElementFlowNode = Node<ElementNodeData, "element">;

/** `selected` is here rather than on the node: see withFrame. */
export type FrameNodeData = { element: ArchElement; width: number; height: number; selected: boolean };
export type FrameFlowNode = Node<FrameNodeData, "frame">;

export type StickyNodeData = {
  sticky: Sticky;
  /** Showing a text box in place of the text. */
  editing: boolean;
  onEdit(): void;
  /** The new text, or null to keep the old one. */
  onDone(text: string | null): void;
  /**
   * On views of boxes, the note has a dot under it to drag to a box, the frame or an arrow, and put
   * the note on it, and on a flowchart, to a block: the dot is being dragged, and is at this point
   * on the diagram.
   */
  onLinkDrag?(at: Point): void;
  /** The dot let go at this point on the diagram, or null when the drag was cancelled. */
  onLinkDrop?(at: Point | null): void;
  /** What the dot can be dragged to, as its tooltip says: "a box, the frame or an arrow", unless this says. */
  linkTo?: string;
  /** Its new corner and size, once its resizer is let go. Without it, the note has no resizer. */
  onResize?(box: Rect): void;
};
export type StickyFlowNode = Node<StickyNodeData, "sticky">;

/** The edit that gives a note the corner and size it was resized to. */
export function stickyResizeOp(view: string, sticky: Sticky, box: Rect): Operation {
  return { op: "update-sticky", view, id: sticky.id, at: [Math.round(box.x), Math.round(box.y)], size: [Math.max(1, Math.round(box.w)), Math.max(1, Math.round(box.h))] };
}

/**
 * The node for a note: at its saved size, when it has one. It's that wide, and React Flow
 * measures how tall it is, as a note with more text than fits grows taller.
 */
export function stickyNodeSize(sticky: Sticky): { width?: number } {
  return sticky.size ? { width: sticky.size[0] } : {};
}

/**
 * Opens the notes of an element, of a sticky note on the open view, or of the relationships an
 * arrow or a sequence's step on it draws, in the notes editor. With more than one of those
 * relationships having notes, it selects `whole`, the arrow or step, and shows its details
 * instead, where each has its own. The designer gives it to the diagrams; without it, boxes,
 * notes, arrows and steps don't offer their notes.
 */
export const NotesOpener = createContext<{
  element(id: string): void;
  sticky(id: string): void;
  relationships(sources: RelationshipSource[], whole: Selection): void;
} | null>(null);

/**
 * The chip on the corner of a box, sticky note, arrow's label or step's label that has notes: it
 * shows they're there, and a click opens them in the notes editor. Pictures of the diagram leave
 * it out (see image.ts). It doesn't select the box, note, arrow or step, drag it, start an arrow
 * from it, or edit a note's text.
 */
export function NotesButton({ name, onOpen }: { name: string; onOpen(): void }) {
  return (
    <button
      type="button"
      className="notes-button nodrag nopan"
      title={`Notes on ${name}`}
      aria-label={`Notes on ${name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />
      </svg>
    </button>
  );
}

/** The notes chip for an element, when it has notes and the diagram can open them. */
export function ElementNotes({ element }: { element: ArchElement }) {
  const opener = useContext(NotesOpener);
  return element.notes && opener ? <NotesButton name={element.name} onOpen={() => opener.element(element.id)} /> : null;
}

/** The notes chip for a sticky note on the open view, when it has notes and the diagram can open them. */
export function StickyNotes({ sticky }: { sticky: Sticky }) {
  const opener = useContext(NotesOpener);
  return sticky.notes && opener ? <NotesButton name={stickyName(sticky.text)} onOpen={() => opener.sticky(sticky.id)} /> : null;
}

/**
 * The notes chip for the frame round a view's boxes, on its top right corner, as a box's is. The
 * frame is drawn under the diagram's background, which takes its clicks (see withFrame in
 * Canvas.tsx), so the chip is drawn over the diagram instead, where it can be pressed. It goes
 * inside the diagram's ReactFlow.
 */
export function FrameNotes({ frame }: { frame: FrameFlowNode | null | undefined }) {
  if (!frame) return null;
  return (
    <ViewportPortal>
      <div className="frame-notes" style={{ transform: `translate(${frame.position.x + frame.data.width}px, ${frame.position.y}px)` }}>
        <ElementNotes element={frame.data.element} />
      </div>
    </ViewportPortal>
  );
}

/** A line from a sticky note to what it's on, between two points on the diagram. */
export interface StickyLine {
  /** The note's ID. */
  id: string;
  from: Point;
  to: Point;
  /** The note is selected, so its line is too. */
  selected: boolean;
}

/**
 * The dotted lines from sticky notes to what they're on (see .sticky-lines in styles.css). It goes
 * inside the diagram's ReactFlow.
 */
export function StickyLines({ lines }: { lines: StickyLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ViewportPortal>
      <svg className="sticky-lines" aria-hidden="true">
        {lines.map((l) => (
          <line key={l.id} className={l.selected ? "selected" : undefined} x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} />
        ))}
      </svg>
    </ViewportPortal>
  );
}

/**
 * The line from a note whose dot is being dragged to where the dot is, `at`, over everything else
 * at `zIndex`. `line` is null while the dot is over its note. It goes inside the diagram's ReactFlow.
 */
export function StickyLinking({ at, line, zIndex }: { at: Point; line: { from: Point; to: Point } | null; zIndex: number }) {
  return (
    <ViewportPortal>
      <svg className="sticky-linking" style={{ zIndex }} aria-hidden="true">
        {line && <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />}
        <circle cx={at.x} cy={at.y} r={5} />
      </svg>
    </ViewportPortal>
  );
}

/** A member with brackets is a method, as in UML; the rest are attributes. */
export function splitMembers(members: string[]): { attributes: string[]; methods: string[] } {
  const method = (m: string) => /\(.*\)/.test(m);
  return { attributes: members.filter((m) => !method(m)), methods: members.filter(method) };
}

/**
 * About how tall a class's box is drawn, from its text (see .c4-class in styles.css): for laying
 * out boxes before they've been drawn. Its description wraps at about 30 characters a line, and a
 * member at about 32.
 */
export function classHeight(e: ArchElement): number {
  const lines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));
  const { attributes, methods } = splitMembers(e.members);
  const compartment = (members: string[]) => 9 + Math.max(12, members.reduce((n, m) => n + lines(m, 32) * 16, 0));
  const head = 16 + 20 + (e.stereotype ? 15 : 0) + (e.technology ? 15 : 0) + (e.description ? 8 + lines(e.description, 30) * 16 : 0);
  return Math.round(head + compartment(attributes) + compartment(methods));
}

/** A class, drawn as UML draws one: its stereotype and name, then its attributes, then its methods. */
function ClassBox({ e }: { e: ArchElement }) {
  const { attributes, methods } = splitMembers(e.members);
  const compartment = (lines: string[], label: string) => (
    <div className="class-members" aria-label={label}>
      {lines.map((m, k) => (
        <div key={k}>{m}</div>
      ))}
    </div>
  );
  return (
    <>
      <div className="class-head">
        {e.stereotype && <div className="class-stereotype">«{e.stereotype}»</div>}
        <div className="c4-name">{e.name}</div>
        {e.technology && <div className="c4-kind">[{e.technology}]</div>}
        {e.description && <div className="c4-desc">{e.description}</div>}
      </div>
      {compartment(attributes, "Attributes")}
      {compartment(methods, "Methods")}
    </>
  );
}

export function ElementNode({ id, data, selected }: NodeProps<ElementFlowNode>) {
  const e = data.element;
  const connection = useConnection();
  // While someone drags a new arrow, the whole box is a drop target.
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  const classes = ["c4", `c4-${e.external ? "external" : e.kind}`, e.shape !== "box" ? `c4-shape-${e.shape}` : "", selected ? "selected" : ""];
  return (
    <div className={classes.join(" ")}>
      <Handle type="target" position={Position.Top} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      {e.kind === "class" ? (
        <ClassBox e={e} />
      ) : (
        <>
          <div className="c4-name">{e.name}</div>
          <div className="c4-kind">
            [{kindLabel(e)}
            {e.technology ? `: ${e.technology}` : ""}]
          </div>
          {e.description && <div className="c4-desc">{e.description}</div>}
        </>
      )}
      {data.problems > 0 && (
        <div className="c4-badge" title={`${data.problems} problem${data.problems === 1 ? "" : "s"} in this element's file`}>
          {data.problems}
        </div>
      )}
      <ElementNotes element={e} />
      <Handle type="source" position={Position.Bottom} className="handle-source" title="Drag to another box to add a relationship" />
    </div>
  );
}

export function FrameNode({ data }: NodeProps<FrameFlowNode>) {
  return (
    <div className={`frame${data.selected ? " selected" : ""}`} style={{ width: data.width, height: data.height }}>
      <div className="frame-label">
        {data.element.name} <span>[{kindLabel(data.element)}]</span>
      </div>
    </div>
  );
}

/**
 * The dot under a note, to drag to a box, the frame or an arrow, or on a flowchart a block (`to`
 * says which), and put the note on it. It keeps the pointer while it's dragged, and reports where
 * it is, as an arrow's grips do; the canvas draws the line being dragged, and puts the note on
 * what it's let go on. A click without a drag selects the note, as a click on the note does.
 */
function LinkGrip({ to, onDrag, onDrop }: { to: string; onDrag(at: Point): void; onDrop(at: Point | null): void }) {
  const rf = useReactFlow();
  const drag = useRef<{ pointer: number; x: number; y: number; moving: boolean } | null>(null);
  /** A drag just ended, so the click that follows it isn't a click on the note. */
  const dragged = useRef(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  // A dot taken away mid-drag, as when the note is deleted, hears no more of the pointer.
  useEffect(
    () => () => {
      if (drag.current?.moving) latest.current(null);
    },
    [],
  );
  const at = (e: PointerEvent) => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const stop = (dropped: Point | null) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moving) return;
    dragged.current = true;
    onDrop(dropped);
  };
  return (
    <div
      className="sticky-grip nodrag nopan"
      title={`Drag to ${to} to put the note on it`}
      onPointerDown={(e) => {
        if (e.button !== 0 || drag.current) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
        dragged.current = false;
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) return;
        if (!d.moving && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_DISTANCE) return;
        d.moving = true;
        onDrag(at(e));
      }}
      onPointerUp={(e) => drag.current?.pointer === e.pointerId && stop(at(e))}
      onPointerCancel={(e) => drag.current?.pointer === e.pointerId && stop(null)}
      onLostPointerCapture={(e) => drag.current?.pointer === e.pointerId && stop(null)}
      onClick={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
      }}
    />
  );
}

export function StickyNode({ id, data, selected }: NodeProps<StickyFlowNode>) {
  const { sticky, editing } = data;
  // The node's own size, which its resizer sets as it's dragged, snapped. The props' size is what
  // React Flow measured, which a note that grows to fit its text mustn't be drawn at.
  const width = useStore((s) => s.nodeLookup.get(id)?.width);
  const height = useStore((s) => s.nodeLookup.get(id)?.height);
  // A note with a size is that wide, and at least that tall. While it's resized, it's as big as its resizer says.
  const sized = width !== undefined || height !== undefined || !!sticky.size ? { width: width ?? sticky.size?.[0], minHeight: height ?? sticky.size?.[1] } : undefined;
  const input = useRef<HTMLTextAreaElement>(null);
  // Escape ends editing, and the text box losing focus as it goes mustn't then save it.
  const finished = useRef(false);
  useEffect(() => {
    if (!editing) return;
    finished.current = false;
    // A new note stays hidden until React Flow has measured it, and hidden elements can't take focus.
    let frame = 0;
    const focus = () => {
      const el = input.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) el.select();
      else frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  const finish = (text: string | null) => {
    if (finished.current) return;
    finished.current = true;
    data.onDone(text);
  };
  return (
    // nopan: double-clicking a note edits it rather than zooming the canvas.
    <div
      className={`sticky sticky-${sticky.color}${selected ? " selected" : ""}${editing ? " editing" : ""} nopan`}
      style={sized}
      onDoubleClick={data.onEdit}
      title={editing ? undefined : "Double-click to edit"}
    >
      {data.onResize && (
        <NodeResizer
          isVisible={selected && !editing}
          color="var(--accent)"
          minWidth={STICKY_MIN}
          minHeight={STICKY_MIN}
          onResizeEnd={(_, r) => data.onResize?.({ x: r.x, y: r.y, w: r.width, h: r.height })}
        />
      )}
      {editing ? (
        <textarea
          ref={input}
          className="nodrag nowheel"
          defaultValue={sticky.text}
          aria-label="Sticky note text"
          onBlur={(e) => finish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") finish(null);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
          }}
        />
      ) : (
        <div className="sticky-text">{sticky.text}</div>
      )}
      {!editing && <StickyNotes sticky={sticky} />}
      {!editing && data.onLinkDrag && data.onLinkDrop && <LinkGrip to={data.linkTo ?? "a box, the frame or an arrow"} onDrag={data.onLinkDrag} onDrop={data.onLinkDrop} />}
    </div>
  );
}

export const nodeTypes = { element: ElementNode, frame: FrameNode, sticky: StickyNode };
