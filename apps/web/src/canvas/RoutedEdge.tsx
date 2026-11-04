/**
 * Arrows drawn along the routes the canvas works out for them (see routing.ts),
 * with rounded corners, and labelled where the canvas places their labels.
 */
import type { RelationshipKind, ViewEdge } from "@open-arch/core";
import { BaseEdge, EdgeLabelRenderer, useReactFlow, ViewportPortal, type Edge, type EdgeProps } from "@xyflow/react";
import { useEffect, useRef, type PointerEvent } from "react";
import type { Point } from "./autoLayout.js";

/** An arrow's start, at the box it's from, or its end, at the box it points to. */
export type ArrowEnd = "from" | "to";

export type ArrowData = {
  edge: ViewEdge;
  /** The route, from a point on the source box's border to one on the target's. Shared with the routing, so read-only. */
  points: readonly Readonly<Point>[];
  /** Where the label's centre goes, and how wide it can be. */
  label?: Point & { maxWidth: number };
  /** Where the route crosses other arrows, along its horizontal runs (see crossings in routing.ts). */
  crossings: Point[];
  onSelect(): void;
  /** A selected arrow's start or end is being dragged, and is at this point on the diagram. */
  onEndDrag(end: ArrowEnd, at: Point): void;
  /** The start or end let go at this point on the diagram, or null when the drag was cancelled. */
  onEndDrop(end: ArrowEnd, at: Point | null): void;
  /** The end being dragged, while one is. The canvas draws the arrow then, from its other end. */
  moving?: ArrowEnd;
};
export type ArrowEdge = Edge<ArrowData, "arrow">;

/** How far, in pixels, a grip at an arrow's end moves before it's dragged, so a click that wobbles does nothing. */
const DRAG_DISTANCE = 4;

const CORNER = 8;
/** Radius of the little arc a route draws to hop over an arrow it crosses. */
const HOP = 5;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** The point `by` pixels from `from` toward `to`. */
function toward(from: Point, to: Point, by: number): Point {
  const d = distance(from, to) || 1;
  return { x: from.x + ((to.x - from.x) * by) / d, y: from.y + ((to.y - from.y) * by) / d };
}

/**
 * A path through `points` with rounded corners, hopping over the arrows it
 * crosses at `crossings`. A crossing too near a corner, or too near the last
 * hop to fit another, is drawn as a plain crossing.
 */
