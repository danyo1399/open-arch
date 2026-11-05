import { builtInto, containerOf, isInside, kindList, libraryOf, PARENT_KINDS } from "./model.js";
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
  const parentKinds = PARENT_KINDS[el.kind];
  const wantedParent = kindList(parentKinds);

  if (!parentKinds.length && el.parent !== undefined) {
    const message = el.kind === "library" ? "A library belongs to no one container, so it can't have a parent. Containers list the libraries built into them." : `A ${el.kind} is top-level, so it can't have a parent.`;
    out.push({ severity: "error", rule: "parent-not-allowed", message, path: at("parent"), fix: "Remove the parent." });
  } else if (parentKinds.length && el.parent === undefined) {
    out.push({ severity: "error", rule: "parent-required", message: `A ${el.kind} needs a parent: the ID of the ${wantedParent} it belongs to.`, path: at("parent") });
  } else if (parentKinds.length && el.parent !== undefined) {
    const parent = ws.elements.get(el.parent);
    if (!parent) {
      out.push({ severity: "error", rule: "parent-unknown", message: `Parent "${el.parent}" isn't an element.`, path: at("parent"), fix: didYouMean(ws, el.parent) });
    } else if (!parentKinds.includes(parent.kind)) {
      out.push({ severity: "error", rule: "parent-kind", message: `A ${el.kind}'s parent must be a ${wantedParent}, but "${parent.id}" is a ${parent.kind}.`, path: at("parent") });
    }
  }

  if (el.external && el.kind !== "person" && el.kind !== "system") {
    out.push({ severity: "warning", rule: "external-ignored", message: "Only people and systems can be external.", path: at("external"), fix: "Remove external." });
  }
  // The workspace draws people as people and classes as classes, so look at what the file says.
  const data = ws.doc.elements[el.id];
  if ((el.kind === "person" || el.kind === "class") && (data?.shape ?? "box") !== "box") {
    const message = el.kind === "person" ? "People are always drawn as a person." : "Classes are always drawn as a class.";
    out.push({ severity: "warning", rule: "shape-ignored", message, path: at("shape"), fix: "Remove shape." });
  }
  if (el.kind !== "container" && data?.libraries?.length) {
    out.push({ severity: "warning", rule: "libraries-ignored", message: "Only containers are built with libraries.", path: at("libraries"), fix: "Remove libraries." });
  }
  el.libraries.forEach((id) => {
    const path = at(`libraries[${data!.libraries!.indexOf(id)}]`);
    const library = ws.elements.get(id);
    if (!library) out.push({ severity: "error", rule: "library-unknown", message: `"${id}" in \`libraries\` isn't an element.`, path, fix: didYouMean(ws, id) });
    else if (library.kind !== "library") out.push({ severity: "error", rule: "library-kind", message: `"${id}" in \`libraries\` is a ${library.kind}, not a library.`, path });
  });
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
    // Something uses the copy of a library built into its own container. A library's code uses
    // it from each container built with both libraries.
    const library = libraryOf(ws, target.id);
    const source = libraryOf(ws, el.id);
    if (library && source?.id !== library.id) {
      const container = containerOf(ws, el.id);
      const missing = source ? builtInto(ws, source.id).filter((c) => !c.libraries.includes(library.id)) : container && !container.libraries.includes(library.id) ? [container] : [];
      const build = (c: ArchElement) => `\`open-arch update-element ${c.id}${[...c.libraries, library.id].map((id) => ` --library ${id}`).join("")}\``;
      const names = (cs: ArchElement[]) => cs.map((c) => `"${c.id}"`).join(", ");
      const where = `"${el.id}" uses "${target.id}", in the library "${library.id}", but`;
      const message = source
        ? `${where} ${names(missing)}, built with the library "${source.id}", ${missing.length === 1 ? "isn't" : "aren't"} built with that one, so ${missing.length === 1 ? "its" : "their"} diagrams leave this out.`
        : container
          ? `${where} its container "${container.id}" isn't built with that library, so only class views draw it.`
          : `${where} isn't inside a container, and only containers are built with libraries, so only class views draw it.`;
      if (missing.length || (!source && !container)) {
        out.push({
          severity: "warning",
          rule: "library-not-included",
          message,
          path,
          fix: missing.length ? `Build ${missing.length === 1 ? missing[0]!.id : "each"} with it: ${missing.map(build).join(", ")}.` : "Point the relationship at something inside a container instead.",
        });
      }
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
