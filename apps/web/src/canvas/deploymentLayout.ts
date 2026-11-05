/**
 * Laying out a deployment view: its nodes nested inside one another, the containers and systems
 * they run as boxes inside them, and the arrows routed round them. ELK does all of it, the
 * arrows too, as nothing on a deployment view is placed by hand. When ELK can't be loaded, the
 * boxes go in rows inside their nodes, and the arrows are drawn straight. The arrows' labels are
 * placed as on other views, clear of the boxes and of each node's name.
 */
import { nodeKindLabel, type ComputedDeployment, type DeploymentNode } from "@open-arch/core";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk.bundled.js";
import { loadOnce, NODE_W, type Point } from "./autoLayout.js";
import { placeLabels, type Box } from "./routing.js";

/** Room inside a node round what it holds, and at its top for its name, its kind and its technology. */
export const NODE_PAD = { top: 64, side: 30, bottom: 30 };
const SPACING = { "elk.spacing.nodeNode": "60", "elk.layered.spacing.nodeNodeBetweenLayers": "80", "elk.spacing.componentComponent": "60", "elk.spacing.edgeNode": "24", "elk.spacing.edgeEdge": "16" };

export interface DeploymentLayout {
  /** Every node, holding something or not, and every instance, by its ID: where it is and how big. */
  boxes: Map<string, Box>;
  /** Each arrow's route, by its ID. */
  arrows: Map<string, Point[]>;
}

/**
 * How tall a box is drawn: its name and kind, and its description at about 30 characters a line,
 * but no less than a box's least height (see .c4 in styles.css). Boxes are drawn this tall, so
 * the arrows ELK routes to them meet their edges.
 */
export function boxHeight(description: string | undefined): number {
  const lines = description ? Math.ceil(description.length / 30) : 0;
  return Math.max(100, 76 + lines * 16);
}

/** Whether a node is drawn as a frame round what it holds, rather than as a box of its own. */
export function holdsAnything(d: ComputedDeployment, node: DeploymentNode): boolean {
  return d.nodes.some((n) => n.parent === node.id) || d.instances.some((i) => i.node === node.id);
}

const loadElk = loadOnce(() => import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK()));

/** The view laid out, by ELK unless `layout` says otherwise. `failed` says when ELK couldn't be used and the rows were. */
export async function layOutDeployment(
  d: ComputedDeployment,
  labels: Map<string, { w: number; h: number }>,
  layout: (d: ComputedDeployment, labels: Map<string, { w: number; h: number }>) => Promise<DeploymentLayout> = elkDeployment,
): Promise<{ layout: DeploymentLayout; failed: boolean }> {
  try {
    return { layout: await layout(d, labels), failed: false };
  } catch {
    return { layout: rowsDeployment(d), failed: true };
  }
}

export async function elkDeployment(d: ComputedDeployment, labels: Map<string, { w: number; h: number }>): Promise<DeploymentLayout> {
  const graph = (parent: string | undefined): ElkNode[] => [
    ...d.instances.filter((i) => parent !== undefined && i.node === parent).map((i): ElkNode => ({ id: i.id, width: NODE_W, height: boxHeight(i.element.description) })),
    ...d.nodes
      .filter((n) => n.parent === parent)
      .map((n): ElkNode =>
        holdsAnything(d, n)
          ? { id: n.id, layoutOptions: { "elk.padding": `[top=${NODE_PAD.top},left=${NODE_PAD.side},bottom=${NODE_PAD.bottom},right=${NODE_PAD.side}]`, ...SPACING }, children: graph(n.id) }
          : { id: n.id, width: NODE_W, height: boxHeight(n.description) },
      ),
  ];
  const edges = d.arrows.map((a): ElkExtendedEdge => {
    const size = labels.get(a.id);
    return { id: a.id, sources: [a.from], targets: [a.to], labels: size ? [{ id: `${a.id}:label`, width: size.w, height: size.h }] : [] };
  });
  const result = await (await loadElk()).layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.edgeLabels.placement": "CENTER",
      // Everything in the diagram's own coordinates, nested or not.
      "elk.json.shapeCoords": "ROOT",
      "elk.json.edgeCoords": "ROOT",
      ...SPACING,
    },
    children: graph(undefined),
    edges,
  });
  const boxes = new Map<string, Box>();
  const walk = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      boxes.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, w: child.width ?? NODE_W, h: child.height ?? 0 });
      walk(child);
    }
  };
  walk(result);
  const arrows = new Map<string, Point[]>();
  for (const edge of (result.edges ?? []) as ElkExtendedEdge[]) {
    arrows.set(edge.id, (edge.sections ?? []).flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]));
  }
  return { boxes, arrows };
}

