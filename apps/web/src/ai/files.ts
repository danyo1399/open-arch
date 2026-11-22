/**
 * What Ask AI's model can do with the files of a folder opened from the start page (folders.ts):
 * find them by name, read one, and search their text. It only reads. Hidden files and folders,
 * such as .env and .git, node_modules, and files named as keys and secrets usually are, are left
 * out of all three, so a secret kept in one isn't sent to the model's provider.
 */
import type { FileHandle, FolderHandle } from "../folders.js";
import { segments } from "../paths.js";
import { isNamed } from "../problems.js";

/** The most files a search or a listing looks at, so one in a huge folder ends. */
export const FILES_LIMIT = 5000;
/** The most paths a listing answers with, and the most lines a search does. */
export const FOUND_LIMIT = 200;
/** A file bigger than this isn't read or searched: it's unlikely to be source, and would take the model's whole attention. */
export const FILE_BYTES_LIMIT = 1024 * 1024;
/** The most lines of a file read at once. */
export const LINES_LIMIT = 500;
/** The most of a line shown in a search's answer. */
const LINE_SHOWN = 240;

/**
 * Names that keys and secrets usually go by: SSH keys, certificates' private keys and key
 * stores, files of credentials or secrets, another environment's .env, and Terraform's state
 * and variables.
 */
const SECRET = /^(id_(rsa|dsa|ecdsa|ed25519)|credentials\.json|secrets?\.(ya?ml|json|toml|txt|properties)|.*\.(pem|key|p12|pfx|jks|keystore|kdbx|env|tfvars|tfstate|tfstate\.backup))$/;

/** A file or folder the model isn't shown: a hidden one, node_modules, or one named as a key or a secret usually is. Capitals don't matter. */
const skipped = (name: string) => name.startsWith(".") || name.toLowerCase() === "node_modules" || SECRET.test(name.toLowerCase());

/** A problem with what the model asked for, said so it can ask again. */
export class FileProblem extends Error {}

/** A path the model gave, as its parts. Refuses one outside the folder, or into something it isn't shown. */
function parts(path: string, what = "path"): string[] {
  const out = segments(path.trim());
  if (out === null) throw new FileProblem(`The ${what} ${JSON.stringify(path)} is outside the folder. Give one inside it, like src/main.ts.`);
  const hidden = out.find(skipped);
  if (hidden) throw new FileProblem(`${JSON.stringify(path)} isn't read, because of ${hidden}: hidden files and folders, node_modules, and files named as keys and secrets usually are, are left out.`);
  return out;
}

const missing = (error: unknown) => isNamed(error, "NotFoundError") || isNamed(error, "TypeMismatchError");

async function folderAt(root: FolderHandle, path: string[]): Promise<FolderHandle> {
  let dir = root;
  try {
    for (const part of path) dir = await dir.getDirectoryHandle(part);
  } catch (error) {
    if (missing(error)) throw new FileProblem(`There's no folder ${path.join("/")}. Use find_files to see what's there.`);
    throw error;
  }
  return dir;
}

type Token = { kind: "char"; char: string } | { kind: "one" | "star" | "deep" | "folders" };

/**
 * A pattern for file paths as a test: `*` is any run of characters in one name, `**` any run of
 * folders, and `?` one character. Without any of those it's text the path has to contain. Capitals
 * don't matter. It's matched a character at a time, never going back over the path, so no pattern
 * takes long, however many `*` it has.
 */
