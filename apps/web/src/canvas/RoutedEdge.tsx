/**
 * Arrows drawn along the routes the canvas works out for them (see routing.ts),
 * with rounded corners, and labelled where the canvas places their labels.
 */
import type { ViewEdge } from "@open-arch/core";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import type { Point } from "./autoLayout.js";

export type ArrowData = {
  edge: ViewEdge;
  /** The route, from a point on the source box's border to one on the target's. */
  points: Point[];
  /** Where the label's centre goes. */
  label?: Point;
  onSelect(): void;
};
export type ArrowEdge = Edge<ArrowData, "arrow">;

const CORNER = 8;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** The point `by` pixels from `from` toward `to`. */
function toward(from: Point, to: Point, by: number): Point {
  const d = distance(from, to) || 1;
  return { x: from.x + ((to.x - from.x) * by) / d, y: from.y + ((to.y - from.y) * by) / d };
}

function pathThrough(points: Point[]): string {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let d = `M ${first.x} ${first.y}`;
  for (let k = 1; k < points.length - 1; k++) {
    const [a, b, c] = [points[k - 1]!, points[k]!, points[k + 1]!];
    const r = Math.min(CORNER, distance(a, b) / 2, distance(b, c) / 2);
    const p = toward(b, a, r);
    const q = toward(b, c, r);
    d += ` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  return `${d} L ${last.x} ${last.y}`;
}

/** Roughly how big an arrow's label is drawn (see .arrow-label), or undefined when it has none. */
export function labelSize(edge: ViewEdge): { w: number; h: number } | undefined {
  const lines = [edge.description, edge.technology && `[${edge.technology}]`].filter((t): t is string => !!t);
  if (!lines.length) return undefined;
  const [charWidth, lineHeight, padX, padY, maxWidth] = [6, 14.3, 16, 8, 190];
  const widths = lines.map((t) => t.length * charWidth);
  const rows = widths.reduce((sum, w) => sum + Math.ceil(w / (maxWidth - padX)), 0);
  return { w: Math.min(Math.max(...widths), maxWidth - padX) + padX, h: rows * lineHeight + padY };
}

export function RoutedEdge({ id, markerEnd, data, selected }: EdgeProps<ArrowEdge>) {
  if (!data || data.points.length < 2) return null;
  const { edge, points, label } = data;

  return (
    <>
      <BaseEdge id={id} path={pathThrough(points)} markerEnd={markerEnd} className={`arrow${edge.implied ? " implied" : ""}${selected ? " selected" : ""}`} interactionWidth={18} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`arrow-label nodrag nopan${selected ? " selected" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)` }}
            onClick={data.onSelect}
            title={edge.implied ? `Implied by: ${edge.sources.map((s) => s.element).join(", ")}` : undefined}
          >
            {edge.description && <div>{edge.description}</div>}
            {edge.technology && <div className="arrow-tech">[{edge.technology}]</div>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { arrow: RoutedEdge };
