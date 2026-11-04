/**
 * Placing boxes that have no saved position. A view with no positions at all
 * gets a full ELK layout; boxes added to a laid-out view are put near where
 * ELK would put them, without moving anything the user placed.
 */
import type { ELK as ElkEngine, ElkNode } from "elkjs/lib/elk.bundled.js";

export const NODE_W = 220;
export const NODE_H = 120;
const GAP = 40;

export interface Point {
  x: number;
  y: number;
}

/** `load`, run the first time it's needed and kept, but run again the next time after it failed. */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () =>
    (loading ??= load().catch((error: unknown) => {
      loading = undefined;
      throw error;
    }));
}

// ELK is large, so it's loaded the first time a view needs laying out.
const loadElk = loadOnce(() => import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK()));

/**
 * Positions for every box, from ELK. When ELK can't lay them out, they go in rows (see
 * gridLayout) and `failed` says so, so the diagram is still drawn. That happens when ELK's file
 * can't be loaded: offline, or when the app was updated after the page was opened, since each
 * update gives the file a new name and the old one is gone.
 */
/** A box to lay out: whether it's inside the frame, and how tall it is, when that isn't NODE_H, as for a class with members. */
export interface LayoutNode {
  id: string;
  inside: boolean;
  height?: number;
}

export async function layOut(
  nodes: LayoutNode[],
  edges: { from: string; to: string }[],
  layout = elkLayout,
): Promise<{ positions: Record<string, Point>; failed: boolean }> {
  try {
    return { positions: await layout(nodes, edges), failed: false };
  } catch {
    return { positions: gridLayout(nodes), failed: true };
  }
}

/** Positions in rows of four, for when ELK can't be used: the boxes outside the frame, then below them the ones inside it. */
export function gridLayout(nodes: { id: string; inside: boolean }[]): Record<string, Point> {
  const PER_ROW = 4;
  const out: Record<string, Point> = {};
  /** Puts the boxes in rows from `top` down, and says where the next one would start. */
  const rows = (ids: string[], top: number) => {
    ids.forEach((id, i) => (out[id] = { x: (i % PER_ROW) * (NODE_W + 70), y: top + Math.floor(i / PER_ROW) * (NODE_H + 110) }));
    return top + Math.ceil(ids.length / PER_ROW) * (NODE_H + 110);
  };
  const outside = nodes.filter((n) => !n.inside).map((n) => n.id);
  const below = rows(outside, 0);
  // Room above the boxes inside for the frame's top edge.
  rows(
    nodes.filter((n) => n.inside).map((n) => n.id),
    outside.length ? below + 60 : 0,
  );
  return out;
}

export async function elkLayout(nodes: LayoutNode[], edges: { from: string; to: string }[]): Promise<Record<string, Point>> {
  const box = (n: LayoutNode): ElkNode => ({ id: n.id, width: NODE_W, height: n.height ?? NODE_H });
  const inside = nodes.filter((n) => n.inside);
  const children: ElkNode[] = nodes.filter((n) => !n.inside).map(box);
  // The spaces between boxes, which ELK takes from each box's parent: the frame needs them too.
  const spacing = { "elk.spacing.nodeNode": "70", "elk.layered.spacing.nodeNodeBetweenLayers": "110", "elk.spacing.componentComponent": "90" };
  if (inside.length) {
    children.push({ id: "__frame", layoutOptions: { "elk.padding": "[top=50,left=40,bottom=50,right=40]", ...spacing }, children: inside.map(box) });
  }
  const result = await (await loadElk()).layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      ...spacing,
    },
    children,
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  });
  const out: Record<string, Point> = {};
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      if (child.id === "__frame") walk(child, x, y);
      else out[child.id] = { x, y };
    }
  };
  walk(result, 0, 0);
  return out;
}

