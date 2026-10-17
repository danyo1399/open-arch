import { parseArgs, type ParseArgsConfig } from "node:util";
import { OpError } from "@open-arch/core";
import { check } from "./commands/check.js";
import { fmt } from "./commands/fmt.js";
import { init } from "./commands/init.js";
import { create } from "./commands/new.js";
import { rename } from "./commands/rename.js";
import { show } from "./commands/show.js";
import { CliError, VERSION, type Io } from "./io.js";

export { CliError, type Io } from "./io.js";

type Options = NonNullable<ParseArgsConfig["options"]>;
type Values = Record<string, string | boolean | string[] | undefined>;

interface Command {
  usage: string;
  options: Options;
  run(io: Io, values: Values, positionals: string[]): number;
}

const ROOT = { root: { type: "string" } } as const;
const str = (v: Values[string]) => (typeof v === "string" ? v : undefined);
const bool = (v: Values[string]) => v === true;

const COMMANDS: Record<string, Command> = {
  init: {
    usage: `Usage: open-arch init [dir] [--no-skills] [--no-agents-md]

Creates a workspace in dir (default: the current folder): open-arch.yaml, model/ and views/.
Also installs the open-arch agent skill into .agents/skills/ and .claude/skills/, and adds an
open-arch section to AGENTS.md, at the repository root (or the current folder outside a repository).
Safe to run again: it keeps your files and refreshes the skill and the AGENTS.md section.
`,
    options: { "no-skills": { type: "boolean" }, "no-agents-md": { type: "boolean" } },
    run: (io, v, p) => init(io, { dir: p[0], noSkills: bool(v["no-skills"]), noAgentsMd: bool(v["no-agents-md"]) }),
  },
  check: {
    usage: `Usage: open-arch check [files...] [--json] [--strict]

Validates the whole workspace. With files, reports only problems in those files.
Exits 1 when there are errors (or any warnings, with --strict).
`,
    options: { ...ROOT, json: { type: "boolean" }, strict: { type: "boolean" } },
    run: (io, v, p) => check(io, { root: str(v.root), json: bool(v.json), strict: bool(v.strict), files: p }),
  },
  fmt: {
    usage: `Usage: open-arch fmt [files...] [--check]

Rewrites files in the form open-arch saves them, regenerates each view's Mermaid preview,
and drops layout positions for elements no longer in a view.
With --check, changes nothing and exits 1 if any file would change.
`,
    options: { ...ROOT, check: { type: "boolean" } },
    run: (io, v, p) => fmt(io, { root: str(v.root), check: bool(v.check), files: p }),
  },
  show: {
    usage: `Usage: open-arch show [id] [--json]

Without an id: the model as a tree, and the list of views.
With an element id: its details, what it uses, what uses it, and the views it appears in.
With a view id: the boxes and arrows the view draws.
`,
    options: { ...ROOT, json: { type: "boolean" } },
    run: (io, v, p) => show(io, { root: str(v.root), json: bool(v.json), id: p[0] }),
  },
  new: {
    usage: `Usage:
  open-arch new element <id> --kind <person|system|container|component> [--parent <id>]
                             [--name <name>] [--description <text>] [--technology <text>]
                             [--external] [--tag <tag>]... [--dir <folder>]
  open-arch new view <id> --level <landscape|context|container|component> [--scope <id>]
                          [--title <title>] [--description <text>]

Containers need --parent <system>, components need --parent <container>.
Context and container views need --scope <system>, component views need --scope <container>.
`,
    options: {
      ...ROOT,
      kind: { type: "string" },
      parent: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      technology: { type: "string" },
      external: { type: "boolean" },
      tag: { type: "string", multiple: true },
      dir: { type: "string" },
      level: { type: "string" },
      scope: { type: "string" },
      title: { type: "string" },
    },
    run: (io, v, p) =>
      create(io, {
        root: str(v.root),
        what: p[0],
        id: p[1],
        kind: str(v.kind),
        parent: str(v.parent),
        name: str(v.name),
        description: str(v.description),
        technology: str(v.technology),
        external: bool(v.external),
        tag: Array.isArray(v.tag) ? v.tag : undefined,
        dir: str(v.dir),
        level: str(v.level),
        scope: str(v.scope),
        title: str(v.title),
      }),
  },
  rename: {
    usage: `Usage: open-arch rename <old-id> <new-id> [--dry-run]

Changes an element's or view's ID: renames its file (and the folder of its children),
and updates every parent, uses, scope, include, exclude and layout reference to it.
Prose in file bodies isn't changed; the files that mention the old ID are listed.
`,
    options: { ...ROOT, "dry-run": { type: "boolean" } },
    run: (io, v, p) => rename(io, { root: str(v.root), dryRun: bool(v["dry-run"]), from: p[0], to: p[1] }),
  },
};

const HELP = `open-arch ${VERSION}: an architecture model (C4) kept as markdown files.

Usage: open-arch <command> [options]

Commands:
  init [dir]           Create a workspace and install the agent skill
  check [files...]     Validate the workspace (exits 1 on errors)
  fmt [files...]       Rewrite files in canonical form and regenerate view previews
  show [id]            Print the model, an element, or a view
  new element <id>     Create an element file
  new view <id>        Create a view file
  rename <old> <new>   Change an element's or view's ID everywhere

Options:
  --root <dir>         Workspace folder (default: the nearest open-arch.yaml)
  --json               Machine-readable output (check, show)
  -h, --help           Help for a command: open-arch <command> --help
  -v, --version        Print the version
`;

export function run(argv: string[], io: Io): number {
  const [name, ...rest] = argv;
  try {
    if (!name || name === "help" || name === "-h" || name === "--help") {
      io.out(HELP);
      return 0;
    }
    if (name === "-v" || name === "--version") {
      io.out(`${VERSION}\n`);
      return 0;
    }
    const command = COMMANDS[name];
    if (!command) throw new CliError(`Unknown command "${name}". Run \`open-arch --help\` for the list.`, 2);
    let parsed;
    try {
      parsed = parseArgs({ args: rest, options: { ...command.options, help: { type: "boolean", short: "h" } }, allowPositionals: true, strict: true });
    } catch (error) {
      throw new CliError(`${(error as Error).message}\n\n${command.usage}`, 2);
    }
    if (parsed.values.help) {
      io.out(command.usage);
      return 0;
    }
    return command.run(io, parsed.values as Values, parsed.positionals);
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`open-arch: ${error.message}\n`);
      return error.code;
    }
    if (error instanceof OpError) {
      io.err(`open-arch: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
