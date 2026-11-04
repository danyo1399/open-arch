import { kindLabel, type ArchElement, type Sticky } from "@open-arch/core";
import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useRef } from "react";

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
    </div>
  );
}

export const nodeTypes = { element: ElementNode, frame: FrameNode, sticky: StickyNode };
