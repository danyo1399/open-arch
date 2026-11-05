/**
 * The generated Mermaid preview stored in each view file, so GitHub and other
 * markdown viewers show a diagram without open-arch.
 */
import { inFrame, kindLabel } from "./model.js";
import type { ArchElement, RelationshipKind } from "./types.js";
import type { ComputedView } from "./views.js";

const RESERVED = new Set(["end", "graph", "flowchart", "subgraph", "class", "classdef", "click", "style", "linkstyle", "direction", "default", "call", "href"]);

/** Only in a diagram with a library, so diagrams without one read as they did before there were libraries. */
const LIBRARY_DEF = "classDef library fill:#85bbf0,stroke:#5d82a8,color:#000000,stroke-dasharray:5 5";

const CLASS_DEFS = [
  "classDef person fill:#08427b,stroke:#052e56,color:#ffffff",
  "classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff",
  "classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff",
  "classDef component fill:#85bbf0,stroke:#5d82a8,color:#000000",
  "classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff",
];

/** Words a sequence diagram reads as keywords, whatever their case. */
const SEQUENCE_RESERVED = new Set([
  "participant", "actor", "as", "autonumber", "activate", "deactivate", "note", "over", "left", "right", "of", "loop", "alt", "else", "opt", "par", "and",
  "rect", "critical", "break", "end", "box", "title", "link", "links", "properties", "details", "create", "destroy", "off",
]);

/** Words a class diagram reads as keywords, beyond those in RESERVED. */
const CLASS_RESERVED = new Set(["note", "namespace", "link", "callback"]);

/** Mermaid node ID for an element ID: kebab-case becomes snake_case, which Mermaid parses safely. */
export function mermaidId(id: string): string {
  const out = id.replace(/-/g, "_");
  return RESERVED.has(out) ? `${out}_` : out;
}

/** A participant's ID in a sequence diagram, which has keywords of its own. */
function participantId(id: string): string {
  const out = mermaidId(id);
  return SEQUENCE_RESERVED.has(out) ? `${out}_` : out;
}

/** A class's ID in a class diagram, which has keywords of its own. */
function classId(id: string): string {
  const out = mermaidId(id);
  return CLASS_RESERVED.has(out) ? `${out}_` : out;
}

function escape(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/\|/g, "#124;").replace(/`/g, "#96;");
}

const SEQUENCE_ENTITIES: Record<string, string> = { "#": "#35;", ";": "#59;", '"': "#quot;", "<": "#lt;", ">": "#gt;", "|": "#124;", "`": "#96;" };

/** Text for one line of a sequence diagram, where `#` and `;` mean something too, and a line break ends the line. */
function escapeLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").replace(/[#;"<>|`]/g, (c) => SEQUENCE_ENTITIES[c]!);
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
  // The nearest of Mermaid's shapes. The rest, like a browser, a folder or an envelope, are boxes.
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
  if (cv.view.level === "sequence") return renderSequence(cv);
  if (cv.view.level === "class") return renderClasses(cv);
  const lines = ["flowchart TB"];
  const boundary = cv.boundary;
  const inside = cv.nodes.filter((n) => inFrame(boundary, n));
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
    lines.push(`  ${mermaidId(edge.from)} ${edge.bidirectional ? "<-->" : "-->"}${label} ${mermaidId(edge.to)}`);
  }

  if (cv.nodes.length) {
    lines.push(...CLASS_DEFS.map((c) => `  ${c}`));
    if (cv.nodes.some((n) => n.kind === "library")) lines.push(`  ${LIBRARY_DEF}`);
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


/**
 * A sequence view as a Mermaid sequence diagram: a lifeline per element, people as actors, and
 * each step numbered, calls as solid arrows and replies as dashed ones.
 */
function renderSequence(cv: ComputedView): string {
  const lines = ["sequenceDiagram"];
  if (cv.steps.length === 0) {
    lines.push("  %% This view has no steps yet.");
    return lines.join("\n");
  }
  lines.push("  autonumber");
  for (const e of cv.nodes) {
    const kind = kindLabel(e);
    const detail = e.technology ? `${kind}: ${e.technology}` : kind;
    lines.push(`  ${e.kind === "person" ? "actor" : "participant"} ${participantId(e.id)} as ${escapeLine(e.name)}<br/>[${escapeLine(detail)}]`);
  }
  for (const step of cv.steps) {
    const text = [step.label ?? "(no description)", step.labelTechnology ? `[${step.labelTechnology}]` : undefined].filter(Boolean).map((t) => escapeLine(t!)).join(" ");
    lines.push(`  ${participantId(step.from)}${step.reply ? "-->>" : "->>"}${participantId(step.to)}: ${text}`);
  }
  return lines.join("\n");
}

/** Each kind of relationship as a class diagram draws it, from the element it's on to the one it names. */
const CLASS_ARROWS: Record<RelationshipKind, string> = {
  association: "-->",
  dependency: "..>",
  inheritance: "--|>",
  realization: "..|>",
  composition: "*--",
  aggregation: "o--",
};

/**
 * Characters a class diagram reads as markup, as entities. Brackets are left alone: they make a
 * member a method. Line breaks become spaces.
 */
const CLASS_ENTITIES: Record<string, string> = {
  "#": "#35;",
  ";": "#59;",
  '"': "#quot;",
  "<": "#lt;",
  ">": "#gt;",
  "{": "#123;",
  "}": "#125;",
  "|": "#124;",
  "`": "#96;",
  "~": "#126;",
  "*": "#42;",
  _: "#95;",
  $: "#36;",
};

