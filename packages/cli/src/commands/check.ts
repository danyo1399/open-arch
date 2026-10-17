import { checkWorkspace, type Diagnostic } from "@open-arch/core";
import type { Io } from "../io.js";
import { displayPath, openWorkspace, toWorkspacePath } from "../workspace.js";

export interface CheckOptions {
  root?: string;
  json?: boolean;
  strict?: boolean;
  files: string[];
}

export function check(io: Io, opts: CheckOptions): number {
  const { root, ws } = openWorkspace(io.cwd, opts.root);
  const show = (p: string) => displayPath(root, io.cwd, p);
  let diagnostics = checkWorkspace(ws);
  if (opts.files.length) {
    const wanted = new Set(opts.files.map((f) => toWorkspacePath(root, io.cwd, f)));
    diagnostics = diagnostics.filter((d) => wanted.has(d.path));
  }
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const ok = errors === 0 && !(opts.strict && warnings > 0);

  if (opts.json) {
    io.out(
      JSON.stringify(
        {
          ok,
          workspace: displayPath(root, io.cwd, ""),
          elements: ws.elements.size,
          views: ws.views.size,
          errors,
          warnings,
          diagnostics: diagnostics.map((d) => ({ ...d, path: show(d.path) })),
        },
        null,
        2,
      ) + "\n",
    );
    return ok ? 0 : 1;
  }

  for (const d of diagnostics) io.out(formatDiagnostic(d, show) + "\n");
  const counts = `${plural(ws.elements.size, "element")}, ${plural(ws.views.size, "view")}`;
  if (diagnostics.length === 0) io.out(`OK: ${counts}, no problems.\n`);
  else io.out(`\n${plural(errors, "error")}, ${plural(warnings, "warning")} (${counts}).\n`);
  return ok ? 0 : 1;
}

export function formatDiagnostic(d: Diagnostic, show: (p: string) => string): string {
  const where = d.line ? `${show(d.path)}:${d.line}` : show(d.path);
  return `${where}: ${d.severity} [${d.rule}] ${d.message}${d.fix ? `\n  fix: ${d.fix}` : ""}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
