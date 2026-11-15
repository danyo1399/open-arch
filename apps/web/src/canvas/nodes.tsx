import { kindLabel, type ArchElement, type Sticky } from "@open-arch/core";
import { Handle, Position, useConnection, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, type PointerEvent } from "react";
import type { Point } from "./autoLayout.js";
import { DRAG_DISTANCE } from "./RoutedEdge.js";

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
   * the note on it: the dot is being dragged, and is at this point on the diagram.
   */
  onLinkDrag?(at: Point): void;
  /** The dot let go at this point on the diagram, or null when the drag was cancelled. */
  onLinkDrop?(at: Point | null): void;
};
export type StickyFlowNode = Node<StickyNodeData, "sticky">;

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
 * The dot under a note, to drag to a box, the frame or an arrow and put the note on it. It keeps
 * the pointer while it's dragged, and reports where it is, as an arrow's grips do; the canvas
 * draws the line being dragged, and puts the note on what it's let go on. A click without a drag
 * selects the note, as a click on the note does.
 */
function LinkGrip({ onDrag, onDrop }: { onDrag(at: Point): void; onDrop(at: Point | null): void }) {
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
      title="Drag to a box, the frame or an arrow to put the note on it"
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

export function StickyNode({ data, selected }: NodeProps<StickyFlowNode>) {
  const { sticky, editing } = data;
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
    <div className={`sticky sticky-${sticky.color}${selected ? " selected" : ""}${editing ? " editing" : ""} nopan`} onDoubleClick={data.onEdit} title={editing ? undefined : "Double-click to edit"}>
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
      {!editing && data.onLinkDrag && data.onLinkDrop && <LinkGrip onDrag={data.onLinkDrag} onDrop={data.onLinkDrop} />}
    </div>
  );
}

export const nodeTypes = { element: ElementNode, frame: FrameNode, sticky: StickyNode };
