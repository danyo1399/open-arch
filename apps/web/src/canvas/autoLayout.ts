/**
 * Placing boxes that have no saved position. A view with no positions at all
 * gets a full ELK layout; boxes added to a laid-out view are put near where
 * ELK would put them, without moving anything the user placed.
 */
import type { Operation, ViewDef } from "@open-arch/core";
import type { ELK as ElkEngine, ElkNode } from "elkjs/lib/elk.bundled.js";

export const NODE_W = 220;
export const NODE_H = 120;
const GAP = 40;
/** How far apart one row of boxes is from the next, when the arrows' labels need no more room than this. */
export const ROW_GAP = 110;

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
/** A box to lay out: whether it's inside the frame, and how tall and wide it is, when that isn't NODE_H or NODE_W, as for a class with members or an entity. */
export interface LayoutNode {
  id: string;
  inside: boolean;
  height?: number;
  width?: number;
}

/** An arrow between two boxes to lay out, and how big its label is drawn at its widest, when it has one. */
export interface LayoutEdge {
  from: string;
  to: string;
  label?: { w: number; h: number };
}

export async function layOut(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
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
    ids.forEach((id, i) => (out[id] = { x: (i % PER_ROW) * (NODE_W + 70), y: top + Math.floor(i / PER_ROW) * (NODE_H + ROW_GAP) }));
    return top + Math.ceil(ids.length / PER_ROW) * (NODE_H + ROW_GAP);
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

/** Labels one above the other are given this much room between them, as the router keeps them this far apart where it can (see LABEL_APART in routing.ts). */
const LABEL_APART = 24;
/** The room left at each end of an arrow, between its label and the box there, for the line and its arrowhead to show. */
const LABEL_CLEAR = 24;
/** Room is made for this many labels one above the other. With more arrows than this at one box, their labels spread sideways too. */
const STACKED = 3;

/**
 * How far apart ELK puts each row of boxes from the next, so the arrows' labels have room:
 * ROW_GAP, or more when they need it. It's one gap for the whole diagram, as ELK takes one, so
 * every row is as far apart as the most crowded needs. Arrows leaving one box run side by side,
 * closer together than their labels are wide, so their labels go one above the other, and the
 * same for arrows arriving at one box. The rows are far enough apart for the tallest of those
 * labels, up to STACKED of them, at whichever box needs the most room. That can be one label on
 * its own, when it's a tall one.
 * When the boxes are laid out in columns (`down` is false), the arrows run across, and so do
 * their labels: the columns are far enough apart for the widest.
 */
export function rowGap(edges: LayoutEdge[], down = true): number {
  const labels = edges.flatMap((e) => (e.label ? [{ ...e, label: e.label }] : []));
  if (!down) return Math.ceil(Math.max(ROW_GAP, ...labels.map((e) => e.label.w + 2 * LABEL_CLEAR)));
  // The heights of the labels on the arrows leaving each box, and of those arriving at each.
  const [leaving, arriving] = [new Map<string, number[]>(), new Map<string, number[]>()];
  for (const e of labels) {
    leaving.set(e.from, [...(leaving.get(e.from) ?? []), e.label.h]);
    arriving.set(e.to, [...(arriving.get(e.to) ?? []), e.label.h]);
  }
  const room = (heights: number[]) => {
    const tallest = heights.sort((a, b) => b - a).slice(0, STACKED);
    return tallest.reduce((sum, h) => sum + h, 0) + (tallest.length - 1) * LABEL_APART + 2 * LABEL_CLEAR;
  };
  return Math.ceil(Math.max(ROW_GAP, ...[...leaving.values(), ...arriving.values()].map(room)));
}

/** `options`: more of ELK's layout options, for the whole diagram. */
export async function elkLayout(nodes: LayoutNode[], edges: LayoutEdge[], options: Record<string, string> = {}): Promise<Record<string, Point>> {
  const box = (n: LayoutNode): ElkNode => ({ id: n.id, width: n.width ?? NODE_W, height: n.height ?? NODE_H });
  const inside = nodes.filter((n) => n.inside);
  const children: ElkNode[] = nodes.filter((n) => !n.inside).map(box);
  const between = rowGap(edges, (options["elk.direction"] ?? "DOWN") === "DOWN");
  // The spaces between boxes, which ELK takes from each box's parent: the frame needs them too.
  const spacing = { "elk.spacing.nodeNode": "70", "elk.layered.spacing.nodeNodeBetweenLayers": String(between), "elk.spacing.componentComponent": "90" };
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
      ...options,
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

/** Something on a diagram, at its top-left corner: a box's size, unless it says how big it is. */
export type Spot = Point & { w?: number; h?: number };

/**
 * The free spot nearest `start`, in any direction, where something of `size`, a box's unless it
 * says, doesn't overlap anything in `occupied`.
 */
export function freeSpotAmong(start: Point, occupied: Spot[], size: { w: number; h: number } = { w: NODE_W, h: NODE_H }): Point {
  const overlaps = (p: Point) =>
    occupied.some((q) => {
      const [w, h] = [q.w ?? NODE_W, q.h ?? NODE_H];
      return p.x < q.x + w + GAP / 2 && q.x < p.x + size.w + GAP / 2 && p.y < q.y + h + GAP / 2 && q.y < p.y + size.h + GAP / 2;
    });
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

/** How big a new note is, with the text it's added with, for finding a free spot for it. */
export function newStickySpace(size = STICKY): { w: number; h: number } {
  return { w: size.width, h: stickyHeight("New note", size) };
}

/** The smallest a sticky note can be resized to, across or down. */
export const STICKY_MIN = 60;
/** How much of a note's width its padding takes, either side of its text (see `.sticky` in styles.css). */
const STICKY_PADDING = 28;

/**
 * How big a sticky note is before it has been drawn: as wide as its size says, or else the usual
 * width, and as tall as its size says, or taller when its text, estimated, needs more.
 */
export function stickyBox(sticky: { text: string; size?: [number, number] }, size = STICKY): { width: number; height: number } {
  if (!sticky.size) return { width: size.width, height: stickyHeight(sticky.text, size) };
  const [width, height] = sticky.size;
  // A line of a narrower note holds fewer characters, and of a wider one more.
  const perLine = Math.max(1, Math.floor((size.perLine * (width - STICKY_PADDING)) / (size.width - STICKY_PADDING)));
  return { width, height: Math.max(height, stickyHeight(sticky.text, { ...size, perLine })) };
}

/**
 * Positions for every sticky note: saved ones as they are; ones on something, by ID in `beside`,
 * in the free spot nearest that point, clear of the boxes and the notes placed before them; and
 * the rest, in order, in a column to the right of everything else.
 */
export function placeStickies(
  stickies: { id: string; text: string; at?: [number, number]; size?: [number, number] }[],
  boxes: Point[],
  size = STICKY,
  beside: Record<string, Point> = {},
): Record<string, Point> {
  const noteAt = (s: (typeof stickies)[number], at: Point) => {
    const box = stickyBox(s, size);
    return { ...at, w: box.width, h: box.height };
  };
  const placed = stickies.filter((s) => s.at).map((s) => noteAt(s, { x: s.at![0], y: s.at![1] }));
  const out: Record<string, Point> = {};
  // Each note beside what it's on is clear of the boxes and the other notes, at their sizes.
  const taken: Spot[] = [...boxes, ...placed];
  for (const s of stickies) {
    if (s.at || !beside[s.id]) continue;
    const box = stickyBox(s, size);
    out[s.id] = freeSpotAmong(beside[s.id]!, taken, { w: box.width, h: box.height });
    taken.push(noteAt(s, out[s.id]!));
  }
  const rights = [...boxes.map((b) => b.x + NODE_W), ...taken.slice(boxes.length).map((p) => p.x + p.w!)];
  const x = rights.length ? Math.max(...rights) + 80 : 0;
  let y = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0;
  for (const s of stickies) {
    if (s.at) {
      out[s.id] = { x: s.at[0], y: s.at[1] };
      continue;
    }
    if (out[s.id]) continue;
    out[s.id] = { x, y };
    y += stickyBox(s, size).height + STICKY_GAP;
  }
  return out;
}

/**
 * The part of Auto layout's edit for sticky notes: each note with a saved place goes back to where
 * the designer puts a note with none, beside what it's on or else beside the diagram. Once
 * everything else has moved, the place it had means nothing.
 */
export function stickiesBackOps(view: Pick<ViewDef, "id" | "stickies">): Operation[] {
  return view.stickies.flatMap((s): Operation[] => (s.at ? [{ op: "update-sticky", view: view.id, id: s.id, at: null }] : []));
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
