import { kindLabel, type ArchElement } from "@open-arch/core";
import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";

export type ElementNodeData = { element: ArchElement; problems: number };
export type ElementFlowNode = Node<ElementNodeData, "element">;

export type FrameNodeData = { element: ArchElement; width: number; height: number };
export type FrameFlowNode = Node<FrameNodeData, "frame">;

export function ElementNode({ id, data, selected }: NodeProps<ElementFlowNode>) {
  const e = data.element;
  const connection = useConnection();
  // While someone drags a new arrow, the whole box is a drop target.
  const dropTarget = connection.inProgress && connection.fromNode.id !== id;
  const classes = ["c4", `c4-${e.external ? "external" : e.kind}`, e.tags.includes("database") ? "c4-db" : "", selected ? "selected" : ""];
  return (
    <div className={classes.join(" ")}>
      <Handle type="target" position={Position.Top} className={dropTarget ? "handle-drop" : "handle-hidden"} isConnectableStart={false} />
      <div className="c4-name">{e.name}</div>
      <div className="c4-kind">
        [{kindLabel(e)}
        {e.technology ? `: ${e.technology}` : ""}]
      </div>
      {e.description && <div className="c4-desc">{e.description}</div>}
      {data.problems > 0 && (
        <div className="c4-badge" title={`${data.problems} problem${data.problems === 1 ? "" : "s"} in this element's file`}>
          {data.problems}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="handle-source" title="Drag to another box to add a relationship" />
    </div>
  );
}

export function FrameNode({ data, selected }: NodeProps<FrameFlowNode>) {
  return (
    <div className={`frame${selected ? " selected" : ""}`} style={{ width: data.width, height: data.height }}>
      <div className="frame-label">
        {data.element.name} <span>[{kindLabel(data.element)}]</span>
      </div>
    </div>
  );
}

export const nodeTypes = { element: ElementNode, frame: FrameNode };
