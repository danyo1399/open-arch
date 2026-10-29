import { basename, resolve } from "node:path";
import { exportDocs } from "@open-arch/core";
import { CliError, type Io } from "../io.js";
import { displayPath, docsFolder, findWorkspaceFile, readWorkspaceFile, writeDocs, type DocsResult } from "../workspace.js";
import { plural } from "./check.js";

export interface ExportOptions {
  file?: string;
  dir?: string;
  check?: boolean;
}

/** Write the generated markdown docs, to `dir` or the folder the workspace names. */
export function exportCommand(io: Io, opts: ExportOptions): number {
  const file = findWorkspaceFile(io.cwd, opts.file);
  const ws = readWorkspaceFile(file);
  const dir = opts.dir ? resolve(io.cwd, opts.dir) : docsFolder(file, ws.doc);
  if (!dir) throw new CliError("Say where to write the docs: `open-arch export <folder>`, or set a folder with `open-arch update-workspace --docs <folder>`.", 2);
  const result = writeDocs(dir, exportDocs(ws, basename(file)), { dryRun: opts.check });
  if (opts.check) {
    const stale = result.written.length + result.deleted.length;
    io.out(stale ? `The docs in ${displayPath(io.cwd, dir)} are out of date (${plural(stale, "page")}). Run \`open-arch export\`.\n` : `The docs in ${displayPath(io.cwd, dir)} are up to date.\n`);
    return stale ? 1 : 0;
  }
  io.out(describeDocs(io, result) + "\n");
  return 0;
}

export function describeDocs(io: Io, r: DocsResult): string {
  const where = displayPath(io.cwd, r.dir);
  const parts = [r.written.length ? `wrote ${plural(r.written.length, "page")}` : "", r.deleted.length ? `removed ${plural(r.deleted.length, "old page")}` : ""].filter(Boolean);
  const lines = [parts.length ? `Docs in ${where}: ${parts.join(", ")}.` : `Docs in ${where} are up to date.`];
  if (r.skipped.length) lines.push(`Left alone because open-arch didn't write them: ${r.skipped.join(", ")}.`);
  return lines.join("\n");
}
