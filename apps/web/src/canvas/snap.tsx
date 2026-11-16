/**
 * Snapping, as boxes and sticky notes are dragged. What's dragged lines up with the boxes and
 * notes around it, edge to edge or middle to middle, and a guide is drawn along each line they
 * share. Or it snaps to the grid of dots behind the diagram. Lining up comes first: the grid only
 * takes what lines up with nothing. Holding Alt (⌥ on a Mac) while dragging turns both off, to
 * place something exactly. The two buttons with the zoom buttons turn each on or off.
 */
import { ControlButton, useReactFlow, ViewportPortal, type Node, type NodeChange, type NodePositionChange, type XYPosition } from "@xyflow/react";
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

/** A guide along each line `moved` shares with `others`, joined into one where they're on the same line. */
function guidesFor(moved: readonly Rect[], others: readonly Rect[]): Guide[] {
  const found = new Map<string, Guide>();
  for (const axis of ["x", "y"] as const) {
    const across = (r: Rect): [number, number] => (axis === "x" ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
    for (const m of moved) {
      const mine = lines(m, axis);
      for (const o of others) {
        const theirs = lines(o, axis);
        for (const [a, b] of PAIRS) {
          // Half a pixel: what's dragged sits between whole pixels until it's dropped.
          if (Math.abs(theirs[b]! - mine[a]!) >= 0.5) continue;
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

const sameGuides = (a: readonly Guide[], b: readonly Guide[]) =>
  a.length === b.length && a.every((g, i) => g.axis === b[i]!.axis && g.at === b[i]!.at && g.from === b[i]!.from && g.to === b[i]!.to);

/**
 * Snapping for a React Flow diagram. Pass the changes React Flow makes through `snapChanges`
 * before applying them, and the nodes it drops through `dropped` before saving where they are.
 * React Flow works out where a dragged node goes from the pointer, each time it moves, so it
 * doesn't know about the snap: `dropped` moves them where they're drawn. `snaps` says whether a
 * node snaps when it's dragged: a drag of any that doesn't, or of one inside another, doesn't
 * snap. `isTarget` says whether a node is something to line up with.
 */
export function useSnap<N extends Node>(settings: SnapSettings, { snaps, isTarget }: { snaps(node: N): boolean; isTarget(node: N): boolean }) {
  const rf = useReactFlow<N>();
  const [guides, setGuides] = useState<Guide[]>([]);
  /** Whether Alt is held, to drag freely. */
  const free = useRef(false);
  const last = useRef<LastSnap | null>(null);
  /** The snap the nodes were let go with, until `dropped` saves where they are. */
  const drop = useRef<LastSnap | null>(null);

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

  const snapChanges = useCallback(
    (changes: NodeChange<N>[]): NodeChange<N>[] => {
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
      const size = (n: N) => {
        const measured = rf.getInternalNode(n.id)?.measured;
        return { w: measured?.width ?? n.width ?? 0, h: measured?.height ?? n.height ?? 0 };
      };
      const moving = moves.map((c, k) => ({ ...c.position!, ...size(dragged[k]!) }));
      const others = [...nodes.values()].flatMap((n): Rect[] => {
        if (moves.some((c) => c.id === n.id) || !isTarget(n)) return [];
        const at = rf.getInternalNode(n.id)?.internals.positionAbsolute ?? n.position;
        const r = { x: at.x, y: at.y, ...size(n) };
        return r.w > 0 && r.h > 0 ? [r] : [];
      });
      const snap = snapMove(moving, others, { ...settings, reach: SNAP_REACH / rf.getZoom() });
      last.current = { dx: snap.dx, dy: snap.dy, from: new Map(moves.map((c) => [c.id, c.position!])) };
      setGuides((g) => (sameGuides(g, snap.guides) ? g : snap.guides));
      return changes.map(snapped(last.current));
    },
    [rf, settings, snaps, isTarget],
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

  return { snapChanges, dropped, guides };
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
const FREELY = `Start dragging, then hold ${isMac ? "⌥" : "Alt"} to place it freely.`;

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
        title={`Line up with other boxes as you drag, with a guide where they line up. ${FREELY}`}
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
        title={`Snap to the grid of dots as you drag. ${FREELY}`}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          {[1.5, 6, 10.5].flatMap((x) => [1.5, 6, 10.5].map((y) => <circle key={`${x},${y}`} cx={x} cy={y} r="1.4" />))}
        </svg>
      </ControlButton>
    </>
  );
}
