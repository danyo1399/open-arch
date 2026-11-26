/**
 * Snapping, as boxes and sticky notes are dragged. What's dragged lines up with the boxes and
 * notes around it, edge to edge or middle to middle, and a guide is drawn along each line they
 * share. Or it snaps to the grid of dots behind the diagram. Lining up comes first: the grid only
 * takes what lines up with nothing. A shape resized by its corner or edge snaps the same way: the
 * edge being dragged lines up with the edges around it, or goes to the grid. Holding Alt (⌥ on a
 * Mac) while dragging turns both off, to place or size something exactly. The two buttons with
 * the zoom buttons turn each on or off.
 */
import { ControlButton, useReactFlow, ViewportPortal, type Node, type NodeChange, type NodeDimensionChange, type NodePositionChange, type XYPosition } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SnapSettings } from "../settings.js";
import type { Rect } from "./stickyLines.js";

/** How far apart the grid's points are, on the diagram: as far as the dots drawn behind it. */
export const GRID = 20;
/** How near, on the screen, an edge or middle has to come to another's to line up with it. */
export const SNAP_REACH = 6;
/** Over everything on the diagram, even a selected note, which React Flow lifts above the rest. */
const GUIDES_Z = 10_000;

/**
 * A line where what's dragged lines up with something: down the diagram at `at` across it, from
 * `from` to `to` (`axis` x), or across it at `at` down it (`axis` y).
 */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** How far to move what's dragged so it snaps, and the guides to draw where it lines up. */
export interface Snapped {
  dx: number;
  dy: number;
  guides: Guide[];
}

type Axis = "x" | "y";
/** Which of a rect's lines, along each axis, by their place in `lines`. */
type Along = Record<Axis, readonly number[]>;
/** All of them: start, middle and end. */
const ALL: Along = { x: [0, 1, 2], y: [0, 1, 2] };

/** A rect's start, middle and end along an axis: its left, middle and right, or its top, middle and bottom. */
function lines(r: Rect, axis: Axis): [start: number, middle: number, end: number] {
  const [start, size] = axis === "x" ? [r.x, r.w] : [r.y, r.h];
  return [start, start + size / 2, start + size];
}

/** The lines that line up: either edge with either edge, and middle with middle. */
const PAIRS: [number, number][] = [
  [0, 0],
  [0, 2],
  [2, 0],
  [2, 2],
  [1, 1],
];

/** How far to move along an axis to line one of `moving` up with one of `others`: the nearest within reach, if any. */
function nearestLine(moving: readonly Rect[], others: readonly Rect[], axis: Axis, reach: number): number | undefined {
  let best: number | undefined;
  for (const m of moving) {
    const mine = lines(m, axis);
    for (const o of others) {
      const theirs = lines(o, axis);
      for (const [a, b] of PAIRS) {
        const delta = theirs[b]! - mine[a]!;
        if (Math.abs(delta) <= reach && (best === undefined || Math.abs(delta) < Math.abs(best))) best = delta;
      }
    }
  }
  return best;
}

/**
 * A guide along each line `moved` shares with `others`, joined into one where they're on the
 * same line. `along` says which of `moved`'s lines to look at: all of them, unless it says less.
 */
