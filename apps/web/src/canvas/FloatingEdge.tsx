/**
 * Arrows that leave and enter boxes at the edge facing the other box, so
 * they look right wherever boxes are dragged.
 */
import type { ViewEdge } from "@open-arch/core";
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type Edge, type EdgeProps, type InternalNode } from "@xyflow/react";
import { NODE_H, NODE_W } from "./autoLayout.js";

export type ArrowData = {
  edge: ViewEdge;
  /** Shifts the arrow sideways when there's another arrow the opposite way. */
  offset: number;
  onSelect(): void;
};
export type ArrowEdge = Edge<ArrowData, "arrow">;

function box(node: InternalNode) {
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured.width ?? NODE_W;
  const h = node.measured.height ?? NODE_H;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Where the line from this box's centre to `toward` crosses this box's border. */
function border(node: InternalNode, toward: { cx: number; cy: number }) {
  const b = box(node);
  const dx = toward.cx - b.cx;
  const dy = toward.cy - b.cy;
  if (dx === 0 && dy === 0) return { x: b.cx, y: b.cy };
  const scale = 1 / Math.max(Math.abs(dx) / (b.w / 2), Math.abs(dy) / (b.h / 2));
  return { x: b.cx + dx * scale, y: b.cy + dy * scale };
}

export function FloatingEdge({ id, source, target, markerEnd, data, selected }: EdgeProps<ArrowEdge>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to || !data) return null;

  const a = border(from, box(to));
  const b = border(to, box(from));
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / length) * data.offset;
  const ny = ((b.x - a.x) / length) * data.offset;
  const [path, labelX, labelY] = getStraightPath({ sourceX: a.x + nx, sourceY: a.y + ny, targetX: b.x + nx, targetY: b.y + ny });
  const { edge } = data;
  const label = edge.description ?? (edge.implied ? undefined : "(no description)");

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`arrow${edge.implied ? " implied" : ""}${selected ? " selected" : ""}`} interactionWidth={18} />
      {(label || edge.technology) && (
        <EdgeLabelRenderer>
          <div
            className={`arrow-label nodrag nopan${selected ? " selected" : ""}${edge.description ? "" : " missing"}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={data.onSelect}
            title={edge.implied ? `Implied by: ${edge.sources.map((s) => s.element).join(", ")}` : undefined}
          >
            {label && <div>{label}</div>}
            {edge.technology && <div className="arrow-tech">[{edge.technology}]</div>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { arrow: FloatingEdge };