export function pathTest(pattern: string): (path: string) => boolean {
  const text = pattern.trim().toLowerCase();
  if (!text) return () => true;
  if (!/[*?]/.test(text)) return (path) => path.toLowerCase().includes(text);
  const tokens: Token[] = text
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .flatMap((piece): Token[] =>
      piece === "**/" ? [{ kind: "folders" }] : piece === "**" ? [{ kind: "deep" }] : piece === "*" ? [{ kind: "star" }] : piece === "?" ? [{ kind: "one" }] : [...piece].map((char) => ({ kind: "char", char })),
    );
  // A pattern with no folder in it is for a file's name, wherever it is.
  if (!text.includes("/")) tokens.unshift({ kind: "folders" });
  /** Adds the places reached without reading a character: past anything that can match nothing. */
  const settle = (places: Set<number>) => {
    for (const at of places) if (tokens[at] && tokens[at].kind !== "char" && tokens[at].kind !== "one") places.add(at + 1);
    return places;
  };
  return (path) => {
    // Where in the pattern the path so far can have got to, and the runs of folders it's partway
    // through a folder's name in: those go on only at that name's `/`, so a run of folders is
    // whole folders, never the start of a name.
    let places = settle(new Set([0]));
    let within = new Set<number>();
    for (const char of path.toLowerCase()) {
      const next = new Set<number>();
      const nextWithin = new Set<number>();
      for (const at of places) {
        const token = tokens[at];
        if (!token) continue;
        if (token.kind === "char" ? token.char === char : token.kind === "one" && char !== "/") next.add(at + 1);
        else if (token.kind === "deep" || (token.kind === "star" && char !== "/")) next.add(at);
        // A run of folders starts a folder's name here.
        else if (token.kind === "folders" && char !== "/") nextWithin.add(at);
      }
      // A folder's name ends at its `/`: then the run can end, or take another folder.
      for (const at of within) (char === "/" ? next : nextWithin).add(at);
      if (next.size === 0 && nextWithin.size === 0) return false;
      places = settle(next);
      within = nextWithin;
    }
    return places.has(tokens.length);
  };
}

interface Walk {
  /** How many files were looked at. */
  seen: number;
  /** Whether it stopped early: at the limit, or because `each` said to. */
  stopped: boolean;
}

/**
 * Calls `each` with every file under a folder, with its path from the folder opened, folder by
 * folder and in name order. Stops at the limit, when `each` answers false, or when the request is
 * stopped. A folder it can't list is passed over.
 */
async function walk(root: FolderHandle, from: string[], signal: AbortSignal | undefined, each: (path: string, file: FileHandle) => Promise<boolean | void> | boolean | void): Promise<Walk> {
  const state: Walk = { seen: 0, stopped: false };
  const visit = async (dir: FolderHandle, prefix: string): Promise<void> => {
    const entries: (FileHandle | FolderHandle)[] = [];
    try {
      for await (const entry of dir.values()) if (!skipped(entry.name)) entries.push(entry);
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (state.stopped) return;
      signal?.throwIfAborted();
      if (entry.kind === "directory") await visit(entry, `${prefix}${entry.name}/`);
      else if (state.seen >= FILES_LIMIT) state.stopped = true;
      else {
        state.seen++;
        if ((await each(prefix + entry.name, entry)) === false) state.stopped = true;
      }
    }
  };
  await visit(await folderAt(root, from), from.map((part) => `${part}/`).join(""));
  return state;
}