function guidesFor(moved: readonly Rect[], others: readonly Rect[], along: Along = ALL): Guide[] {
  const found = new Map<string, Guide>();
  for (const axis of ["x", "y"] as const) {
    const across = (r: Rect): [number, number] => (axis === "x" ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
    for (const m of moved) {
      const mine = lines(m, axis);
      for (const o of others) {
        const theirs = lines(o, axis);
        for (const [a, b] of PAIRS) {
          // Half a pixel: what's dragged sits between whole pixels until it's dropped.
          if (!along[axis].includes(a) || Math.abs(theirs[b]! - mine[a]!) >= 0.5) continue;
          const at = theirs[b]!;
          const [from, to] = [Math.min(across(m)[0], across(o)[0]), Math.max(across(m)[1], across(o)[1])];
          const key = `${axis}:${Math.round(at * 2)}`;
          const seen = found.get(key);
          found.set(key, seen ? { ...seen, from: Math.min(seen.from, from), to: Math.max(seen.to, to) } : { axis, at, from, to });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => (a.axis === b.axis ? a.at - b.at : a.axis === "x" ? -1 : 1));
}

/**
 * Where boxes and notes being dragged, at `moving`, snap to: how far to move them all, together,
 * and the guides to draw. With `guides`, each axis goes to the nearest line one of them shares
 * with one of `others`, no further than `reach` away. With `grid`, an axis that lines up with
 * nothing puts their top left corner, together, on the grid.
 */
export function snapMove(moving: readonly Rect[], others: readonly Rect[], { guides, grid, reach }: SnapSettings & { reach: number }): Snapped {
  if (moving.length === 0) return { dx: 0, dy: 0, guides: [] };
  const offset = (axis: Axis) => {
    const lined = guides ? nearestLine(moving, others, axis, reach) : undefined;
    if (lined !== undefined) return lined;
    if (!grid) return 0;
    const start = Math.min(...moving.map((r) => (axis === "x" ? r.x : r.y)));
    return Math.round(start / GRID) * GRID - start;
  };
  const [dx, dy] = [offset("x"), offset("y")];
  const moved = moving.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  return { dx, dy, guides: guides ? guidesFor(moved, others) : [] };
}

/** Which edge of a box moves along each axis as it's resized: its left or top (`start`), its right or bottom (`end`), or neither. */
export type Edges = Partial<Record<Axis, "start" | "end">>;

/** Where a box being resized goes, snapped, and the guides to draw. */
export interface SnappedRect {
  rect: Rect;
  guides: Guide[];
}

/** How far to move an edge, `at` along an axis, to line it up with an edge of one of `others`: the nearest within reach, where `fits`, if any. */
function nearestEdge(at: number, others: readonly Rect[], axis: Axis, reach: number, fits: (to: number) => boolean): number | undefined {
  let best: number | undefined;
  for (const o of others) {
    const [start, , end] = lines(o, axis);
    for (const to of [start, end]) {
      const delta = to - at;
      if (Math.abs(delta) <= reach && fits(to) && (best === undefined || Math.abs(delta) < Math.abs(best))) best = delta;
    }
  }
  return best;
}

/**
 * Where a box being resized, at `resizing`, snaps to. Only the edges in `edges` move: the others
 * stay where the resize left them. With `guides`, each goes to the nearest edge of one of
 * `others`, no further than `reach` away. With `grid`, one that lines up with nothing goes to the
 * grid. Neither makes the box smaller than `min` across or down.
 */
export function snapResize(resizing: Rect, edges: Edges, others: readonly Rect[], { guides, grid, reach, min }: SnapSettings & { reach: number; min: number }): SnappedRect {
  const rect = { ...resizing };
  for (const axis of ["x", "y"] as const) {
    const edge = edges[axis];
    if (!edge) continue;
    const [start, , end] = lines(resizing, axis);
    const at = edge === "start" ? start : end;
    const fits = (to: number) => (edge === "start" ? end - to : to - start) >= min;
    const lined = guides ? nearestEdge(at, others, axis, reach, fits) : undefined;
    const onGrid = Math.round(at / GRID) * GRID;
    const to = at + (lined ?? (grid && fits(onGrid) ? onGrid - at : 0));
    const [place, size] = axis === "x" ? (["x", "w"] as const) : (["y", "h"] as const);
    if (edge === "start") [rect[place], rect[size]] = [to, end - to];
    else rect[size] = to - start;
  }
  const moved = (axis: Axis) => (edges[axis] === "start" ? [0] : edges[axis] === "end" ? [2] : []);
  return { rect, guides: guides ? guidesFor([rect], others, { x: moved("x"), y: moved("y") }) : [] };
}

/** The setting, as each diagram's buttons show and change it. */
export interface SnapControl {
  settings: SnapSettings;
  set(change: Partial<SnapSettings>): void;
}

/** The snap the nodes being dragged were last drawn with, and where React Flow put each of them for it. */
interface LastSnap {
  dx: number;
  dy: number;
  from: Map<string, XYPosition>;
}

/** Where a node goes with the last snap, if React Flow put it where it was for that snap. */
function shifted(last: LastSnap | null, id: string, position: XYPosition): XYPosition | undefined {
  const from = last?.from.get(id);
  return last && from && from.x === position.x && from.y === position.y ? { x: position.x + last.dx, y: position.y + last.dy } : undefined;
}

/** A box being resized: where it was when the resize started, where the resize puts it, and where it's drawn, snapped. */
interface Resizing {
  id: string;
  start: Rect;
  /** Where React Flow's resizer puts it, before it's snapped. */
  raw: Rect;
  /** The edges the resize moves. Once an edge has moved, it's the one that snaps until the box is let go. */
  edges: Edges;
  drawn: Rect;
}

const sameGuides = (a: readonly Guide[], b: readonly Guide[]) =>
  a.length === b.length && a.every((g, i) => g.axis === b[i]!.axis && g.at === b[i]!.at && g.from === b[i]!.from && g.to === b[i]!.to);

/**
 * Snapping for a React Flow diagram. Pass the changes React Flow makes through `snapChanges`
 * before applying them, the nodes it drops through `dropped` before saving where they are, and
 * the corner and size a node is resized to through `resized` before saving them. React Flow
 * works out where a dragged node goes, and how big a resized one is, from the pointer, each time
 * it moves, so it doesn't know about the snap: `dropped` and `resized` give where they're drawn.
 * `snaps` says whether a node snaps when it's dragged or resized: a drag of any that doesn't, or
 * of one inside another, doesn't snap. `isTarget` says whether a node is something to line up
 * with. `minSize` is the smallest a resized node can be, across or down, as its resizer allows:
 * the same for every node, or each node's own.
 */
export function useSnap<N extends Node>(
  settings: SnapSettings,
  { snaps, isTarget, minSize = 1 }: { snaps(node: N): boolean; isTarget(node: N): boolean; minSize?: number | ((node: N) => number) },
) {
  const rf = useReactFlow<N>();
  const [guides, setGuides] = useState<Guide[]>([]);
  /** Whether Alt is held, to drag freely. */
  const free = useRef(false);
  const last = useRef<LastSnap | null>(null);
  /** The snap the nodes were let go with, until `dropped` saves where they are. */
  const drop = useRef<LastSnap | null>(null);
  /** The node being resized, from its first change until it's let go. */
  const resizing = useRef<Resizing | null>(null);

  useEffect(() => {
    // Each key and pointer event says whether Alt is held. These hear of the pointer moving
    // before React Flow does: it listens on the window too, after them.
    const note = (e: KeyboardEvent | MouseEvent) => {
      free.current = e.altKey;
    };
    const reset = () => {
      free.current = false;
    };
    const types = ["pointerdown", "pointermove", "mousemove", "keydown", "keyup"] as const;
    for (const type of types) window.addEventListener(type, note, true);
    window.addEventListener("blur", reset);
    return () => {
      for (const type of types) window.removeEventListener(type, note, true);
      window.removeEventListener("blur", reset);
    };
  }, []);

  const size = useCallback(
    (n: N) => {
      const measured = rf.getInternalNode(n.id)?.measured;
      return { w: measured?.width ?? n.width ?? 0, h: measured?.height ?? n.height ?? 0 };
    },
    [rf],
  );

  /** Everything to line up with, but the nodes in `leave`, where they're drawn. */
  const othersThan = useCallback(
    (nodes: Iterable<N>, leave: (id: string) => boolean) =>
      [...nodes].flatMap((n): Rect[] => {
        if (leave(n.id) || !isTarget(n)) return [];
        const at = rf.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position;
        const r = { x: at.x, y: at.y, ...size(n) };
        return r.w > 0 && r.h > 0 ? [r] : [];
      }),
    [rf, isTarget, size],
  );

  /**
   * A node's resizer's changes, snapped. Each time the pointer moves it says where the node goes
   * and how big it is, and it says how big it is once more when it's let go. Where it goes only
   * changes when its left or top edge moves.
   */
  const snapResizing = useCallback(
    (changes: NodeChange<N>[], resize: NodeDimensionChange): NodeChange<N>[] => {
      const { id, dimensions } = resize;
      const nodes = rf.getNodes();
      const node = nodes.find((n) => n.id === id);
      if (!node || !dimensions || node.parentId || !snaps(node)) {
        resizing.current = null;
        return changes;
      }
      // Let go: it stays as it was last drawn.
      if (!resize.resizing) {
        const last = resizing.current?.id === id ? resizing.current.drawn : null;
        resizing.current = null;
        setGuides((g) => (g.length ? [] : g));
        return last ? changes.map((c) => (c === resize ? { ...resize, dimensions: { width: last.w, height: last.h } } : c)) : changes;
      }
      if (resizing.current?.id !== id) {
        const start = { ...node.position, ...size(node) };
        resizing.current = { id, start, raw: start, edges: {}, drawn: start };
      }
      const r = resizing.current;
      const to = changes.find((c): c is NodePositionChange => c.type === "position" && c.id === id && !!c.position)?.position;
      r.raw = { x: to?.x ?? r.raw.x, y: to?.y ?? r.raw.y, w: dimensions.width, h: dimensions.height };
      for (const [axis, across] of [["x", "w"], ["y", "h"]] as const) {
        if (r.edges[axis]) continue;
        if (r.raw[axis] !== r.start[axis]) r.edges[axis] = "start";
        else if (r.raw[axis] + r.raw[across] !== r.start[axis] + r.start[across]) r.edges[axis] = "end";
      }
      const others = othersThan(nodes, (other) => other === id);
      const snap =
        free.current || (!settings.guides && !settings.grid)
          ? { rect: r.raw, guides: [] }
          : snapResize(r.raw, r.edges, others, { ...settings, reach: SNAP_REACH / rf.getZoom(), min: typeof minSize === "function" ? minSize(node) : minSize });
      r.drawn = snap.rect;
      setGuides((g) => (sameGuides(g, snap.guides) ? g : snap.guides));
      // Where it goes each time, even when the resizer leaves that out, so its far edges stay put as the snap changes.
      const position: NodePositionChange = { id, type: "position", position: { x: r.drawn.x, y: r.drawn.y } };
      return [
        ...changes.flatMap((c): NodeChange<N>[] => {
          if (c.type === "position" && c.id === id) return [];
          return c === resize ? [{ ...resize, dimensions: { width: r.drawn.w, height: r.drawn.h } }] : [c];
        }),
        position,
      ];
    },
    [rf, settings, snaps, size, othersThan, minSize],
  );

  const snapChanges = useCallback(
    (changes: NodeChange<N>[]): NodeChange<N>[] => {
      // React Flow's resizer says it's resizing, or has finished. Measuring a node says neither.
      const resize = changes.find((c): c is NodeDimensionChange => c.type === "dimensions" && c.resizing !== undefined);
      if (resize) return snapResizing(changes, resize);
      const moves = changes.filter((c): c is NodePositionChange => c.type === "position" && !!c.position);
      if (moves.length === 0) return changes;
      /** A change that moves a node, moved by this snap instead. */
      const snapped = (snap: LastSnap | null) => (c: NodeChange<N>): NodeChange<N> => {
        if (c.type !== "position" || !c.position) return c;
        const to = shifted(snap, c.id, c.position);
        return to ? { ...c, position: to } : c;
      };
      // Let go, where they were last drawn. Arrow keys move selected nodes too, without dragging
      // them: those don't snap, and the snap is gone by then.
      if (!moves.some((c) => c.dragging)) {
        drop.current = last.current;
        last.current = null;
        setGuides([]);
        return changes.map(snapped(drop.current));
      }
      drop.current = null;
      last.current = null;
      const nodes = new Map(rf.getNodes().map((n) => [n.id, n]));
      const dragged = moves.map((c) => nodes.get(c.id));
      if (free.current || (!settings.guides && !settings.grid) || dragged.some((n) => !n || n.parentId || !snaps(n))) {
        setGuides((g) => (g.length ? [] : g));
        return changes;
      }
      const moving = moves.map((c, k) => ({ ...c.position!, ...size(dragged[k]!) }));
      const others = othersThan(nodes.values(), (id) => moves.some((c) => c.id === id));
      const snap = snapMove(moving, others, { ...settings, reach: SNAP_REACH / rf.getZoom() });
      last.current = { dx: snap.dx, dy: snap.dy, from: new Map(moves.map((c) => [c.id, c.position!])) };
      setGuides((g) => (sameGuides(g, snap.guides) ? g : snap.guides));
      return changes.map(snapped(last.current));
    },
    [rf, settings, snaps, size, othersThan, snapResizing],
  );

  /** The nodes React Flow dropped, where they were drawn: snapped as they were when they were let go. */
  const dropped = useCallback((nodes: N[]): N[] => {
    const at = nodes.map((n) => shifted(drop.current, n.id, n.position));
    drop.current = null;
    last.current = null;
    setGuides([]);
    // All of them or none, so they keep their places among each other.
    return at.every((p) => p) ? nodes.map((n, k) => ({ ...n, position: at[k]! })) : nodes;
  }, []);

  /** The corner and size a node's resizer let it go at, as it was drawn: snapped as it was when it was let go. */
  const resized = useCallback((id: string, box: Rect): Rect => (resizing.current?.id === id ? resizing.current.drawn : box), []);

  return { snapChanges, dropped, resized, guides };
}

/** The guides where what's being dragged lines up with something, over the diagram. */
export function SnapGuides({ guides }: { guides: readonly Guide[] }) {
  if (guides.length === 0) return null;
  return (
    <ViewportPortal>
      <svg className="snap-guides" style={{ zIndex: GUIDES_Z }} aria-hidden="true">
        {guides.map((g) =>
          g.axis === "x" ? <line key={`x${g.at}`} x1={g.at} y1={g.from} x2={g.at} y2={g.to} /> : <line key={`y${g.at}`} x1={g.from} y1={g.at} x2={g.to} y2={g.at} />,
        )}
      </svg>
    </ViewportPortal>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const FREELY = `Start dragging, then hold ${isMac ? "⌥" : "Alt"} to place or size it freely.`;

/** The buttons, with the zoom buttons, that turn lining up with other boxes and snapping to the grid on and off. */
export function SnapButtons({ snap }: { snap: SnapControl }) {
  const { settings, set } = snap;
  return (
    <>
      <ControlButton
        className="snap-button"
        onClick={() => set({ guides: !settings.guides })}
        aria-pressed={settings.guides}
        aria-label="Line up with other boxes"
        title={`Line up with other boxes as you drag or resize, with a guide where they line up. ${FREELY}`}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <rect x="0" y="0" width="1.5" height="12" />
          <rect x="3" y="1.5" width="8" height="3.5" />
          <rect x="3" y="7" width="5" height="3.5" />
        </svg>
      </ControlButton>
      <ControlButton
        className="snap-button"
        onClick={() => set({ grid: !settings.grid })}
        aria-pressed={settings.grid}
        aria-label="Snap to the grid"
        title={`Snap to the grid of dots as you drag or resize. ${FREELY}`}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          {[1.5, 6, 10.5].flatMap((x) => [1.5, 6, 10.5].map((y) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.4" />))}
        </svg>
      </ControlButton>
    </>
  );
}
