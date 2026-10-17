/**
 * Edits that touch more than one file: creating elements and views, and
 * renaming IDs. Each returns the file changes to write; nothing here touches
 * a disk.
 */
import { isMap, isScalar, isSeq, type Document } from "yaml";
import { ELEMENT_KEY_ORDER, parseFrontmatter, stringifyDoc, stringifyFields, VIEW_KEY_ORDER } from "./frontmatter.js";
import { formatWorkspace } from "./format.js";
import { layoutBlockLines, parseLayout } from "./layout.js";
import { idFromPath, loadWorkspace, type Workspace } from "./load.js";
import { findBlocks, joinFile } from "./markdown.js";
import { PARENT_KIND } from "./model.js";
import { ELEMENT_KINDS, ID_PATTERN, VIEW_LEVELS, type ElementKind, type FileChange, type InputFile, type ViewLevel } from "./types.js";
import { scopeProblems } from "./views.js";

export class OpError extends Error {}

export interface NewElementOptions {
  id: string;
  kind: string;
  parent?: string;
  name?: string;
  description?: string;
  technology?: string;
  external?: boolean;
  tags?: string[];
  /** Workspace-relative folder for the file. Defaults to one that mirrors the hierarchy. */
  dir?: string;
}

export function newElement(ws: Workspace, opts: NewElementOptions): FileChange[] {
  assertNewId(ws, opts.id);
  if (!(ELEMENT_KINDS as readonly string[]).includes(opts.kind)) {
    throw new OpError(`Unknown kind "${opts.kind}". Use one of: ${ELEMENT_KINDS.join(", ")}.`);
  }
  const kind = opts.kind as ElementKind;
  const wantedParent = PARENT_KIND[kind];
  if (!wantedParent && opts.parent) throw new OpError(`A ${kind} is top-level, so it can't have a parent.`);
  if (wantedParent && !opts.parent) throw new OpError(`A ${kind} needs a parent ${wantedParent}: pass --parent <id>.`);
  const parent = opts.parent ? ws.elements.get(opts.parent) : undefined;
  if (opts.parent && !parent) throw new OpError(`Parent "${opts.parent}" isn't an element.`);
  if (parent && parent.kind !== wantedParent) throw new OpError(`A ${kind}'s parent must be a ${wantedParent}, but "${parent.id}" is a ${parent.kind}.`);
  if (opts.external && wantedParent) throw new OpError("Only people and systems can be external.");

  let dir = opts.dir !== undefined ? normalizeDir(opts.dir) : parent ? parent.path.replace(/\.md$/, "") : ws.config.model;
  if (dir !== ws.config.model && !dir.startsWith(ws.config.model + "/")) {
    throw new OpError(`Element files must be inside the "${ws.config.model}" folder.`);
  }
  const path = `${dir}/${opts.id}.md`;
  assertFree(ws, path);

  const name = opts.name ?? titleFromId(opts.id);
  const frontmatter = stringifyFields(
    {
      kind,
      name,
      parent: opts.parent,
      description: opts.description,
      technology: opts.technology,
      external: opts.external || undefined,
      tags: opts.tags?.length ? opts.tags : undefined,
    },
    ELEMENT_KEY_ORDER,
  );
  const created: FileChange = { path, content: joinFile(frontmatter, `\n# ${name}\n`, "\n") };
  return withRefreshedViews(ws, [created]);
}

export interface NewViewOptions {
  id: string;
  level: string;
  scope?: string;
  title?: string;
  description?: string;
}

export function newView(ws: Workspace, opts: NewViewOptions): FileChange[] {
  assertNewId(ws, opts.id);
  if (!(VIEW_LEVELS as readonly string[]).includes(opts.level)) {
    throw new OpError(`Unknown level "${opts.level}". Use one of: ${VIEW_LEVELS.join(", ")}.`);
  }
  const level = opts.level as ViewLevel;
  const path = `${ws.config.views}/${opts.id}.md`;
  const draft = { id: opts.id, path, title: "", level, scope: opts.scope, include: ["*"], exclude: [], lines: {}, listLines: { include: [], exclude: [] } };
  const problems = scopeProblems(ws, draft);
  if (problems.length) throw new OpError(problems[0]!.message);
  assertFree(ws, path);

  const scope = opts.scope ? ws.elements.get(opts.scope) : undefined;
  const title = opts.title ?? (scope ? `${scope.name} ${level === "context" ? "context" : level === "container" ? "containers" : "components"}` : "System landscape");
  const frontmatter = stringifyFields({ kind: "view", title, description: opts.description, level, scope: opts.scope, include: ["*"] }, VIEW_KEY_ORDER);
  const created: FileChange = { path, content: joinFile(frontmatter, `\n# ${title}\n`, "\n") };
  return withRefreshedViews(ws, [created]);
}

export interface RenameResult {
  changes: FileChange[];
  /** Files whose prose still mentions the old ID; rename doesn't edit prose. */
  mentions: string[];
  /** Files that reference nothing could be updated in, because their frontmatter is broken. */
  skipped: string[];
}

