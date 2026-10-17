import { parseLayout } from "./layout.js";
import type { ParsedFile, Workspace } from "./load.js";
import { hashText, renderMermaid } from "./mermaid.js";
import { isInside, PARENT_KIND } from "./model.js";
import type { ArchElement, Diagnostic, ViewDef } from "./types.js";
import { computeView, didYouMean, scopeProblems } from "./views.js";

const FMT_FIX = "Run `open-arch fmt`.";

/** Every problem in the workspace, sorted by file and line. */
export function checkWorkspace(ws: Workspace): Diagnostic[] {
  const out = [...ws.diagnostics];
  for (const element of ws.elements.values()) checkElement(ws, element, out);
  for (const view of ws.views.values()) checkView(ws, view, out);
  for (const file of ws.files.values()) {
    if (file.role !== "element") continue;
    const block = file.blocks.preview ?? file.blocks.layout;
    if (block) {
      out.push({
        severity: "warning",
        rule: "block-in-element",
        message: "Preview and layout blocks belong in view files; this one in an element file is ignored.",
        path: file.path,
        line: file.split.bodyLine + block.start,
        fix: "Delete the block.",
      });
    }
  }
  return sortDiagnostics(out);
}

export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0)));
}

function checkElement(ws: Workspace, el: ArchElement, out: Diagnostic[]): void {
  const at = (line: number | undefined) => ({ path: el.path, line: line ?? el.lines.kind });
  const wantedParent = PARENT_KIND[el.kind];

  if (!wantedParent && el.parent !== undefined) {
    out.push({ ...at(el.lines.parent), severity: "error", rule: "parent-not-allowed", message: `A ${el.kind} is top-level, so it can't have a \`parent\`.`, fix: "Remove `parent`." });
  } else if (wantedParent && el.parent === undefined) {
    out.push({ ...at(el.lines.kind), severity: "error", rule: "parent-required", message: `A ${el.kind} needs \`parent\`: the ID of the ${wantedParent} it belongs to.` });
  } else if (wantedParent && el.parent !== undefined && !ws.brokenIds.has(el.parent)) {
    const parent = ws.elements.get(el.parent);
    if (!parent) {
      out.push({ ...at(el.lines.parent), severity: "error", rule: "parent-unknown", message: `Parent "${el.parent}" isn't an element.`, fix: didYouMean(ws, el.parent) });
    } else if (parent.kind !== wantedParent) {
      out.push({ ...at(el.lines.parent), severity: "error", rule: "parent-kind", message: `A ${el.kind}'s parent must be a ${wantedParent}, but "${parent.id}" is a ${parent.kind}.` });
    }
  }

  if (el.external && wantedParent) {
    out.push({ ...at(el.lines.external), severity: "warning", rule: "external-ignored", message: "Only people and systems can be external; it's ignored here.", fix: "Remove `external`." });
  }

  const seen = new Set<string>();
  el.uses.forEach((rel) => {
    const line = rel.line ?? el.lines.uses;
    if (ws.brokenIds.has(rel.to)) return;
    const target = ws.elements.get(rel.to);
    if (!target) {
      const isView = ws.views.has(rel.to);
      out.push({
        ...at(line),
        severity: "error",
        rule: "relationship-unknown-target",
        message: isView ? `"${rel.to}" is a view, not an element.` : `"${rel.to}" isn't an element.`,
        fix: isView ? undefined : didYouMean(ws, rel.to),
      });
      return;
    }
    if (target.id === el.id) {
      out.push({ ...at(line), severity: "error", rule: "relationship-self", message: "An element can't use itself." });
      return;
    }
    if (isInside(ws, el.id, target.id) || isInside(ws, target.id, el.id)) {
      out.push({
        ...at(line),
        severity: "error",
        rule: "relationship-parent-child",
        message: `"${el.id}" and "${target.id}" contain one another, so no view can draw this relationship.`,
        fix: "Point the relationship at a sibling or at something outside instead.",
      });
      return;
    }
    if (!rel.description) {
      out.push({ ...at(line), severity: "warning", rule: "relationship-description", message: `The relationship to "${rel.to}" has no \`description\`.`, fix: 'Add a short verb phrase, e.g. "Reads and writes orders".' });
    }
    const key = `${rel.to}\u0000${rel.description ?? ""}`;
    if (seen.has(key)) {
      out.push({ ...at(line), severity: "warning", rule: "relationship-duplicate", message: `This relationship to "${rel.to}" is listed twice.`, fix: "Remove one of them." });
    }
    seen.add(key);
  });
}

function checkView(ws: Workspace, view: ViewDef, out: Diagnostic[]): void {
  const file = ws.files.get(view.path)!;
  const problems = scopeProblems(ws, view);
  out.push(...problems);
  const layout = checkLayoutSyntax(file, out);
  if (problems.length) return;

  const cv = computeView(ws, view);
  out.push(...cv.diagnostics);
  checkPreview(ws, file, renderMermaid(cv), out);

  if (layout) {
    const ids = new Set(cv.nodes.map((n) => n.id));
    const stale = Object.keys(layout.nodes).filter((id) => !ids.has(id));
    if (stale.length) {
      out.push({
        severity: "warning",
        rule: "layout-stale",
        message: `The layout comment has positions for elements no longer in this view: ${stale.join(", ")}.`,
        path: file.path,
        line: file.split.bodyLine + file.blocks.layout!.start,
        fix: FMT_FIX,
      });
    }
  }
}

function checkLayoutSyntax(file: ParsedFile, out: Diagnostic[]) {
  const block = file.blocks.layout;
  if (!block) return undefined;
  const parsed = parseLayout(block.json);
  if (!parsed.ok) {
    out.push({
      severity: "error",
      rule: "layout-invalid",
      message: parsed.message,
      path: file.path,
      line: file.split.bodyLine + block.start,
      fix: "Restore the comment from version control, or delete it to let the designer lay the view out again.",
    });
    return undefined;
  }
  return parsed.layout;
}

function checkPreview(ws: Workspace, file: ParsedFile, expected: string, out: Diagnostic[]): void {
  const block = file.blocks.preview;
  const line = block ? file.split.bodyLine + block.start : file.split.bodyLine;
  const push = (rule: string, message: string, fix = FMT_FIX): void => {
    out.push({ severity: "error", rule, message, path: file.path, line, fix });
  };

  if (ws.config.preview === "none") {
    if (block) out.push({ severity: "warning", rule: "preview-disabled", message: "Previews are turned off in open-arch.yaml, but this view has one.", path: file.path, line, fix: FMT_FIX });
    return;
  }
  if (!block) return push("preview-missing", "The view has no generated Mermaid preview.");
  if (block.malformed) return push("preview-malformed", block.malformed);
  if (block.hash !== hashText(block.content!)) {
    return push(
      "preview-edited",
      "The generated preview was edited by hand. It's rebuilt from the model, so the edit would be lost.",
      "Make the change in the element files (or this view's frontmatter), then run `open-arch fmt`.",
    );
  }
  if (block.content !== expected) push("preview-stale", "The generated preview is out of date with the model.");
}
