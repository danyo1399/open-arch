import {
  computeView,
  describeElement,
  modelTree,
  scopeProblems,
  suggest,
  tagEntries,
  tagText,
  type ArchElement,
  type Relationship,
  type Tags,
  type TreeNode,
  type Workspace,
} from "@open-arch/core";
import { CliError, type Io } from "../io.js";
import { displayPath, findWorkspaceFile, readWorkspaceFile } from "../workspace.js";

export interface ShowOptions {
  file?: string;
  json?: boolean;
  id?: string;
}

export function show(io: Io, opts: ShowOptions): number {
  const file = findWorkspaceFile(io.cwd, opts.file);
  const ws = readWorkspaceFile(file);
  const print = (value: unknown, text: string) => io.out(opts.json ? JSON.stringify(value, null, 2) + "\n" : text);

  if (!opts.id) {
    print(overviewJson(ws), overviewText(ws, displayPath(io.cwd, file)));
    return 0;
  }
  const element = ws.elements.get(opts.id);
  if (element) {
    const d = describeElement(ws, opts.id)!;
    const json = {
      ...summary(element),
      description: element.description,
      shape: element.shape === "box" ? undefined : element.shape,
      tags: element.tags,
      notes: element.notes,
      children: d.children.map((c) => c.id),
      uses: d.uses.map(({ rel, target }) => ({ to: rel.to, description: rel.description, technology: rel.technology, tags: rel.tags, notes: rel.notes, known: !!target })),
      usedBy: d.usedBy.map(({ from, rel }) => ({ from: from.id, description: rel.description, technology: rel.technology, tags: rel.tags, notes: rel.notes })),
      contentsUse: d.contentsUse.map(({ from, rel }) => ({ from: from.id, to: rel.to, description: rel.description, technology: rel.technology, notes: rel.notes })),
      contentsUsedBy: d.contentsUsedBy.map(({ from, rel }) => ({ from: from.id, to: rel.to, description: rel.description, technology: rel.technology, notes: rel.notes })),
      views: d.views.map(({ view, as }) => ({ id: view.id, as })),
    };
    const lines = [`${element.id}: ${element.name}`];
    const field = (label: string, value: string | undefined) => value && lines.push(`  ${(label + ":").padEnd(13)}${value}`);
    field("kind", element.external ? `${element.kind} (external)` : element.kind);
    field("parent", d.parent ? `${d.parent.id} (${d.parent.name})` : element.parent);
    field("technology", element.technology);
    field("description", element.description);
    field("shape", element.shape === "box" ? undefined : element.shape);
    const tags = tagEntries(element.tags);
    if (tags.length) lines.push("", "Tags:", ...table(tags.map(([name, value]) => [`  ${name}`, value])));
    if (element.notes) lines.push("", "Notes:", ...indented(element.notes, "  "));
    if (d.children.length) lines.push("", "Contains:", ...table(d.children.map(row)));
    lines.push("", "Uses:");
    if (d.uses.length === 0) lines.push("  (nothing)");
    lines.push(...relTable(d.uses.map(({ rel, target }) => [rel, `  -> ${rel.to}`, relLabel(rel) + (target ? "" : "  (not an element!)")])));
    lines.push("", "Used by:");
    if (d.usedBy.length === 0) lines.push("  (nothing)");
    lines.push(...relTable(d.usedBy.map(({ from, rel }) => [rel, `  <- ${from.id}`, relLabel(rel)])));
    if (d.contentsUse.length) {
      lines.push("", "Its contents use:", ...relTable(d.contentsUse.map(({ from, rel }) => [rel, `  ${from.id} -> ${rel.to}`, relLabel(rel)])));
    }
    if (d.contentsUsedBy.length) {
      lines.push("", "Its contents are used by:", ...relTable(d.contentsUsedBy.map(({ from, rel }) => [rel, `  ${from.id} -> ${rel.to}`, relLabel(rel)])));
    }
    lines.push("", "Shown in views:", d.views.length ? `  ${d.views.map((v) => (v.as === "frame" ? `${v.view.id} (as the frame)` : v.view.id)).join(", ")}` : "  (none)");
    print(json, lines.join("\n") + "\n");
    return 0;
  }

  const view = ws.views.get(opts.id);
  if (view) {
    const problems = scopeProblems(ws, view);
    if (problems.length) throw new CliError(`View "${view.id}" can't be shown: ${problems[0]!.message} Run \`open-arch check\`.`);
    const cv = computeView(ws, view);
    const json = {
      id: view.id,
      title: view.title,
      description: view.description,
      level: view.level,
      scope: view.scope,
      notes: view.notes,
      frame: cv.boundary?.id,
      boxes: cv.nodes.map(summary),
      arrows: cv.edges.map((e) => ({ from: e.from, to: e.to, description: e.description, technology: e.technology, implied: e.implied, sources: e.sources })),
      stickies: view.stickies.map((s) => ({ id: s.id, text: s.text, color: s.color, at: s.at })),
    };
    const scope = cv.boundary ?? (view.scope ? ws.elements.get(view.scope) : undefined);
    const lines = [
      `${view.id}: ${view.title}`,
      `  level:       ${view.level}${scope ? ` view of ${scope.id} (${scope.name})` : ""}`,
      ...(view.description ? [`  description: ${view.description}`] : []),
      ...(view.notes ? ["", "Notes:", ...indented(view.notes, "  ")] : []),
      "",
      "Boxes:",
      ...(cv.nodes.length ? table(cv.nodes.map(row)) : ["  (none)"]),
      "",
      "Arrows:",
      ...(cv.edges.length
        ? table(
            cv.edges.map((e) => [
              `  ${e.from} -> ${e.to}`,
              relLabel(e) + (e.implied ? `  (via ${e.sources.map((s) => `${s.element} -> ${ws.elements.get(s.element)!.uses[s.index]!.to}`).join(", ")})` : ""),
            ]),
          )
        : ["  (none)"]),
      ...(view.stickies.length
        ? ["", "Sticky notes:", ...view.stickies.flatMap((s) => [`  ${s.id} (${s.color}${s.at ? ` at ${s.at.join(", ")}` : ""}):`, ...s.text.split("\n").map((l) => `    ${l}`.trimEnd())])]
        : []),
    ];
    print(json, lines.join("\n") + "\n");
    return 0;
  }

  const near = suggest(opts.id, [...ws.elements.keys(), ...ws.views.keys()]);
  throw new CliError(`No element or view has the ID "${opts.id}".${near ? ` Did you mean "${near}"?` : ""} Run \`open-arch show\` to list them.`);
}

