/** Finding, reading and writing a .openarch file, and keeping its docs folder in sync. Shared with the desktop app. */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { exportDocs, FILE_EXTENSION, GENERATED_MARKER, loadWorkspace, serializeDocument, type ExportedFile, type OpenArchDocument, type Workspace } from "@open-arch/core";
import { CliError } from "./errors.js";

const SEARCH_DEPTH = 3;

function openarchFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(FILE_EXTENSION))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** The .openarch file to use: `--file`, else the one in the nearest folder at or above `cwd`, else the only one below it. */
export function findWorkspaceFile(cwd: string, explicit?: string): string {
  if (explicit) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new CliError(`${path} doesn't exist.`);
    if (!statSync(path).isDirectory()) return path;
    const inside = openarchFiles(path);
    if (inside.length === 1) return inside[0]!;
    throw new CliError(inside.length ? `More than one ${FILE_EXTENSION} file in ${path}; name one with --file.` : `There's no ${FILE_EXTENSION} file in ${path}.`);
  }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const found = openarchFiles(dir);
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw new CliError(`More than one ${FILE_EXTENSION} file in ${dir}; pick one with --file:\n${found.map((f) => `  ${basename(f)}`).join("\n")}`);
    if (dirname(dir) === dir) break;
  }
  const below: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > SEARCH_DEPTH) return;
    below.push(...openarchFiles(dir));
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") walk(join(dir, e.name), depth + 1);
  };
  walk(resolve(cwd), 1);
  if (below.length === 1) return below[0]!;
  if (below.length > 1) throw new CliError(`Found more than one ${FILE_EXTENSION} file; pick one with --file:\n${below.map((f) => `  ${relative(cwd, f)}`).join("\n")}`);
  throw new CliError(`No ${FILE_EXTENSION} file found here, above or below. Run \`open-arch init\` to create one, or pass --file.`);
}

export function readWorkspaceFile(file: string): Workspace {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new CliError(`Can't read ${file}: ${(error as Error).message}`);
  }
  return loadWorkspace(text);
}

/** Write the canonical text, through a temporary file so a crash never leaves half a file. */
export function writeWorkspaceFile(file: string, doc: OpenArchDocument): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, serializeDocument(doc));
  renameSync(temp, file);
}

/** The docs folder a document asks for, resolved next to its file. */
export function docsFolder(file: string, doc: OpenArchDocument): string | undefined {
  const docs = doc.export?.docs;
  if (!docs) return undefined;
  if (posix.isAbsolute(docs) || win32.isAbsolute(docs)) throw new CliError(`export.docs must be a folder relative to the ${FILE_EXTENSION} file, not ${JSON.stringify(docs)}.`);
  return resolve(dirname(file), ...docs.split("/"));
}

export interface DocsResult {
  dir: string;
  written: string[];
  deleted: string[];
  /** Files in the way that open-arch didn't generate, so it left them alone. */
  skipped: string[];
}

const isGenerated = (path: string) => {
  try {
    return readFileSync(path, "utf8").startsWith(GENERATED_MARKER);
  } catch {
    return false;
  }
};

/**
 * Make `dir` hold exactly these generated pages. Only pages carrying the
 * generated marker are ever overwritten or deleted; anything else is left alone.
 */
export function writeDocs(dir: string, files: ExportedFile[], options: { dryRun?: boolean } = {}): DocsResult {
  const result: DocsResult = { dir, written: [], deleted: [], skipped: [] };
  const targets = new Map(files.map((f) => [fileInside(dir, f.path), f]));
  for (const [abs, f] of targets) {
    if (existsSync(abs)) {
      if (readFileSync(abs, "utf8") === f.content) continue;
      if (!isGenerated(abs)) {
        result.skipped.push(f.path);
        continue;
      }
    }
    result.written.push(f.path);
    if (!options.dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
  }
  const walk = (folder: string) => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(folder, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".md") && !targets.has(abs) && isGenerated(abs)) {
        result.deleted.push(relative(dir, abs).split(sep).join("/"));
        if (!options.dryRun) {
          unlinkSync(abs);
          removeEmptyDirs(dir, folder);
        }
      }
    }
  };
  walk(dir);
  return result;
}

/** Regenerate the document's docs folder, if it names one. */
export function syncDocs(file: string, ws: Workspace, options: { dryRun?: boolean } = {}): DocsResult | undefined {
  const dir = docsFolder(file, ws.doc);
  return dir ? writeDocs(dir, exportDocs(ws, basename(file)), options) : undefined;
}

/** The file a relative path names inside `root`. Nothing may escape `root`. */
function fileInside(root: string, p: string): string {
  const bad = (why: string) => new CliError(`Refusing to write ${JSON.stringify(p)}: ${why}.`);
  if (typeof p !== "string" || !p || p.includes("\0")) throw bad("it isn't a file path");
  if (posix.isAbsolute(p) || win32.isAbsolute(p)) throw bad("paths must be relative");
  if (p.split(/[\\/]/).includes("..")) throw bad("paths can't contain `..`");
  const file = join(root, ...p.split("/"));
  const rel = relative(resolve(root), resolve(file));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw bad("it's outside the folder");
  return file;
}

function removeEmptyDirs(root: string, dir: string): void {
  for (let d = dir; d.startsWith(root + sep) && d !== root; d = dirname(d)) {
    try {
      if (readdirSync(d).length > 0) return;
      rmdirSync(d);
    } catch {
      return;
    }
  }
}

/** A path as the user should see it: relative to where they ran the command when it's below there. */
export function displayPath(cwd: string, abs: string): string {
  const rel = relative(cwd, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? abs : rel || ".";
}
