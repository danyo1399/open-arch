/** Finding, reading and writing a workspace on disk. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { CONFIG_FILE, loadWorkspace, parseConfig, type FileChange, type InputFile, type Workspace } from "@open-arch/core";
import { CliError } from "./errors.js";

const SEARCH_DEPTH = 3;

/** The workspace folder: `--root`, else the nearest open-arch.yaml above `cwd`, else the only one below it. */
export function findRoot(cwd: string, explicit?: string): string {
  if (explicit) {
    const dir = resolve(cwd, explicit);
    if (!existsSync(join(dir, CONFIG_FILE))) throw new CliError(`There's no ${CONFIG_FILE} in ${dir}.`);
    return dir;
  }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    if (dirname(dir) === dir) break;
  }
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > SEARCH_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === CONFIG_FILE)) found.push(dir);
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") walk(join(dir, e.name), depth + 1);
    }
  };
  walk(resolve(cwd), 1);
  if (found.length === 1) return found[0]!;
  if (found.length > 1) {
    throw new CliError(`Found more than one workspace; pick one with --root:\n${found.map((f) => `  ${relative(cwd, f) || "."}`).join("\n")}`);
  }
  throw new CliError(`No open-arch workspace found (no ${CONFIG_FILE} here, above or below). Run \`open-arch init\` to create one, or pass --root.`);
}

export interface OpenWorkspace {
  root: string;
  ws: Workspace;
}

export function openWorkspace(cwd: string, explicit?: string): OpenWorkspace {
  const root = findRoot(cwd, explicit);
  const { configText, files } = readWorkspace(root);
  const { config, diagnostics } = parseConfig(configText);
  return { root, ws: loadWorkspace(files, config, diagnostics) };
}

/** The config text and every element and view file of the workspace at `root`. */
export function readWorkspace(root: string): { configText: string; files: InputFile[] } {
  const configText = readFileSync(join(root, CONFIG_FILE), "utf8");
  const { config } = parseConfig(configText);
  const files: InputFile[] = [];
  for (const folder of [config.model, config.views]) readTree(root, folder, files);
  return { configText, files };
}

function readTree(root: string, folder: string, out: InputFile[]): void {
  const dir = join(root, ...folder.split("/"));
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) readTree(root, path, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push({ path, text: readFileSync(join(dir, entry.name), "utf8") });
  }
}

/** Write and delete files under `root`. Throws before touching anything if a path would land outside it. */
export function writeChanges(root: string, changes: FileChange[]): void {
  const abs = (p: string) => fileInside(root, p);
  for (const change of changes) {
    abs(change.path);
    if (change.from !== undefined) abs(change.from);
  }
  for (const change of changes) {
    if (change.content === null) continue;
    mkdirSync(dirname(abs(change.path)), { recursive: true });
    writeFileSync(abs(change.path), change.content);
  }
  for (const change of changes) {
    const gone = change.content === null ? change.path : change.from !== change.path ? change.from : undefined;
    if (!gone) continue;
    if (existsSync(abs(gone))) unlinkSync(abs(gone));
    removeEmptyDirs(root, dirname(abs(gone)));
  }
}

/** The file a workspace-relative path names. Changes can come from the desktop renderer, so nothing may escape `root`. */
function fileInside(root: string, p: string): string {
  const bad = (why: string) => new CliError(`Refusing to write ${JSON.stringify(p)}: ${why}.`);
  if (typeof p !== "string" || !p || p.includes("\0")) throw bad("it isn't a file path");
  if (posix.isAbsolute(p) || win32.isAbsolute(p)) throw bad("paths must be relative to the workspace");
  if (p.split(/[\\/]/).includes("..")) throw bad("paths can't contain `..`");
  const file = join(root, ...p.split("/"));
  const rel = relative(resolve(root), resolve(file));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw bad("it's outside the workspace");
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

/** A path the user typed, as a workspace-relative path with `/` separators. */
export function toWorkspacePath(root: string, cwd: string, p: string): string {
  return relative(root, resolve(cwd, p)).split(sep).join("/");
}

/** A workspace-relative path, as the user should see it: relative to where they ran the command. */
export function displayPath(root: string, cwd: string, wsPath: string): string {
  const abs = join(root, ...wsPath.split("/"));
  const rel = relative(cwd, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? abs : rel || ".";
}
