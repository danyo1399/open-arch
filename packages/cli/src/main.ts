import { parseArgs, type ParseArgsConfig } from "node:util";
import { OpError } from "@open-arch/core";
import { check } from "./commands/check.js";
import { BUILDERS, commit, tidy, writeOptions, type Values } from "./commands/edit.js";
import { exportCommand } from "./commands/export.js";
import { fmt } from "./commands/fmt.js";
import { init } from "./commands/init.js";
import { show } from "./commands/show.js";
import { CliError, VERSION, type Io } from "./io.js";

export { CliError, type Io } from "./io.js";

type Options = NonNullable<ParseArgsConfig["options"]>;

interface Command {
  usage: string;
  options: Options;
  run(io: Io, values: Values, positionals: string[], usage: string): number;
}

const s = { type: "string" } as const;
const b = { type: "boolean" } as const;
const many = { type: "string", multiple: true } as const;
const FILE = { file: s };
const WRITE = { ...FILE, "dry-run": b, json: b, "no-export": b };
const WRITE_HELP = `
  --file <path>     The .openarch file (default: the one here, above or below)
  --dry-run         Check the change and report it, but don't save
  --json            Print the result as JSON
  --no-export       Don't refresh the docs folder after saving`;

const str = (v: Values[string]) => (typeof v === "string" ? v : undefined);
const bool = (v: Values[string]) => v === true;

function writer(usage: string, options: Options): Command {
  return {
    usage: `${usage.trimEnd()}\n${WRITE_HELP}\n`,
    options: { ...WRITE, ...options },
    run: (io, v, p, u) => {
      const name = usage.split("\n")[0]!.split(" ")[2]!;
      return commit(io, writeOptions(v), tidy(BUILDERS[name]!(io, v, p, u)));
    },
  };
}

