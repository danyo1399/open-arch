import { checkWorkspace, errorCount, type Diagnostic } from "@open-arch/core";
import type { Io } from "../io.js";
import { displayPath, findWorkspaceFile, readWorkspaceFile } from "../workspace.js";

export interface CheckOptions {
  file?: string;
  json?: boolean;
  strict?: boolean;
}

export function check(io: Io, opts: CheckOptions): number {
  const file = findWorkspaceFile(io.cwd, opts.file);
  const ws = readWorkspaceFile(file);
  const diagnostics = checkWorkspace(ws);
  const errors = errorCount(diagnostics);
  const warnings = diagnostics.length - errors;
  const ok = errors === 0 && !(opts.strict && warnings > 0);

  if (opts.json) {
    const report = { ok, file: displayPath(io.cwd, file), elements: ws.elements.size, views: ws.views.size, errors, warnings, diagnostics };
    io.out(JSON.stringify(report, null, 2) + "\n");
    return ok ? 0 : 1;
  }
  for (const d of diagnostics) io.out(formatDiagnostic(d) + "\n");
  const counts = `${plural(ws.elements.size, "element")}, ${plural(ws.views.size, "view")}`;
  if (diagnostics.length === 0) io.out(`OK: ${displayPath(io.cwd, file)}, ${counts}, no problems.\n`);
  else io.out(`\n${plural(errors, "error")}, ${plural(warnings, "warning")} in ${displayPath(io.cwd, file)} (${counts}).\n`);
  return ok ? 0 : 1;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.path || "(file)"}: ${d.severity} [${d.rule}] ${d.message}${d.fix ? `\n  fix: ${d.fix}` : ""}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
