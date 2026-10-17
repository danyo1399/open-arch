/**
 * `fmt`: rewrite files in the one form open-arch saves them. Running it twice
 * changes nothing, and the designer saves the same way, so files edited by
 * hand, by agents and by the designer all diff cleanly.
 */
import { isMap, isSeq, type Document } from "yaml";
import { ELEMENT_KEY_ORDER, orderKeys, parseFrontmatter, RELATIONSHIP_KEY_ORDER, stringifyDoc, VIEW_KEY_ORDER } from "./frontmatter.js";
import { layoutBlockLines, parseLayout } from "./layout.js";
import type { ParsedFile, Workspace } from "./load.js";
import { joinFile } from "./markdown.js";
import { previewBlockLines, renderMermaid } from "./mermaid.js";
import type { FileChange } from "./types.js";
import { computeView, scopeProblems } from "./views.js";

export interface FormatResult {
  changes: FileChange[];
  /** Files left untouched, or only partly formatted, and why. */
  skipped: { path: string; reason: string }[];
}

/** Format every workspace file, or only the given workspace-relative paths. */
export function formatWorkspace(ws: Workspace, only?: Iterable<string>): FormatResult {
  const filter = only ? new Set(only) : undefined;
  const result: FormatResult = { changes: [], skipped: [] };
  const originals = new Map(ws.inputs.map((f) => [f.path, f.text]));
  for (const file of ws.files.values()) {
    if (filter && !filter.has(file.path)) continue;
    const formatted = formatFile(ws, file);
    if (formatted.reason) result.skipped.push({ path: file.path, reason: formatted.reason });
    if (formatted.text !== undefined && formatted.text !== originals.get(file.path)) {
      result.changes.push({ path: file.path, content: formatted.text });
    }
  }
  return result;
}

export function formatFile(ws: Workspace, file: ParsedFile): { text?: string; reason?: string } {
  if (!file.fm) return { reason: "its frontmatter has errors; fix them first" };
  const fm = parseFrontmatter(file.split.frontmatter, file.split.frontmatterLine);
  const doc = fm.doc as Document;
  if (!isMap(doc.contents)) return { reason: "its frontmatter isn't a map" };

  if (file.role === "element") {
    orderKeys(doc.contents, ELEMENT_KEY_ORDER);
    const uses = doc.contents.get("uses", true);
    if (isSeq(uses)) for (const item of uses.items) if (isMap(item)) orderKeys(item, RELATIONSHIP_KEY_ORDER);
    return { text: joinFile(stringifyDoc(doc), file.split.body, file.split.eol) };
  }

  orderKeys(doc.contents, VIEW_KEY_ORDER);
  const frontmatter = stringifyDoc(doc);
  const view = ws.views.get(file.id);
  const unchangedBody = { text: joinFile(frontmatter, file.split.body, file.split.eol) };
  if (!view) return { ...unchangedBody, reason: "the view has errors, so its preview wasn't regenerated" };
  if (scopeProblems(ws, view).length) return { ...unchangedBody, reason: "the view's scope has errors, so its preview wasn't regenerated" };

  const cv = computeView(ws, view);
  const { blocks } = file;
  let lines = [...blocks.lines];
  const edits: { start: number; end: number; lines: string[] }[] = [];

  let layoutNote: string | undefined;
  if (blocks.layout) {
    const parsed = parseLayout(blocks.layout.json);
    if (parsed.ok) {
      const ids = new Set(cv.nodes.map((n) => n.id));
      const nodes = Object.fromEntries(Object.entries(parsed.layout.nodes).filter(([id]) => ids.has(id)));
      edits.push({ start: blocks.layout.start, end: blocks.layout.end, lines: layoutBlockLines({ ...parsed.layout, nodes }) });
    } else {
      layoutNote = "its layout comment isn't valid JSON, so it was left as is";
    }
  }

  if (ws.config.preview === "mermaid") {
    const preview = previewBlockLines(renderMermaid(cv));
    if (blocks.preview) {
      edits.push({ start: blocks.preview.start, end: blocks.preview.end, lines: preview });
    } else if (blocks.layout) {
      const before = blocks.layout.start;
      const needsGap = before > 0 && lines[before - 1]!.trim() !== "";
      edits.push({ start: before, end: before - 1, lines: [...(needsGap ? [""] : []), ...preview, ""] });
    } else {
      while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
      edits.push({ start: lines.length, end: lines.length - 1, lines: ["", ...preview] });
    }
  } else if (blocks.preview) {
    edits.push({ start: blocks.preview.start, end: blocks.preview.end, lines: [] });
  }

  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) lines = [...lines.slice(0, edit.start), ...edit.lines, ...lines.slice(edit.end + 1)];
  return { text: joinFile(frontmatter, lines.join("\n"), file.split.eol), reason: layoutNote };
}
