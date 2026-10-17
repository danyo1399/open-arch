import { formatWorkspace } from "@open-arch/core";
import type { Io } from "../io.js";
import { displayPath, openWorkspace, toWorkspacePath, writeChanges } from "../workspace.js";
import { plural } from "./check.js";

export interface FmtOptions {
  root?: string;
  check?: boolean;
  files: string[];
}

export function fmt(io: Io, opts: FmtOptions): number {
  const { root, ws } = openWorkspace(io.cwd, opts.root);
  const show = (p: string) => displayPath(root, io.cwd, p);
  const only = opts.files.length ? opts.files.map((f) => toWorkspacePath(root, io.cwd, f)) : undefined;
  const { changes, skipped } = formatWorkspace(ws, only);

  for (const s of skipped) io.err(`skipped ${show(s.path)}: ${s.reason}\n`);
  if (opts.check) {
    for (const c of changes) io.out(`would change ${show(c.path)}\n`);
    io.out(changes.length ? `${plural(changes.length, "file")} need formatting. Run \`open-arch fmt\`.\n` : "All files are formatted.\n");
    return changes.length ? 1 : 0;
  }
  writeChanges(root, changes);
  for (const c of changes) io.out(`formatted ${show(c.path)}\n`);
  io.out(changes.length ? `Formatted ${plural(changes.length, "file")}.\n` : "Nothing to change.\n");
  return 0;
}
