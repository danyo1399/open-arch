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
| `open-arch show <element-id>` | The element's fields, properties, notes, what it uses, what uses it (directly and through what's inside it), and the views showing it |
| `open-arch show <view-id>` | The view's boxes, and its arrows with the relationships each stands for |
| `open-arch check [--json] [--strict]` | Problems in the model; exits 1 on errors (or warnings, with `--strict`) |
| `open-arch export [folder] [--check]` | Writes the docs to the folder, or to the workspace's docs folder; `--check` exits 1 if they're out of date |

All of these accept `--json`.

## Changing

In `update-*` commands, only the options given change, and an empty value (`--technology ""`) removes a field. Lists like `--tags a,b` are comma-separated and replace the old list; `--tags ""` clears it.

| Command | Options |
|---|---|
| `add-element <id>` | `--kind <person\|system\|container\|component>` (required), `--parent <id>`, `--name`, `--description`, `--technology`, `--external`, `--tags <a,b>`, `--property <key=value>` (repeatable), `--notes <markdown>` or `--notes-file <path\|->` |
| `update-element <id>` | `--name`, `--parent`, `--description`, `--technology`, `--external` / `--internal`, `--tags`, `--property <key=value>` (`key=` removes it), `--notes`, `--notes-file` |
| `remove-element <id>` | Also removes what's inside it, views scoped to them, and every reference |
| `rename <old-id> <new-id>` | Works for elements and views; updates every reference |
| `add-relationship <from> <to>` | `--description`, `--technology`, `--tags` |
| `update-relationship <from> <to>` | `--index <n>`, `--description`, `--technology`, `--tags` |
| `remove-relationship <from> <to>` | `--index <n>` |
| `add-view <id>` | `--level <landscape\|context\|container\|component>` (required), `--scope <id>`, `--title`, `--description`, `--include <a,b>`, `--exclude <a,b>` |
| `update-view <id>` | `--title`, `--description`, `--include`, `--exclude` |
| `remove-view <id>` | |
| `show-in-view <view> <id>...` | Removes them from the view's exclude list, or adds them to include |
| `hide-in-view <view> <id>...` | Removes them from include, or adds them to exclude; the model is unchanged |
| `update-workspace` | `--name`, `--description`, `--docs <folder>` (`--docs ""` stops generating docs) |
| `apply [file\|-]` | A JSON list of operations, all or nothing (see below) |
| `init [file]` | `--name`, `--docs <folder>`, `--no-skills`, `--no-agents-md` |
| `fmt [--check]` | Rewrites the file in canonical form |

`--index` picks one relationship when an element has several to the same target: 0 is the first. Without it, the command says how many there are and what each describes.

## Operations for `apply`

`open-arch apply changes.json` (or `open-arch apply -` to read standard input) takes one operation or a list. The whole list is checked and applied together: if any operation fails, or the result would have errors, nothing is saved and the error names the operation.

Each operation has `"op"` and the fields below. In `update-*` operations, `null` removes a field.

| `op` | Fields (required in bold) |
|---|---|
| `add-element` | **id**, **kind**, parent, name, description, technology, external, tags, properties, notes |
| `update-element` | **id**, name, parent, description, technology, external, tags, properties (a `null` value removes that key), notes |
| `remove-element` | **id** |
| `rename` | **id**, **to** |
| `add-relationship` | **from**, **to**, description, technology, tags |
| `update-relationship` | **from**, **to**, index, description, technology, tags |
| `remove-relationship` | **from**, **to**, index |
| `add-view` | **id**, **level**, scope, title, description, include, exclude |
| `update-view` | **id**, title, description, include, exclude |
| `remove-view` | **id** |
| `show-in-view` | **view**, **id** |
| `hide-in-view` | **view**, **id** |
| `set-layout` | **view**, **positions**: `{ "<element-id>": [x, y] }`, `null` removes one. Used by the designer; agents don't need it |
| `update-workspace` | name, description, docs |

Example:

```json
[
  { "op": "add-element", "id": "notifications", "kind": "container", "parent": "shop", "name": "Notifications", "technology": "Go", "description": "Sends order emails." },
  { "op": "add-relationship", "from": "checkout-api", "to": "notifications", "description": "Asks it to send order confirmations", "technology": "AMQP" },
  { "op": "add-element", "id": "email-provider", "kind": "system", "name": "Email Provider", "external": true },
  { "op": "add-relationship", "from": "notifications", "to": "email-provider", "description": "Sends email using", "technology": "SMTP" },
  { "op": "update-element", "id": "checkout-api", "notes": "Publishes an `order-placed` event after payment." }
]
```
