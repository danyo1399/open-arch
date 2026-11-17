# open-arch commands

Every command takes `--file <path>` to name the `.openarch` file; without it, the CLI uses the one in the current folder or the nearest folder above, or the only one in the folders below it, up to two levels down.

Commands that change the model also take:

| Option | Effect |
|---|---|
| `--dry-run` | Check the change and print what it would do, without saving |
| `--json` | Print the result as JSON: `{ "ok", "saved", "changes", "warnings", "docs" }`, or `{ "ok": false, "error", "diagnostics" }` |
| `--no-export` | Don't refresh the docs folder after saving |

Exit codes: 0 = done, 1 = refused or failed (nothing saved), 2 = the command was used wrongly.

## Reading

| Command | Prints |
|---|---|
| `open-arch show` | The model as a tree, and the views |
| `open-arch show <element-id>` | The element's fields, tags, notes, a class's stereotype and members, a container's libraries, the containers a library is built into, what it uses, what uses it (directly and through what's inside it), with those relationships' notes, and the views showing it |
| `open-arch show <view-id>` | The view's description and notes, its boxes, and its arrows with the relationships each stands for, and on a class view, each arrow's kind. For a sequence view: the elements in it, and its steps in order, with the relationships each goes along. For a state view: its states, with where it starts and can end, and its transitions in order. For a deployment view: its nodes, nested, with what each runs, its connections in order, and the arrows it draws between the copies of what runs where. For an event view: its lanes from the top down, and its cards in order, each with its kind, its lane and the cards it comes from. For a wireframe view: its screens in order, each with its device and the widgets on it, top to bottom, those in a row or panel under it, each with its kind, its text and the screen it leads to. For a whiteboard view: its shapes from the back to the front, each with its kind, where it is, its text and how it looks, and its arrows, each with its ends. For a flowchart view: its blocks in order, each with its kind, its text, its description and where it is, and its flows in order, each with its ends and its text |
| `open-arch check [--json] [--strict]` | Problems in the model; exits 1 on errors (or warnings, with `--strict`) |
| `open-arch export [folder] [--check]` | Writes the docs to the folder, or to the workspace's docs folder; `--check` exits 1 if they're out of date |

All of these accept `--json`.

## Changing

In `update-*` commands, only the options given change, and an empty value (`--technology ""`) removes a field. Lists like `--include a,b` are comma-separated and replace the old list.

Tags are names with values. `--tag owner=payments` sets one, and `--tag pii` sets one without a value; repeat `--tag` for more. In updates, `--tag` adds a tag or changes its value, leaving the others alone, and `--remove-tag <name>` (repeatable) removes one. Unlike other fields, an empty value doesn't remove a tag: `--tag owner=` leaves `owner` as a tag without a value.

