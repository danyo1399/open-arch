/**
 * Commands that change the model. Each becomes one or more operations, which
 * core checks and applies all-or-nothing; then the file is saved and its docs
 * folder refreshed. Nothing here writes the document any other way.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyOperations, buildWorkspace, OpError, parseOperations, type Operation, type TagChanges, type Tags } from "@open-arch/core";
import { CliError, type Io } from "../io.js";
import { displayPath, findWorkspaceFile, readWorkspaceFile, syncDocs, writeWorkspaceFile } from "../workspace.js";
import { formatDiagnostic } from "./check.js";
import { describeDocs } from "./export.js";

export type Values = Record<string, string | boolean | string[] | undefined>;

export interface WriteOptions {
  file?: string;
  dryRun?: boolean;
  json?: boolean;
  noExport?: boolean;
}

export function writeOptions(v: Values): WriteOptions {
  return { file: text(v.file), dryRun: v["dry-run"] === true, json: v.json === true, noExport: v["no-export"] === true };
}

/** Apply operations to the workspace file and save it. */
export function commit(io: Io, opts: WriteOptions, ops: Operation[]): number {
  const file = findWorkspaceFile(io.cwd, opts.file);
  const ws = readWorkspaceFile(file);
  const shown = displayPath(io.cwd, file);
  if (!ws.valid) {
    throw new CliError(
      `${shown} has errors that stop it being changed safely:\n${ws.diagnostics.map(formatDiagnostic).join("\n")}\nFix them by hand, or restore the file from version control.`,
    );
  }
  let result;
  try {
    result = applyOperations(ws.doc, ops);
  } catch (error) {
    if (error instanceof OpError && opts.json) {
      io.out(JSON.stringify({ ok: false, error: error.message, diagnostics: error.diagnostics }, null, 2) + "\n");
      return 1;
    }
    throw error;
  }
  const docs = opts.dryRun ? undefined : (writeWorkspaceFile(file, result.doc), opts.noExport ? undefined : syncDocs(file, buildWorkspace(result.doc)));

  if (opts.json) {
    const docsJson = docs && { ...docs, dir: displayPath(io.cwd, docs.dir) };
    io.out(JSON.stringify({ ok: true, saved: !opts.dryRun, file: shown, changes: result.summary, warnings: result.warnings, docs: docsJson }, null, 2) + "\n");
    return 0;
  }
  for (const line of result.summary) io.out(`${opts.dryRun ? "would have " : ""}${line}\n`);
  for (const w of result.warnings) io.out(`warning: ${formatDiagnostic(w)}\n`);
  io.out(opts.dryRun ? "Nothing was saved (--dry-run).\n" : `Saved ${shown}.\n`);
  if (docs) io.out(describeDocs(io, docs) + "\n");
  return 0;
}

// --- Turning command-line arguments into operations ---------------------------------

const text = (v: Values[string]) => (typeof v === "string" ? v : undefined);
/** A value an update can remove: an empty string means "remove it". */
const clearable = (v: Values[string]) => (typeof v === "string" ? (v.trim() === "" ? null : v) : undefined);
const list = (v: Values[string]) =>
  typeof v === "string"
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

function need(positionals: string[], names: string[], usage: string): string[] {
  if (positionals.length < names.length) throw new CliError(`Missing ${names.slice(positionals.length).join(" and ")}.\n\n${usage}`, 2);
  if (positionals.length > names.length) throw new CliError(`Too many arguments: ${positionals.slice(names.length).join(" ")}.\n\n${usage}`, 2);
  return positionals;
}

/**
 * `--tag owner=payments` sets a tag, `--tag pii` (or `--tag pii=`) one without a value, and
 * `--remove-tag owner` removes one. Tags can have empty values, so only --remove-tag removes.
 */
function tags(v: Values): TagChanges | undefined {
  const many = (value: Values[string]) => (Array.isArray(value) ? value : []);
  const out = new Map<string, string | null>();
  for (const item of many(v.tag)) {
    const at = item.indexOf("=");
    const name = (at < 0 ? item : item.slice(0, at)).trim();
    if (!name) throw new CliError(`--tag needs a name, like --tag owner=payments, not "${item}".`, 2);
    out.set(name, at < 0 ? "" : item.slice(at + 1));
  }
  for (const name of many(v["remove-tag"])) out.set(name, null);
  return out.size ? Object.fromEntries(out) : undefined;
}

function notes(io: Io, v: Values): string | null | undefined {
  const file = text(v["notes-file"]);
  if (file === undefined) return clearable(v.notes);
  try {
    return file === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(io.cwd, file), "utf8");
  } catch (error) {
    throw new CliError(`Can't read notes from ${file}: ${(error as Error).message}`);
  }
}

function index(v: Values[string]): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new CliError("--index must be a whole number, 0 or more.", 2);
  return n;
}

/** `--at 400,120`; an empty value means "remove it". */
function point(v: Values[string]): [number, number] | null | undefined {
  if (typeof v !== "string") return undefined;
  if (v.trim() === "") return null;
  const parts = v.split(",").map((n) => Number(n.trim()));
  if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new CliError(`--at needs x,y, e.g. --at 400,120, not "${v}".`, 2);
  return parts as [number, number];
}

export type Builder = (io: Io, v: Values, positionals: string[], usage: string) => Operation[];

