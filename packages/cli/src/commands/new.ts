import { newElement, newView, type FileChange } from "@open-arch/core";
import { CliError, type Io } from "../io.js";
import { displayPath, openWorkspace, toWorkspacePath, writeChanges } from "../workspace.js";

export interface NewOptions {
  root?: string;
  what?: string;
  id?: string;
  kind?: string;
  parent?: string;
  name?: string;
  description?: string;
  technology?: string;
  external?: boolean;
  tag?: string[];
  dir?: string;
  level?: string;
  scope?: string;
  title?: string;
}

export function create(io: Io, opts: NewOptions): number {
  if (opts.what !== "element" && opts.what !== "view") {
    throw new CliError("Say what to create: `open-arch new element <id> --kind <kind>` or `open-arch new view <id> --level <level>`.", 2);
  }
  if (!opts.id) throw new CliError(`Give the new ${opts.what} an ID: \`open-arch new ${opts.what} <id>\`.`, 2);
  const { root, ws } = openWorkspace(io.cwd, opts.root);

  let changes: FileChange[];
  if (opts.what === "element") {
    if (!opts.kind) throw new CliError("Pass --kind: person, system, container or component.", 2);
    changes = newElement(ws, {
      id: opts.id,
      kind: opts.kind,
      parent: opts.parent,
      name: opts.name,
      description: opts.description,
      technology: opts.technology,
      external: opts.external,
      tags: opts.tag,
      dir: opts.dir === undefined ? undefined : toWorkspacePath(root, io.cwd, opts.dir),
    });
  } else {
    if (!opts.level) throw new CliError("Pass --level: landscape, context, container or component.", 2);
    changes = newView(ws, { id: opts.id, level: opts.level, scope: opts.scope, title: opts.title, description: opts.description });
  }

  writeChanges(root, changes);
  const [created, ...updated] = changes;
  io.out(`created ${displayPath(root, io.cwd, created!.path)}\n`);
  for (const c of updated) io.out(`updated preview in ${displayPath(root, io.cwd, c.path)}\n`);
  if (opts.what === "element") io.out("Add relationships under `uses:` in the new file, then run `open-arch check`.\n");
  return 0;
}
