/**
 * The generated Mermaid preview stored in each view file, so GitHub and other
 * markdown viewers show a diagram without open-arch.
 */
import { kindLabel } from "./model.js";
import type { ArchElement } from "./types.js";
import type { ComputedView } from "./views.js";

const RESERVED = new Set(["end", "graph", "flowchart", "subgraph", "class", "classdef", "click", "style", "linkstyle", "direction", "default", "call", "href"]);

const CLASS_DEFS = [
  "classDef person fill:#08427b,stroke:#052e56,color:#ffffff",
  "classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff",
  "classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff",
  "classDef component fill:#85bbf0,stroke:#5d82a8,color:#000000",
  "classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff",
];

/** Mermaid node ID for an element ID: kebab-case becomes snake_case, which Mermaid parses safely. */
export function mermaidId(id: string): string {
  const out = id.replace(/-/g, "_");
  return RESERVED.has(out) ? `${out}_` : out;
}

function escape(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/\|/g, "#124;").replace(/`/g, "#96;");
}

function nodeLabel(e: ArchElement): string {
  const kind = kindLabel(e);
  const detail = e.technology ? `${kind}: ${e.technology}` : kind;
  return `"${escape(e.name)}<br/>[${escape(detail)}]"`;
}

function nodeLine(e: ArchElement): string {
  const id = mermaidId(e.id);
  const label = nodeLabel(e);
  if (e.kind === "person") return `${id}([${label}])`;
  // The nearest of Mermaid's shapes; it has none for a browser or a folder.
  switch (e.shape) {
    case "database":
      return `${id}[(${label})]`;
    case "queue":
      return `${id}[[${label}]]`;
    case "mobile-app":
      return `${id}(${label})`;
    default:
      return `${id}[${label}]`;
  }
}

export function renderMermaid(cv: ComputedView): string {
  const lines = ["flowchart TB"];
  const boundary = cv.boundary;
  const inside = boundary ? cv.nodes.filter((n) => n.parent === boundary.id) : [];
  const outside = cv.nodes.filter((n) => !inside.includes(n));

  if (cv.nodes.length === 0) lines.push("  %% This view has no elements yet.");
  for (const node of outside.filter((n) => n.kind === "person")) lines.push(`  ${nodeLine(node)}`);
  if (boundary) {
    // One line: Mermaid clips multi-line frame titles.
    lines.push(`  subgraph ${mermaidId(boundary.id)}_boundary["${escape(boundary.name)} [${escape(kindLabel(boundary))}]"]`);
    for (const node of inside) lines.push(`    ${nodeLine(node)}`);
    lines.push("  end");
  }
  for (const node of outside.filter((n) => n.kind !== "person")) lines.push(`  ${nodeLine(node)}`);

  for (const edge of cv.edges) {
    const parts = [edge.description, edge.technology ? `[${edge.technology}]` : undefined].filter(Boolean) as string[];
    const label = parts.length ? `|"${parts.map(escape).join("<br/>")}"|` : "";
    lines.push(`  ${mermaidId(edge.from)} -->${label} ${mermaidId(edge.to)}`);
  }

  if (cv.nodes.length) {
    lines.push(...CLASS_DEFS.map((c) => `  ${c}`));
    const byClass = new Map<string, string[]>();
    for (const node of cv.nodes) {
      const cls = node.external ? "external" : node.kind;
      byClass.set(cls, [...(byClass.get(cls) ?? []), mermaidId(node.id)]);
    }
    for (const [cls, ids] of byClass) lines.push(`  class ${ids.join(",")} ${cls}`);
  }
  if (boundary) lines.push(`  style ${mermaidId(boundary.id)}_boundary fill:none,stroke:#444444,stroke-dasharray:5 5`);
  return lines.join("\n");
}
