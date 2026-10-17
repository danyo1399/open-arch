/**
 * The layout comment at the end of a view file: box positions saved by the
 * designer, keyed by element ID. It is only a hint. Elements without a
 * position get placed automatically, and entries for elements that left the
 * view are dropped by `fmt`.
 */

export interface NodeLayout {
  x: number;
  y: number;
  w?: number;
  h?: number;
  [extra: string]: unknown;
}

export interface Layout {
  nodes: Record<string, NodeLayout>;
  /** Other top-level keys, kept as they are for future use. */
  [extra: string]: unknown;
}

export type LayoutParse = { ok: true; layout: Layout } | { ok: false; message: string };

export function parseLayout(json: string): LayoutParse {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, message: `The layout comment isn't valid JSON: ${(error as Error).message}` };
  }
  if (!isObject(value)) return { ok: false, message: 'The layout comment must hold a JSON object like {"nodes": {}}.' };
  const nodes = value.nodes ?? {};
  if (!isObject(nodes)) return { ok: false, message: "`nodes` in the layout comment must be an object keyed by element ID." };
  for (const [id, node] of Object.entries(nodes)) {
    if (!isObject(node) || typeof node.x !== "number" || typeof node.y !== "number") {
      return { ok: false, message: `Layout entry "${id}" needs numeric \`x\` and \`y\`.` };
    }
  }
  return { ok: true, layout: { ...value, nodes: nodes as Record<string, NodeLayout> } };
}

/** Deterministic text: one node per line, sorted by ID, so diffs stay small. */
export function layoutBlockLines(layout: Layout): string[] {
  const ids = Object.keys(layout.nodes).sort();
  const extras = Object.keys(layout)
    .filter((k) => k !== "nodes")
    .sort();
  const lines = ["<!-- open-arch:layout", "{"];
  if (ids.length === 0) {
    lines.push(`  "nodes": {}${extras.length ? "," : ""}`);
  } else {
    lines.push('  "nodes": {');
    ids.forEach((id, i) => lines.push(`    ${JSON.stringify(id)}: ${nodeJson(layout.nodes[id]!)}${i < ids.length - 1 ? "," : ""}`));
    lines.push(`  }${extras.length ? "," : ""}`);
  }
  extras.forEach((key, i) => lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(layout[key])}${i < extras.length - 1 ? "," : ""}`));
  lines.push("}", "-->");
  return lines;
}

function nodeJson(node: NodeLayout): string {
  const first = ["x", "y", "w", "h"].filter((k) => node[k] !== undefined);
  const rest = Object.keys(node)
    .filter((k) => !first.includes(k))
    .sort();
  const parts = [...first, ...rest].map((k) => `${JSON.stringify(k)}: ${JSON.stringify(node[k])}`);
  return `{${parts.join(", ")}}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