/** Change an element's or view's ID everywhere it's used. */
export function renameId(ws: Workspace, oldId: string, newId: string): RenameResult {
  const file = [...ws.files.values()].find((f) => f.id === oldId);
  if (!file) throw new OpError(`No element or view has the ID "${oldId}".`);
  if (oldId === newId) throw new OpError("The new ID is the same as the old one.");
  assertNewId(ws, newId);

  const texts = new Map(ws.inputs.map((f) => [f.path, f.text]));
  const skipped: string[] = [];

  if (file.role === "element") {
    for (const other of ws.files.values()) {
      const text = texts.get(other.path)!;
      const updated = rewriteReferences(other.split.frontmatter, other.split.frontmatterLine, other.role, other.split.body, oldId, newId);
      if (updated === "broken") {
        if (text.includes(oldId)) skipped.push(other.path);
        continue;
      }
      if (updated) texts.set(other.path, joinFile(updated.frontmatter, updated.body, other.split.eol));
    }
  }

  // Move the file, and the folder of children that mirrors it, if there is one.
  const moves = new Map<string, string>();
  const dir = file.path.slice(0, file.path.lastIndexOf("/"));
  moves.set(file.path, `${dir}/${newId}.md`);
  if (file.role === "element") {
    const oldFolder = file.path.replace(/\.md$/, "/");
    const newFolder = `${dir}/${newId}/`;
    for (const path of texts.keys()) if (path.startsWith(oldFolder)) moves.set(path, newFolder + path.slice(oldFolder.length));
  }
  for (const target of moves.values()) {
    if (texts.has(target) && !moves.has(target)) throw new OpError(`Can't move to ${target}: a file is already there.`);
  }

  const changes: FileChange[] = [];
  const originals = new Map(ws.inputs.map((f) => [f.path, f.text]));
  for (const [path, text] of texts) {
    const target = moves.get(path);
    if (target) changes.push({ path: target, content: text, from: path });
    else if (text !== originals.get(path)) changes.push({ path, content: text });
  }

  const all = withRefreshedViews(ws, changes);
  const pattern = new RegExp(`(?<![a-z0-9-])${oldId.replace(/[-]/g, "\\-")}(?![a-z0-9-])`);
  const after = applyChanges(ws.inputs, all);
  const reloaded = loadWorkspace(after, ws.config);
  const mentions = [...reloaded.files.values()]
    .filter((f) => {
      const lines = f.blocks.lines.filter((_, i) => !inBlock(i, f.blocks.preview) && !inBlock(i, f.blocks.layout));
      return pattern.test(lines.join("\n"));
    })
    .map((f) => f.path);
  return { changes: all, mentions, skipped };
}

function inBlock(i: number, block: { start: number; end: number } | undefined): boolean {
  return !!block && i >= block.start && i <= block.end;
}

/** Rewrites ID references in one file. Returns null when nothing changed and "broken" when it couldn't parse. */
function rewriteReferences(
  yamlText: string,
  firstLine: number,
  role: "element" | "view",
  body: string,
  oldId: string,
  newId: string,
): { frontmatter: string; body: string } | null | "broken" {
  const fm = parseFrontmatter(yamlText, firstLine);
  const doc = fm.doc as Document;
  if (doc.errors.length || !isMap(doc.contents)) return "broken";
  const map = doc.contents;
  let changed = false;
  const swap = (node: unknown) => {
    if (isScalar(node) && node.value === oldId) {
      node.value = newId;
      changed = true;
    }
  };

  if (role === "element") {
    swap(map.get("parent", true));
    const uses = map.get("uses", true);
    if (isSeq(uses)) {
      for (const item of uses.items) {
        if (isMap(item)) swap(item.get("to", true));
        else swap(item);
      }
    }
  } else {
    swap(map.get("scope", true));
    for (const key of ["include", "exclude"]) {
      const list = map.get(key, true);
      if (isSeq(list)) list.items.forEach(swap);
    }
  }

  let newBody = body;
  const layout = role === "view" ? findBlocks(body).layout : undefined;
  if (layout) {
    const parsed = parseLayout(layout.json);
    if (parsed.ok && parsed.layout.nodes[oldId] && !parsed.layout.nodes[newId]) {
      const { [oldId]: moved, ...rest } = parsed.layout.nodes;
      const lines = body.split("\n");
      const replaced = layoutBlockLines({ ...parsed.layout, nodes: { ...rest, [newId]: moved! } });
      newBody = [...lines.slice(0, layout.start), ...replaced, ...lines.slice(layout.end + 1)].join("\n");
      changed = true;
    }
  }
  return changed ? { frontmatter: stringifyDoc(doc), body: newBody } : null;
}

/** The inputs as they'll be after `changes` are written. */
export function applyChanges(inputs: InputFile[], changes: FileChange[]): InputFile[] {
  const files = new Map(inputs.map((f) => [f.path, f.text]));
  for (const change of changes) {
    if (change.from) files.delete(change.from);
    if (change.content === null) files.delete(change.path);
    else files.set(change.path, change.content);
  }
  return [...files].map(([path, text]) => ({ path, text }));
}

/** Add the view-preview updates that `changes` cause, merged into one list. */
export function withRefreshedViews(ws: Workspace, changes: FileChange[]): FileChange[] {
  const next = loadWorkspace(applyChanges(ws.inputs, changes), ws.config);
  const viewPaths = [...next.files.values()].filter((f) => f.role === "view").map((f) => f.path);
  const merged = new Map(changes.map((c) => [c.path, { ...c }]));
  for (const change of formatWorkspace(next, viewPaths).changes) {
    const existing = merged.get(change.path);
    if (existing) existing.content = change.content;
    else merged.set(change.path, change);
  }
  return [...merged.values()];
}

function assertNewId(ws: Workspace, id: string): void {
  if (!ID_PATTERN.test(id)) throw new OpError(`"${id}" isn't a valid ID. IDs are lowercase kebab-case, like "checkout-api".`);
  const taken = [...ws.files.values()].find((f) => f.id === id);
  if (taken) throw new OpError(`The ID "${id}" is already used by ${taken.path}.`);
}

function assertFree(ws: Workspace, path: string): void {
  if (ws.inputs.some((f) => f.path === path)) throw new OpError(`${path} already exists.`);
  if (idFromPath(path) === "readme") throw new OpError(`"readme" can't be used as an ID.`);
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
