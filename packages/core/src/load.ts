import { isMap, isScalar, isSeq, type YAMLMap } from "yaml";
import { FieldReader, nodeLine, parseFrontmatter, type ParsedFrontmatter } from "./frontmatter.js";
import { findBlocks, splitFile, type BodyBlocks, type SplitFile } from "./markdown.js";
import {
  DEFAULT_CONFIG,
  ELEMENT_KINDS,
  ID_PATTERN,
  VIEW_LEVELS,
  type ArchElement,
  type Diagnostic,
  type ElementKind,
  type InputFile,
  type Relationship,
  type ViewDef,
  type ViewLevel,
  type WorkspaceConfig,
} from "./types.js";

export interface ParsedFile {
  path: string;
  id: string;
  role: "element" | "view";
  split: SplitFile;
  /** Present when the frontmatter parsed into a YAML map without errors. */
  fm?: ParsedFrontmatter & { map: YAMLMap };
  blocks: BodyBlocks;
}

export interface Workspace {
  config: WorkspaceConfig;
  inputs: InputFile[];
  files: Map<string, ParsedFile>;
  elements: Map<string, ArchElement>;
  views: Map<string, ViewDef>;
  /** IDs of files that exist but couldn't be read; references to them aren't reported again. */
  brokenIds: Set<string>;
  /** Element ID → IDs of its direct children. */
  children: Map<string, string[]>;
  /** Problems found while reading files. `checkWorkspace` adds the rest. */
  diagnostics: Diagnostic[];
}

/** Whether a workspace-relative path is an element file, a view file, or neither. */
export function roleOf(path: string, config: WorkspaceConfig): "element" | "view" | undefined {
  if (!path.endsWith(".md")) return undefined;
  const segments = path.split("/");
  const name = segments[segments.length - 1]!;
  if (name.toLowerCase() === "readme.md") return undefined;
  if (segments.some((s) => s.startsWith(".") || s.startsWith("_"))) return undefined;
  if (path.startsWith(config.model + "/")) return "element";
  if (path.startsWith(config.views + "/")) return "view";
  return undefined;
}

export function idFromPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/, "");
}

export function loadWorkspace(inputs: InputFile[], config: WorkspaceConfig = DEFAULT_CONFIG, configDiagnostics: Diagnostic[] = []): Workspace {
  const ws: Workspace = {
    config,
    inputs,
    files: new Map(),
    elements: new Map(),
    views: new Map(),
    brokenIds: new Set(),
    children: new Map(),
    diagnostics: [...configDiagnostics],
  };
  const seen = new Map<string, string>();
  const sorted = [...inputs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const input of sorted) {
    const role = roleOf(input.path, config);
    if (!role) continue;
    const id = idFromPath(input.path);
    const split = splitFile(input.text);
    const blocks = findBlocks(split.body);
    const file: ParsedFile = { path: input.path, id, role, split, blocks };
    ws.files.set(input.path, file);
    const diag = (d: Omit<Diagnostic, "path">) => ws.diagnostics.push({ ...d, path: input.path });

    for (const p of blocks.problems) diag({ severity: "error", rule: p.rule, message: p.message, line: split.bodyLine + p.index });

    if (!ID_PATTERN.test(id)) {
      diag({
        severity: "error",
        rule: "id-format",
        message: `File name "${id}.md" isn't a valid ID. IDs are lowercase kebab-case, like "checkout-api".`,
        line: 1,
        fix: `Rename the file to ${suggestId(id)}.md.`,
      });
    }
    const other = seen.get(id);
    if (other) {
      diag({
        severity: "error",
        rule: "id-duplicate",
        message: `ID "${id}" is already used by ${other}. Every element and view needs its own file name.`,
        line: 1,
        fix: "Rename one of the files.",
      });
      continue;
    }
    seen.set(id, input.path);

    const fm = readFrontmatter(file, diag);
    if (!fm) {
      ws.brokenIds.add(id);
      continue;
    }
    file.fm = fm;
    if (role === "element") {
      const element = readElement(file, fm, diag);
      if (element) ws.elements.set(id, element);
      else ws.brokenIds.add(id);
    } else {
      const view = readView(file, fm, diag);
      if (view) ws.views.set(id, view);
      else ws.brokenIds.add(id);
    }
  }

  for (const element of ws.elements.values()) {
    if (!element.parent) continue;
    const list = ws.children.get(element.parent) ?? [];
    list.push(element.id);
    ws.children.set(element.parent, list);
  }
  return ws;
}