/** A file's text, or null when it's too big or isn't text (UTF-8). */
async function textOf(file: FileHandle): Promise<string | null> {
  const blob = await file.getFile();
  if (blob.size > FILE_BYTES_LIMIT) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** Why a listing or a search may have missed something, or nothing when it looked at everything. */
const cutShort = (found: Walk, more: boolean, what: string) =>
  more ? `\n(There are more: these are the first ${FOUND_LIMIT}. Narrow the ${what}, or give a folder.)` : found.stopped ? `\n(Stopped after ${FILES_LIMIT} files. Give a folder to look in the rest.)` : "";

/** The files under the folder opened, or one inside it, whose path matches the pattern: every one, without a pattern. */
export async function findFiles(root: FolderHandle, options: { pattern?: string; folder?: string }, signal?: AbortSignal): Promise<string> {
  const matches = pathTest(options.pattern ?? "");
  const paths: string[] = [];
  let more = false;
  const found = await walk(root, parts(options.folder ?? "", "folder"), signal, (path) => {
    if (!matches(path)) return;
    if (paths.length === FOUND_LIMIT) {
      more = true;
      return false;
    }
    paths.push(path);
  });
  if (paths.length === 0) return `No file${options.pattern?.trim() ? ` matches ${JSON.stringify(options.pattern)}` : "s"} in ${options.folder?.trim() || "the folder"}.${cutShort(found, false, "pattern")}`;
  return paths.join("\n") + cutShort(found, more, "pattern");
}

/** A file's text, with its lines numbered: all of it, or the lines asked for, up to the most read at once. */
export async function readFile(root: FolderHandle, options: { path: string; from?: number; lines?: number }): Promise<string> {
  const path = parts(options.path);
  if (path.length === 0) throw new FileProblem("Give the file's path, like src/main.ts.");
  let file: FileHandle;
  try {
    file = await (await folderAt(root, path.slice(0, -1))).getFileHandle(path[path.length - 1]!);
  } catch (error) {
    if (missing(error)) throw new FileProblem(`There's no file ${path.join("/")}. Use find_files to see what's there.`);
    throw error;
  }
  const text = await textOf(file);
  if (text === null) throw new FileProblem(`${path.join("/")} can't be read: it's bigger than ${FILE_BYTES_LIMIT / 1024 / 1024} MB, or it isn't text.`);
  const all = text.split(/\r?\n/);
  // A file's last line break ends its last line; it doesn't start another.
  if (all.length > 1 && all[all.length - 1] === "") all.pop();
  const whole = (value: number | undefined, otherwise: number) => (Number.isInteger(value) && value! >= 1 ? value! : otherwise);
  const first = whole(options.from, 1);
  const count = Math.min(whole(options.lines, LINES_LIMIT), LINES_LIMIT);
  const shown = all.slice(first - 1, first - 1 + count);
  if (shown.length === 0) return `${path.join("/")} has ${all.length} line${all.length === 1 ? "" : "s"}, so there's none at ${first}.`;
  const last = first + shown.length - 1;
  const rest = last < all.length ? ` Read on with from: ${last + 1}.` : "";
  const heading = shown.length === all.length ? `${path.join("/")} (${all.length} line${all.length === 1 ? "" : "s"}):` : `${path.join("/")} (lines ${first} to ${last} of ${all.length}):${rest}`;
  return [heading, ...shown.map((line, i) => `${first + i}: ${line}`)].join("\n");
}

/** The lines with some text in them, in the files under the folder opened, or one inside it, whose path matches the pattern. Capitals don't matter. */
export async function searchFiles(root: FolderHandle, options: { text: string; pattern?: string; folder?: string }, signal?: AbortSignal): Promise<string> {
  const wanted = options.text.toLowerCase();
  if (!wanted.trim()) throw new FileProblem("Give the text to search for.");
  const matches = pathTest(options.pattern ?? "");
  const lines: string[] = [];
  let more = false;
  const found = await walk(root, parts(options.folder ?? "", "folder"), signal, async (path, file) => {
    if (!matches(path)) return;
    const text = await textOf(file).catch(() => null);
    if (text === null || !text.toLowerCase().includes(wanted)) return;
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (!line.toLowerCase().includes(wanted)) continue;
      if (lines.length === FOUND_LIMIT) {
        more = true;
        return false;
      }
      const shown = line.trim();
      lines.push(`${path}:${i + 1}: ${shown.length > LINE_SHOWN ? `${shown.slice(0, LINE_SHOWN)}…` : shown}`);
    }
  });
  if (lines.length === 0) return `Nothing in ${options.folder?.trim() || "the folder"} has ${JSON.stringify(options.text)} in it.${cutShort(found, false, "search")}`;
  return lines.join("\n") + cutShort(found, more, "search");
}