export const BUILDERS: Record<string, Builder> = {
  "add-element": (io, v, p, usage) => {
    const [id] = need(p, ["<id>"], usage);
    const kind = text(v.kind);
    if (!kind) throw new CliError(`Pass --kind: person, system, container or component.\n\n${usage}`, 2);
    return [
      {
        op: "add-element",
        id: id!,
        kind: kind as never,
        parent: text(v.parent),
        name: text(v.name),
        description: text(v.description),
        technology: text(v.technology),
        external: v.external === true || undefined,
        shape: text(v.shape) as never,
        tags: tags(v) as Tags | undefined,
        notes: notes(io, v) ?? undefined,
      },
    ];
  },
  "update-element": (io, v, p, usage) => {
    const [id] = need(p, ["<id>"], usage);
    if (v.external === true && v.internal === true) throw new CliError("Pass --external or --internal, not both.", 2);
    return [
      {
        op: "update-element",
        id: id!,
        name: text(v.name),
        parent: text(v.parent),
        description: clearable(v.description),
        technology: clearable(v.technology),
        external: v.external === true ? true : v.internal === true ? false : undefined,
        shape: clearable(v.shape) as never,
        tags: tags(v),
        notes: notes(io, v),
      },
    ];
  },
  "remove-element": (_io, _v, p, usage) => [{ op: "remove-element", id: need(p, ["<id>"], usage)[0]! }],
  rename: (_io, _v, p, usage) => {
    const [id, to] = need(p, ["<old-id>", "<new-id>"], usage);
    return [{ op: "rename", id: id!, to: to! }];
  },
  "add-relationship": (io, v, p, usage) => {
    const [from, to] = need(p, ["<from>", "<to>"], usage);
    return [
      { op: "add-relationship", from: from!, to: to!, description: text(v.description), technology: text(v.technology), tags: tags(v) as Tags | undefined, notes: notes(io, v) ?? undefined },
    ];
  },
  "update-relationship": (io, v, p, usage) => {
    const [from, to] = need(p, ["<from>", "<to>"], usage);
    return [
      {
        op: "update-relationship",
        from: from!,
        to: to!,
        index: index(v.index),
        description: clearable(v.description),
        technology: clearable(v.technology),
        tags: tags(v),
        notes: notes(io, v),
      },
    ];
  },
  "remove-relationship": (_io, v, p, usage) => {
    const [from, to] = need(p, ["<from>", "<to>"], usage);
    return [{ op: "remove-relationship", from: from!, to: to!, index: index(v.index) }];
  },
  "add-view": (io, v, p, usage) => {
    const [id] = need(p, ["<id>"], usage);
    const level = text(v.level);
    if (!level) throw new CliError(`Pass --level: landscape, context, container or component.\n\n${usage}`, 2);
    return [
      {
        op: "add-view",
        id: id!,
        level: level as never,
        scope: text(v.scope),
        title: text(v.title),
        description: text(v.description),
        include: list(v.include),
        exclude: list(v.exclude),
        notes: notes(io, v) ?? undefined,
      },
    ];
  },
  "update-view": (io, v, p, usage) => {
    const [id] = need(p, ["<id>"], usage);
    return [{ op: "update-view", id: id!, title: text(v.title), description: clearable(v.description), include: list(v.include), exclude: list(v.exclude), notes: notes(io, v) }];
  },
  "remove-view": (_io, _v, p, usage) => [{ op: "remove-view", id: need(p, ["<id>"], usage)[0]! }],
  "show-in-view": (_io, _v, p, usage) => {
    if (p.length < 2) throw new CliError(`Name a view and at least one element.\n\n${usage}`, 2);
    return p.slice(1).map((id) => ({ op: "show-in-view", view: p[0]!, id }) as const);
  },
  "hide-in-view": (_io, _v, p, usage) => {
    if (p.length < 2) throw new CliError(`Name a view and at least one element.\n\n${usage}`, 2);
    return p.slice(1).map((id) => ({ op: "hide-in-view", view: p[0]!, id }) as const);
  },
  "add-sticky": (_io, v, p, usage) => {
    const [view, id] = need(p, ["<view>", "<id>"], usage);
    const body = text(v.text);
    if (body === undefined) throw new CliError(`Pass --text.\n\n${usage}`, 2);
    return [{ op: "add-sticky", view: view!, id: id!, text: body, color: text(v.color) as never, at: point(v.at) ?? undefined }];
  },
  "update-sticky": (_io, v, p, usage) => {
    const [view, id] = need(p, ["<view>", "<id>"], usage);
    return [{ op: "update-sticky", view: view!, id: id!, text: text(v.text), color: text(v.color) as never, at: point(v.at) }];
  },
  "remove-sticky": (_io, _v, p, usage) => {
    const [view, id] = need(p, ["<view>", "<id>"], usage);
    return [{ op: "remove-sticky", view: view!, id: id! }];
  },
  "update-workspace": (_io, v, p, usage) => {
    need(p, [], usage);
    return [{ op: "update-workspace", name: text(v.name), description: clearable(v.description), docs: clearable(v.docs) }];
  },
  apply: (io, _v, p, usage) => {
    if (p.length > 1) throw new CliError(`apply takes one file (or - for standard input).\n\n${usage}`, 2);
    const source = p[0] ?? "-";
    let raw: string;
    try {
      raw = source === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(io.cwd, source), "utf8");
    } catch (error) {
      throw new CliError(`Can't read ${source === "-" ? "standard input" : source}: ${(error as Error).message}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new CliError(`The operations aren't valid JSON: ${(error as Error).message}`);
    }
    return parseOperations(json);
  },
};

/** Drop undefined fields so operations print and compare cleanly. */
export function tidy(ops: Operation[]): Operation[] {
  return ops.map((op) => Object.fromEntries(Object.entries(op).filter(([, v]) => v !== undefined)) as Operation);
}