const GAP = 50;

/**
 * Without ELK: each node's instances in a row along its top, then the nodes inside it in a row
 * below them, and the top-level nodes in a column. Arrows go straight from the middle of the
 * bottom of one box to the middle of the top of the other.
 */
export function rowsDeployment(d: ComputedDeployment): DeploymentLayout {
  const boxes = new Map<string, Box>();
  /** Lays out a node at (x, y), and says how big it is. */
  const place = (node: DeploymentNode, x: number, y: number): { w: number; h: number } => {
    if (!holdsAnything(d, node)) {
      const box = { x, y, w: NODE_W, h: boxHeight(node.description) };
      boxes.set(node.id, box);
      return box;
    }
    let right = x + NODE_PAD.side;
    let bottom = y + NODE_PAD.top;
    let cx = x + NODE_PAD.side;
    for (const i of d.instances.filter((i) => i.node === node.id)) {
      const h = boxHeight(i.element.description);
      boxes.set(i.id, { x: cx, y: y + NODE_PAD.top, w: NODE_W, h });
      cx += NODE_W + GAP;
      right = Math.max(right, cx - GAP);
      bottom = Math.max(bottom, y + NODE_PAD.top + h);
    }
    const top = cx > x + NODE_PAD.side ? bottom + GAP : bottom;
    cx = x + NODE_PAD.side;
    for (const child of d.nodes.filter((n) => n.parent === node.id)) {
      const size = place(child, cx, top);
      cx += size.w + GAP;
      right = Math.max(right, cx - GAP);
      bottom = Math.max(bottom, top + size.h);
    }
    const box = { x, y, w: right + NODE_PAD.side - x, h: bottom + NODE_PAD.bottom - y };
    boxes.set(node.id, box);
    return box;
  };
  let y = 0;
  for (const node of d.nodes.filter((n) => !n.parent)) y += place(node, 0, y).h + GAP;
  const arrows = new Map<string, Point[]>();
  for (const a of d.arrows) {
    const from = boxes.get(a.from);
    const to = boxes.get(a.to);
    if (from && to) arrows.set(a.id, [{ x: from.x + from.w / 2, y: from.y + from.h }, { x: to.x + to.w / 2, y: to.y }]);
  }
  return { boxes, arrows };
}

/** About where a node's name, kind and technology are drawn at the top left of its frame (see .deployment-frame-label). */
export function frameLabelBox(node: DeploymentNode, frame: Box): Box {
  const kind = `[${nodeKindLabel(node)}${node.technology ? `: ${node.technology}` : ""}]`;
  const name = node.name.length * 8 + (node.instances > 1 ? 30 : 0);
  return { x: frame.x + 14, y: frame.y + 8, w: Math.min(frame.w - 28, Math.max(name, kind.length * 6.2)), h: 36 };
}

/**
 * Where each arrow's label's centre goes: on its route, clear of the boxes, the nodes' names
 * and the other labels where there's room, as placeLabels places them. `sizes` are by arrow ID.
 */
export function placeDeploymentLabels(d: ComputedDeployment, layout: DeploymentLayout, sizes: Map<string, { w: number; h: number }>): Map<string, Point> {
  const obstacles: Box[] = [];
  for (const n of d.nodes) {
    const box = layout.boxes.get(n.id);
    if (box) obstacles.push(holdsAnything(d, n) ? frameLabelBox(n, box) : box);
  }
  for (const i of d.instances) {
    const box = layout.boxes.get(i.id);
    if (box) obstacles.push(box);
  }
  const routes = new Map([...layout.arrows].filter(([id, points]) => sizes.has(id) && points.length >= 2));
  return placeLabels(routes, new Map([...sizes].filter(([id]) => routes.has(id))), obstacles);
}
