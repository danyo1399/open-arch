/**
 * The generated Mermaid preview stored in each view file, so GitHub and other
 * markdown viewers show a diagram without open-arch.
 */
import { inFrame, kindLabel } from "./model.js";
import type { ArchElement, DeploymentNode, ElementShape, RelationshipKind, Transition } from "./types.js";
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
  if (e.kind === "person") return `${mermaidId(e.id)}([${nodeLabel(e)}])`;
  return shaped(mermaidId(e.id), nodeLabel(e), e.shape);
}

/** A flowchart node with this ID and label, in the nearest of Mermaid's shapes. */
function shaped(id: string, label: string, shape: ElementShape): string {
  // The rest, like a browser, a folder or an envelope, are boxes.
  switch (shape) {
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
  if (cv.view.level === "state") return renderStates(cv);
  if (cv.deployment) return renderDeployment(cv);
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

  // A flowchart has none of UML's arrow ends, so an arrow of another kind than association, as
  // between two classes a library holds, says its kind, and a dependency or realization is dashed.
  for (const edge of cv.edges) {
    const kind = edge.kind === "association" ? undefined : `(${edge.kind})`;
    const parts = [kind, edge.description, edge.technology ? `[${edge.technology}]` : undefined].filter(Boolean) as string[];
    const label = parts.length ? `|"${parts.map(escape).join("<br/>")}"|` : "";
    const line = edge.bidirectional ? "<-->" : edge.kind === "dependency" || edge.kind === "realization" ? "-.->" : "-->";
    lines.push(`  ${mermaidId(edge.from)} ${line}${label} ${mermaidId(edge.to)}`);
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

/** Words a state diagram reads as keywords, beyond those in RESERVED. */
const STATE_RESERVED = new Set(["state", "note", "as", "statediagram"]);

/** Text for a state diagram's line, where a colon ends the name of what it describes. */
function escapeState(text: string): string {
  return escapeLine(text).replace(/:/g, "#58;");
}

/** A state's ID in a state diagram, which has keywords of its own. */
function stateId(id: string): string {
  const out = mermaidId(id);
  return STATE_RESERVED.has(out) ? `${out}_` : out;
}

/** A transition's label as UML writes one: `event [guard] / action`, each part only when it has one. */
export function transitionLabel(t: Pick<Transition, "event" | "guard" | "action">): string {
  return [t.event, t.guard ? `[${t.guard}]` : undefined, t.action ? `/ ${t.action}` : undefined].filter(Boolean).join(" ");
}

/**
 * A state view as a Mermaid state diagram: each state with its name and description, a start
 * into the initial state, an end out of each final state, and each transition labelled
 * `event [guard] / action`.
 */
function renderStates(cv: ComputedView): string {
  const v = cv.view;
  const lines = ["stateDiagram-v2"];
  if (v.states.length === 0) {
    lines.push("  %% This view has no states yet.");
    return lines.join("\n");
  }
  const known = new Set(v.states.map((s) => s.id));
  for (const s of v.states) {
    lines.push(`  state "${escapeState(s.name)}" as ${stateId(s.id)}`);
    if (s.description) lines.push(`  ${stateId(s.id)} : ${escapeState(s.description)}`);
  }
  if (v.initial && known.has(v.initial)) lines.push(`  [*] --> ${stateId(v.initial)}`);
  for (const t of v.transitions) {
    if (!known.has(t.from) || !known.has(t.to)) continue;
    const label = transitionLabel(t);
    lines.push(`  ${stateId(t.from)} --> ${stateId(t.to)}${label ? ` : ${escapeState(label)}` : ""}`);
  }
  for (const s of v.states) if (s.final) lines.push(`  ${stateId(s.id)} --> [*]`);
  return lines.join("\n");
}

/** A deployment node's kind, as its label says it: an infrastructure node, or a deployment node. */
export function nodeKindLabel(node: Pick<DeploymentNode, "infrastructure">): string {
  return node.infrastructure ? "Infrastructure node" : "Deployment node";
}

/**
 * A deployment view as a Mermaid flowchart: each node that holds anything as a subgraph, nested,
 * with the containers and systems it runs inside, and each other node as a box in its shape.
 */
function renderDeployment(cv: ComputedView): string {
  const d = cv.deployment!;
  const lines = ["flowchart TB"];
  if (d.nodes.length === 0) {
    lines.push("  %% This view has no nodes yet.");
    return lines.join("\n");
  }
  // Node IDs come from kebab-case, so never have two underscores in a row, and an instance's can't be any node's.
  const nodeId = (id: string) => mermaidId(id);
  const boxId = (box: string) => (box.includes("/") ? box.split("/").map((p) => p.replace(/-/g, "_")).join("__") : nodeId(box));
  /** A node's name, with how many copies run, then its kind and technology, with `between` between them. */
  const label = (n: DeploymentNode, between: string) => {
    const detail = n.technology ? `${nodeKindLabel(n)}: ${n.technology}` : nodeKindLabel(n);
    return `${escape(n.name)}${n.instances > 1 ? ` ×${n.instances}` : ""}${between}[${escape(detail)}]`;
  };
  const children = (id: string | undefined) => d.nodes.filter((n) => n.parent === id);
  const runIn = (id: string) => d.instances.filter((i) => i.node === id);
  const holds = (n: DeploymentNode) => children(n.id).length > 0 || runIn(n.id).length > 0;
  const write = (n: DeploymentNode, indent: string) => {
    if (!holds(n)) {
      // A node with nothing inside is a box, with its kind under its name, as an element's box has.
      lines.push(`${indent}${shaped(nodeId(n.id), `"${label(n, "<br/>")}"`, n.shape)}`);
      return;
    }
    // A subgraph's title on one line: Mermaid clips titles of more.
    lines.push(`${indent}subgraph ${nodeId(n.id)}["${label(n, " ")}"]`);
    for (const i of runIn(n.id)) lines.push(`${indent}  ${shaped(boxId(i.id), nodeLabel(i.element), i.element.shape)}`);
    for (const child of children(n.id)) write(child, `${indent}  `);
    lines.push(`${indent}end`);
  };
  for (const n of children(undefined)) write(n, "  ");
  for (const arrow of d.arrows) {
    const parts = [arrow.description, arrow.technology ? `[${arrow.technology}]` : undefined].filter(Boolean) as string[];
    const text = parts.length ? `|"${parts.map(escape).join("<br/>")}"|` : "";
    lines.push(`  ${boxId(arrow.from)} ${arrow.bidirectional ? "<-->" : "-->"}${text} ${boxId(arrow.to)}`);
  }
  if (d.instances.length) {
    lines.push(...CLASS_DEFS.filter((c) => /classDef (container|system|external) /.test(c)).map((c) => `  ${c}`));
    const byClass = new Map<string, string[]>();
    for (const i of d.instances) {
      const cls = i.element.external ? "external" : i.element.kind;
      byClass.set(cls, [...(byClass.get(cls) ?? []), boxId(i.id)]);
    }
    for (const [cls, ids] of byClass) lines.push(`  class ${ids.join(",")} ${cls}`);
  }
  const boxes = d.nodes.filter((n) => !holds(n));
  if (boxes.length) {
    lines.push(`  ${NODE_DEF}`, `  class ${boxes.map((n) => nodeId(n.id)).join(",")} deploymentNode`);
  }
  for (const n of d.nodes.filter(holds)) lines.push(`  style ${nodeId(n.id)} fill:none,stroke:#444444`);
  return lines.join("\n");
}

/** A deployment node or infrastructure node drawn as a box: white, with a grey edge, as the designer draws them. */
const NODE_DEF = "classDef deploymentNode fill:#ffffff,stroke:#8a94a6,color:#000000";

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
