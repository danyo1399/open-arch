# open-arch commands

Every command takes `--file <path>` to name the `.openarch` file; without it, the CLI uses the one in the current folder or the nearest folder above, or the only one up to three folders below.

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
| `open-arch show <view-id>` | The view's description and notes, its boxes, and its arrows with the relationships each stands for, and on a class view, each arrow's kind. For a sequence view: the elements in it, and its steps in order, with the relationships each goes along. For a state view: its states, with where it starts and can end, and its transitions in order. For a deployment view: its nodes, nested, with what each runs, its connections in order, and the arrows it draws between the copies of what runs where |
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
| `add-view <id>` | `--level <landscape\|context\|container\|component\|class\|sequence\|state\|deployment>` (required), `--scope <id>` (a container or library for a component view, a component or library for a class view, and for a state view, optionally, the element of any kind whose states it shows), `--title`, `--description`, `--include <a,b>`, `--exclude <a,b>`, `--notes <markdown>` or `--notes-file <path\|->`. Sequence and deployment views take no scope, include or exclude, and a state view no include or exclude |
| `update-view <id>` | `--title`, `--description`, `--include`, `--exclude`, `--new-elements <show\|hide>`, `--notes`, `--notes-file`. `--new-elements hide` lists the view's boxes in include, so elements added later stay out; `show` puts `*` back, excluding what it would add. Either keeps the boxes the view has now |
| `remove-view <id>` | |
| `show-in-view <view> <id>...` | Removes them from the view's exclude list, or adds them to include |
| `hide-in-view <view> <id>...` | Removes them from include, or adds them to exclude; the model is unchanged |
| `add-sticky <view> <id>` | `--text` (required), `--color <yellow\|pink\|blue\|green>`, `--at <x,y>` |
| `update-sticky <view> <id>` | `--text`, `--color`, `--at <x,y>` (`--at ""` lets the designer place it) |
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
| `update-workspace` | `--name`, `--description`, `--docs <folder>` (`--docs ""` stops generating docs) |
| `apply [file\|-]` | A JSON list of operations, all or nothing (see below) |
| `init [file]` | `--name`, `--docs <folder>`, `--no-skills`, `--no-agents-md` |
| `fmt [--check]` | Rewrites the file in canonical form |

`--index` picks one relationship when an element has several to the same target: 0 is the first. Without it, the command says how many there are and what each describes.

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
| `add-sticky` | **view**, **id**, **text**, color, at (`[x, y]`) |
| `update-sticky` | **view**, **id**, text, color, at (`null` lets the designer place it) |
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
