import { renameId } from "@open-arch/core";
import { CliError, type Io } from "../io.js";
import { displayPath, openWorkspace, writeChanges } from "../workspace.js";

export interface RenameOptions {
  root?: string;
  dryRun?: boolean;
  from?: string;
  to?: string;
}

export function rename(io: Io, opts: RenameOptions): number {
  if (!opts.from || !opts.to) throw new CliError("Usage: open-arch rename <old-id> <new-id>", 2);
  const { root, ws } = openWorkspace(io.cwd, opts.root);
  const show = (p: string) => displayPath(root, io.cwd, p);
  const result = renameId(ws, opts.from, opts.to);

  if (!opts.dryRun) writeChanges(root, result.changes);
  const verb = opts.dryRun ? "would " : "";
  for (const c of result.changes) {
    if (c.from && c.from !== c.path) io.out(`${verb}move ${show(c.from)} -> ${show(c.path)}\n`);
    else io.out(`${verb}update ${show(c.path)}\n`);
  }
  for (const path of result.skipped) io.err(`skipped ${show(path)}: its frontmatter has errors, so its references weren't updated\n`);
  if (result.mentions.length) {
    io.out(`\nThe text of these files still mentions "${opts.from}"; update it by hand if it should change:\n`);
    for (const path of result.mentions) io.out(`  ${show(path)}\n`);
  }
  return result.skipped.length ? 1 : 0;
}
