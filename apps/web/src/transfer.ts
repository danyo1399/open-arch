/**
 * What import and export read and write. A workspace is one .openarch file,
 * and several go in a .zip of them, so each still opens on its own (in the
 * desktop app, or with the CLI) once unzipped.
 */
import { FILE_EXTENSION, parseDocument } from "@open-arch/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { StoredWorkspace, WorkspaceLibrary } from "./library.js";
import type { ExportFile, PickedFile } from "./providers.js";

export interface WorkspaceFile {
  name: string;
  text: string;
}

/**
 * Why a file can't be imported, or null when it can. Only files the designer
 * can edit are let in: a workspace in the browser can't be fixed by hand.
 */
export function importProblem(file: WorkspaceFile): string | null {
  const text = file.text.replace(/^\uFEFF/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  if (typeof raw !== "object" || raw === null || !("openarch" in raw)) return `${file.name} isn't an open-arch workspace.`;
  const { diagnostics, valid } = parseDocument(text);
  if (valid) return null;
  const first = diagnostics[0]!;
  return `${file.name} has problems that stop it being edited${first.path ? ` (at ${first.path})` : ""}: ${first.message} Fix the file, then import it again.`;
}

const isZip = (data: Uint8Array) => data[0] === 0x50 && data[1] === 0x4b;

/** A workspace in a zip, at any depth, leaving out the copies macOS adds (__MACOSX/, ._name). */
function isWorkspaceEntry(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return !path.startsWith("__MACOSX/") && !name.startsWith(".") && name.toLowerCase().endsWith(FILE_EXTENSION);
}

/** The workspaces in some files: a .openarch file is one, and a zip holds any number. */
export function unpack(files: PickedFile[]): { workspaces: WorkspaceFile[]; problems: string[] } {
  const workspaces: WorkspaceFile[] = [];
  const problems: string[] = [];
  const take = (name: string, data: Uint8Array) => {
    const file = { name, text: strFromU8(data).replace(/^\uFEFF/, "") };
    const problem = importProblem(file);
    if (problem) problems.push(problem);
    else workspaces.push(file);
  };
  for (const file of files) {
    if (!isZip(file.data)) {
      take(file.name, file.data);
      continue;
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(file.data, { filter: (entry) => isWorkspaceEntry(entry.name) });
    } catch {
      problems.push(`${file.name} isn't a zip file that can be read.`);
      continue;
    }
    const paths = Object.keys(entries).sort();
    if (paths.length === 0) problems.push(`${file.name} has no ${FILE_EXTENSION} files in it.`);
    for (const path of paths) take(path.split("/").pop()!, entries[path]!);
  }
  return { workspaces, problems };
}

export interface ImportResult {
  added: StoredWorkspace[];
  /** Workspaces the library already had, word for word, so they weren't added again. */
  existing: StoredWorkspace[];
  problems: string[];
}

/** Adds the workspaces in `files` to the library. Importing a backup twice doesn't make copies. */
export async function importFiles(library: WorkspaceLibrary, files: PickedFile[]): Promise<ImportResult> {
  const { workspaces, problems } = unpack(files);
  const known = await library.list();
  const added: StoredWorkspace[] = [];
  const existing: StoredWorkspace[] = [];
  for (const file of workspaces) {
    const same = known.find((r) => r.text === file.text);
    if (same) {
      if (!added.includes(same) && !existing.includes(same)) existing.push(same);
      continue;
    }
    const record = await library.add(file.name, file.text);
    added.push(record);
    known.push(record);
  }
  return { added, existing, problems };
}

/** `name`, or `name-2` and so on: names in a zip mustn't clash, even where case doesn't count. */
function uniqueName(fileName: string, used: Set<string>): string {
  const base = fileName.slice(0, fileName.length - (fileName.toLowerCase().endsWith(FILE_EXTENSION) ? FILE_EXTENSION.length : 0));
  for (let n = 1; ; n++) {
    const name = `${base}${n === 1 ? "" : `-${n}`}${FILE_EXTENSION}`;
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
  }
}

/** Every workspace in one zip, named for the day it was made. */
export function workspacesZip(records: StoredWorkspace[], date = new Date()): ExportFile {
  const used = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  for (const record of records) entries[uniqueName(record.fileName, used)] = strToU8(record.text);
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  return { name: `open-arch-workspaces-${day}.zip`, data: zipSync(entries) };
}