/** Positions for every box: saved ones as they are, missing ones placed near their ELK position without overlapping. */
export function placeMissing(ids: string[], saved: Record<string, Point>, auto: Record<string, Point>): Record<string, Point> {
  const placedIds = ids.filter((id) => saved[id]);
  const missing = ids.filter((id) => !saved[id]);
  if (placedIds.length === 0) return Object.fromEntries(ids.map((id) => [id, auto[id] ?? { x: 0, y: 0 }]));

  const result: Record<string, Point> = {};
  for (const id of placedIds) result[id] = saved[id]!;
  // Line ELK's coordinates up with the user's, using the boxes both know about.
  const known = placedIds.filter((id) => auto[id]);
  const dx = known.length ? known.reduce((s, id) => s + saved[id]!.x - auto[id]!.x, 0) / known.length : 0;
  const dy = known.length ? known.reduce((s, id) => s + saved[id]!.y - auto[id]!.y, 0) / known.length : 0;

  const overlaps = (p: Point) => Object.values(result).some((q) => Math.abs(p.x - q.x) < NODE_W + GAP / 2 && Math.abs(p.y - q.y) < NODE_H + GAP / 2);
  const ordered = missing.sort((a, b) => (auto[a]?.y ?? 0) - (auto[b]?.y ?? 0) || (auto[a]?.x ?? 0) - (auto[b]?.x ?? 0));
  for (const id of ordered) {
    const start = auto[id] ? { x: auto[id]!.x + dx, y: auto[id]!.y + dy } : { x: 0, y: 0 };
    result[id] = freeSpot(start, overlaps);
  }
  return result;
}

/** The free spot nearest `start`, in any direction, that doesn't overlap any box at `occupied`. */
export function freeSpotAmong(start: Point, occupied: Point[]): Point {
  const overlaps = (p: Point) => occupied.some((q) => Math.abs(p.x - q.x) < NODE_W + GAP / 2 && Math.abs(p.y - q.y) < NODE_H + GAP / 2);
  const candidates: Point[] = [];
  for (let row = -4; row <= 4; row++) {
    for (let col = -4; col <= 4; col++) candidates.push({ x: Math.round(start.x + col * (NODE_W / 2 + GAP)), y: Math.round(start.y + row * (NODE_H / 2 + GAP)) });
  }
  candidates.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
  return candidates.find((p) => !overlaps(p)) ?? { x: Math.round(start.x), y: Math.round(start.y) };
}

/** How big sticky notes are drawn: their width, about how many characters fit on a line, and a line's height. */
export interface StickySize {
  width: number;
  perLine: number;
  lineHeight: number;
}
/** Notes with 13px text, as `.sticky` in styles.css draws them. */
export const STICKY: StickySize = { width: 200, perLine: 26, lineHeight: 18 };
/**
 * Notes on a touch screen. Their text is 16px, so a phone doesn't zoom in
 * when you edit one, and they're wider to suit (see `.sticky` in styles.css).
 */
export const TOUCH_STICKY: StickySize = { width: 220, perLine: 23, lineHeight: 22 };
const STICKY_GAP = 24;

/** A sticky note's height before it has been drawn, estimated from its text. */
export function stickyHeight(text: string, size = STICKY): number {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / size.perLine)), 0);
  return 26 + lines * size.lineHeight;
}

/**
 * Positions for every sticky note: saved ones as they are, and the rest, in
 * order, in a column to the right of everything else.
 */
export function placeStickies(stickies: { id: string; text: string; at?: [number, number] }[], boxes: Point[], size = STICKY): Record<string, Point> {
  const placed = stickies.filter((s) => s.at).map((s) => ({ x: s.at![0], y: s.at![1] }));
  const rights = [...boxes.map((b) => b.x + NODE_W), ...placed.map((p) => p.x + size.width)];
  const x = rights.length ? Math.max(...rights) + 80 : 0;
  let y = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0;
  const out: Record<string, Point> = {};
  for (const s of stickies) {
    if (s.at) {
      out[s.id] = { x: s.at[0], y: s.at[1] };
      continue;
    }
    out[s.id] = { x, y };
    y += stickyHeight(s.text, size) + STICKY_GAP;
  }
  return out;
}

/** The first spot on a grid to the right of and below `start` that nothing overlaps. */
function freeSpot(start: Point, overlaps: (p: Point) => boolean): Point {
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 4; col++) {
      const p = { x: Math.round(start.x + col * (NODE_W + GAP)), y: Math.round(start.y + row * (NODE_H + GAP)) };
      if (!overlaps(p)) return p;
    }
  }
  return { x: Math.round(start.x), y: Math.round(start.y) };
}
