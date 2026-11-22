import { computeView, scopeProblems, showElement, showView, showWorkspace, suggest, type Shown } from "@open-arch/core";
import { CliError, type Io } from "../io.js";
import { displayPath, findWorkspaceFile, readWorkspaceFile } from "../workspace.js";

export interface ShowOptions {
  file?: string;
  json?: boolean;
  id?: string;
}

export function show(io: Io, opts: ShowOptions): number {
  const file = findWorkspaceFile(io.cwd, opts.file);
  const ws = readWorkspaceFile(file);
  const print = ({ json, text }: Shown) => io.out(opts.json ? JSON.stringify(json, null, 2) + "\n" : text);

  if (!opts.id) {
    const overview = showWorkspace(ws, displayPath(io.cwd, file));
    print({ json: overview.json, text: `${overview.text}\nRun \`open-arch show <id>\` for details of one element or view.\n` });
    return 0;
  }
  const element = ws.elements.get(opts.id);
  if (element) {
    print(showElement(ws, element));
    return 0;
  }

  const view = ws.views.get(opts.id);
  if (view) {
    const problems = scopeProblems(ws, view);
    if (problems.length) throw new CliError(`View "${view.id}" can't be shown: ${problems[0]!.message} Run \`open-arch check\`.`);
    print(showView(ws, computeView(ws, view)));
    return 0;
  }

  const near = suggest(opts.id, [...ws.elements.keys(), ...ws.views.keys()]);
  throw new CliError(`No element or view has the ID "${opts.id}".${near ? ` Did you mean "${near}"?` : ""} Run \`open-arch show\` to list them.`);
}