function escapeClass(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").replace(/[#;"<>{}|`~*_$]/g, (c) => CLASS_ENTITIES[c]!);
}

/**
 * A member as Mermaid shows it. Mermaid puts its own colon before a method's return type, so the
 * one in UML's "+total(): Money" goes.
 */
function memberLine(member: string): string {
  return escapeClass(member.replace(/\)\s*:\s*([^()]*)$/, ") $1"));
}

/**
 * A class view as a Mermaid class diagram: each class with its stereotype and members, the other
 * boxes as classes named by their kind, and each arrow in UML's notation for its kind.
 */
function renderClasses(cv: ComputedView): string {
  const lines = ["classDiagram"];
  if (cv.nodes.length === 0) {
    lines.push("  %% This view has no elements yet.");
    return lines.join("\n");
  }
  for (const e of cv.nodes) {
    const kind = kindLabel(e);
    const annotation = e.kind === "class" ? e.stereotype : e.technology ? `${kind}: ${e.technology}` : kind;
    const body = [...(annotation ? [`<<${escapeClass(annotation)}>>`] : []), ...(e.kind === "class" ? e.members.map(memberLine) : [])];
    const head = `  class ${classId(e.id)}["${escapeClass(e.name)}"]`;
    lines.push(body.length ? `${head} {` : head, ...(body.length ? [...body.map((b) => `    ${b}`), "  }"] : []));
  }
  for (const edge of cv.edges) {
    const arrow = edge.bidirectional ? "<-->" : CLASS_ARROWS[edge.kind];
    const text = [edge.description, edge.technology ? `[${edge.technology}]` : undefined].filter(Boolean).join(" ");
    lines.push(`  ${classId(edge.from)} ${arrow} ${classId(edge.to)}${text ? ` : ${escapeClass(text)}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * One view on its own as a markdown file: its title, its description and its Mermaid diagram.
 * Unlike the view's page in the generated docs, it links to nothing, so it reads the same
 * wherever it's put.
 */
export function viewMarkdown(cv: ComputedView): string {
  const v = cv.view;
  const lines = [`# ${v.title}`];
  if (v.description) lines.push("", v.description);
  lines.push("", "```mermaid", renderMermaid(cv), "```", "");
  return lines.join("\n");
}