function overviewText(ws: Workspace, workspace: string): string {
  const rows: string[][] = [];
  const walk = (node: TreeNode, depth: number) => {
    const [, kind, name] = row(node.element);
    rows.push([`  ${"  ".repeat(depth)}${node.element.id}`, kind!, name!]);
    node.children.forEach((c) => walk(c, depth + 1));
  };
  modelTree(ws).forEach((n) => walk(n, 0));
  const views = [...ws.views.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return [
    `${ws.doc.name}: ${workspace} (${ws.elements.size} elements, ${ws.views.size} views)`,
    "",
    "Model:",
    ...(rows.length ? table(rows) : ["  (empty)"]),
    "",
    "Views:",
    ...(views.length ? table(views.map((v) => [`  ${v.id}`, v.scope ? `${v.level} view of ${v.scope}` : `${v.level} view`, v.title])) : ["  (none)"]),
    "",
    "Run `open-arch show <id>` for details of one element or view.",
  ].join("\n") + "\n";
}

function overviewJson(ws: Workspace) {
  return {
    elements: [...ws.elements.values()].map((e) => ({ ...summary(e), parent: e.parent })),
    views: [...ws.views.values()].map((v) => ({ id: v.id, title: v.title, level: v.level, scope: v.scope })),
  };
}

function summary(e: ArchElement) {
  return { id: e.id, kind: e.kind, name: e.name, technology: e.technology, external: e.external || undefined };
}

function row(e: ArchElement): string[] {
  return [`  ${e.id}`, e.external ? `${e.kind} (external)` : e.kind, e.technology ? `${e.name} [${e.technology}]` : e.name];
}

function relLabel(r: { description?: string; technology?: string; tags?: Tags }): string {
  const tags = r.tags && tagText(r.tags);
  return [r.description ?? "(no description)", r.technology ? `[${r.technology}]` : "", tags ? `(tags: ${tags})` : ""].filter(Boolean).join(" ");
}

/** Multi-line text, each line indented. */
function indented(text: string, indent: string): string[] {
  return text.split("\n").map((l) => `${indent}${l}`.trimEnd());
}

/** Relationships as left-aligned columns, each followed by its notes, indented under it. */
function relTable(rows: [Relationship, ...string[]][]): string[] {
  const lines = table(rows.map(([, ...cells]) => cells));
  return lines.flatMap((line, i) => {
    const notes = rows[i]![0].notes;
    return [line, ...(notes ? indented(notes, "      ") : [])];
  });
}

/** Left-aligned columns. */
function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]! + 2))).join("").trimEnd());
}
