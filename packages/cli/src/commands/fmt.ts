import { readFileSync } from "node:fs";
import { pruneLayouts, serializeDocument } from "@open-arch/core";
import { CliError, type Io } from "../io.js";
import { displayPath, findWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from "../workspace.js";
import { formatDiagnostic } from "./check.js";

export interface FmtOptions {
  file?: string;
  check?: boolean;
}

/** Rewrite the file in canonical form, dropping positions of elements that left their views. */
export function fmt(io: Io, opts: FmtOptions): number {
  const file = findWorkspaceFile(io.cwd, opts.file);
  const ws = readWorkspaceFile(file);
  const shown = displayPath(io.cwd, file);
  if (!ws.valid) {
    throw new CliError(`${shown} has errors that formatting would lose; fix them first:\n${ws.diagnostics.map(formatDiagnostic).join("\n")}`);
  }
  const doc = structuredClone(ws.doc);
  pruneLayouts(doc);
  const changed = serializeDocument(doc) !== readFileSync(file, "utf8");
  if (opts.check) {
    io.out(changed ? `${shown} needs formatting. Run \`open-arch fmt\`.\n` : `${shown} is formatted.\n`);
    return changed ? 1 : 0;
  }
  if (changed) writeWorkspaceFile(file, doc);
  io.out(changed ? `Formatted ${shown}.\n` : `${shown} is already formatted.\n`);
  return 0;
}