| Command | Options |
|---|---|
| `add-element <id>` | `--kind <person\|system\|container\|component\|library\|class>` (required), `--parent <id>`, `--name`, `--description`, `--technology`, `--external`, `--shape <box\|database\|queue\|folder\|document\|web-browser\|mobile-app\|desktop-app\|terminal\|server\|email\|scheduled-job>`, `--stereotype <text>` and `--member <text>` (classes only; repeat `--member` for each attribute or method), `--library <id>` (containers only: a library built into it; repeat for more), `--tag <name[=value]>`, `--notes <markdown>` or `--notes-file <path\|->` |
| `update-element <id>` | `--name`, `--parent`, `--description`, `--technology`, `--external` / `--internal`, `--shape` (`--shape ""` makes it a box again), `--stereotype`, `--member` (replaces all of a class's members; `--member ""` removes them), `--library` (replaces a container's libraries; `--library ""` removes them), `--tag <name[=value]>`, `--remove-tag <name>`, `--notes`, `--notes-file` |
| `remove-element <id>` | Also removes what's inside it, views scoped to them, and every reference |
| `rename <old-id> <new-id>` | Works for elements and views; updates every reference |
| `add-relationship <from> <to>` | `--description`, `--technology`, `--tag <name[=value]>`, `--kind <association\|dependency\|inheritance\|realization\|composition\|aggregation>` (between two classes; default: association), `--bidirectional` (associations only: `<to>` uses `<from>` too), `--notes <markdown>` or `--notes-file <path\|->` |
| `update-relationship <from> <to>` | `--index <n>`, `--new-from <id>` / `--new-to <id>` (move an end to another element; it keeps its description, technology, tags and notes), `--kind` (`--kind ""` makes it an association again), `--bidirectional` / `--one-way`, `--description`, `--technology`, `--tag <name[=value]>`, `--remove-tag <name>`, `--notes`, `--notes-file` |
| `remove-relationship <from> <to>` | `--index <n>` |
| `add-view <id>` | `--level <landscape\|context\|container\|component\|class\|sequence\|state\|deployment\|event\|wireframe\|whiteboard\|flowchart>` (required), `--scope <id>` (a container or library for a component view, a component or library for a class view, for a state view, optionally, the element of any kind whose states it shows, for a wireframe view, optionally, the system or container whose screens it shows, and for a flowchart view, optionally, the element of any kind whose process it shows), `--title`, `--description`, `--include <a,b>`, `--exclude <a,b>`, `--notes <markdown>` or `--notes-file <path\|->`. Sequence, deployment, event and whiteboard views take no scope, include or exclude, and state, wireframe and flowchart views no include or exclude |
| `update-view <id>` | `--title`, `--description`, `--include`, `--exclude`, `--new-elements <show\|hide>`, `--notes`, `--notes-file`. `--new-elements hide` lists the view's boxes in include, so elements added later stay out; `show` puts `*` back, excluding what it would add. Either keeps the boxes the view has now |
| `remove-view <id>` | |
| `show-in-view <view> <id>...` | Removes them from the view's exclude list, or adds them to include |
| `hide-in-view <view> <id>...` | Removes them from include, or adds them to exclude; the model is unchanged |
| `add-sticky <view> <id>` | `--text` (required), `--element <id>` or `--from <id> --to <id>` (`--kind <kind>` when that relationship isn't an association): what it's on, on a landscape, context, container, component or class view; `--color <yellow\|pink\|blue\|green>`, `--at <x,y>` |
| `update-sticky <view> <id>` | `--text`, `--element <id>` or `--from <id> --to <id>` (with `--kind`) puts it on something else, `--detach` takes it off, `--color`, `--at <x,y>` (`--at ""` lets the designer place it) |
| `remove-sticky <view> <id>` | |
| `add-step <view> <from> <to>` | Sequence views only. `--description`, `--technology`, `--reply` (`<from>` answers `<to>`), `--step <n>` (insert it as step n; default: after the last) |
| `update-step <view> <n>` | `--from <id>`, `--to <id>`, `--description`, `--technology`, `--reply` / `--call`, `--move-to <n>` |
| `remove-step <view> <n>` | The steps after it move up one |
| `add-state <view> <id>` | State views only. `--name`, `--description`, `--initial` (the view starts here), `--final` (it can end here), `--at <x,y>` |
| `update-state <view> <id>` | `--name`, `--new-id <id>` (its transitions follow it), `--description`, `--initial` / `--not-initial`, `--final` / `--not-final`, `--at <x,y>` (`--at ""` lets the designer lay it out) |
| `remove-state <view> <id>` | Also removes the transitions to and from it |
| `add-transition <view> <from> <to>` | State views only; `<from>` and `<to>` can be the same state. `--event`, `--guard`, `--action`, `--transition <n>` (insert it as transition n; default: after the last) |
| `update-transition <view> <n>` | `--from <id>`, `--to <id>`, `--event`, `--guard`, `--action`, `--move-to <n>` |
| `remove-transition <view> <n>` | The transitions after it move up one |
| `add-node <view> <id>` | Deployment views only. `--name`, `--parent <node>` (the node of the view it's inside), `--technology`, `--description`, `--run <id>` (a container or system that runs in it; repeat for each), `--infrastructure` (like a load balancer: it runs nothing and holds no nodes), `--instances <n>` (how many copies run; default: 1), `--shape` (as for elements; drawn when it holds nothing) |
| `update-node <view> <id>` | `--name`, `--new-id <id>` (the nodes inside it and its connections follow it), `--parent` (`--parent ""` puts it at the top), `--technology`, `--description`, `--run` (replaces what it runs; `--run ""` runs nothing; connections to what it no longer runs go), `--infrastructure` / `--deployment-node`, `--instances` (`--instances ""` is 1 again), `--shape` |
| `remove-node <view> <id>` | Also removes the nodes inside it, and the connections to them and to what only they ran |
| `add-connection <view> <from> <to>` | Deployment views only. Each end is a node of the view, or a container or system one of its nodes runs; at least one is a node. `--description`, `--technology`, `--connection <n>` (insert it as connection n; default: after the last) |
| `update-connection <view> <n>` | `--from <id>`, `--to <id>`, `--description`, `--technology`, `--move-to <n>` |
| `remove-connection <view> <n>` | The connections after it move up one |
| `add-lane <view> <id>` | Event and flowchart views only. `--name`, `--description`, `--position <n>` (its place: from the top on an event view, and from the left on a flowchart. 1 is the first; default: after the last) |
| `update-lane <view> <id>` | `--name`, `--new-id <id>` (its cards or blocks follow it), `--description`, `--position <n>` (moves it; the lanes between move one place) |
| `remove-lane <view> <id>` | Its cards, or its blocks, stay, in no lane; its blocks are laid out again, as their `--at` was from its left |
| `add-card <view> <id>` | Event views only. `--kind <event\|command\|actor\|policy\|read-model\|external-system\|aggregate\|hotspot>` (default: event), `--name`, `--description`, `--lane <lane>` (default: none, in a row above the lanes), `--from <card>` (a card that leads to it, drawn as an arrow to it; repeat for each), `--position <n>` (its place along the timeline: 1 is the first; default: after the last) |
| `update-card <view> <id>` | `--kind`, `--name`, `--new-id <id>` (the cards that come from it follow it), `--description`, `--lane` (`--lane ""` takes it out of its lane), `--from` (replaces the cards it comes from; `--from ""` removes them all), `--position <n>` (moves it; the cards between move one place) |
| `remove-card <view> <id>` | Also removes the arrows to and from it |
| `add-screen <view> <id>` | Wireframe views only. `--name`, `--device <desktop\|tablet\|phone>` (default: desktop), `--description`, `--position <n>` (its place, left to right: 1 is the first; default: after the last) |
| `update-screen <view> <id>` | `--name`, `--new-id <id>` (the widgets that lead to it follow it), `--device` (`--device ""` is desktop again), `--description`, `--position <n>` (moves it; the screens between move one place) |
| `remove-screen <view> <id>` | Also removes the widgets on it; widgets on other screens that led to it lead nowhere |
| `add-widget <view> <id>` | Wireframe views only. `--kind <heading\|text\|button\|link\|input\|checkbox\|select\|image\|list\|table\|tabs\|divider\|panel\|row>` (required), `--screen <screen>` (the screen it goes on) or `--in <widget>` (the row or panel it goes in), `--text` (a list's items, a table's rows and tabs one to a line; a table's cells split by `\|`), `--to <screen>` (the screen it leads to, drawn as an arrow), `--description`, `--position <n>` (its place among the widgets there: 1 is the first; default: after the last) |
| `update-widget <view> <id>` | `--kind` (a row or panel with widgets in it stays a row or panel), `--text`, `--to` (`--to ""` leads nowhere), `--new-id <id>`, `--screen <screen>` (moves it onto that screen, out of any row or panel), `--in <widget>` (moves it into a row or panel; `--in ""` onto its screen), `--description`, `--position <n>` (moves it among the widgets where it is, or goes) |
| `remove-widget <view> <id>` | Also removes the widgets inside it |
| `add-shape <view> <id>` | Whiteboard views only. `--kind <rectangle\|ellipse\|diamond\|text\|pen>` (required), `--text` (needed on text; not on a pen), `--at <x,y>` or `--at <x,y,width,height>` (its top-left corner, and its size; default: under the shapes there are, 160 by 80, or as big as its text), `--points <"x,y x,y ...">` (a pen's points from its corner, two or more; required for a pen), `--size <small\|medium\|large\|huge>` (its text; default: medium), `--color <black\|grey\|red\|orange\|green\|blue\|purple>` (default: black), `--fill <white\|grey\|red\|orange\|yellow\|green\|blue\|purple>` (default: none; not on a pen), `--dashed` (not on text), `--position <n>` (its place from the back: 1 is drawn first; default: in front of the rest) |
| `update-shape <view> <id>` | `--kind` (a pen stays a pen, and nothing else becomes one), `--text` (text can't be left without any: remove it instead), `--new-id <id>` (the arrows to and from it follow it), `--at` (`x,y` moves it and keeps its size), `--points`, `--size`, `--color`, `--fill` (`--fill ""` makes it see-through), `--dashed` / `--solid`, `--position <n>` (moves it to that place from the back) |
| `remove-shape <view> <id>` | Also removes the arrows to and from it |
| `add-arrow <view> <id>` | Whiteboard views only. `--from <shape\|x,y>` and `--to <shape\|x,y>` (required: a shape, which the arrow follows, or a point), `--from-side <top\|right\|bottom\|left>` and `--to-side` (the side of its shape the end stays on, wherever the other end is, like a diamond's tip; default: it faces the other end), `--text`, `--heads <end\|both\|none>` (default: end; none is a line), `--color`, `--dashed` |
| `update-arrow <view> <id>` | `--from`, `--to` (on another shape, an end faces the other end unless it's given a side too; naming the shape it's on already keeps its side), `--from-side`, `--to-side` (put the end on that side of its shape; `""` lets it face the other end again), `--text`, `--new-id <id>`, `--heads` (`--heads ""` is end again), `--color`, `--dashed` / `--solid` |
| `remove-arrow <view> <id>` | |
| `add-block <view> <id>` | Flowchart views only. `--kind <start\|end\|process\|decision\|input-output\|subprocess\|document\|database>` (default: process), `--text` (what it says; default: from the id), `--description`, `--lane <lane>` (the lane it's in), `--at <x,y>` (its top-left corner; default: the designer lays it out. In a flowchart with lanes, x is from the left of its lane), `--position <n>` (its place in the view's list of blocks: 1 is the first; default: after the last) |
| `update-block <view> <id>` | `--kind` (`--kind ""` makes it a process again), `--text` (a block needs text), `--new-id <id>` (the flows to and from it follow it), `--description`, `--lane` (`--lane ""` takes it out of its lane), `--at` (`--at ""` lets the designer lay it out again), `--position <n>` (moves it to that place) |
| `remove-block <view> <id>` | Also removes the flows to and from it |
| `add-flow <view> <from> <to>` | Flowchart views only. `--text` (like `Yes` or `No` on the ways out of a decision), `--flow <n>` (its number: 1 is the first; default: after the last) |
| `update-flow <view> <n>` | `--from`, `--to`, `--text`, `--move-to <n>` |
| `remove-flow <view> <n>` | The ones after it move up one |
| `update-workspace` | `--name`, `--description`, `--docs <folder>` (`--docs ""` stops generating docs) |
| `apply [file\|-]` | A JSON list of operations, all or nothing (see below) |
| `init [file]` | `--name`, `--docs <folder>`, `--no-skills`, `--no-agents-md` |
| `fmt [--check]` | Rewrites the file in canonical form |

`--index` picks one relationship when an element has several to the same target: 0 is the first. Without it, the command says how many there are and what each describes.

A lane and a card are named by their IDs, each unique among its event view's lanes or cards; a flowchart's lanes are named the same way, and its blocks' `--lane` names one the view already has, so add the lane first. A card's `--from` names cards the view already has, so add a card after the ones that lead to it, or set it later with `update-card`.

A screen is named by its ID, unique among its wireframe view's screens, and a widget by its ID, unique among all the view's widgets, on every screen. A widget's `--to` names a screen the view already has, so add the screens first, or set it later with `update-widget`. A widget that leads to the screen it's on is a warning: no arrow is drawn.

A shape and an arrow are named by their IDs, each unique among its whiteboard's shapes or arrows. An arrow's end that's a shape names one the view already has, so add the shapes first. An arrow from a shape to itself is a warning: it isn't drawn.

A block is named by its ID, unique among its flowchart's blocks, and a flow by its number, as `show <view>` prints it: 1 is the first. A flow's ends name blocks the view already has, so add the blocks first. A flow can't go from a block to itself, or say what another between the same two blocks says. Check warns about a flowchart without a start, a decision with fewer than two ways out, a way out of a decision without text, a flow out of an end and one into a start.

A step is named by its number in its sequence view, as `show <view>` prints it: 1 is the first. A step from A to B needs a relationship in the model from A, or something inside A, to B, or something inside B, or one between them that goes both ways. A reply goes back along one from B to A. If there's none, the command refuses the step: add the relationship first.

## Operations for `apply`

`open-arch apply changes.json` (or `open-arch apply -` to read standard input) takes one operation or a list. The whole list is checked and applied together: if any operation fails, or the result would have errors, nothing is saved and the error names the operation.

Each operation has `"op"` and the fields below. In `update-*` operations, `null` removes a field.

| `op` | Fields (required in bold) |
|---|---|
| `add-element` | **id**, **kind**, parent, name, description, technology, external, shape, stereotype, members (a list of strings), libraries (a container's: a list of library IDs), tags (`{ "owner": "payments", "pii": "" }`), notes |
| `update-element` | **id**, name, parent, description, technology, external, shape, stereotype, members (replaces the list), libraries (replaces the list), tags (merged into the old ones; a `null` value removes that tag), notes |
| `remove-element` | **id** |
| `rename` | **id**, **to** |
| `add-relationship` | **from**, **to**, kind, bidirectional, description, technology, tags, notes |
| `update-relationship` | **from**, **to**, index, newFrom, newTo (the elements it moves to), kind, bidirectional (`false` makes it one-way), description, technology, tags (merged, like an element's), notes |
| `remove-relationship` | **from**, **to**, index |
| `add-view` | **id**, **level**, scope, title, description, include, exclude, notes |
| `update-view` | **id**, title, description, include, exclude, newElements (`"show"` or `"hide"`, not with include or exclude), notes |
| `remove-view` | **id** |
| `show-in-view` | **view**, **id** |
| `hide-in-view` | **view**, **id** |
| `set-layout` | **view**, **positions**: `{ "<element-id>": [x, y] }`, `null` removes one. Used by the designer; agents don't need it |
| `add-sticky` | **view**, **id**, **text**, on (`{ "element": "<id>" }`, or `{ "from": "<id>", "to": "<id>" }` with `"kind"` when it isn't an association), color, at (`[x, y]`) |
| `update-sticky` | **view**, **id**, text, on (`null` takes it off), color, at (`null` lets the designer place it) |
| `remove-sticky` | **view**, **id** |
| `add-step` | **view**, **from**, **to**, description, technology, reply (`true` for an answer), step (its number: 1 is the first; default: after the last) |
| `update-step` | **view**, **step**, from, to, description, technology, reply, newStep (the number to move it to) |
| `remove-step` | **view**, **step** |
| `add-state` | **view**, **id**, name, description, initial (`true` makes it where the view starts), final, at (`[x, y]`) |
| `update-state` | **view**, **id**, newId, name, description, initial, final, at (`null` lets the designer lay it out) |
| `remove-state` | **view**, **id** |
| `add-transition` | **view**, **from**, **to**, event, guard, action, transition (its number: 1 is the first; default: after the last) |
| `update-transition` | **view**, **transition**, from, to, event, guard, action, newTransition (the number to move it to) |
| `remove-transition` | **view**, **transition** |
| `add-node` | **view**, **id**, name, parent, description, technology, infrastructure, instances (a whole number, 1 or more), shape, runs (a list of container and system IDs) |
| `update-node` | **view**, **id**, newId, name, parent (`null` puts it at the top), description, technology, infrastructure, instances (`null` is 1), shape, runs (replaces the list) |
| `remove-node` | **view**, **id** |
| `add-connection` | **view**, **from**, **to**, description, technology, connection (its number: 1 is the first; default: after the last) |
| `update-connection` | **view**, **connection**, from, to, description, technology, newConnection (the number to move it to) |
| `remove-connection` | **view**, **connection** |
| `add-lane` | **view**, **id**, name, description, position (its place from the top, or on a flowchart from the left: 1 is the first; default: after the last) |
| `update-lane` | **view**, **id**, newId, name, description, position (the place to move it to) |
| `remove-lane` | **view**, **id** |
| `add-card` | **view**, **id**, kind (default: `"event"`), name, description, lane, from (a list of card IDs), position (its place along the timeline: 1 is the first; default: after the last) |
| `update-card` | **view**, **id**, newId, kind, name, description, lane (`null` takes it out of its lane), from (replaces the list; `null` removes it), position (the place to move it to) |
| `remove-card` | **view**, **id** |
| `add-screen` | **view**, **id**, name, description, device (default: `"desktop"`), position (its place, left to right: 1 is the first; default: after the last) |
| `update-screen` | **view**, **id**, newId, name, description, device, position (the place to move it to) |
| `remove-screen` | **view**, **id** |
| `add-widget` | **view**, **id**, **kind**, screen or in (the row or panel it goes in), text, description, to (the screen it leads to), position (its place among the widgets there: 1 is the first; default: after the last) |
| `update-widget` | **view**, **id**, newId, kind, text, description, to (`null` leads nowhere), screen (moves it onto that screen, out of any row or panel), in (moves it into that row or panel; `null` onto its screen), position (the place to move it to) |
| `remove-widget` | **view**, **id** |
| `add-shape` | **view**, **id**, **kind**, text, at (`[x, y]` or `[x, y, width, height]`), points (a pen's, `[[x, y], ...]`), size, color, fill, dashed, position (its place from the back: 1 is the first; default: in front of the rest) |
| `update-shape` | **view**, **id**, newId, kind, text, at (`[x, y]` keeps its size), points, size, color, fill (`null` makes it see-through), dashed, position (the place to move it to) |
| `remove-shape` | **view**, **id** |
| `add-arrow` | **view**, **id**, **from**, **to** (each a shape's ID, a shape and a side of it, `{ "shape": "paid", "side": "right" }`, or a point, `[x, y]`), fromSide, toSide (the side of its shape an end stays on), text, heads (default: `"end"`), color, dashed |
| `update-arrow` | **view**, **id**, newId, from, to (on another shape, an end faces the other end unless it's given a side; naming the shape it's on already keeps its side), fromSide, toSide (`null` lets the end face the other end again), text, heads, color, dashed |
| `remove-arrow` | **view**, **id** |
| `add-block` | **view**, **id**, kind (default: `"process"`), text, description, lane, at (`[x, y]`), position (its place in the list: 1 is the first; default: after the last) |
| `update-block` | **view**, **id**, newId, kind, text, description, lane (`null` takes it out of its lane), at (`null` lets the designer lay it out again), position (the place to move it to) |
| `remove-block` | **view**, **id** |
| `add-flow` | **view**, **from**, **to**, text, flow (its number: 1 is the first; default: after the last) |
| `update-flow` | **view**, **flow**, from, to, text, newFlow |
| `remove-flow` | **view**, **flow** |
| `update-workspace` | name, description, docs |

Example:

```json
[
  { "op": "add-element", "id": "notifications", "kind": "container", "parent": "shop", "name": "Notifications", "technology": "Go", "description": "Sends order emails.", "tags": { "owner": "checkout-team" } },
  { "op": "add-element", "id": "email-queue", "kind": "container", "parent": "shop", "name": "Email Queue", "technology": "RabbitMQ", "shape": "queue" },
  { "op": "add-relationship", "from": "checkout-api", "to": "email-queue", "description": "Queues order confirmations on", "technology": "AMQP" },
  { "op": "add-relationship", "from": "notifications", "to": "email-queue", "description": "Takes emails to send from", "technology": "AMQP" },
  { "op": "add-element", "id": "email-provider", "kind": "system", "name": "Email Provider", "external": true },
  { "op": "add-relationship", "from": "notifications", "to": "email-provider", "description": "Sends email using", "technology": "SMTP" },
  { "op": "update-element", "id": "checkout-api", "notes": "Publishes an `order-placed` event after payment." }
]
```
