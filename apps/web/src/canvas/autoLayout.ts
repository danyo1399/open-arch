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

// ELK is large, so it's loaded the first time a view needs laying out.
let elk: Promise<ElkEngine> | undefined;
const loadElk = () => (elk ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK()));

export async function elkLayout(nodes: { id: string; inside: boolean }[], edges: { from: string; to: string }[]): Promise<Record<string, Point>> {
  const box = (id: string): ElkNode => ({ id, width: NODE_W, height: NODE_H });
  const inside = nodes.filter((n) => n.inside);
  const children: ElkNode[] = nodes.filter((n) => !n.inside).map((n) => box(n.id));
  if (inside.length) {
    children.push({ id: "__frame", layoutOptions: { "elk.padding": "[top=50,left=40,bottom=50,right=40]" }, children: inside.map((n) => box(n.id)) });
  }
  const result = await (await loadElk()).layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "70",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.componentComponent": "90",
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
