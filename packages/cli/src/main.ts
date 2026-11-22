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

Creates an empty workspace file, architecture.openarch, and writes its docs. Without a file
named, it goes here if this folder is empty but for hidden things like .agents/, or else in a
folder of its own, architecture/: say, at the top of a Git repository. Its docs go beside it
when it has its folder to itself, and otherwise in docs/architecture beside it, apart from
what's there. --docs names another folder, relative to the file. Also installs the open-arch
agent skill into .agents/skills/ and .claude/skills/ and adds an open-arch section to
AGENTS.md, at the repository root. Safe to run again: it keeps the file and refreshes the
skill and the section.
If AGENTS.md can't be read, isn't UTF-8 text, or has a section that can't be told apart from
the rest of it (a marker without its pair, the markers out of order, more than one section),
init leaves AGENTS.md alone and exits 1. So it does when the path of the workspace or its docs
folder has a line break in it (\r, \n, or Unicode's line or paragraph separator). The workspace
and its docs are in place, and the skill too unless --no-skills is given.
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
With an element id: its fields, notes, what it uses and what uses it (with those
relationships' notes), and the views showing it.
With a view id: its description and notes, and the boxes and arrows the view draws, or for
a sequence view, its steps in order, for a state view, its states and transitions, for a
deployment view, its nodes and what runs in them, its connections and the arrows it draws, for
an event view, its lanes, and its cards in order with the cards each comes from, or for a
wireframe view, its screens in order, each with its widgets and the screens they lead to, for
a whiteboard view, its shapes from the back to the front, and its arrows, for a flowchart
view, its lanes, its blocks in order, and its flows, or for an entity view, its entities in
order, each with its attributes, and its links with how many of each end there can be.
Then the view's sticky notes, with their notes.
A class's members, a relationship's kind when it isn't an association, a container's
libraries and the containers a library is built into are shown too.
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
generated from this file (or from one that isn't there any more) are overwritten or removed,
and old ones are only looked for at the folder's top and in views/ and elements/. So the docs
of another workspace whose file is in the same folder as this one are left alone, even in the
same docs folder; workspaces in different folders need docs folders of their own. With
--check, exits 1 if the docs are out of date.
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
hide-in-view, set-layout, add-sticky, update-sticky, remove-sticky, add-step, update-step,
remove-step, add-state, update-state, remove-state, add-transition, update-transition,
remove-transition, add-node, update-node, remove-node, add-connection, update-connection,
remove-connection, add-lane, update-lane, remove-lane, add-card, update-card, remove-card,
add-screen, update-screen, remove-screen, add-widget, update-widget, remove-widget,
add-shape, update-shape, remove-shape, add-arrow, update-arrow, remove-arrow, add-block,
update-block, remove-block, add-flow, update-flow, remove-flow, add-entity, update-entity,
remove-entity, add-attribute, update-attribute, remove-attribute, add-link, update-link,
remove-link, update-workspace.
In updates, null removes a field.
`,
    {},
  ),
  "add-element": writer(
    `Usage: open-arch add-element <id> --kind <person|system|container|component|library|class> [options]

A library is code shared by several containers, such as a logging library: each container
built with it lists it with --library, and its components and classes are kept in one place.
  --parent <id>          Containers need a system, components a container or library, and
                         classes a component or library. People, systems and libraries have none
  --name <name>          Display name (default: from the id)
  --description <text>   One sentence, shown in the box
  --technology <text>    e.g. Node.js, PostgreSQL
  --external             A person or system outside your organisation
  --shape <shape>        How the box is drawn: box (the default), database, queue, folder,
                         document, web-browser, mobile-app, desktop-app, terminal, server,
                         email or scheduled-job. People are always drawn as a person, and
                         classes as a class
  --stereotype <text>    Classes only: what sort of class it is, e.g. interface, abstract
                         or enum. Drawn as «interface»
  --member <text>        Classes only: an attribute or method, in UML's notation, like
                         --member "+id: OrderId" --member "+total(): Money". Repeat for more
  --library <id>         Containers only: a library built into it. Repeat for more
  --tag <name[=value]>   Repeat for more, e.g. --tag owner=payments --tag pii
  --notes <markdown>     Longer documentation (or --notes-file <path>, - for stdin)
`,
    { kind: s, parent: s, name: s, description: s, technology: s, external: b, shape: s, stereotype: s, member: many, library: many, tag: many, notes: s, "notes-file": s },
  ),
  "update-element": writer(
    `Usage: open-arch update-element <id> [options]

Changes only the fields given. An empty value removes a field, e.g. --technology "".
  --name, --description, --technology, --notes, --notes-file
  --parent <id>          Move it into another system (or container or library, for a
                         component, or component or library, for a class)
  --external, --internal Mark a person or system as outside your organisation, or not
  --shape <shape>        box, database, queue, folder, document, web-browser, mobile-app,
                         desktop-app, terminal, server, email or scheduled-job
  --stereotype <text>    Classes only, e.g. interface
  --member <text>        Classes only: replaces its members with these; repeat for more.
                         --member "" removes them all
  --library <id>         Containers only: replaces the libraries built into it with these;
                         repeat for more. --library "" removes them all
  --tag <name[=value]>   Add a tag or change its value; repeat for more. Without a value
                         (--tag pii or --tag pii=) it's a plain label, not a removal
  --remove-tag <name>    Remove a tag; repeat for more
`,
    { name: s, parent: s, description: s, technology: s, external: b, internal: b, shape: s, stereotype: s, member: many, library: many, tag: many, "remove-tag": many, notes: s, "notes-file": s },
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
                                 [--kind <kind>] [--bidirectional] [--notes <markdown>]

Adds "<from> uses <to>". Describe it from <from>'s side, e.g. "Reads and writes orders".
  --kind <kind>          Between two classes, what it means in UML, for class views:
                         association (the default: <from> uses <to>), dependency (depends
                         on), inheritance (extends), realization (implements), composition
                         (is made of) or aggregation (holds). <from> is the subclass, or
                         the whole that holds the part
  --bidirectional        It goes both ways: <to> uses <from> too, e.g. "Syncs customers with".
                         Drawn with an arrowhead at each end. When each way is described
                         differently, add two relationships instead. Only for associations
  --notes <markdown>     Longer documentation (or --notes-file <path>, - for stdin)
`,
    { description: s, technology: s, tag: many, kind: s, bidirectional: b, notes: s, "notes-file": s },
  ),
  "update-relationship": writer(
    `Usage: open-arch update-relationship <from> <to> [--index <n>] [--new-from <id>] [--new-to <id>]
                                    [--kind <kind>] [--bidirectional | --one-way] [--description <text>]
                                    [--technology <text>] [--tag <name[=value]>]... [--remove-tag <name>]...
                                    [--notes <markdown>]

--index picks one when <from> has several relationships to <to> (0 is the first).
--new-from and --new-to move it to another element at either end. It keeps its
description, technology, tags and notes.
--kind changes what it means between two classes: association, dependency, inheritance,
realization, composition or aggregation (see add-relationship).
--bidirectional makes it go both ways, and --one-way only from <from> to <to>.
--notes takes markdown, or use --notes-file <path> (- for stdin).
An empty value removes a field.
`,
    { index: s, "new-from": s, "new-to": s, kind: s, bidirectional: b, "one-way": b, description: s, technology: s, tag: many, "remove-tag": many, notes: s, "notes-file": s },
  ),
  "remove-relationship": writer(
    `Usage: open-arch remove-relationship <from> <to> [--index <n>]
`,
    { index: s },
  ),
  "add-view": writer(
    `Usage: open-arch add-view <id> --level <landscape|context|container|component|class|sequence|state|deployment|event|wireframe|whiteboard|flowchart|entity> [options]

A class view shows a component's or library's classes, with their members, as a UML class
diagram.
A sequence view shows steps between elements, in order: add them with add-step. It takes no
scope, include or exclude.
A state view shows the states something can be in, and the transitions between them: add
them with add-state and add-transition. Its scope, if any, is the element whose states they
are, of any kind. It takes no include or exclude.
A deployment view shows where containers and systems run, such as one environment like
Production: add its nodes with add-node, each listing what it runs. Arrows between the
containers come from the model's relationships; add-connection adds arrows to or from nodes.
It takes no scope, include or exclude.
An event view shows what happens in a business process, as event storming does: commands,
events and the other notes, as cards in order along a timeline, in swimlanes. Add its lanes
with add-lane and its cards with add-card. It takes no scope, include or exclude.
A wireframe view sketches an app's screens: what's on each, and which screen a button or link
on one leads to. Add its screens with add-screen and what's on them with add-widget. Its
scope, if any, is the system or container whose screens they are. It takes no include or
exclude.
A whiteboard view is a freehand sketch, to share an idea: shapes, text, arrows and lines drawn
with a pen, each where it's put, none of them part of the model. Add its shapes with add-shape
and its arrows with add-arrow. It takes no scope, include or exclude.
A flowchart view shows the steps of a process: where it starts and ends, what's done, the
decisions on the way, and the arrows from one to the next. Add its blocks with add-block and
the flows between them with add-flow, and with add-lane, a lane, a column for the blocks of
one actor, team or system, which can be for an element of the model. Its scope, if any, is the element of any kind whose
process it is. It takes no include or exclude.
An entity view shows the data something keeps, as an entity-relationship diagram (ERD): its
entities, like a database's tables, each with its attributes, and the links between them,
with how many of each end there can be. Add its entities with add-entity, their attributes
with add-attribute and the links with add-link. Its scope, if any, is the system, container,
component or library whose data it is, like a database. It takes no include or exclude.
  --scope <id>           A system for context and container views, a container or library
                         for component views, a component or library for class views, for
                         state views, if any, the element of any kind they're the states of,
                         for wireframe views, if any, the system or container whose screens
                         they are, for flowchart views, if any, the element of any kind whose
                         process they show, and for entity views, if any, the system,
                         container, component or library whose data they show
  --title <title>        Default: from the scope and level, or for a sequence, deployment,
                         event or whiteboard view, or a state, wireframe, flowchart or
                         entity view without a scope, from the id
  --description <text>   One sentence, shown under the title
  --include <a,b>        What to show (default: *, the scope's contents and what they connect to)
  --exclude <a,b>        What to hide
  --notes <markdown>     Longer documentation (or --notes-file <path>, - for stdin)
`,
    { level: s, scope: s, title: s, description: s, include: s, exclude: s, notes: s, "notes-file": s },
  ),
  "update-view": writer(
    `Usage: open-arch update-view <id> [--title <title>] [--description <text>] [--scope <id>]
                            [--include <a,b>] [--exclude <a,b>] [--new-elements <show|hide>]
                            [--notes <markdown>]

--scope links a state, wireframe, flowchart or entity view to another element: the one
whose states, screens, process or data it shows (see add-view). What's on the view stays
as it is. An empty value links it to nothing in particular. Other views' scope is what
they draw, so it can't change: add a new view instead.
--new-elements says whether elements added to the model later appear in this view.
show puts * back in include, so they appear on their own. hide lists the view's boxes in
include, so it shows only those until you add more with show-in-view. Either way, the view
keeps the boxes it shows now.
--notes takes markdown, or use --notes-file <path> (- for stdin).
An empty value removes a field.
`,
    { title: s, description: s, scope: s, include: s, exclude: s, "new-elements": s, notes: s, "notes-file": s },
  ),
  "remove-view": writer(`Usage: open-arch remove-view <id>\n`, {}),
  "show-in-view": writer(`Usage: open-arch show-in-view <view> <id>...\n\nShows elements in a view, removing them from its exclude list or adding them to include.\n`, {}),
  "hide-in-view": writer(`Usage: open-arch hide-in-view <view> <id>...\n\nHides elements from a view, without removing them from the model.\n`, {}),
  "add-sticky": writer(
    `Usage: open-arch add-sticky <view> <id> --text <text>
                            [--element <id> | --from <id> --to <id> [--kind <kind>] | --block <id>]
                            [--color <yellow|pink|blue|green>] [--at <x,y>] [--notes <markdown>]

Adds a sticky note to a view: text for people reading the diagram, such as what to notice or
why it's drawn this way. It isn't part of the model. The id must be unique within the view.
On a landscape, context, container, component or class view, a note can be on an element or
a relationship: the designer draws a line from the note to the box or arrow that shows it.
On a flowchart view, a note can be on a block, with a line to it.
  --element <id>         The element it's on
  --from <id> --to <id>  The relationship it's on: <from> uses <to>, as add-relationship says
  --kind <kind>          That relationship's kind, when it isn't an association
  --block <id>           The block it's on, on a flowchart view
  --at <x,y>             Top-left corner (default: the designer puts it beside what it's on,
                         or else beside the diagram)
  --notes <markdown>     More than the note should say: the designer opens them from the note,
                         and the docs show them after its text (or --notes-file <path>, - for stdin)
`,
    { text: s, element: s, from: s, to: s, kind: s, block: s, color: s, at: s, notes: s, "notes-file": s },
  ),
  "update-sticky": writer(
    `Usage: open-arch update-sticky <view> <id> [--text <text>]
                               [--element <id> | --from <id> --to <id> [--kind <kind>] | --block <id> | --detach]
                               [--color <yellow|pink|blue|green>] [--at <x,y>] [--notes <markdown>]

--element, or --from and --to, put the note on an element or a relationship, and --block on
a flowchart view's block (see add-sticky). --detach takes it off.
--at "" lets the designer place it again.
--notes takes markdown, or use --notes-file <path> (- for stdin), and --notes "" removes them.
`,
    { text: s, element: s, from: s, to: s, kind: s, block: s, detach: b, color: s, at: s, notes: s, "notes-file": s },
  ),
  "remove-sticky": writer(`Usage: open-arch remove-sticky <view> <id>\n`, {}),
  "add-step": writer(
    `Usage: open-arch add-step <view> <from> <to> [--description <text>] [--technology <text>] [--reply] [--step <n>]

Adds a step to a sequence view: <from> calls <to>. The model needs a relationship from <from>,
or something inside it, to <to>, or something inside it.
  --description <text>   What's sent, e.g. "Submits the order" (default: the relationship's)
  --technology <text>    e.g. JSON/HTTPS (default: the relationship's)
  --reply                <from> answers an earlier call from <to>, drawn as a dashed arrow. It
                         goes back along a relationship from <to> to <from>
  --step <n>             Its number: 1 is the first (default: after the last)
`,
    { description: s, technology: s, reply: b, step: s },
  ),
  "update-step": writer(
    `Usage: open-arch update-step <view> <n> [--from <id>] [--to <id>] [--description <text>] [--technology <text>]
                            [--reply | --call] [--move-to <n>]

<n> is the step's number, as show prints it: 1 is the first.
  --reply, --call        Make it an answer to an earlier call, or a call
  --move-to <n>          Give it another number; the steps between move up or down one
An empty value removes a field.
`,
    { from: s, to: s, description: s, technology: s, reply: b, call: b, "move-to": s },
  ),
  "remove-step": writer(`Usage: open-arch remove-step <view> <n>\n\nRemoves a sequence view's step <n>; the steps after it move up one.\n`, {}),
  "add-state": writer(
    `Usage: open-arch add-state <view> <id> [--name <name>] [--description <text>] [--initial] [--final] [--at <x,y>]

Adds a state to a state view, like "paid". The id must be unique within the view.
  --name <name>          Display name (default: from the id)
  --description <text>   One sentence, shown in the state
  --initial              It's the state the view starts in (another one stops being it)
  --final                The state machine can end in this state
  --at <x,y>             Top-left corner (default: the designer lays it out)
`,
    { name: s, description: s, initial: b, final: b, at: s },
  ),
  "update-state": writer(
    `Usage: open-arch update-state <view> <id> [--name <name>] [--new-id <id>] [--description <text>]
                             [--initial | --not-initial] [--final | --not-final] [--at <x,y>]

--new-id changes its ID, and its transitions follow it.
--at "" lets the designer lay it out again.
An empty value removes a field.
`,
    { name: s, "new-id": s, description: s, initial: b, "not-initial": b, final: b, "not-final": b, at: s },
  ),
  "remove-state": writer(`Usage: open-arch remove-state <view> <id>\n\nRemoves a state, and the transitions to and from it.\n`, {}),
  "add-transition": writer(
    `Usage: open-arch add-transition <view> <from> <to> [--event <text>] [--guard <text>] [--action <text>] [--transition <n>]

Adds a transition from one state of a state view to another, or back to the same one. It's
labelled as UML writes it: event [guard] / action.
  --event <text>         What makes it happen, e.g. "Payment taken"
  --guard <text>         What has to be true for it to happen, e.g. "paid in full"
  --action <text>        What's done as it happens, e.g. "Send a receipt"
  --transition <n>       Its number: 1 is the first (default: after the last)
`,
    { event: s, guard: s, action: s, transition: s },
  ),
  "update-transition": writer(
    `Usage: open-arch update-transition <view> <n> [--from <id>] [--to <id>] [--event <text>] [--guard <text>]
                                  [--action <text>] [--move-to <n>]

<n> is the transition's number, as show prints it: 1 is the first.
  --move-to <n>          Give it another number; the ones between move up or down one
An empty value removes a field.
`,
    { from: s, to: s, event: s, guard: s, action: s, "move-to": s },
  ),
  "remove-transition": writer(`Usage: open-arch remove-transition <view> <n>\n\nRemoves transition <n>; the ones after it move up one.\n`, {}),
  "add-node": writer(
    `Usage: open-arch add-node <view> <id> [--name <name>] [--parent <node>] [--technology <text>] [--run <id>]...
                         [--infrastructure] [--instances <n>] [--shape <shape>] [--description <text>]

Adds a node to a deployment view: something things run on or in, like a server, a Kubernetes
cluster or a cloud region. The id must be unique within the view.
  --name <name>          Display name (default: from the id)
  --parent <node>        The node of the view it's inside (default: none, at the top)
  --technology <text>    What it is, e.g. "Ubuntu 24.04" or "Amazon ECS"
  --run <id>             A container or system that runs in it; repeat for each
  --infrastructure       It's infrastructure, like a load balancer, DNS or a firewall: it runs
                         nothing and holds no nodes, and connections join it to what it serves
  --instances <n>        How many copies of it run, with everything inside (default: 1)
  --shape <shape>        box (default), database, queue, folder, document, web-browser,
                         mobile-app, desktop-app, terminal, server, email, scheduled-job
  --description <text>   One sentence, shown in the node
`,
    { name: s, parent: s, description: s, technology: s, run: many, infrastructure: b, instances: s, shape: s },
  ),
  "update-node": writer(
    `Usage: open-arch update-node <view> <id> [--name <name>] [--new-id <id>] [--parent <node>] [--technology <text>]
                            [--run <id>]... [--infrastructure | --deployment-node] [--instances <n>]
                            [--shape <shape>] [--description <text>]

--run replaces what the node runs: repeat it for each, and --run "" runs nothing. A connection
to something it no longer runs goes too.
--new-id changes its ID, and the nodes inside it and its connections follow it.
--parent "" puts it at the top, and --instances "" back to 1.
An empty value removes a field.
`,
    { name: s, "new-id": s, parent: s, description: s, technology: s, run: many, infrastructure: b, "deployment-node": b, instances: s, shape: s },
  ),
  "remove-node": writer(`Usage: open-arch remove-node <view> <id>\n\nRemoves a node, the nodes inside it, and the connections to them and to what only they ran.\n`, {}),
  "add-connection": writer(
    `Usage: open-arch add-connection <view> <from> <to> [--description <text>] [--technology <text>] [--connection <n>]

Adds an arrow to a deployment view, like a load balancer forwarding to the web app. Each end
is a node of the view, or a container or system one of its nodes runs, and at least one is a
node: arrows between two containers come from the model's relationships.
  --description <text>   What it does, e.g. "Forwards requests to"
  --technology <text>    e.g. HTTPS
  --connection <n>       Its number: 1 is the first (default: after the last)
`,
    { description: s, technology: s, connection: s },
  ),
  "update-connection": writer(
    `Usage: open-arch update-connection <view> <n> [--from <id>] [--to <id>] [--description <text>] [--technology <text>]
                                  [--move-to <n>]

<n> is the connection's number, as show prints it: 1 is the first.
  --move-to <n>          Give it another number; the ones between move up or down one
An empty value removes a field.
`,
    { from: s, to: s, description: s, technology: s, "move-to": s },
  ),
  "remove-connection": writer(`Usage: open-arch remove-connection <view> <n>\n\nRemoves connection <n>; the ones after it move up one.\n`, {}),
  "add-lane": writer(
    `Usage: open-arch add-lane <view> <id> [--name <name>] [--description <text>] [--element <id>] [--position <n>]

Adds a swimlane for one actor, team or system, like "Customer" or "Orders": to an event view,
a row for its cards, and to a flowchart, a column for its blocks. The id must be unique among
the view's lanes.
  --name <name>          Display name (default: the element's name, or from the id)
  --description <text>   One sentence about the lane
  --element <id>         Flowcharts only: the element of the model the lane is for, like the
                         container or person that does its steps. The element's page in the
                         docs lists the flowchart
  --position <n>         Its place: from the top on an event view, and from the left on a
                         flowchart. 1 is the first (default: after the last)
In a flowchart with lanes, a block's x is from the inside of its lane's left, and 0 or more,
so a flowchart's first lane moves its placed blocks right together, if need be, so none has an
x less than 0.
`,
    { name: s, description: s, element: s, position: s },
  ),
  "update-lane": writer(
    `Usage: open-arch update-lane <view> <id> [--name <name>] [--new-id <id>] [--description <text>] [--element <id>] [--position <n>]

--new-id changes its ID, and its cards or blocks follow it.
--element makes a flowchart's lane for an element of the model, and --element "" takes it off
the element. Its name stays as it is.
--position moves it: 1 is the top lane, or on a flowchart the leftmost, and the lanes between
move one place.
An empty value removes a field.
`,
    { name: s, "new-id": s, description: s, element: s, position: s },
  ),
  "remove-lane": writer(
    `Usage: open-arch remove-lane <view> <id>\n\nRemoves a lane. Its cards, or its blocks, stay, in no lane: move them with update-card --lane or update-block --lane. Its blocks are laid out again, as their --at was from its left.\n`,
    {},
  ),
  "add-card": writer(
    `Usage: open-arch add-card <view> <id> [--kind <kind>] [--name <name>] [--lane <lane>] [--from <card>]...
                         [--description <text>] [--position <n>]

Adds a card to an event view: a command, an event or another of event storming's notes.
Cards are drawn left to right in order, each in its lane. The id must be unique among the
view's cards.
  --kind <kind>          event (the default): something that happened, like "Order placed"
                         command: a decision or request to do something, like "Place order"
                         actor: the person who gives a command
                         policy: a rule that reacts to an event, "whenever this, then that"
                         read-model: what someone looks at to decide, like a list of orders
                         external-system: a system outside, that sends events or takes commands
                         aggregate: the thing a command changes, like an order
                         hotspot: a question or problem to come back to
  --name <name>          Display name (default: from the id)
  --lane <lane>          The lane it's in (default: none, in a row above the lanes)
  --from <card>          A card that leads to it, like the command an event comes from,
                         drawn as an arrow to it; repeat for each
  --description <text>   One sentence, shown on the card
  --position <n>         Its place along the timeline: 1 is the first (default: after the last)
`,
    { kind: s, name: s, lane: s, from: many, description: s, position: s },
  ),
  "update-card": writer(
    `Usage: open-arch update-card <view> <id> [--kind <kind>] [--name <name>] [--new-id <id>] [--lane <lane>]
                            [--from <card>]... [--description <text>] [--position <n>]

--kind is event, command, actor, policy, read-model, external-system, aggregate or hotspot.
--from replaces the cards it comes from: repeat it for each, and --from "" removes them all.
--new-id changes its ID, and the cards that come from it follow it.
--lane "" takes it out of its lane.
--position moves it along the timeline: 1 is the first, and the cards between move one place.
An empty value removes a field.
`,
    { kind: s, name: s, "new-id": s, lane: s, from: many, description: s, position: s },
  ),
  "remove-card": writer(`Usage: open-arch remove-card <view> <id>\n\nRemoves a card, and the arrows to and from it.\n`, {}),
  "add-screen": writer(
    `Usage: open-arch add-screen <view> <id> [--name <name>] [--device <device>] [--description <text>] [--position <n>]

Adds a screen to a wireframe view: a page of a website, or of an app, like "Cart". Screens are
drawn left to right in order. The id must be unique among the view's screens.
  --name <name>          Display name (default: from the id)
  --device <device>      desktop (the default), tablet or phone: how wide it's drawn
  --description <text>   One sentence about the screen
  --position <n>         Its place, left to right: 1 is the first (default: after the last)
`,
    { name: s, device: s, description: s, position: s },
  ),
  "update-screen": writer(
    `Usage: open-arch update-screen <view> <id> [--name <name>] [--new-id <id>] [--device <device>]
                              [--description <text>] [--position <n>]

--device is desktop, tablet or phone.
--new-id changes its ID, and the widgets that lead to it follow it.
--position moves it: 1 is the first, and the screens between move one place.
An empty value removes a field: --device "" makes it a desktop screen again.
`,
    { name: s, "new-id": s, device: s, description: s, position: s },
  ),
  "remove-screen": writer(`Usage: open-arch remove-screen <view> <id>\n\nRemoves a screen, with the widgets on it. The widgets on other screens that led to it lead nowhere.\n`, {}),
  "add-widget": writer(
    `Usage: open-arch add-widget <view> <id> --kind <kind> (--screen <screen> | --in <widget>) [--text <text>]
                           [--to <screen>] [--description <text>] [--position <n>]

Adds a widget to a screen of a wireframe view, or to a row or a panel on one: what's on the
screen, top to bottom. The id must be unique among all the view's widgets, on every screen.
  --kind <kind>          heading: a title, in large type
                         text: a paragraph
                         button, link: their text is what they say
                         input: a box to type in, with its text as its label
                         checkbox: a box to tick, with its text beside it
                         select: a drop-down list, with its text as its label
                         image: where a picture goes, with its text saying what it shows
                         list: an item for each line of its text
                         table: a row for each line of its text, with the cells split by |;
                         the first row is its headings
                         tabs: a tab for each line of its text; the first is the open one
                         divider: a line across, with its text in the middle, if any
                         panel: a box that holds widgets, top to bottom, with its text as its
                         title
                         row: holds widgets side by side, with its text above them, if any
  --screen <screen>      The screen it goes on
  --in <widget>          The row or panel it goes in, instead
  --text <text>          What it says. A list's items, a table's rows and tabs go on lines of
                         their own, like --text $'Pizza\\nPasta' in bash
  --to <screen>          The screen it leads to, like the one a button opens, drawn as an
                         arrow to it
  --description <text>   One sentence on what it does, shown when you point at it
  --position <n>         Its place among the widgets where it goes: 1 is the first (default:
                         after the last)
`,
    { kind: s, screen: s, in: s, text: s, to: s, description: s, position: s },
  ),
  "update-widget": writer(
    `Usage: open-arch update-widget <view> <id> [--kind <kind>] [--text <text>] [--to <screen>] [--new-id <id>]
                              [--screen <screen>] [--in <widget>] [--description <text>] [--position <n>]

--kind is heading, text, button, link, input, checkbox, select, image, list, table, tabs,
divider, panel or row. A row or panel with widgets in it can only be a row or a panel.
--screen moves it onto that screen, out of any row or panel. --in moves it into a row or a
panel, and --in "" out of one, onto its screen.
--position moves it among the widgets where it is, or where it goes: 1 is the first.
--to "" makes it lead nowhere.
An empty value removes a field.
`,
    { kind: s, text: s, to: s, "new-id": s, screen: s, in: s, description: s, position: s },
  ),
  "remove-widget": writer(`Usage: open-arch remove-widget <view> <id>\n\nRemoves a widget, with the widgets inside it.\n`, {}),
  "add-shape": writer(
    `Usage: open-arch add-shape <view> <id> --kind <kind> [--text <text>] [--at <x,y[,width,height]>]
                          [--points <x,y x,y ...>] [--size <size>] [--color <color>] [--fill <fill>]
                          [--dashed] [--position <n>]

Adds a shape to a whiteboard view. Each shape is drawn where it's put, over the shapes added
before it. The id must be unique among the view's shapes.
  --kind <kind>          rectangle, ellipse or diamond: an outline, with its text inside
                         text: just its text, with no outline
                         pen: a line drawn freehand, through its --points
  --text <text>          What it says. Lines of their own, like --text $'Cache\\nthe menus'
                         in bash. Text needs it; a pen takes none
  --at <x,y>             Its top-left corner (default: under the shapes there are). Add its
                         width and height, --at x,y,width,height, to size it: without them, a
                         rectangle, ellipse or diamond is 160 by 80, and text is as big as
                         what it says. A pen's size comes from its points
  --points <x,y ...>     A pen's points, from its corner, split by spaces: --points "0,0 12,6 30,2"
  --size <size>          How big its text is: small, medium (the default), large or huge
  --color <color>        Its outline's and text's colour, or a pen's: black (the default),
                         grey, red, orange, green, blue or purple
  --fill <fill>          What it's filled with: white, grey, red, orange, yellow, green, blue
                         or purple (default: none, so it's see-through). Not on a pen
  --dashed               A dashed outline, or a dashed pen line. Not on text
  --position <n>         Its place from the back: 1 is drawn first, under the rest (default:
                         in front of the rest)
`,
    { kind: s, text: s, at: s, points: s, size: s, color: s, fill: s, dashed: b, position: s },
  ),
  "update-shape": writer(
    `Usage: open-arch update-shape <view> <id> [--kind <kind>] [--text <text>] [--new-id <id>] [--at <x,y[,width,height]>]
                             [--points <x,y x,y ...>] [--size <size>] [--color <color>] [--fill <fill>]
                             [--dashed | --solid] [--position <n>]

--kind is rectangle, ellipse, diamond or text; a pen's line stays a pen's line, and text
needs text: --text "" on it is refused, so remove it with remove-shape instead.
--at x,y moves it and keeps its size; --at x,y,width,height moves it and gives it that size.
--new-id changes its ID, and the arrows to and from it follow it.
--position moves it to that place from the back: 1 is drawn first, under the rest.
An empty value removes a field: --fill "" makes it see-through, and --size "" and --color ""
put them back to medium and black.
`,
    { kind: s, text: s, "new-id": s, at: s, points: s, size: s, color: s, fill: s, dashed: b, solid: b, position: s },
  ),
  "remove-shape": writer(`Usage: open-arch remove-shape <view> <id>\n\nRemoves a shape, and the arrows to and from it.\n`, {}),
  "add-arrow": writer(
    `Usage: open-arch add-arrow <view> <id> --from <shape | x,y> --to <shape | x,y> [--from-side <side>]
                          [--to-side <side>] [--text <text>] [--heads <heads>] [--color <color>] [--dashed]

Adds an arrow, or a line, to a whiteboard view. Each end is a shape, which the arrow is drawn
to the edge of and follows as it moves, or a point on the whiteboard. The id must be unique
among the view's arrows.
  --from, --to           A shape's ID, or a point, x,y
  --from-side <side>     The side of its shape the start stays on, wherever the other end is:
  --to-side <side>       top, right, bottom or left, the middle of that edge, as a diamond's
                         tips are, for a decision's yes and no. Without one, the end faces the
                         other end, and moves round the shape's edge as they move
  --text <text>          What it says, drawn in the middle of it
  --heads <heads>        end (the default): an arrow; both: an arrow both ways; none: a line
  --color <color>        black (the default), grey, red, orange, green, blue or purple
  --dashed               A dashed line
`,
    { from: s, to: s, "from-side": s, "to-side": s, text: s, heads: s, color: s, dashed: b },
  ),
  "update-arrow": writer(
    `Usage: open-arch update-arrow <view> <id> [--from <shape | x,y>] [--to <shape | x,y>] [--from-side <side>]
                             [--to-side <side>] [--text <text>] [--new-id <id>] [--heads <heads>]
                             [--color <color>] [--dashed | --solid]

--from and --to move an end. On another shape, it faces the other end, unless --from-side or
--to-side says the side of it the end stays on: top, right, bottom or left. Naming the shape it's
on already keeps its side. --from-side or --to-side alone puts the end on that side of the shape
it's on, and --from-side "" or --to-side "" lets it face the other end again.
--heads is end, both or none.
An empty value removes a field: --heads "" and --color "" put them back to end and black.
`,
    { from: s, to: s, "from-side": s, "to-side": s, text: s, "new-id": s, heads: s, color: s, dashed: b, solid: b },
  ),
  "remove-arrow": writer(`Usage: open-arch remove-arrow <view> <id>\n`, {}),
  "add-block": writer(
    `Usage: open-arch add-block <view> <id> [--kind <kind>] [--text <text>] [--description <text>] [--lane <lane>]
                          [--at <x,y>] [--position <n>]

Adds a block to a flowchart view, like "pack-order". The id must be unique among the view's
blocks.
  --kind <kind>          start or end: where the process starts, or where it ends
                         process (the default): a step, something that's done
                         decision: a question with more than one way on, like "In stock?"
                         input-output: something that comes in or goes out
                         subprocess: a process drawn in full somewhere else
                         document: a document or report that's made or read
                         database: data that's kept
  --text <text>          What it says (default: from the id). Lines of their own, like
                         --text $'Pack\\nthe order' in bash
  --description <text>   One sentence, shown under its text
  --lane <lane>          The lane it's in, a column of the flowchart: add it first with add-lane
  --at <x,y>             Top-left corner (default: the designer lays it out). In a flowchart
                         with lanes, x is from the inside of its lane's left, and 0 or more
  --position <n>         Its place in the view's list of blocks: 1 is the first (default: last)
`,
    { kind: s, text: s, description: s, lane: s, at: s, position: s },
  ),
  "update-block": writer(
    `Usage: open-arch update-block <view> <id> [--kind <kind>] [--text <text>] [--new-id <id>] [--description <text>]
                             [--lane <lane>] [--at <x,y>] [--position <n>]

--kind is start, end, process, decision, input-output, subprocess, document or database.
--lane moves it into a lane, and --lane "" out of its lane.
--new-id changes its ID, and the flows to and from it, and the sticky notes on it, follow it.
--at x,y moves it. In a flowchart with lanes, x is from the inside of its lane's left, and 0 or
more. --at "" lets the designer lay it out again.
--position moves it to that place in the view's list of blocks: 1 is the first.
An empty value removes a field: --kind "" makes it a process. A block needs text, so
--text "" is refused.
`,
    { kind: s, text: s, "new-id": s, description: s, lane: s, at: s, position: s },
  ),
  "remove-block": writer(`Usage: open-arch remove-block <view> <id>\n\nRemoves a block, and the flows to and from it. A sticky note on it stays on the view, on nothing.\n`, {}),
  "add-flow": writer(
    `Usage: open-arch add-flow <view> <from> <to> [--text <text>] [--flow <n>]

Adds a flow, an arrow from one block of a flowchart view to another.
  --text <text>          What it says, like "Yes" or "No" on the ways out of a decision
  --flow <n>             Its number: 1 is the first (default: after the last)
`,
    { text: s, flow: s },
  ),
  "update-flow": writer(
    `Usage: open-arch update-flow <view> <n> [--from <id>] [--to <id>] [--text <text>] [--move-to <n>]

<n> is the flow's number, as show prints it: 1 is the first.
  --move-to <n>          Give it another number; the ones between move up or down one
An empty value removes a field.
`,
    { from: s, to: s, text: s, "move-to": s },
  ),
  "remove-flow": writer(`Usage: open-arch remove-flow <view> <n>\n\nRemoves flow <n>; the ones after it move up one.\n`, {}),
  "add-entity": writer(
    `Usage: open-arch add-entity <view> <id> [--name <name>] [--description <text>] [--at <x,y>] [--position <n>]

Adds an entity to an entity view, like "order": a thing whose data is kept, like a database's
table. The id must be unique among the view's entities. Add what's kept about it with
add-attribute.
  --name <name>          Default: from the id
  --description <text>   One sentence, shown under its name
  --at <x,y>             Top-left corner (default: the designer lays it out)
  --position <n>         Its place in the view's list of entities: 1 is the first (default: last)
`,
    { name: s, description: s, at: s, position: s },
  ),
  "update-entity": writer(
    `Usage: open-arch update-entity <view> <id> [--name <name>] [--new-id <id>] [--description <text>] [--at <x,y>]
                              [--position <n>]

--new-id changes its ID, and the links to and from it follow it.
--at "" lets the designer lay it out again.
--position moves it to that place in the view's list of entities: 1 is the first.
An empty value removes a field. An entity needs a name, so --name "" is refused.
`,
    { name: s, "new-id": s, description: s, at: s, position: s },
  ),
  "remove-entity": writer(`Usage: open-arch remove-entity <view> <id>\n\nRemoves an entity, with its attributes, and the links to and from it.\n`, {}),
  "add-attribute": writer(
    `Usage: open-arch add-attribute <view> <entity> <name> [--type <type>] [--key <pk,fk,uk>] [--description <text>]
                              [--position <n>]

Adds an attribute to an entity of an entity view: something kept about it, like a table's
column, such as "email". Its name must be unique among the entity's attributes.
  --type <type>          What it holds, like uuid, text or decimal(10,2)
  --key <pk,fk,uk>       The keys it's part of: pk, its primary key, or part of it; fk, a
                         foreign key, which names one of another entity; uk, unique, so no
                         two of the entity have the same
  --description <text>   One sentence, shown in the docs
  --position <n>         Its place among the entity's attributes: 1 is the first (default: last)
`,
    { type: s, key: s, description: s, position: s },
  ),
  "update-attribute": writer(
    `Usage: open-arch update-attribute <view> <entity> <name> [--new-name <name>] [--type <type>] [--key <pk,fk,uk>]
                                 [--description <text>] [--position <n>]

<name> is the attribute's name now. --key replaces its keys: pk, fk or uk, or several, like
--key pk,fk.
--position moves it to that place among the entity's attributes: 1 is the first.
An empty value removes a field: --key "" leaves it no key. An attribute needs a name, so
--new-name "" is refused.
`,
    { "new-name": s, type: s, key: s, description: s, position: s },
  ),
  "remove-attribute": writer(`Usage: open-arch remove-attribute <view> <entity> <name>\n`, {}),
  "add-link": writer(
    `Usage: open-arch add-link <view> <from> <to> [--cardinality <from's,to's>] [--text <text>] [--link <n>]

Adds a link between two entities of an entity view, or from one to itself: a relationship,
in an ERD's terms, like a customer placing orders.
  --cardinality <a,b>    How many of each end there can be: of <from> for each <to>, then of
                         <to> for each <from>, each one (exactly one), zero-or-one,
                         one-or-more or zero-or-more. Drawn in crow's foot notation, each at
                         its end (default: one,zero-or-more, like one customer to their orders)
  --text <text>          What it says, like "places"
  --link <n>             Its number: 1 is the first (default: after the last)
`,
    { cardinality: s, text: s, link: s },
  ),
  "update-link": writer(
    `Usage: open-arch update-link <view> <n> [--from <id>] [--to <id>] [--cardinality <from's,to's>] [--text <text>]
                            [--move-to <n>]

<n> is the link's number, as show prints it: 1 is the first.
  --cardinality <a,b>    How many of each end there can be, as add-link takes it; ""
                         puts it back to one,zero-or-more
  --move-to <n>          Give it another number; the ones between move up or down one
An empty value removes a field.
`,
    { from: s, to: s, cardinality: s, text: s, "move-to": s },
  ),
  "remove-link": writer(`Usage: open-arch remove-link <view> <n>\n\nRemoves link <n>; the ones after it move up one.\n`, {}),
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
  add-step <view> <from> <to>     update-step <view> <n>          remove-step <view> <n>
  add-state <view> <id>           update-state <view> <id>        remove-state <view> <id>
  add-transition <view> <from> <to>   update-transition <view> <n>   remove-transition <view> <n>
  add-node <view> <id>            update-node <view> <id>         remove-node <view> <id>
  add-connection <view> <from> <to>   update-connection <view> <n>   remove-connection <view> <n>
  add-lane <view> <id>            update-lane <view> <id>         remove-lane <view> <id>
  add-card <view> <id>            update-card <view> <id>         remove-card <view> <id>
  add-screen <view> <id>          update-screen <view> <id>       remove-screen <view> <id>
  add-widget <view> <id>          update-widget <view> <id>       remove-widget <view> <id>
  add-shape <view> <id>           update-shape <view> <id>        remove-shape <view> <id>
  add-arrow <view> <id>           update-arrow <view> <id>        remove-arrow <view> <id>
  add-block <view> <id>           update-block <view> <id>        remove-block <view> <id>
  add-flow <view> <from> <to>     update-flow <view> <n>          remove-flow <view> <n>
  add-entity <view> <id>          update-entity <view> <id>       remove-entity <view> <id>
  add-attribute <view> <entity> <name>    update-attribute <view> <entity> <name>
  remove-attribute <view> <entity> <name>
  add-link <view> <from> <to>     update-link <view> <n>          remove-link <view> <n>
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