type Diag = (d: Omit<Diagnostic, "path">) => void;

function readFrontmatter(file: ParsedFile, diag: Diag): (ParsedFrontmatter & { map: YAMLMap }) | undefined {
  const { split } = file;
  if (!split.hasFrontmatter) {
    diag({
      severity: "error",
      rule: "frontmatter-missing",
      message: "The file must start with YAML frontmatter between `---` lines.",
      line: 1,
      fix: file.role === "element" ? "Add frontmatter with at least `kind` and `name`." : "Add frontmatter with `kind: view`, `title` and `level`.",
    });
    return undefined;
  }
  if (split.unclosed) {
    diag({ severity: "error", rule: "frontmatter-invalid", message: "The frontmatter is never closed with a `---` line.", line: 1 });
    return undefined;
  }
  const fm = parseFrontmatter(split.frontmatter, split.frontmatterLine);
  if (fm.doc.errors.length) {
    for (const error of fm.doc.errors) {
      diag({ severity: "error", rule: "frontmatter-invalid", message: `YAML error: ${error.message.split("\n")[0]}`, line: fm.lineAt(error.pos[0]) });
    }
    return undefined;
  }
  if (!isMap(fm.doc.contents)) {
    diag({ severity: "error", rule: "frontmatter-invalid", message: "The frontmatter must be a YAML map of fields.", line: split.frontmatterLine });
    return undefined;
  }
  return Object.assign(fm, { map: fm.doc.contents });
}

function readElement(file: ParsedFile, fm: ParsedFrontmatter & { map: YAMLMap }, diag: Diag): ArchElement | undefined {
  const diagnostics: Diagnostic[] = [];
  const read = new FieldReader(fm, fm.map, file.path, diagnostics);
  const flush = () => diagnostics.splice(0).forEach((d) => diag(d));

  const kind = read.string("kind");
  if (kind === undefined) {
    diag({
      severity: "error",
      rule: "field-required",
      message: "`kind` is required: person, system, container or component.",
      line: read.line("kind") ?? file.split.frontmatterLine,
    });
    flush();
    return undefined;
  }
  if (kind === "view") {
    diag({ severity: "error", rule: "wrong-folder", message: "This is a view file, but it's in the model folder.", line: read.line("kind"), fix: "Move it to the views folder." });
    return undefined;
  }
  if (!(ELEMENT_KINDS as readonly string[]).includes(kind)) {
    diag({ severity: "error", rule: "kind-invalid", message: `Unknown kind "${kind}". Use person, system, container or component.`, line: read.line("kind") });
    return undefined;
  }

  let name = read.string("name");
  if (name === undefined || name.trim() === "") {
    diag({ severity: "error", rule: "field-required", message: "`name` is required: the display name shown in diagrams.", line: read.line("name") ?? read.line("kind") });
    name = file.id;
  }

  const element: ArchElement = {
    id: file.id,
    path: file.path,
    kind: kind as ElementKind,
    name,
    parent: read.string("parent"),
    description: read.string("description"),
    technology: read.string("technology"),
    external: read.boolean("external") ?? false,
    tags: read.stringList("tags")?.values ?? [],
    uses: [],
    lines: {},
  };
  for (const key of ["kind", "name", "parent", "description", "technology", "external", "tags", "uses"]) {
    element.lines[key] = read.has(key) ? read.line(key) : undefined;
  }

  const usesPair = fm.map.items.find((p) => isScalar(p.key) && p.key.value === "uses");
  const uses = usesPair?.value;
  if (uses && !(isScalar(uses) && uses.value === null)) {
    if (!isSeq(uses)) {
      diag({ severity: "error", rule: "field-type", message: "`uses` must be a list of relationships.", line: element.lines.uses });
    } else {
      uses.items.forEach((item, index) => {
        const where = `uses[${index}].`;
        if (isScalar(item) && typeof item.value === "string") {
          element.uses.push({ to: item.value, tags: [], index, line: nodeLine(fm, item) });
          return;
        }
        if (!isMap(item)) {
          diag({ severity: "error", rule: "field-type", message: `\`uses[${index}]\` must be a map with at least \`to\`.`, line: nodeLine(fm, item) ?? element.lines.uses });
          return;
        }
        const relRead = new FieldReader(fm, item, file.path, diagnostics, where);
        const to = relRead.string("to");
        if (!to) {
          diag({ severity: "error", rule: "field-required", message: `\`${where}to\` is required: the ID of the element this one uses.`, line: nodeLine(fm, item) });
          return;
        }
        const rel: Relationship = {
          to,
          description: relRead.string("description"),
          technology: relRead.string("technology"),
          tags: relRead.stringList("tags")?.values ?? [],
          index,
          line: relRead.line("to"),
        };
        element.uses.push(rel);
      });
    }
  }
  flush();
  return element;
}

