import { isInside, PARENT_KIND } from "./model.js";
import type { ArchElement, Diagnostic, ViewDef } from "./types.js";
import { computeView, didYouMean, scopeProblems } from "./views.js";
import type { Workspace } from "./workspace.js";

/** Every problem in the workspace: the file's shape, then the model's meaning. */
export function checkWorkspace(ws: Workspace): Diagnostic[] {
  const out = [...ws.diagnostics];
  for (const id of ws.elements.keys()) {
    if (ws.views.has(id)) {
      out.push({ severity: "error", rule: "id-duplicate", message: `"${id}" is the ID of both an element and a view.`, path: `views.${id}`, fix: "Rename the view." });
    }
  }
  for (const element of ws.elements.values()) checkElement(ws, element, out);
  for (const view of ws.views.values()) checkView(ws, view, out);
  return out;
}

export function errorCount(diagnostics: Diagnostic[]): number {
  return diagnostics.filter((d) => d.severity === "error").length;
}

function checkElement(ws: Workspace, el: ArchElement, out: Diagnostic[]): void {
  const at = (field: string) => `${el.path}.${field}`;
  const wantedParent = PARENT_KIND[el.kind];

  if (!wantedParent && el.parent !== undefined) {
    out.push({ severity: "error", rule: "parent-not-allowed", message: `A ${el.kind} is top-level, so it can't have a parent.`, path: at("parent"), fix: "Remove the parent." });
  } else if (wantedParent && el.parent === undefined) {
    out.push({ severity: "error", rule: "parent-required", message: `A ${el.kind} needs a parent: the ID of the ${wantedParent} it belongs to.`, path: at("parent") });
  } else if (wantedParent && el.parent !== undefined) {
    const parent = ws.elements.get(el.parent);
    if (!parent) {
      out.push({ severity: "error", rule: "parent-unknown", message: `Parent "${el.parent}" isn't an element.`, path: at("parent"), fix: didYouMean(ws, el.parent) });
    } else if (parent.kind !== wantedParent) {
      out.push({ severity: "error", rule: "parent-kind", message: `A ${el.kind}'s parent must be a ${wantedParent}, but "${parent.id}" is a ${parent.kind}.`, path: at("parent") });
    }
  }

  if (el.external && wantedParent) {
    out.push({ severity: "warning", rule: "external-ignored", message: "Only people and systems can be external.", path: at("external"), fix: "Remove external." });
  }
  // The workspace draws people as people and classes as classes, so look at what the file says.
  const data = ws.doc.elements[el.id];
  if ((el.kind === "person" || el.kind === "class") && (data?.shape ?? "box") !== "box") {
    const message = el.kind === "person" ? "People are always drawn as a person." : "Classes are always drawn as a class.";
    out.push({ severity: "warning", rule: "shape-ignored", message, path: at("shape"), fix: "Remove shape." });
  }
  if (el.kind !== "class") {
    if (data?.members?.length) out.push({ severity: "warning", rule: "members-ignored", message: "Only classes have members.", path: at("members"), fix: "Remove members." });
    if (data?.stereotype) out.push({ severity: "warning", rule: "stereotype-ignored", message: "Only classes have a stereotype.", path: at("stereotype"), fix: "Remove stereotype." });
  }

  const seen = new Set<string>();
  el.uses.forEach((rel) => {
    const path = at(`uses[${rel.index}]`);
    const target = ws.elements.get(rel.to);
    if (!target) {
      const isView = ws.views.has(rel.to);
      out.push({
        severity: "error",
        rule: "relationship-unknown-target",
        message: isView ? `"${rel.to}" is a view, not an element.` : `"${rel.to}" isn't an element.`,
        path: `${path}.to`,
        fix: isView ? undefined : didYouMean(ws, rel.to),
      });
      return;
    }
    if (target.id === el.id) {
      out.push({ severity: "error", rule: "relationship-self", message: "An element can't use itself.", path });
      return;
    }
    if (isInside(ws, el.id, target.id) || isInside(ws, target.id, el.id)) {
      out.push({
        severity: "error",
        rule: "relationship-parent-child",
        message: `"${el.id}" and "${target.id}" contain one another, so no view can draw this relationship.`,
        path,
        fix: "Point the relationship at a sibling or at something outside instead.",
      });
      return;
    }
    if (rel.kind !== "association" && (el.kind !== "class" || target.kind !== "class")) {
      out.push({
        severity: "error",
        rule: "relationship-kind-classes",
        message: `Only relationships between classes can be of the kind "${rel.kind}", and "${el.kind === "class" ? target.id : el.id}" is a ${el.kind === "class" ? target.kind : el.kind}.`,
        path: `${path}.kind`,
        fix: "Remove kind, or point the relationship at a class.",
      });
    }
    if (rel.kind !== "association" && rel.bidirectional) {
      out.push({ severity: "error", rule: "relationship-kind-bidirectional", message: `Only associations go both ways, and this relationship is a ${rel.kind}.`, path: `${path}.bidirectional`, fix: "Remove bidirectional, or kind." });
    }
    // Inheritance, say, means one thing: its kind describes it.
    if (!rel.description && rel.kind === "association") {
      out.push({ severity: "warning", rule: "relationship-description", message: `The relationship from "${el.id}" to "${rel.to}" has no description.`, path, fix: 'Add a short verb phrase, e.g. "Reads and writes orders".' });
    }
    const key = `${rel.to}\u0000${rel.kind}\u0000${rel.description ?? ""}`;
    if (seen.has(key)) out.push({ severity: "warning", rule: "relationship-duplicate", message: `The relationship to "${rel.to}" is listed twice.`, path, fix: "Remove one of them." });
    seen.add(key);
  });
}

function checkView(ws: Workspace, view: ViewDef, out: Diagnostic[]): void {
  const problems = scopeProblems(ws, view);
  out.push(...problems);
  if (problems.length) return;
  const cv = computeView(ws, view);
  out.push(...cv.diagnostics);
  const shown = new Set(cv.nodes.map((n) => n.id));
  const stale = Object.keys(view.layout).filter((id) => !shown.has(id));
  if (stale.length) {
    out.push({
      severity: "warning",
      rule: "layout-stale",
      message: `The layout has positions for elements no longer in this view: ${stale.join(", ")}.`,
      path: `${view.path}.layout`,
      fix: "Run `open-arch fmt`.",
    });
  }
}