const COMMANDS: Record<string, Command> = {
  init: {
    usage: `Usage: open-arch init [file] [--name <name>] [--docs <folder>] [--no-skills] [--no-agents-md]

Creates an empty workspace file (default: architecture.openarch) with a docs folder
(default: docs/architecture, relative to the file). Also installs the open-arch agent skill
into .agents/skills/ and .claude/skills/ and adds an open-arch section to AGENTS.md, at the
repository root. Safe to run again: it keeps the file and refreshes the skill and the section.
`,
    options: { name: s, docs: s, "no-skills": b, "no-agents-md": b },
    run: (io, v, p) => init(io, { file: p[0], name: str(v.name), docs: str(v.docs), noSkills: bool(v["no-skills"]), noAgentsMd: bool(v["no-agents-md"]) }),
  },
  check: {
    usage: `Usage: open-arch check [--file <path>] [--json] [--strict]

Validates the workspace. Exits 1 when there are errors (or any warnings, with --strict).
`,
    options: { ...FILE, json: b, strict: b },
    run: (io, v) => check(io, { file: str(v.file), json: bool(v.json), strict: bool(v.strict) }),
  },
  show: {
    usage: `Usage: open-arch show [id] [--file <path>] [--json]

Without an id: the model as a tree, and the list of views.
With an element id: its fields, notes, what it uses, what uses it, and the views showing it.
With a view id: the boxes and arrows the view draws.
`,
    options: { ...FILE, json: b },
    run: (io, v, p) => show(io, { file: str(v.file), json: bool(v.json), id: p[0] }),
  },
  fmt: {
    usage: `Usage: open-arch fmt [--file <path>] [--check]

Rewrites the file in canonical form. With --check, changes nothing and exits 1 if it would.
`,
    options: { ...FILE, check: b },
    run: (io, v) => fmt(io, { file: str(v.file), check: bool(v.check) }),
  },
  export: {
    usage: `Usage: open-arch export [folder] [--file <path>] [--check]

Writes the generated markdown docs (an index, a page per element and per view with its
Mermaid diagram) to the folder, or to the workspace's docs folder. Only pages open-arch
generated are overwritten or removed. With --check, exits 1 if the docs are out of date.
`,
    options: { ...FILE, check: b },
    run: (io, v, p) => exportCommand(io, { file: str(v.file), dir: p[0], check: bool(v.check) }),
  },
  apply: writer(
    `Usage: open-arch apply [file | -]

Applies a JSON list of operations from a file, or from standard input with - (the default),
all or nothing. Each operation is an object with "op" and the same fields as the matching
command, e.g. [{ "op": "add-element", "id": "cache", "kind": "container", "parent": "shop" }].
Operations: add-element, update-element, remove-element, rename, add-relationship,
update-relationship, remove-relationship, add-view, update-view, remove-view, show-in-view,
hide-in-view, set-layout, add-sticky, update-sticky, remove-sticky, update-workspace.
In updates, null removes a field.
`,
    {},
  ),
  "add-element": writer(
    `Usage: open-arch add-element <id> --kind <person|system|container|component> [options]

  --parent <id>          Containers need a system; components need a container
  --name <name>          Display name (default: from the id)
  --description <text>   One sentence, shown in the box
  --technology <text>    e.g. Node.js, PostgreSQL
  --external             A person or system outside your organisation
  --shape <shape>        How the box is drawn: box (the default), database, queue, web-browser,
                         mobile-app or folder. People are always drawn as a person
  --tag <name[=value]>   Repeat for more, e.g. --tag owner=payments --tag pii
  --notes <markdown>     Longer documentation (or --notes-file <path>, - for stdin)
`,
    { kind: s, parent: s, name: s, description: s, technology: s, external: b, shape: s, tag: many, notes: s, "notes-file": s },
  ),
  "update-element": writer(
    `Usage: open-arch update-element <id> [options]

Changes only the fields given. An empty value removes a field, e.g. --technology "".
  --name, --description, --technology, --notes, --notes-file
  --parent <id>          Move it into another system (or container, for a component)
  --external, --internal Mark a person or system as outside your organisation, or not
  --shape <shape>        box, database, queue, web-browser, mobile-app or folder
  --tag <name[=value]>   Add a tag or change its value; repeat for more
  --remove-tag <name>    Remove a tag; repeat for more
`,
    { name: s, parent: s, description: s, technology: s, external: b, internal: b, shape: s, tag: many, "remove-tag": many, notes: s, "notes-file": s },
  ),
  "remove-element": writer(
    `Usage: open-arch remove-element <id>

Removes the element, everything inside it, views scoped to them, and every relationship and
view entry that refers to them.
`,
    {},
  ),
  rename: writer(
    `Usage: open-arch rename <old-id> <new-id>

Changes an element's or view's ID everywhere it's referenced.
`,
    {},
  ),
  "add-relationship": writer(
    `Usage: open-arch add-relationship <from> <to> [--description <text>] [--technology <text>] [--tag <name[=value]>]...

Adds "<from> uses <to>". Describe it from <from>'s side, e.g. "Reads and writes orders".
`,
    { description: s, technology: s, tag: many },
  ),
  "update-relationship": writer(
    `Usage: open-arch update-relationship <from> <to> [--index <n>] [--description <text>] [--technology <text>]
                                    [--tag <name[=value]>]... [--remove-tag <name>]...

--index picks one when <from> has several relationships to <to> (0 is the first).
An empty value removes a field.
`,
    { index: s, description: s, technology: s, tag: many, "remove-tag": many },
  ),
  "remove-relationship": writer(
    `Usage: open-arch remove-relationship <from> <to> [--index <n>]
`,
    { index: s },
  ),
  "add-view": writer(
    `Usage: open-arch add-view <id> --level <landscape|context|container|component> [options]

  --scope <id>           A system for context and container views, a container for component views
  --title <title>        Default: from the scope and level
  --description <text>
  --include <a,b>        What to show (default: *, the scope's contents and what they connect to)
  --exclude <a,b>        What to hide
`,
    { level: s, scope: s, title: s, description: s, include: s, exclude: s },
  ),
  "update-view": writer(
    `Usage: open-arch update-view <id> [--title <title>] [--description <text>] [--include <a,b>] [--exclude <a,b>]
`,
    { title: s, description: s, include: s, exclude: s },
  ),
  "remove-view": writer(`Usage: open-arch remove-view <id>\n`, {}),
  "show-in-view": writer(`Usage: open-arch show-in-view <view> <id>...\n\nShows elements in a view, removing them from its exclude list or adding them to include.\n`, {}),
  "hide-in-view": writer(`Usage: open-arch hide-in-view <view> <id>...\n\nHides elements from a view, without removing them from the model.\n`, {}),
  "add-sticky": writer(
    `Usage: open-arch add-sticky <view> <id> --text <text> [--color <yellow|pink|blue|green>] [--at <x,y>]

Adds a sticky note to a view: text for people reading the diagram, such as what to notice or
why it's drawn this way. It isn't part of the model. The id must be unique within the view.
  --at <x,y>             Top-left corner (default: the designer puts it beside the diagram)
`,
    { text: s, color: s, at: s },
  ),
  "update-sticky": writer(
    `Usage: open-arch update-sticky <view> <id> [--text <text>] [--color <yellow|pink|blue|green>] [--at <x,y>]

--at "" lets the designer place it again.
`,
    { text: s, color: s, at: s },
  ),
  "remove-sticky": writer(`Usage: open-arch remove-sticky <view> <id>\n`, {}),
  "update-workspace": writer(
    `Usage: open-arch update-workspace [--name <name>] [--description <text>] [--docs <folder>]

--docs sets the folder (relative to the .openarch file) kept up to date with generated docs;
--docs "" turns that off.
`,
    { name: s, description: s, docs: s },
  ),
};

const HELP = `open-arch ${VERSION}: an architecture model (C4) in one .openarch file.

Usage: open-arch <command> [options]

Read:
  show [id]              The model, one element, or one view
  check                  Validate (exits 1 on errors)
  export [folder]        Write the generated markdown docs

Change (each change is checked first; nothing is saved if it would break the model):
  add-element <id>       update-element <id>       remove-element <id>      rename <old> <new>
  add-relationship <from> <to>    update-relationship <from> <to>    remove-relationship <from> <to>
  add-view <id>          update-view <id>          remove-view <id>
  show-in-view <view> <id>...     hide-in-view <view> <id>...     update-workspace
  add-sticky <view> <id>          update-sticky <view> <id>       remove-sticky <view> <id>
  apply [file | -]       Several changes from JSON, all or nothing

Other:
  init [file]            Create a workspace and install the agent skill
  fmt                    Rewrite the file in canonical form

Run open-arch <command> --help for its options. Every command takes --file <path>.
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
    return command.run(io, parsed.values as Values, parsed.positionals, command.usage);
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