function readView(file: ParsedFile, fm: ParsedFrontmatter & { map: YAMLMap }, diag: Diag): ViewDef | undefined {
  const diagnostics: Diagnostic[] = [];
  const read = new FieldReader(fm, fm.map, file.path, diagnostics);
  const flush = () => diagnostics.splice(0).forEach((d) => diag(d));

  const kind = read.string("kind");
  if (kind === undefined) {
    diag({ severity: "error", rule: "field-required", message: "View files need `kind: view`.", line: file.split.frontmatterLine, fix: "Add `kind: view` to the frontmatter." });
    flush();
    return undefined;
  }
  if (kind !== "view") {
    const isElement = (ELEMENT_KINDS as readonly string[]).includes(kind);
    diag({
      severity: "error",
      rule: isElement ? "wrong-folder" : "kind-invalid",
      message: isElement ? `This is a ${kind} element, but it's in the views folder.` : `View files need \`kind: view\`, not "${kind}".`,
      line: read.line("kind"),
      fix: isElement ? "Move it to the model folder." : undefined,
    });
    flush();
    return undefined;
  }

  let title = read.string("title");
  if (!title) {
    diag({ severity: "error", rule: "field-required", message: "`title` is required.", line: read.line("kind") });
    title = file.id;
  }
  const level = read.string("level");
  if (level === undefined || !(VIEW_LEVELS as readonly string[]).includes(level)) {
    diag({
      severity: "error",
      rule: level === undefined ? "field-required" : "level-invalid",
      message: `\`level\` must be one of: ${VIEW_LEVELS.join(", ")}.`,
      line: read.line("level") ?? read.line("kind"),
    });
    flush();
    return undefined;
  }

  const include = read.stringList("include");
  const exclude = read.stringList("exclude");
  const view: ViewDef = {
    id: file.id,
    path: file.path,
    title,
    description: read.string("description"),
    level: level as ViewLevel,
    scope: read.string("scope"),
    include: include?.values ?? ["*"],
    exclude: exclude?.values ?? [],
    lines: {},
    listLines: { include: include?.lines ?? [], exclude: exclude?.lines ?? [] },
  };
  for (const key of ["kind", "title", "description", "level", "scope", "include", "exclude"]) {
    view.lines[key] = read.has(key) ? read.line(key) : undefined;
  }
  flush();
  return view;
}

/** Best-effort kebab-case version of a name, for fix hints and defaults. */
export function suggestId(name: string): string {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "element"
  );
}