export function pathThrough(points: readonly Readonly<Point>[], crossings: readonly Readonly<Point>[] = []): string {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let d = `M ${first.x} ${first.y}`;
  // Hops along the run from `a` to `b`, up to `end`, which is where the next corner starts.
  const hops = (a: Point, b: Point, start: number, end: Point) => {
    if (a.y !== b.y) return;
    const ahead = Math.sign(b.x - a.x);
    let from = start;
    for (const c of crossings) {
      if (c.y !== a.y) continue;
      const along = (c.x - a.x) * ahead;
      if (along - HOP < from || (end.x - c.x) * ahead < HOP + 1) continue;
      // Over the top, whichever way the run goes.
      d += ` L ${c.x - HOP * ahead} ${c.y} A ${HOP} ${HOP} 0 0 ${ahead > 0 ? 1 : 0} ${c.x + HOP * ahead} ${c.y}`;
      from = along + HOP + 1;
    }
  };
  let start = 0;
  for (let k = 1; k < points.length - 1; k++) {
    const [a, b, c] = [points[k - 1]!, points[k]!, points[k + 1]!];
    const r = Math.min(CORNER, distance(a, b) / 2, distance(b, c) / 2);
    const p = toward(b, a, r);
    const q = toward(b, c, r);
    hops(a, b, start, p);
    d += ` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
    start = r + 1;
  }
  if (points.length >= 2) hops(points[points.length - 2]!, last, start, last);
  return `${d} L ${last.x} ${last.y}`;
}

/** The widths a label can be drawn at, widest first. Narrower ones wrap onto more lines, to fit between boxes close together. */
export const LABEL_WIDTHS: readonly number[] = Object.freeze([190, 140, 100]);

/** How big a label is drawn (see .arrow-label) when it's at most `maxWidth` wide. */
export type LabelSize = { w: number; h: number; maxWidth: number };

/** One line of a label, and the class it's drawn with. */
export type LabelLine = { text: string; className?: string };

/** What an arrow for a relationship with no description says in place of one, so the gap is plain to see. */
export const NO_DESCRIPTION = "(no description)";

/**
 * The lines an arrow's label shows: its description, then its technology in brackets.
 * An arrow for a relationship with no description says so instead; an implied one,
 * which stands for relationships between what's inside the boxes, just leaves it out, as
 * does one of a kind other than association, whose ends say what it means.
 * Drawn, measured and estimated alike from these.
 */
export function labelLines(edge: Pick<ViewEdge, "description" | "technology" | "implied"> & { kind?: ViewEdge["kind"] }): LabelLine[] {
  const quiet = edge.implied || (edge.kind ?? "association") !== "association";
  const description = edge.description ? [{ text: edge.description }] : quiet ? [] : [{ text: NO_DESCRIPTION, className: "arrow-missing" }];
  return [...description, ...(edge.technology ? [{ text: `[${edge.technology}]`, className: "arrow-tech" }] : [])];
}

/** How big a label showing `lines` is drawn at most `maxWidth` wide. */
export type MeasureLabel = (lines: LabelLine[], maxWidth: number) => { w: number; h: number };

/**
 * Roughly how big a label is drawn, from how many characters it has: for where
 * there's no page to measure it in, as in tests. It wraps at spaces, and breaks a
 * word too long for a line between letters.
 */
export const estimateLabel: MeasureLabel = (lines, maxWidth) => {
  // As the browser lays text out, a run of spaces counts as one, and none at either end.
  const texts = lines.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const [charWidth, lineHeight, padX, padY] = [6, 14.3, 16, 8];
  const room = maxWidth - padX;
  const perLine = Math.max(1, Math.floor(room / charWidth));
  let rows = 0;
  for (const text of texts) {
    let width = 0;
    for (const word of text.split(" ")) {
      const next = width + (width ? charWidth : 0) + charWidth * word.length;
      if (width && next <= room) {
        width = next;
        continue;
      }
      if (width) rows++;
      const full = Math.max(0, Math.ceil(word.length / perLine) - 1);
      rows += full;
      width = charWidth * (word.length - full * perLine);
    }
    rows++;
  }
  // A label that wraps is as wide as it's allowed to be, not as wide as its longest line.
  const widest = Math.max(0, ...texts.map((t) => t.length * charWidth));
  return { w: Math.min(widest, room) + padX, h: rows * lineHeight + padY };
};

/**
 * Sizes measured so far (see measureLabelSizes), by lines and width, the ones used
 * least recently first. As texts come and go while the model is edited, those are
 * let go once there are more than MEASURED_LIMIT, though never ones the labels in
 * hand need.
 */
const measured = new Map<string, { w: number; h: number }>();
export const MEASURED_LIMIT = 10_000;
const measuredKey = (lines: LabelLine[], maxWidth: number) => JSON.stringify([lines, maxWidth]);

/** Lets go of every label size measured so far. For tests, which measure in pages of their own. */
export function forgetLabelSizes(): void {
  measured.clear();
}

/** A label off the page, hidden, with the same styles as a drawn one, showing `lines` at most `maxWidth` wide. */
function probe(lines: LabelLine[], maxWidth: number): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "arrow-label";
  div.setAttribute("aria-hidden", "true");
  div.style.cssText = `visibility: hidden; left: -10000px; top: 0; max-width: ${maxWidth}px`;
  div.append(...lines.map(({ text, className }) => Object.assign(document.createElement("div"), { textContent: text, className: className ?? "" })));
  return div;
}

/** The sizes a label can be drawn at, widest first, leaving out widths that make no difference, given how big it is at each, by its place in LABEL_WIDTHS. */
function sizesAt(sizeAt: (maxWidth: number, k: number) => { w: number; h: number }): LabelSize[] {
  const out: LabelSize[] = [];
  for (const [k, maxWidth] of LABEL_WIDTHS.entries()) {
    const size = { ...sizeAt(maxWidth, k), maxWidth };
    if (!out.length || size.w < out[out.length - 1]!.w) out.push(size);
  }
  return out;
}

/** How big an arrow's label is at each width it can be drawn (see sizesAt); none when it has no label. */
export function labelSizes(edge: ViewEdge, measureOne: MeasureLabel): LabelSize[] {
  const lines = labelLines(edge);
  return lines.length ? sizesAt((maxWidth) => measureOne(lines, maxWidth)) : [];
}

/**
 * labelSizes for each of `edges`, measured in hidden labels with the same styles as
 * drawn ones. The sizes not measured before are measured all together, laying the
 * page out once rather than once a label.
 */
export function measureLabelSizes(edges: ViewEdge[]): LabelSize[][] {
  // What each label is measured at, at each width, in LABEL_WIDTHS' order.
  type Wanted = { key: string; lines: LabelLine[]; maxWidth: number };
  const each = edges.map((e): Wanted[] => {
    const lines = labelLines(e);
    return lines.length ? LABEL_WIDTHS.map((maxWidth) => ({ key: measuredKey(lines, maxWidth), lines, maxWidth })) : [];
  });
  const wanted = new Map(each.flat().map((w) => [w.key, w]));
  // The sizes these labels need are used now, so they're the last to be let go.
  const missing: Wanted[] = [];
  for (const [key, w] of wanted) {
    const size = measured.get(key);
    if (!size) missing.push(w);
    else {
      measured.delete(key);
      measured.set(key, size);
    }
  }
  // The least recently used first, up to the first these labels need, which come last.
  for (const key of measured.keys()) {
    if (measured.size + missing.length <= MEASURED_LIMIT || wanted.has(key)) break;
    measured.delete(key);
  }
  if (missing.length) {
    const probes = missing.map(({ key, lines, maxWidth }) => [key, probe(lines, maxWidth)] as const);
    // Into the holder one at a time, as spread into append a big enough view would be more arguments than a
    // call can take, and then onto the page all at once.
    const holder = document.createElement("div");
    for (const [, div] of probes) holder.appendChild(div);
    document.body.appendChild(holder);
    try {
      for (const [key, div] of probes) {
        const { width, height } = div.getBoundingClientRect();
        measured.set(key, { w: width, h: height });
      }
    } finally {
      holder.remove();
    }
  }
  return each.map((at) => (at.length ? sizesAt((_, k) => measured.get(at[k]!.key)!) : []));
}

/**
 * A grip on each end of a selected arrow, to drag that end to another box. The grips are over the
 * boxes, so the half of each on its box can be grabbed too. A grip keeps the pointer while it's
 * dragged, and reports where it is; the canvas draws the arrow being moved, and moves it.
 */
function EndGrips({ data }: { data: ArrowData }) {
  const rf = useReactFlow();
  const drag = useRef<{ end: ArrowEnd; pointer: number; x: number; y: number; moving: boolean } | null>(null);
  const latest = useRef(data);
  latest.current = data;
  // Grips taken away mid-drag, as when the arrow leaves the view, hear no more of the pointer.
  useEffect(
    () => () => {
      const d = drag.current;
      if (d?.moving) latest.current.onEndDrop(d.end, null);
    },
    [],
  );
  const { points } = data;
  const at = (e: PointerEvent) => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const stop = (dropped: Point | null) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moving) data.onEndDrop(d.end, dropped);
  };
  const grip = (end: ArrowEnd, p: Readonly<Point>) => (
    <div
      key={end}
      className={`arrow-grip nodrag nopan${data.moving === end ? " moving" : ""}`}
      style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
      title={end === "from" ? "Drag to another box to start the arrow there" : "Drag to another box to point the arrow there"}
      onPointerDown={(e) => {
        if (e.button !== 0 || drag.current) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { end, pointer: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) return;
        if (!d.moving && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_DISTANCE) return;
        d.moving = true;
        data.onEndDrag(end, at(e));
      }}
      onPointerUp={(e) => drag.current?.pointer === e.pointerId && stop(at(e))}
      onPointerCancel={(e) => drag.current?.pointer === e.pointerId && stop(null)}
      onLostPointerCapture={(e) => drag.current?.pointer === e.pointerId && stop(null)}
      // The click that ends a drag would select the arrow as it was.
      onClick={(e) => e.stopPropagation()}
    />
  );
  return (
    <ViewportPortal>
      {grip("from", points[0]!)}
      {grip("to", points[points.length - 1]!)}
    </ViewportPortal>
  );
}

/** A UML arrow end: a hollow triangle, an open arrowhead, or a filled or hollow diamond. */
type UmlEnd = "triangle" | "open" | "diamond" | "hollow-diamond";

/**
 * How a class view draws each kind of relationship other than association: whether its line is
 * dashed, and what's at its start (the element it's on) and its end (the one it names).
 */
const UML_ARROWS: Record<Exclude<RelationshipKind, "association">, { dashed: boolean; start?: UmlEnd; end?: UmlEnd }> = {
  dependency: { dashed: true, end: "open" },
  inheritance: { dashed: false, end: "triangle" },
  realization: { dashed: true, end: "triangle" },
  composition: { dashed: false, start: "diamond" },
  aggregation: { dashed: false, start: "hollow-diamond" },
};

/**
 * One UML arrow end, drawn pointing along the line, its tip on the box's border. At the start,
 * the marker is turned round, so it points back at the box there.
 */
function UmlMarker({ id, end, selected }: { id: string; end: UmlEnd; selected: boolean }) {
  const diamond = end === "diamond" || end === "hollow-diamond";
  const shape = `uml-marker${end === "diamond" ? " uml-filled" : end === "open" ? " uml-open" : " uml-hollow"}${selected ? " selected" : ""}`;
  return (
    <marker id={id} viewBox={diamond ? "0 0 22 16" : "0 0 16 16"} markerWidth={diamond ? 22 : 16} markerHeight={16} refX={diamond ? 21 : 15} refY={8} markerUnits="userSpaceOnUse" orient="auto-start-reverse">
      <path className={shape} d={diamond ? "M1,8 L11,3 L21,8 L11,13 Z" : end === "open" ? "M2,2 L15,8 L2,14" : "M1,1 L15,8 L1,15 Z"} />
    </marker>
  );
}

/** An ID for a marker of this arrow's, made only of characters a url() takes without escaping. */
const markerId = (arrow: string, end: "start" | "end") => `uml-${arrow.replace(/[^a-zA-Z0-9-]/g, (c) => `_${c.charCodeAt(0)}`)}-${end}`;

export function RoutedEdge({ id, markerStart, markerEnd, data, selected }: EdgeProps<ArrowEdge>) {
  if (!data || data.points.length < 2) return null;
  const { edge, points, label, moving } = data;
  // An association has React Flow's arrowheads; the other kinds draw their own.
  const uml = edge.kind === "association" ? undefined : UML_ARROWS[edge.kind];
  const ends = uml && { start: uml.start && markerId(id, "start"), end: uml.end && markerId(id, "end") };

  return (
    <>
      {uml && ends && !moving && (
        <defs>
          {uml.start && <UmlMarker id={ends.start!} end={uml.start} selected={!!selected} />}
          {uml.end && <UmlMarker id={ends.end!} end={uml.end} selected={!!selected} />}
        </defs>
      )}
      {!moving && (
        <BaseEdge
          id={id}
          path={pathThrough(points, data.crossings)}
          markerStart={ends ? ends.start && `url(#${ends.start})` : markerStart}
          markerEnd={ends ? ends.end && `url(#${ends.end})` : markerEnd}
          className={`arrow${edge.implied || uml?.dashed ? " dashed" : ""}${edge.implied ? " implied" : ""}${selected ? " selected" : ""}`}
          interactionWidth={18}
        />
      )}
      {selected && <EndGrips data={data} />}
      {label && !moving && (
        <EdgeLabelRenderer>
          <div
            className={`arrow-label nodrag nopan${selected ? " selected" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, maxWidth: label.maxWidth }}
            onClick={data.onSelect}
            title={edge.implied ? `Implied by: ${edge.sources.map((s) => s.element).join(", ")}` : undefined}
          >
            {labelLines(edge).map(({ text, className }, k) => (
              <div key={k} className={className}>
                {text}
              </div>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { arrow: RoutedEdge };
